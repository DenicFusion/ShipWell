import React, { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { sendEmailVerification, type User } from "firebase/auth";
import {
  AlertTriangle,
  Bell,
  Box,
  Check,
  Copy,
  DollarSign,
  Home,
  Mail,
  Plus,
  RefreshCw,
  Search,
  Truck,
} from "lucide-react";
import toast from "react-hot-toast";
import { useShipWell } from "@/components/providers/ShipWellProvider";
import { RouteArcMap, StageStepper } from "@/components/dashboard/RouteArcMap";
import {
  getEtaSummary,
  lastTsOf,
  myOpenAlertsForShipment,
} from "@/components/dashboard/useDashboardShipments";
import {
  formatTimeAgo,
  formatTrackingCode,
  getShipmentChip,
  normalizeEmail,
  type ShipmentAlert,
  type ShipmentRecord,
  type TrackingEvent,
} from "@/types/tracking";

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function DashboardOverview({
  user,
  displayName,
  incoming,
  sent,
  allUnique,
  openAlerts,
}: {
  user: User;
  displayName: string;
  incoming: ShipmentRecord[];
  sent: ShipmentRecord[];
  allUnique: ShipmentRecord[];
  openAlerts: { shipment: ShipmentRecord; alert: ShipmentAlert }[];
}) {
  const { openAction, refreshOpenAlerts } = useShipWell();
  const navigate = useNavigate();
  const [searchCode, setSearchCode] = useState("");
  const [verifyingBusy, setVerifyingBusy] = useState(false);

  const userEmail = normalizeEmail(user.email || "");
  const firstName = displayName.trim().split(/\s+/)[0] || "Customer";

  const liveIncoming = useMemo(
    () => incoming.filter((s) => s.status !== "Delivered"),
    [incoming]
  );

  const deliveredCount = useMemo(
    () => allUnique.filter((s) => s.status === "Delivered").length,
    [allUnique]
  );

  const featured = useMemo<ShipmentRecord | null>(() => {
    const active = allUnique.filter((s) => s.status !== "Delivered");
    if (active.length === 0) return null;
    const scored = active
      .map((s) => {
        const hasOpen = myOpenAlertsForShipment(s, userEmail).length > 0 ? 3 : 0;
        const hasHold = s.hold ? 2 : 0;
        const isInc =
          normalizeEmail(s.receiverEmail || s.receiver?.email) === userEmail
            ? 1
            : 0;
        return { s, score: hasOpen + hasHold + isInc };
      })
      .sort((a, b) => b.score - a.score || lastTsOf(b.s) - lastTsOf(a.s));
    return scored[0]?.s || null;
  }, [allUnique, userEmail]);

  const compactIncoming = useMemo(() => {
    return [...incoming]
      .sort(
        (a, b) =>
          Number(a.status === "Delivered") - Number(b.status === "Delivered") ||
          lastTsOf(b) - lastTsOf(a)
      )
      .slice(0, 4);
  }, [incoming]);

  const recentFeed = useMemo(() => {
    const items: { shipment: ShipmentRecord; event: TrackingEvent }[] = [];
    for (const s of allUnique) {
      for (const ev of s.events || []) {
        items.push({ shipment: s, event: ev });
      }
    }
    items.sort((a, b) => b.event.ts - a.event.ts);
    return items.slice(0, 6);
  }, [allUnique]);

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success(`Copied ${code}`);
    } catch {
      toast.error("Unable to copy tracking number");
    }
  };

  const handleTrackSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = formatTrackingCode(searchCode);
    if (clean.length < 3) return;
    navigate(`/dashboard/track/${encodeURIComponent(clean)}`);
  };

  const featuredMeta = useMemo(() => {
    if (!featured) return null;
    const chip = getShipmentChip(featured);
    const eta = getEtaSummary(featured);
    const isReceiver =
      normalizeEmail(featured.receiverEmail || featured.receiver?.email) ===
      userEmail;
    const evs = featured.events || [];
    const lastEv = evs.length > 0 ? evs[evs.length - 1] : null;
    return { chip, eta, isReceiver, lastEv };
  }, [featured, userEmail]);

  return (
    <>
      {/* Welcome Row */}
      <div className="dx-welcome">
        <div>
          <h1>
            {getGreeting()}, {firstName}
          </h1>
          <p>
            {liveIncoming.length
              ? `${liveIncoming.length} parcel${
                  liveIncoming.length > 1 ? "s" : ""
                } on the way to you.`
              : "No parcels are on the way to you right now."}{" "}
            {openAlerts.length
              ? `${openAlerts.length} action${
                  openAlerts.length > 1 ? "s" : ""
                } waiting for you.`
              : "Nothing needs your attention."}
          </p>
        </div>
        <div className="dx-acts">
          <Link className="sw-btn sw-btn-ghost" to="/dashboard/quote">
            <DollarSign className="w-4 h-4" />
            Get a quote
          </Link>
          <Link className="sw-btn sw-btn-em" to="/dashboard/ship">
            <Plus className="w-4 h-4" />
            Ship a parcel
          </Link>
        </div>
      </div>

      {/* Email Verification Prompt when unverified */}
      {!user.emailVerified && (
        <div
          className="dx-card"
          style={{
            padding: "16px 20px",
            borderColor: "rgba(245, 158, 11, 0.4)",
            background: "rgba(245, 158, 11, 0.06)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 14,
            flexWrap: "wrap",
          }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <Mail className="w-5 h-5 text-[var(--amber)] shrink-0" />
            <div>
              <b className="block text-sm">
                Verify your email to unlock incoming parcels
              </b>
              <small className="text-xs text-[var(--muted)]">
                Verify ownership of {user.email} so parcels sent to your address
                sync automatically.
              </small>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              disabled={verifyingBusy}
              className="sw-btn sw-btn-amber"
              style={{ padding: "8px 14px", fontSize: 12.5 }}
              onClick={async () => {
                setVerifyingBusy(true);
                try {
                  await sendEmailVerification(user);
                  toast.success("Verification email sent!");
                } catch {
                  toast.error("Could not send verification email right now");
                } finally {
                  setVerifyingBusy(false);
                }
              }}
            >
              Send verification email
            </button>
            <button
              type="button"
              className="sw-btn sw-btn-ghost"
              style={{ padding: "8px 14px", fontSize: 12.5 }}
              onClick={async () => {
                await user.reload().catch(() => null);
                window.location.reload();
              }}
            >
              <RefreshCw className="w-3.5 h-3.5" />
              I verified
            </button>
          </div>
        </div>
      )}

      {/* Attention Strip */}
      {openAlerts.length > 0 && (
        <div className="dx-alert">
          <div className="ai">
            <span className="ic">
              <AlertTriangle className="w-5 h-5" />
            </span>
          </div>
          <div className="t">
            <b>
              {openAlerts.length === 1
                ? "One thing needs your attention"
                : `${openAlerts.length} things need your attention`}
            </b>
            <small>
              {openAlerts[0].alert.title} · {openAlerts[0].shipment.code}
            </small>
          </div>
          <button
            type="button"
            className="sw-btn sw-btn-em"
            onClick={() =>
              openAction(openAlerts[0].shipment, openAlerts[0].alert, async () => {
                await refreshOpenAlerts();
              })
            }
          >
            Take action
          </button>
        </div>
      )}

      {/* 4 Clickable Stat Cards */}
      <div className="dx-stats">
        <Link className="dx-stat" to="/dashboard/incoming">
          <div className="si">
            <span className="ic">
              <Home className="w-[19px] h-[19px]" />
            </span>
          </div>
          <div>
            <b>{liveIncoming.length}</b>
            <small>On its way to you</small>
          </div>
        </Link>

        <Link className="dx-stat b" to="/dashboard/sent">
          <div className="si">
            <span className="ic">
              <Truck className="w-[19px] h-[19px]" />
            </span>
          </div>
          <div>
            <b>{sent.length}</b>
            <small>Sent by you</small>
          </div>
        </Link>

        <Link
          className={`dx-stat ${openAlerts.length > 0 ? "hot" : ""}`}
          to="/dashboard/alerts"
        >
          <div className="si">
            <span className="ic">
              <Bell className="w-[19px] h-[19px]" />
            </span>
          </div>
          <div>
            <b>{openAlerts.length}</b>
            <small>Action required</small>
          </div>
        </Link>

        <Link className="dx-stat" to="/dashboard/incoming">
          <div className="si">
            <span className="ic">
              <Check className="w-[19px] h-[19px]" />
            </span>
          </div>
          <div>
            <b>{deliveredCount}</b>
            <small>Delivered</small>
          </div>
        </Link>
      </div>

      {/* Main Two-Column Grid */}
      <div className="dx-grid">
        <div className="dx-col">
          {featured && featuredMeta ? (
            <section className="dx-live">
              <div className="in">
                <div className="dx-livehead">
                  <div>
                    <div className="dx-eyebrow">
                      {featuredMeta.isReceiver
                        ? "On its way to you"
                        : "Your shipment · live"}
                    </div>
                    <h3 style={{ marginTop: 10 }}>{featured.contents}</h3>
                    <div className="sub">
                      {featuredMeta.isReceiver ? (
                        <>
                          From <b>{featured.sender.name}</b>
                        </>
                      ) : (
                        <>
                          To <b>{featured.receiver.name}</b>
                        </>
                      )}{" "}
                      · {featured.sender.city} → {featured.receiver.city}
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-end",
                      gap: 8,
                    }}
                  >
                    <span className={`chip ${featuredMeta.chip.tone}`}>
                      {featuredMeta.chip.label}
                    </span>
                    <span className="dx-code">
                      {featured.code}
                      <button
                        type="button"
                        onClick={() => copyCode(featured.code)}
                        aria-label="Copy tracking number"
                      >
                        <span className="ic">
                          <Copy className="w-3.5 h-3.5" />
                        </span>
                      </button>
                    </span>
                  </div>
                </div>

                <RouteArcMap
                  originCity={featured.sender.city}
                  originCountry={featured.sender.country}
                  destCity={featured.receiver.city}
                  destCountry={featured.receiver.country}
                  status={featured.status}
                  isHeld={Boolean(featured.hold)}
                />

                <StageStepper
                  status={featured.status}
                  isHeld={Boolean(featured.hold)}
                />

                <div
                  className="dxt-status"
                  style={{ alignItems: "center" }}
                >
                  <div className="dx-ps" style={{ maxWidth: 460 }}>
                    <b>{featuredMeta.lastEv?.label || "Booked"}</b>
                    {featuredMeta.lastEv?.loc
                      ? ` · ${featuredMeta.lastEv.loc}`
                      : ""}
                    <br />
                    <span style={{ color: "var(--faint)" }}>
                      {featuredMeta.lastEv?.ts
                        ? formatTimeAgo(featuredMeta.lastEv.ts)
                        : ""}
                    </span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 16,
                      flexWrap: "wrap",
                    }}
                  >
                    <div className="dxt-eta">
                      <small>{featuredMeta.eta.k}</small>
                      <b>{featuredMeta.eta.v}</b>
                      <span>{featuredMeta.eta.sub}</span>
                    </div>
                    <Link
                      className="sw-btn sw-btn-em"
                      to={`/dashboard/track/${featured.code}`}
                    >
                      Full tracking →
                    </Link>
                  </div>
                </div>
              </div>
            </section>
          ) : (
            <div className="dx-empty">
              <div className="au-ic">
                <Truck className="w-6 h-6" />
              </div>
              <h3>NO ACTIVE SHIPMENTS</h3>
              <p>
                When someone ships to <b>{user.email}</b>, or you book a parcel,
                live tracking appears here.
              </p>
              <div className="acts">
                <Link className="sw-btn sw-btn-em sw-btn-lg" to="/dashboard/ship">
                  Ship something
                </Link>
                <Link
                  className="sw-btn sw-btn-ghost sw-btn-lg"
                  to="/dashboard/track"
                >
                  Track a parcel
                </Link>
              </div>
            </div>
          )}

          {incoming.length > 0 && (
            <div className="dx-card">
              <div className="dx-ch">
                <h3>On Its Way To You</h3>
                <Link to="/dashboard/incoming">View all →</Link>
              </div>
              <div className="dx-rows" style={{ marginTop: 10 }}>
                {compactIncoming.map((s) => {
                  const chip = getShipmentChip(s);
                  return (
                    <Link
                      key={s.code}
                      className="dx-rw"
                      to={`/dashboard/track/${s.code}`}
                    >
                      <div className="rt">
                        {s.photos && s.photos.length > 0 ? (
                          <img src={s.photos[0]} alt={s.contents} />
                        ) : (
                          <span className="ic">
                            <Box className="w-[18px] h-[18px]" />
                          </span>
                        )}
                      </div>
                      <div className="rm">
                        <b>{s.contents}</b>
                        <small>
                          From {s.sender.name} · {s.sender.city} →{" "}
                          {s.receiver.city}
                        </small>
                      </div>
                      <span className={`chip ${chip.tone}`}>{chip.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Track a parcel + Recent activity */}
        <div className="dx-col">
          <div className="dx-card">
            <div className="dx-ch">
              <h3>Track a parcel</h3>
            </div>
            <div className="dx-cb">
              <form
                className="dxt-form col"
                onSubmit={handleTrackSubmit}
                noValidate
              >
                <div className="in">
                  <span className="ic">
                    <Search className="w-[18px] h-[18px]" />
                  </span>
                  <input
                    value={searchCode}
                    onChange={(e) =>
                      setSearchCode(formatTrackingCode(e.target.value))
                    }
                    placeholder="SW-20260531-A8F4B2C1"
                    aria-label="Tracking number"
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                  />
                </div>
                <button
                  type="submit"
                  className="sw-btn sw-btn-em"
                  style={{ height: 46 }}
                >
                  Track
                </button>
              </form>
            </div>
          </div>

          <div className="dx-card">
            <div className="dx-ch">
              <h3>Recent activity</h3>
            </div>
            {recentFeed.length > 0 ? (
              <div className="dx-feed">
                {recentFeed.map(({ shipment, event }) => (
                  <div
                    key={`${shipment.code}_${event.id}`}
                    className="dx-fi"
                  >
                    <i
                      className={
                        event.kind === "delay"
                          ? "d"
                          : event.kind === "action"
                            ? "a"
                            : ""
                      }
                    />
                    <div>
                      <b>{event.label}</b>
                      <small>
                        {event.loc ? `${event.loc} · ` : ""}
                        {formatTimeAgo(event.ts)} ·{" "}
                        <Link to={`/dashboard/track/${shipment.code}`}>
                          {shipment.code}
                        </Link>
                      </small>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div
                className="dx-cb"
                style={{ color: "var(--faint)", fontSize: 13.5 }}
              >
                Activity from your parcels will show up here.
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
