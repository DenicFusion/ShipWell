import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { User } from "firebase/auth";
import {
  AlertTriangle,
  Bell,
  Box,
  Calendar,
  Check,
  CheckCircle2,
  Copy,
  CreditCard,
  Eye,
  Home,
  Loader2,
  Lock,
  MapPin,
  Search,
  Shield,
  Truck,
  X,
} from "lucide-react";
import toast from "react-hot-toast";
import { auth } from "@/lib/firebase";
import { apiFetch } from "@/lib/api-client";
import { useShipWell } from "@/components/providers/ShipWellProvider";
import { RouteArcMap, StageStepper } from "@/components/dashboard/RouteArcMap";
import { CustomsLedger } from "@/components/tracking/CustomsLedger";
import { ManualPaymentPanel } from "@/components/payments/ManualPaymentPanel";
import {
  getEtaSummary,
  myOpenAlertsForShipment,
  useTrackedShipmentLive,
} from "@/components/dashboard/useDashboardShipments";
import { formatDateTime, formatMoney, SERVICES } from "@/lib/quote-engine";
import {
  formatTimeAgo,
  formatTrackingCode,
  getParcels,
  getShipmentChip,
  isValidTrackingCode,
  normalizeEmail,
  STAGE_HEAD,
  type AlertKind,
  type ManualPaymentRecord,
  type ShipmentRecord,
  type TrackingEvent,
} from "@/types/tracking";

function renderAlertIcon(kind: AlertKind) {
  if (kind === "duty") return <CreditCard className="w-5 h-5" />;
  if (kind === "address") return <MapPin className="w-5 h-5" />;
  if (kind === "id") return <Shield className="w-5 h-5" />;
  if (kind === "reschedule") return <Calendar className="w-5 h-5" />;
  if (kind === "item") return <AlertTriangle className="w-5 h-5" />;
  return <Bell className="w-5 h-5" />;
}

function renderEventIcon(ev: TrackingEvent, isCurrentActive: boolean) {
  if (isCurrentActive) return <Truck className="w-[15px] h-[15px]" />;
  if (ev.kind === "delay") return <AlertTriangle className="w-[15px] h-[15px]" />;
  if (ev.kind === "action") return <Bell className="w-[15px] h-[15px]" />;
  if (ev.kind === "review") return <Eye className="w-[15px] h-[15px]" />;
  return <Check className="w-[15px] h-[15px]" />;
}

export function DashboardTrack({
  routeCode,
  user,
  isAdmin,
  allUnique,
  receiverStatusMap,
}: {
  routeCode: string;
  user: User;
  isAdmin: boolean;
  allUnique: ShipmentRecord[];
  receiverStatusMap: Record<string, boolean>;
}) {
  const navigate = useNavigate();
  const { openAction, openPhotoZoom, refreshOpenAlerts } = useShipWell();

  const normalizedRouteCode = useMemo(
    () => (routeCode ? formatTrackingCode(routeCode) : ""),
    [routeCode]
  );

  const [draftInput, setDraftInput] = useState<{
    forRoute: string;
    value: string;
  }>({ forRoute: normalizedRouteCode, value: normalizedRouteCode });

  const inputCode =
    draftInput.forRoute === normalizedRouteCode
      ? draftInput.value
      : normalizedRouteCode;

  const setInputCode = (val: string) => {
    setDraftInput({ forRoute: normalizedRouteCode, value: val });
  };

  const validFormat =
    normalizedRouteCode.length > 0 && isValidTrackingCode(normalizedRouteCode);

  const { loading, accessMode, shipment, teaser } = useTrackedShipmentLive({
    code: validFormat ? normalizedRouteCode : "",
    uid: user.uid,
    email: user.email,
    emailVerified: user.emailVerified,
    isAdmin,
  });

  const quickChips = useMemo(() => {
    return allUnique.slice(0, 5).map((s) => s.code);
  }, [allUnique]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const formatted = formatTrackingCode(inputCode);
    if (formatted.length < 3) return;
    navigate(`/dashboard/track/${encodeURIComponent(formatted)}`);
  };

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success(`Copied ${code}`);
    } catch {
      toast.error("Unable to copy tracking number");
    }
  };

  const userEmail = normalizeEmail(user.email || "");

  return (
    <>
      {/* Finder card */}
      <section className="dxt-find">
        <h3>Track a parcel</h3>
        <p>
          Paste any ShipWell tracking number. Codes are converted to uppercase
          automatically.
        </p>
        <form className="dxt-form" onSubmit={handleSubmit} noValidate>
          <div className="in">
            <span className="ic">
              <Search className="w-[19px] h-[19px]" />
            </span>
            <input
              value={inputCode}
              onChange={(e) => setInputCode(formatTrackingCode(e.target.value))}
              placeholder="SW-20260531-A8F4B2C1"
              aria-label="Tracking number"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
            />
          </div>
          <button type="submit" className="sw-btn sw-btn-em">
            Track
          </button>
        </form>
        {quickChips.length > 0 && (
          <div className="dxt-mine">
            <small>Your parcels</small>
            {quickChips.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => navigate(`/dashboard/track/${c}`)}
              >
                {c}
              </button>
            ))}
          </div>
        )}
      </section>

      {/* No code entered */}
      {!normalizedRouteCode && (
        <div className="dx-empty">
          <div className="au-ic">
            <Search className="w-6 h-6" />
          </div>
          <h3>WHERE IS YOUR PARCEL?</h3>
          <p>
            Enter a tracking number above to see live status, every checkpoint,
            item photos and delivery updates.
          </p>
        </div>
      )}

      {/* Invalid format */}
      {normalizedRouteCode && !validFormat && (
        <div className="dx-empty">
          <div className="au-ic" style={{ color: "#fb7185", borderColor: "rgba(244,63,94,0.3)", background: "rgba(244,63,94,0.1)" }}>
            <X className="w-6 h-6" />
          </div>
          <h3>CHECK THE NUMBER</h3>
          <p>
            That does not look like a full ShipWell tracking number. The format
            is <code>SW-20260531-A8F4B2C1</code>.
          </p>
        </div>
      )}

      {/* Loading skeleton */}
      {validFormat && loading && (
        <div className="flex flex-col gap-5" aria-busy="true">
          <div className="dx-skel" style={{ height: 340 }} />
          <div className="dxt-cols">
            <div className="dx-skel" style={{ height: 280 }} />
            <div className="dx-skel" style={{ height: 280 }} />
          </div>
        </div>
      )}

      {/* Unknown / not found */}
      {validFormat && !loading && accessMode === "not_found" && (
        <div className="dx-empty">
          <div className="au-ic" style={{ color: "#fb7185", borderColor: "rgba(244,63,94,0.3)", background: "rgba(244,63,94,0.1)" }}>
            <X className="w-6 h-6" />
          </div>
          <h3>NO SHIPMENT FOUND</h3>
          <p>
            We could not find a shipment for <code>{normalizedRouteCode}</code>.
            Check the number and try again.
          </p>
        </div>
      )}

      {/* Full shipment view for sender, verified receiver, or admin */}
      {validFormat && !loading && accessMode === "full" && shipment && (
        <FullTrackedContent
          shipment={shipment}
          userEmail={userEmail}
          userUid={user.uid}
          isAdmin={isAdmin}
          receiverStatusMap={receiverStatusMap}
          onCopy={copyCode}
          onOpenAction={(al) =>
            openAction(shipment, al, async () => {
              await refreshOpenAlerts();
            })
          }
          onZoomPhoto={(src, alt) => openPhotoZoom(src, alt)}
        />
      )}

      {/* Public summary fallback when valid tracking code is not linked to user */}
      {validFormat && !loading && accessMode === "public" && teaser && (
        <PublicTrackedContent teaser={teaser} onCopy={copyCode} />
      )}
    </>
  );
}

function FullTrackedContent({
  shipment,
  userEmail,
  userUid,
  isAdmin,
  receiverStatusMap,
  onCopy,
  onOpenAction,
  onZoomPhoto,
}: {
  shipment: ShipmentRecord;
  userEmail: string;
  userUid: string;
  isAdmin: boolean;
  receiverStatusMap: Record<string, boolean>;
  onCopy: (code: string) => void;
  onOpenAction: (alert: NonNullable<ShipmentRecord["alerts"]>[number]) => void;
  onZoomPhoto: (src: string, alt: string) => void;
}) {
  const isReceiver =
    normalizeEmail(shipment.receiverEmail || shipment.receiver.email) ===
    userEmail;
  const isSender =
    shipment.senderId === userUid ||
    normalizeEmail(shipment.senderEmail || shipment.sender.email) === userEmail;
  const role: "receiver" | "sender" | "admin" = isReceiver
    ? "receiver"
    : isSender
      ? "sender"
      : isAdmin
        ? "admin"
        : "sender";

  const fin = shipment.status === "Delivered";
  const held = Boolean(shipment.hold) && !fin;
  const chip = getShipmentChip(shipment);
  const eta = getEtaSummary(shipment);
  const events = useMemo(() => shipment.events || [], [shipment.events]);
  const lastEv = events.length > 0 ? events[events.length - 1] : null;
  const toneClass = fin
    ? "ok"
    : held
      ? shipment.hold?.type === "Delayed"
        ? "warn"
        : "bad"
      : "";
  const openAlerts = myOpenAlertsForShipment(shipment, userEmail);
  const recEmail = normalizeEmail(
    shipment.receiverEmail || shipment.receiver.email
  );
  const receiverOnShipWell = Boolean(receiverStatusMap[recEmail]);
  const reversedEvents = useMemo(() => [...events].reverse(), [events]);

  const [searchParams] = useSearchParams();
  const isBookingRedirect =
    searchParams.get("paid") === "1" && searchParams.get("booking") === "1";
  const [bookingManualPay, setBookingManualPay] =
    useState<ManualPaymentRecord | null>(null);

  useEffect(() => {
    if (!isSender && !isAdmin) return;
    if (
      !shipment.paymentId &&
      shipment.paymentStatus !== "awaiting_payment" &&
      shipment.paymentStatus !== "pending_review" &&
      shipment.paymentStatus !== "rejected" &&
      shipment.paymentStatus !== "info_requested" &&
      shipment.paymentStatus !== "expired"
    ) {
      return;
    }
    let active = true;
    auth.currentUser
      ?.getIdToken()
      .then((token) =>
        apiFetch<{ ok: boolean; payments: ManualPaymentRecord[] }>(
          `/api/payments/my?code=${encodeURIComponent(shipment.code)}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            step: "track_load_payment",
          }
        )
      )
      .then((res) => {
        if (!active || !Array.isArray(res.payments)) return;
        const found = res.payments.find((p) => p.kind === "booking") || null;
        setBookingManualPay(found);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [shipment.code, shipment.paymentId, shipment.paymentStatus, isSender, isAdmin]);

  const paymentChip = useMemo(() => {
    const ps = bookingManualPay?.status || shipment.paymentStatus;
    if (!ps) return null;
    if (ps === "paid") return { tone: "g", label: "Booking paid" };
    if (ps === "pay_on_pickup")
      return { tone: "b", label: "Booked, payment due at pickup" };
    if (ps === "pending_review") return { tone: "b", label: "Proof under review" };
    if (ps === "rejected") return { tone: "r", label: "Payment rejected" };
    if (ps === "info_requested") return { tone: "a", label: "Info requested" };
    if (ps === "expired") return { tone: "r", label: "Payment expired" };
    if (ps === "refunded") return { tone: "n", label: "Booking refunded" };
    return { tone: "a", label: "Awaiting payment" };
  }, [shipment.paymentStatus, bookingManualPay?.status]);

  const parcels = useMemo(() => getParcels(shipment), [shipment]);

  return (
    <>
      {isBookingRedirect && (
        <div
          className={`dxt-hold ${
            shipment.paymentStatus === "paid" ? "" : ""
          }`}
          style={{
            borderColor:
              shipment.paymentStatus === "paid"
                ? "rgb(var(--em-rgb) / 0.35)"
                : shipment.paymentStatus === "pay_on_pickup"
                  ? "rgb(var(--blue-rgb) / 0.35)"
                  : "rgb(var(--amber-rgb) / 0.4)",
            background:
              shipment.paymentStatus === "paid"
                ? "rgb(var(--em-rgb) / 0.08)"
                : shipment.paymentStatus === "pay_on_pickup"
                  ? "rgb(var(--blue-rgb) / 0.08)"
                  : "rgb(var(--amber-rgb) / 0.08)",
          }}
        >
          <span
            className="ic"
            style={{
              color:
                shipment.paymentStatus === "paid"
                  ? "var(--em)"
                  : shipment.paymentStatus === "pay_on_pickup"
                    ? "var(--blue)"
                    : "var(--amber)",
            }}
          >
            {shipment.paymentStatus === "paid" ? (
              <CheckCircle2 className="w-5 h-5" />
            ) : shipment.paymentStatus === "pay_on_pickup" ? (
              <Truck className="w-5 h-5" />
            ) : (
              <Loader2 className="w-5 h-5 animate-spin" />
            )}
          </span>
          <div>
            <b>
              {shipment.paymentStatus === "paid"
                ? "Payment confirmed — shipment booked"
                : shipment.paymentStatus === "pay_on_pickup"
                  ? "Booked, payment due at pickup"
                  : "Confirming your payment…"}
            </b>
            <small>
              {shipment.paymentStatus === "paid"
                ? "Your payment has been verified and the recipient has been notified."
                : shipment.paymentStatus === "pay_on_pickup"
                  ? "Courier collection is booked. Payment is collected at pickup / delivery."
                  : "Waiting for live webhook confirmation from Bachs. This updates automatically."}
            </small>
          </div>
        </div>
      )}

      {openAlerts.map((al) => (
        <div key={al.id} className="dx-alert">
          <div className="ai">
            <span className="ic">{renderAlertIcon(al.kind)}</span>
          </div>
          <div className="t">
            <b>Action required: {al.title}</b>
            <small>
              {al.message}
              {al.amount > 0 ? ` · ${formatMoney(al.amount)}` : ""}
            </small>
          </div>
          <button
            type="button"
            className="sw-btn sw-btn-em"
            onClick={() => onOpenAction(al)}
          >
            Take action
          </button>
        </div>
      ))}

      <section className="dx-live dxt-hero">
        <div className="in">
          <div className="dx-livehead">
            <div className="dx-eyebrow">
              {fin ? "Delivered" : "Live tracking"}
            </div>
            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <span className={`chip ${chip.tone}`}>{chip.label}</span>
              {paymentChip && (
                <span className={`chip ${paymentChip.tone}`}>
                  {paymentChip.label}
                </span>
              )}
              <span className="dx-code">
                {shipment.code}
                <button
                  type="button"
                  onClick={() => onCopy(shipment.code)}
                  aria-label="Copy tracking number"
                >
                  <span className="ic">
                    <Copy className="w-3.5 h-3.5" />
                  </span>
                </button>
              </span>
            </div>
          </div>

          <div className="dxt-status">
            <div>
              <div className={`dxt-big ${toneClass}`}>
                {STAGE_HEAD[shipment.status] || shipment.status}
              </div>
              <div
                className="sub"
                style={{
                  marginTop: 10,
                  color: "var(--muted)",
                  fontSize: 14,
                }}
              >
                <b style={{ color: "var(--text)" }}>
                  {lastEv?.label || "Booking confirmed"}
                </b>
                {lastEv?.loc ? ` · ${lastEv.loc}` : ""}
                {lastEv?.ts ? ` · ${formatTimeAgo(lastEv.ts)}` : ""}
              </div>
            </div>
            <div className="dxt-eta">
              <small>{eta.k}</small>
              <b>{eta.v}</b>
              <span>{eta.sub}</span>
            </div>
          </div>

          {held && shipment.hold && (
            <div
              className={`dxt-hold ${
                shipment.hold.type === "Delayed" ? "" : "r"
              }`}
            >
              <span className="ic">
                <AlertTriangle className="w-5 h-5" />
              </span>
              <div>
                <b>{shipment.hold.type}</b>
                <small>{shipment.hold.reason}</small>
              </div>
            </div>
          )}

          <RouteArcMap
            originCity={shipment.sender.city}
            originCountry={shipment.sender.country}
            destCity={shipment.receiver.city}
            destCountry={shipment.receiver.country}
            status={shipment.status}
            isHeld={Boolean(shipment.hold)}
          />

          <StageStepper
            status={shipment.status}
            isHeld={Boolean(shipment.hold)}
            events={shipment.events}
            alerts={shipment.alerts}
          />

          <div className="dxt-role">
            {role === "receiver" ? (
              <>
                <span className="ic">
                  <Home className="w-[17px] h-[17px]" />
                </span>
                <span>
                  You are the <b>recipient</b>. This parcel is on its way to you
                  from <b>{shipment.sender.name}</b>.
                </span>
              </>
            ) : role === "sender" ? (
              <>
                <span className="ic">
                  <Box className="w-[17px] h-[17px]" />
                </span>
                <span>
                  You are the <b>sender</b>.{" "}
                  {receiverOnShipWell ? (
                    `${shipment.receiver.name} can see this on their dashboard.`
                  ) : (
                    <>
                      Waiting for <b>{shipment.receiver.email}</b> to sign up so
                      it appears on their dashboard.
                    </>
                  )}
                </span>
              </>
            ) : (
              <>
                <span className="ic">
                  <Shield className="w-[17px] h-[17px]" />
                </span>
                <span>
                  <b>Operations administrator view.</b>
                </span>
              </>
            )}
          </div>

          <div className="dxt-acts">
            <button
              className="sw-btn sw-btn-ghost"
              type="button"
              onClick={() => onCopy(shipment.code)}
            >
              Copy tracking number
            </button>
            <Link
              className="sw-btn sw-btn-ghost"
              to={`/dashboard/${role === "sender" ? "sent" : "incoming"}`}
            >
              Back to my parcels
            </Link>
          </div>
        </div>
      </section>

      {bookingManualPay &&
        bookingManualPay.status !== "paid" &&
        shipment.paymentStatus !== "pay_on_pickup" && (
          <div style={{ marginBottom: 18 }}>
            <ManualPaymentPanel
              payment={bookingManualPay}
              onUpdated={(next) => setBookingManualPay(next)}
            />
          </div>
        )}

      <div className="dxt-cols">
        {/* Shipment History Timeline */}
        <div className="dx-card">
          <div className="dx-ch">
            <h3>Shipment history</h3>
            <span className="chip n">{events.length} updates</span>
          </div>
          <div className="dxt-tl" style={{ paddingTop: 18 }}>
            {shipment.nextStop && !fin && (
              <div className="dxt-ev nx">
                <div className="d">
                  <span className="ic">
                    <MapPin className="w-[15px] h-[15px]" />
                  </span>
                </div>
                <div className="c">
                  <div className="h">
                    <b>Next: {shipment.nextStop.label}</b>
                    {shipment.nextStop.eta && (
                      <time>
                        ETA {formatDateTime(shipment.nextStop.eta)}
                      </time>
                    )}
                  </div>
                  {shipment.nextStop.loc && (
                    <small>{shipment.nextStop.loc}</small>
                  )}
                </div>
              </div>
            )}

            {reversedEvents.map((ev, i) => {
              const isCurrent = i === 0 && !fin;
              return (
                <div
                  key={ev.id}
                  className={`dxt-ev ${isCurrent ? "cur" : ""} k-${ev.kind}`}
                >
                  <div className="d">
                    <span className="ic">{renderEventIcon(ev, isCurrent)}</span>
                  </div>
                  <div className="c">
                    <div className="h">
                      <b>{ev.label}</b>
                      <time>{formatDateTime(ev.ts)}</time>
                    </div>
                    {ev.loc && <small>{ev.loc}</small>}
                    {ev.note && <div className="nt">{ev.note}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Shipment Details + Item Photos */}
        <div className="dx-col">
          <div className="dx-card">
            <div className="dx-ch">
              <h3>Shipment details</h3>
            </div>
            <div className="dx-cb">
              <div className="dxt-kv">
                <div>
                  <small>Service</small>
                  <b>{SERVICES[shipment.service].name}</b>
                </div>
                <div>
                  <small>Weight</small>
                  <b>
                    {Number(shipment.weightKg || 0).toFixed(1)} kg
                    {parcels.length > 1 ? ` · ${parcels.length} parcels` : ""}
                  </b>
                </div>
                <div>
                  <small>Contents</small>
                  <b>{shipment.contents || "—"}</b>
                </div>
                <div>
                  <small>Type</small>
                  <b>{shipment.packageType || "Parcel"}</b>
                </div>
              </div>

              <div className="dxt-parties">
                <div className="dxt-pp">
                  <span className="ic">
                    <Box className="w-[18px] h-[18px]" />
                  </span>
                  <div>
                    <small>From</small>
                    <b>{shipment.sender.name}</b>
                    <span>
                      {shipment.sender.city}, {shipment.sender.country}
                    </span>
                  </div>
                </div>
                <div className="dxt-pp">
                  <span className="ic">
                    <Home className="w-[18px] h-[18px]" />
                  </span>
                  <div>
                    <small>To</small>
                    <b>{shipment.receiver.name}</b>
                    <span>
                      {shipment.receiver.address}, {shipment.receiver.city},{" "}
                      {shipment.receiver.country}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="dx-card">
            <div className="dx-ch">
              <h3>Parcels ({parcels.length})</h3>
              <span className="chip n">
                {formatMoney(
                  parcels.reduce(
                    (sum, p) => sum + Math.max(0, Number(p.declaredValue) || 0),
                    0
                  )
                )}{" "}
                declared
              </span>
            </div>
            <div className="dx-cb flex flex-col gap-3">
              {parcels.map((parcel, idx) => {
                const revState = parcel.review?.state || "pending";
                const revTone =
                  revState === "approved"
                    ? "g"
                    : revState === "flagged"
                      ? "r"
                      : "a";
                return (
                  <div
                    key={parcel.id || idx}
                    style={{
                      border: "1px solid var(--border)",
                      borderRadius: 14,
                      padding: 12,
                      background: "var(--card2)",
                    }}
                  >
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="min-w-0">
                        <b style={{ fontSize: 13.5, display: "block" }}>
                          {parcels.length > 1
                            ? `Parcel ${idx + 1}: ${parcel.contents}`
                            : parcel.contents}
                        </b>
                        <small style={{ color: "var(--muted)", fontSize: 12 }}>
                          {parcel.packageType} · {parcel.weightKg.toFixed(1)} kg ·{" "}
                          {formatMoney(parcel.declaredValue)}
                        </small>
                      </div>
                      <span className={`chip ${revTone}`}>{revState}</span>
                    </div>
                    {parcel.review?.note && (
                      <div
                        style={{
                          marginTop: 8,
                          fontSize: 12,
                          color: "var(--amber)",
                        }}
                      >
                        {parcel.review.note}
                      </div>
                    )}
                    {parcels.length > 1 && parcel.photos.length > 0 && (
                      <div
                        className="dxt-photos"
                        style={{ padding: "10px 0 0" }}
                      >
                        {parcel.photos.map((photoUrl, pIdx) => (
                          <button
                            key={`${parcel.id}_photo_${pIdx}`}
                            type="button"
                            aria-label={`View ${parcel.contents} photo ${pIdx + 1}`}
                            onClick={() =>
                              onZoomPhoto(
                                photoUrl,
                                `${parcel.contents} photo ${pIdx + 1}`
                              )
                            }
                          >
                            <img
                              src={photoUrl}
                              alt={`${parcel.contents} photo ${pIdx + 1}`}
                              loading="lazy"
                            />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {parcels.length === 1 &&
            shipment.photos &&
            shipment.photos.length > 0 && (
              <div className="dx-card">
                <div className="dx-ch">
                  <h3>Item photos</h3>
                  <span className="chip n">Uploaded by sender</span>
                </div>
                <div className="dxt-photos">
                  {shipment.photos.map((photoUrl, idx) => (
                    <button
                      key={`${shipment.code}_photo_${idx}`}
                      type="button"
                      aria-label={`View photo ${idx + 1}`}
                      onClick={() =>
                        onZoomPhoto(
                          photoUrl,
                          `${shipment.contents} photo ${idx + 1}`
                        )
                      }
                    >
                      <img
                        src={photoUrl}
                        alt={`Item photo ${idx + 1}`}
                        loading="lazy"
                      />
                    </button>
                  ))}
                </div>
              </div>
            )}
          {(shipment.alerts || []).some((a) => a.kind === "duty") && (
            <CustomsLedger
              shipment={shipment}
              viewerRole={role}
              isAdmin={isAdmin}
            />
          )}
        </div>
      </div>
    </>
  );
}

function PublicTrackedContent({
  teaser,
  onCopy,
}: {
  teaser: {
    code: string;
    status: ShipmentRecord["status"];
    holdType?: string | null;
    originCity: string;
    originCountry: string;
    destinationCity: string;
    destinationCountry: string;
    service: ShipmentRecord["service"];
    weightKg: number;
    contents: string;
    eta: number;
    deliveredAt?: number | null;
    latestEvent?: { label: string; loc: string; ts: number } | null;
  };
  onCopy: (code: string) => void;
}) {
  const fin = teaser.status === "Delivered";
  const held = Boolean(teaser.holdType) && !fin;
  const chip = getShipmentChip({
    status: teaser.status,
    holdType: teaser.holdType,
  });
  const toneClass = fin
    ? "ok"
    : held
      ? teaser.holdType === "Delayed"
        ? "warn"
        : "bad"
      : "";
  const eta = getEtaSummary({
    status: teaser.status,
    eta: teaser.eta,
    deliveredAt: teaser.deliveredAt,
    hold: teaser.holdType
      ? {
          type: teaser.holdType === "Delayed" ? "Delayed" : "On Hold",
          reason: "",
          at: 0,
        }
      : null,
  } as ShipmentRecord);

  return (
    <>
      <section className="dx-live dxt-hero">
        <div className="in">
          <div className="dx-livehead">
            <div className="dx-eyebrow">
              {fin ? "Delivered" : "Live tracking"}
            </div>
            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <span className={`chip ${chip.tone}`}>{chip.label}</span>
              <span className="dx-code">
                {teaser.code}
                <button
                  type="button"
                  onClick={() => onCopy(teaser.code)}
                  aria-label="Copy tracking number"
                >
                  <span className="ic">
                    <Copy className="w-3.5 h-3.5" />
                  </span>
                </button>
              </span>
            </div>
          </div>

          <div className="dxt-status">
            <div>
              <div className={`dxt-big ${toneClass}`}>
                {STAGE_HEAD[teaser.status] || teaser.status}
              </div>
              <div
                className="sub"
                style={{
                  marginTop: 10,
                  color: "var(--muted)",
                  fontSize: 14,
                }}
              >
                <b style={{ color: "var(--text)" }}>
                  {teaser.latestEvent?.label || "Booking confirmed"}
                </b>
                {teaser.latestEvent?.loc ? ` · ${teaser.latestEvent.loc}` : ""}
                {teaser.latestEvent?.ts
                  ? ` · ${formatTimeAgo(teaser.latestEvent.ts)}`
                  : ""}
              </div>
            </div>
            <div className="dxt-eta">
              <small>{eta.k}</small>
              <b>{eta.v}</b>
              <span>{eta.sub}</span>
            </div>
          </div>

          <RouteArcMap
            originCity={teaser.originCity}
            originCountry={teaser.originCountry}
            destCity={teaser.destinationCity}
            destCountry={teaser.destinationCountry}
            status={teaser.status}
            isHeld={held}
          />

          <StageStepper status={teaser.status} isHeld={held} />

          <div className="dxt-role">
            <span className="ic">
              <Eye className="w-[17px] h-[17px]" />
            </span>
            <span>
              This parcel is not linked to your account, so you see the public
              summary only.
            </span>
          </div>

          <div className="dxt-acts">
            <button
              className="sw-btn sw-btn-ghost"
              type="button"
              onClick={() => onCopy(teaser.code)}
            >
              Copy tracking number
            </button>
            <Link className="sw-btn sw-btn-ghost" to="/dashboard/incoming">
              Back to my parcels
            </Link>
          </div>
        </div>
      </section>

      <div className="dxt-cols">
        <div className="dx-card">
          <div className="dx-ch">
            <h3>Shipment history</h3>
          </div>
          <div className="dxt-lock">
            <span className="ic">
              <Lock className="w-[18px] h-[18px]" />
            </span>
            <span>
              Detailed history is visible only to the sender and the receiver of
              this parcel.
            </span>
          </div>
        </div>

        <div className="dx-col">
          <div className="dx-card">
            <div className="dx-ch">
              <h3>Shipment details</h3>
            </div>
            <div className="dx-cb">
              <div className="dxt-kv">
                <div>
                  <small>Service</small>
                  <b>{SERVICES[teaser.service].name}</b>
                </div>
                <div>
                  <small>Weight</small>
                  <b>{Number(teaser.weightKg || 0).toFixed(1)} kg</b>
                </div>
                <div>
                  <small>Contents</small>
                  <b>{teaser.contents || "—"}</b>
                </div>
                <div>
                  <small>Type</small>
                  <b>Parcel</b>
                </div>
              </div>
            </div>
          </div>

          <div className="dx-card">
            <div className="dx-ch">
              <h3>Item photos</h3>
            </div>
            <div className="dxt-lock">
              <span className="ic">
                <Lock className="w-[18px] h-[18px]" />
              </span>
              <span>
                Photos are only visible to the sender and the receiver.
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
