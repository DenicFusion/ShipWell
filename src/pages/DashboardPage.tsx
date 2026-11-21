import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { sendEmailVerification } from "firebase/auth";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import {
  AlertCircle,
  Calendar,
  Check,
  CreditCard,
  Loader2,
  Lock,
  Mail,
  MapPin,
  Package,
  RefreshCw,
  Shield,
} from "lucide-react";
import { db } from "@/lib/firebase";
import { useShipWell } from "@/components/providers/ShipWellProvider";
import {
  checkAccountExists,
  fetchCustomerShipments,
} from "@/lib/firestore-shipments";
import { formatShortDay, SERVICES } from "@/lib/quote-engine";
import {
  getShipmentChip,
  getStagePercent,
  normalizeEmail,
  type ShipmentAlert,
  type ShipmentRecord,
} from "@/types/tracking";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import toast from "react-hot-toast";

export default function DashboardPage() {
  const {
    user,
    profile,
    authReady,
    openAuth,
    openAction,
    refreshOpenAlerts,
  } = useShipWell();

  const [tab, setTab] = useState<"in" | "sent" | "alerts">("in");
  const [loading, setLoading] = useState(true);
  const [incoming, setIncoming] = useState<ShipmentRecord[]>([]);
  const [sent, setSent] = useState<ShipmentRecord[]>([]);
  const [receiverStatusMap, setReceiverStatusMap] = useState<
    Record<string, boolean>
  >({});

  const loadData = useCallback(async () => {
    if (!user || !user.email) {
      return;
    }
    try {
      const res = await fetchCustomerShipments({
        uid: user.uid,
        email: user.email,
        emailVerified: user.emailVerified,
      });
      setIncoming(res.incoming);
      setSent(res.sent);

      const uniqueEmails = Array.from(
        new Set(res.sent.map((s) => s.receiverEmail).filter(Boolean))
      );
      const pairs = await Promise.all(
        uniqueEmails.map(async (em) => [em, await checkAccountExists(em)] as const)
      );
      setReceiverStatusMap(Object.fromEntries(pairs));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!authReady || !user || !user.email) return;
    loadData();

    const cleanEmail = normalizeEmail(user.email);
    const unsubSent = onSnapshot(
      query(collection(db, "shipments"), where("senderId", "==", user.uid)),
      () => {
        loadData();
        refreshOpenAlerts();
      },
      () => undefined
    );

    const unsubIncoming =
      user.emailVerified && cleanEmail
        ? onSnapshot(
            query(
              collection(db, "shipments"),
              where("receiverEmail", "==", cleanEmail)
            ),
            () => {
              loadData();
              refreshOpenAlerts();
            },
            () => undefined
          )
        : () => undefined;

    return () => {
      unsubSent();
      unsubIncoming();
    };
  }, [authReady, user, loadData, refreshOpenAlerts]);

  if (!authReady) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navbar />
        <main className="sw-main flex-1">
          <div className="wrap py-24 flex flex-col items-center gap-3 text-[var(--muted)]">
            <Loader2 className="w-7 h-7 animate-spin text-[var(--em)]" />
            <span>Loading dashboard...</span>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navbar />
        <main className="sw-main flex-1">
          <div className="wrap" style={{ padding: "56px 18px 96px" }}>
            <div className="ds-empty" style={{ maxWidth: 520, margin: "0 auto" }}>
              <div className="au-ic">
                <Lock className="w-6 h-6" />
              </div>
              <h3>SIGN IN TO SEE YOUR SHIPMENTS</h3>
              <p>
                Parcels sent to your email and shipments you booked appear here
                automatically.
              </p>
              <div className="flex gap-3 justify-center flex-wrap">
                <button
                  type="button"
                  className="sw-btn sw-btn-em"
                  onClick={() => openAuth({ mode: "login" })}
                >
                  Log in
                </button>
                <button
                  type="button"
                  className="sw-btn sw-btn-ghost"
                  onClick={() => openAuth({ mode: "signup" })}
                >
                  Create free account
                </button>
              </div>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  const displayName =
    profile?.name || user.displayName || user.email?.split("@")[0] || "Customer";
  const firstName = displayName.split(/\s+/)[0];

  const allAlerts: { shipment: ShipmentRecord; alert: ShipmentAlert }[] = [];
  incoming.forEach((s) => {
    (s.alerts || [])
      .filter((a) => a.to === "receiver")
      .forEach((alert) => allAlerts.push({ shipment: s, alert }));
  });
  sent.forEach((s) => {
    (s.alerts || [])
      .filter((a) => a.to === "sender")
      .forEach((alert) => allAlerts.push({ shipment: s, alert }));
  });

  const openAlerts = allAlerts.filter((x) => x.alert.status === "open");
  const resolvedAlerts = allAlerts.filter((x) => x.alert.status === "resolved");
  const deliveredCount = [...incoming, ...sent].filter(
    (s) => s.status === "Delivered"
  ).length;

  const renderShipmentCard = (
    s: ShipmentRecord,
    direction: "incoming" | "sent"
  ) => {
    const chip = getShipmentChip(s);
    const pct = getStagePercent(s.status);
    const role = direction === "incoming" ? "receiver" : "sender";
    const cardAlerts = (s.alerts || []).filter(
      (a) => a.status === "open" && a.to === role
    );
    const receiverOnShipWell = receiverStatusMap[s.receiverEmail];

    return (
      <div className="ds-card" key={`${direction}_${s.code}`}>
        <div className="ds-th">
          {s.photos && s.photos.length > 0 ? (
            <img src={s.photos[0]} alt={s.contents} />
          ) : (
            <Package className="w-8 h-8" />
          )}
          {s.photos && s.photos.length > 1 && <em>{s.photos.length} photos</em>}
        </div>

        <div className="min-w-0">
          <div className="ds-top">
            <b>{s.contents}</b>
            <span className={`chip ${chip.tone}`}>{chip.label}</span>
          </div>

          <div className="ds-sub">
            {direction === "incoming" ? (
              <>
                From {s.sender.name} · {s.sender.city} → {s.receiver.city}
              </>
            ) : (
              <>
                To {s.receiver.name} · {s.sender.city} → {s.receiver.city} ·{" "}
                {receiverOnShipWell ? (
                  <span className="ok">
                    ✓ {s.receiver.email} is on ShipWell
                  </span>
                ) : (
                  <span className="wait">
                    Waiting for {s.receiver.email} to sign up
                  </span>
                )}
              </>
            )}
          </div>

          <div className={`ds-bar ${s.hold ? "a" : ""}`}>
            <i style={{ width: `${pct}%` }} />
          </div>

          <div className="ds-meta">
            <span className="mono">{s.code}</span>
            <span>
              {s.status === "Delivered"
                ? `Delivered ${s.deliveredAt ? formatShortDay(s.deliveredAt) : ""}`
                : `ETA ${formatShortDay(s.eta)}`}
            </span>
            <span>{SERVICES[s.service].name}</span>
          </div>

          {cardAlerts.map((al) => (
            <button
              key={al.id}
              type="button"
              className="ds-act"
              onClick={() =>
                openAction(s, al, async () => {
                  await refreshOpenAlerts();
                  await loadData();
                })
              }
            >
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span className="flex-1 font-medium">{al.title}</span>
              <span className="font-semibold">Take action →</span>
            </button>
          ))}
        </div>

        <Link
          to={`/track/${s.code}`}
          className="sw-btn sw-btn-ghost"
          style={{ padding: "10px 16px", fontSize: 13 }}
        >
          Track live →
        </Link>
      </div>
    );
  };

  const renderAlertIcon = (kind: ShipmentAlert["kind"]) => {
    if (kind === "duty") return <CreditCard className="w-5 h-5" />;
    if (kind === "address") return <MapPin className="w-5 h-5" />;
    if (kind === "id") return <Shield className="w-5 h-5" />;
    if (kind === "reschedule") return <Calendar className="w-5 h-5" />;
    return <AlertCircle className="w-5 h-5" />;
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="sw-main flex-1">
        <div className="wrap">
      <div className="ds-head">
        <div>
          <div className="eyebrow">Your Shipments</div>
          <h1>HELLO, {firstName.toUpperCase()}</h1>
          <p>
            Signed in as <b>{user.email}</b> — parcels sent to this address
            appear automatically.
          </p>
        </div>
        <Link className="sw-btn sw-btn-em" to="/ship">
          Ship a parcel
        </Link>
      </div>

      {!user.emailVerified && (
        <div
          className="panel"
          style={{
            marginBottom: 20,
            padding: "16px 20px",
            borderColor: "rgba(245,158,11,0.4)",
            background: "rgba(245,158,11,0.06)",
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
              <b className="block text-sm">Verify your email to see incoming parcels</b>
              <small className="text-xs text-[var(--muted)]">
                We protect recipient privacy by requiring verified email ownership before showing parcels addressed to {user.email}.
              </small>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="sw-btn sw-btn-amber"
              style={{ padding: "8px 14px", fontSize: 12.5 }}
              onClick={async () => {
                await sendEmailVerification(user).catch(() => null);
                toast.success("Verification email sent!");
              }}
            >
              Send verification email
            </button>
            <button
              type="button"
              className="sw-btn sw-btn-ghost"
              style={{ padding: "8px 14px", fontSize: 12.5 }}
              onClick={async () => {
                await user.reload();
                await loadData();
              }}
            >
              <RefreshCw className="w-3.5 h-3.5" />
              I verified
            </button>
          </div>
        </div>
      )}

      {/* 4 STAT CARDS */}
      <div className="ds-stats">
        <div className="ds-stat">
          <small>On its way to you</small>
          <b>{incoming.length}</b>
        </div>
        <div className="ds-stat">
          <small>Sent by you</small>
          <b>{sent.length}</b>
        </div>
        <div className={`ds-stat ${openAlerts.length > 0 ? "hot" : ""}`}>
          <small>Action required</small>
          <b>{openAlerts.length}</b>
        </div>
        <div className="ds-stat good">
          <small>Delivered</small>
          <b>{deliveredCount}</b>
        </div>
      </div>

      {/* 3 TABS */}
      <div className="ds-tabs">
        <button
          type="button"
          className={tab === "in" ? "on" : ""}
          onClick={() => setTab("in")}
        >
          On Its Way To You <i>{incoming.length}</i>
        </button>
        <button
          type="button"
          className={tab === "sent" ? "on" : ""}
          onClick={() => setTab("sent")}
        >
          Sent By You <i>{sent.length}</i>
        </button>
        <button
          type="button"
          className={tab === "alerts" ? "on" : ""}
          onClick={() => setTab("alerts")}
        >
          Action Required <i>{openAlerts.length}</i>
        </button>
      </div>

      {loading ? (
        <div className="py-16 text-center text-[var(--muted)] flex flex-col items-center gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-[var(--em)]" />
          <span>Syncing your shipments...</span>
        </div>
      ) : (
        <div className="ds-list">
          {tab === "in" &&
            (incoming.length > 0 ? (
              incoming.map((s) => renderShipmentCard(s, "incoming"))
            ) : (
              <div className="ds-empty">
                <div className="au-ic">
                  <Package className="w-6 h-6" />
                </div>
                <h3>NO PARCELS ON THE WAY</h3>
                <p>
                  Whenever someone books a parcel with <b>{user.email}</b> as
                  the recipient, it appears here automatically with live updates
                  and item photos.
                </p>
                <Link to="/track" className="sw-btn sw-btn-ghost">
                  Track a number
                </Link>
              </div>
            ))}

          {tab === "sent" &&
            (sent.length > 0 ? (
              sent.map((s) => renderShipmentCard(s, "sent"))
            ) : (
              <div className="ds-empty">
                <div className="au-ic">
                  <Package className="w-6 h-6" />
                </div>
                <h3>NO SHIPMENTS SENT YET</h3>
                <p>
                  Book a collection in under three minutes and get your tracking
                  number right away.
                </p>
                <Link to="/ship" className="sw-btn sw-btn-em">
                  Ship a parcel
                </Link>
              </div>
            ))}

          {tab === "alerts" && (
            <>
              {openAlerts.length > 0 ? (
                openAlerts.map(({ shipment, alert }) => (
                  <div className="al-card" key={alert.id}>
                    <div className="ai">{renderAlertIcon(alert.kind)}</div>
                    <div className="tx">
                      <b>{alert.title}</b>
                      <p>{alert.message}</p>
                      <small className="mono">
                        Shipment {shipment.code} · {shipment.contents}
                      </small>
                      <button
                        type="button"
                        className="sw-btn sw-btn-blue"
                        onClick={() =>
                          openAction(shipment, alert, async () => {
                            await refreshOpenAlerts();
                            await loadData();
                          })
                        }
                      >
                        Take action →
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="ds-empty">
                  <div className="au-ic">
                    <Check className="w-6 h-6" />
                  </div>
                  <h3>ALL CAUGHT UP</h3>
                  <p>
                    You have no pending duties, address confirmations, or
                    document requests.
                  </p>
                </div>
              )}

              {resolvedAlerts.length > 0 && (
                <>
                  <div className="hd2">Completed</div>
                  {resolvedAlerts.map(({ shipment, alert }) => (
                    <div className="al-card done" key={alert.id}>
                      <div className="ai">
                        <Check className="w-5 h-5" />
                      </div>
                      <div className="tx">
                        <b>{alert.title}</b>
                        <p>{alert.response || "Resolved"}</p>
                        <small className="mono">
                          Shipment {shipment.code} · {shipment.contents}
                        </small>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
