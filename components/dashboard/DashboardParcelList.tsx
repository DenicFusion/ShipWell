import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Bell,
  Box,
  Calendar,
  CreditCard,
  FileEdit,
  Home,
  MapPin,
  Shield,
  Trash2,
  Truck,
} from "lucide-react";
import toast from "react-hot-toast";
import { auth } from "@/lib/firebase";
import { apiFetch } from "@/lib/api-client";
import { deleteUserDraft, listUserDrafts } from "@/lib/drafts";
import { useShipWell } from "@/components/providers/ShipWellProvider";
import {
  getEtaSummary,
  lastTsOf,
  myOpenAlertsForShipment,
} from "@/components/dashboard/useDashboardShipments";
import { SERVICES } from "@/lib/quote-engine";
import {
  formatTimeAgo,
  getShipmentChip,
  getStagePercent,
  normalizeEmail,
  type AlertKind,
  type DraftShipmentRecord,
  type ManualPaymentRecord,
  type ShipmentRecord,
} from "@/types/tracking";

type FilterKind = "all" | "active" | "attention" | "delivered";

function renderAlertIcon(kind: AlertKind) {
  if (kind === "duty") return <CreditCard className="w-[15px] h-[15px]" />;
  if (kind === "address") return <MapPin className="w-[15px] h-[15px]" />;
  if (kind === "id") return <Shield className="w-[15px] h-[15px]" />;
  if (kind === "reschedule") return <Calendar className="w-[15px] h-[15px]" />;
  if (kind === "item") return <AlertTriangle className="w-[15px] h-[15px]" />;
  return <Bell className="w-[15px] h-[15px]" />;
}

function getSentPaymentBadge(s: ShipmentRecord): {
  tone: "g" | "a" | "r" | "b";
  label: string;
  cta?: string;
} | null {
  const ps = s.paymentStatus;
  if (!ps || ps === "paid") return null;
  if (ps === "pay_on_pickup") {
    return { tone: "b", label: "Pay on delivery" };
  }
  if (ps === "pending_review") {
    return { tone: "b", label: "Proof under review", cta: "View status →" };
  }
  if (ps === "rejected") {
    return { tone: "r", label: "Payment rejected", cta: "Re-upload proof →" };
  }
  if (ps === "info_requested") {
    return { tone: "a", label: "Info requested", cta: "Submit details →" };
  }
  if (ps === "expired") {
    return { tone: "r", label: "Payment expired" };
  }
  if (ps === "awaiting_payment") {
    return {
      tone: "a",
      label: "Awaiting payment",
      cta: s.paymentChannel === "automatic" ? "Pay now →" : "Pay / Upload proof →",
    };
  }
  return null;
}

export function DashboardParcelList({
  mode,
  uid,
  list,
  userEmail,
  receiverStatusMap,
}: {
  mode: "incoming" | "sent";
  uid?: string;
  list: ShipmentRecord[];
  userEmail: string;
  receiverStatusMap: Record<string, boolean>;
}) {
  const { openAction, refreshOpenAlerts } = useShipWell();
  const [filter, setFilter] = useState<FilterKind>("all");
  const [drafts, setDrafts] = useState<DraftShipmentRecord[]>([]);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [manualPaymentsByCode, setManualPaymentsByCode] = useState<
    Record<string, ManualPaymentRecord>
  >({});

  useEffect(() => {
    if (mode !== "sent" || !uid) return;
    let active = true;
    listUserDrafts(uid)
      .then((items) => {
        if (active) setDrafts(items);
      })
      .catch(() => undefined);

    auth.currentUser
      ?.getIdToken()
      .then((token) =>
        apiFetch<{ ok: boolean; payments: ManualPaymentRecord[] }>(
          "/api/payments/my",
          {
            headers: { Authorization: `Bearer ${token}` },
            step: "sent_list_payments",
          }
        )
      )
      .then((res) => {
        if (!active || !Array.isArray(res.payments)) return;
        const map: Record<string, ManualPaymentRecord> = {};
        for (const p of res.payments) {
          if (p.kind === "booking" && !map[p.trackingCode]) {
            map[p.trackingCode] = p;
          }
        }
        setManualPaymentsByCode(map);
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [mode, uid]);

  const handleDeleteDraft = async (draft: DraftShipmentRecord) => {
    if (!uid) return;
    setDeletingId(draft.id);
    try {
      await deleteUserDraft(uid, draft);
      setDrafts((prev) => prev.filter((x) => x.id !== draft.id));
      setConfirmDeleteId(null);
      toast.success("Draft deleted");
    } catch {
      toast.error("Unable to delete draft");
    } finally {
      setDeletingId(null);
    }
  };

  const sorted = useMemo(() => {
    return [...list].sort(
      (a, b) =>
        Number(a.status === "Delivered") - Number(b.status === "Delivered") ||
        lastTsOf(b) - lastTsOf(a)
    );
  }, [list]);

  const counts = useMemo(
    () => ({
      all: sorted.length,
      active: sorted.filter((s) => s.status !== "Delivered").length,
      attention: sorted.filter(
        (s) =>
          Boolean(s.hold) ||
          myOpenAlertsForShipment(s, userEmail).length > 0 ||
          (mode === "sent" &&
            (s.paymentStatus === "awaiting_payment" ||
              s.paymentStatus === "rejected" ||
              s.paymentStatus === "info_requested"))
      ).length,
      delivered: sorted.filter((s) => s.status === "Delivered").length,
    }),
    [sorted, userEmail, mode]
  );

  const shown = useMemo(() => {
    return sorted.filter((s) => {
      if (filter === "all") return true;
      if (filter === "active") return s.status !== "Delivered";
      if (filter === "attention") {
        return (
          Boolean(s.hold) ||
          myOpenAlertsForShipment(s, userEmail).length > 0 ||
          (mode === "sent" &&
            (s.paymentStatus === "awaiting_payment" ||
              s.paymentStatus === "rejected" ||
              s.paymentStatus === "info_requested"))
        );
      }
      return s.status === "Delivered";
    });
  }, [sorted, filter, userEmail, mode]);

  const draftsSection =
    mode === "sent" && drafts.length > 0 ? (
      <div className="dx-card" style={{ marginBottom: 18 }}>
        <div className="dx-ch">
          <h3>Saved drafts</h3>
          <span className="chip b">{drafts.length} unfinished</span>
        </div>
        <div className="dx-rows" style={{ marginTop: 10 }}>
          {drafts.map((d) => (
            <div
              key={d.id}
              className="dx-rw"
              style={{
                cursor: "default",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: 12,
              }}
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="rt">
                  <span className="ic">
                    <FileEdit className="w-[18px] h-[18px]" />
                  </span>
                </div>
                <div className="rm">
                  <b>
                    {d.data.contents || d.data.pkgType || "Unfinished parcel"}
                  </b>
                  <small>
                    {d.data.sCity || d.data.sCountry} →{" "}
                    {d.data.rCity || d.data.rCountry} · Step {d.step} of 4 ·
                    Saved {formatTimeAgo(d.updatedAtMs)}
                  </small>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Link
                  className="sw-btn sw-btn-em"
                  style={{ padding: "7px 14px", fontSize: 12.5 }}
                  to={`/dashboard/ship?draft=${encodeURIComponent(d.id)}`}
                >
                  Continue →
                </Link>
                {confirmDeleteId === d.id ? (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={deletingId === d.id}
                      className="sw-btn sw-btn-red"
                      style={{ padding: "7px 12px", fontSize: 12 }}
                      onClick={() => handleDeleteDraft(d)}
                    >
                      Confirm delete
                    </button>
                    <button
                      type="button"
                      className="sw-btn sw-btn-ghost"
                      style={{ padding: "7px 10px", fontSize: 12 }}
                      onClick={() => setConfirmDeleteId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="sw-btn sw-btn-ghost"
                    style={{ padding: "7px 10px", fontSize: 12 }}
                    aria-label="Delete draft"
                    onClick={() => setConfirmDeleteId(d.id)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    ) : null;

  if (sorted.length === 0) {
    if (mode === "incoming") {
      return (
        <div className="dx-empty">
          <div className="au-ic">
            <Home className="w-6 h-6" />
          </div>
          <h3>NOTHING ON ITS WAY YET</h3>
          <p>
            Whenever someone ships a parcel to <b>{userEmail}</b> it appears
            here automatically, with the sender&rsquo;s item photos and live
            updates.
          </p>
          <div className="acts">
            <Link
              className="sw-btn sw-btn-em sw-btn-lg"
              to="/dashboard/track"
            >
              Track a parcel
            </Link>
            <Link className="sw-btn sw-btn-ghost sw-btn-lg" to="/dashboard/ship">
              Ship something
            </Link>
          </div>
        </div>
      );
    }

    return (
      <>
        {draftsSection}
        {drafts.length === 0 && (
          <div className="dx-empty">
            <div className="au-ic">
              <Truck className="w-6 h-6" />
            </div>
            <h3>NO SHIPMENTS SENT</h3>
            <p>
              Book your first shipment. Add photos of the item and the
              receiver&rsquo;s email so it shows up on their dashboard.
            </p>
            <div className="acts">
              <Link className="sw-btn sw-btn-em sw-btn-lg" to="/dashboard/ship">
                Ship now →
              </Link>
            </div>
          </div>
        )}
      </>
    );
  }

  const pills: [FilterKind, string][] = [
    ["all", "All"],
    ["active", "Active"],
    ["attention", "Needs attention"],
    ["delivered", "Delivered"],
  ];

  return (
    <>
      {draftsSection}

      <div className="dx-pills" role="tablist" aria-label="Filter parcels">
        {pills.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={filter === key}
            className={filter === key ? "on" : ""}
            onClick={() => setFilter(key)}
          >
            {label}
            <i>{counts[key]}</i>
          </button>
        ))}
      </div>

      <div className="dx-list">
        {shown.length > 0 ? (
          shown.map((s) => {
            const chip = getShipmentChip(s);
            const pct = getStagePercent(s.status);
            const fin = s.status === "Delivered";
            const held = Boolean(s.hold) && !fin;
            const open = myOpenAlertsForShipment(s, userEmail);
            const eta = getEtaSummary(s);
            const recEmail = normalizeEmail(s.receiverEmail || s.receiver.email);
            const recOnShipWell = Boolean(receiverStatusMap[recEmail]);
            const payBadge = mode === "sent" ? getSentPaymentBadge(s) : null;
            const linkedManualPay =
              mode === "sent" ? manualPaymentsByCode[s.code] : undefined;

            return (
              <article key={`${mode}_${s.code}`} className="dx-parcel">
                <Link
                  className="dx-pth"
                  to={`/dashboard/track/${s.code}`}
                  aria-label={`Track ${s.code}`}
                >
                  {s.photos && s.photos.length > 0 ? (
                    <>
                      <img
                        src={s.photos[0]}
                        alt={`${s.contents} photo`}
                        loading="lazy"
                      />
                      {s.photos.length > 1 && (
                        <em>{s.photos.length} photos</em>
                      )}
                    </>
                  ) : (
                    <span className="ic">
                      <Box className="w-[30px] h-[30px]" />
                    </span>
                  )}
                </Link>

                <div className="dx-pm">
                  <div className="dx-pt">
                    <b>{s.contents}</b>
                    <span className={`chip ${chip.tone}`}>{chip.label}</span>
                    {payBadge && (
                      <span className={`chip ${payBadge.tone}`}>
                        {payBadge.label}
                      </span>
                    )}
                  </div>

                  <div className="dx-ps">
                    {mode === "incoming" ? (
                      <>
                        From <b>{s.sender.name}</b> · {s.sender.city} →{" "}
                        {s.receiver.city}
                      </>
                    ) : (
                      <>
                        To <b>{s.receiver.name}</b> · {s.sender.city} →{" "}
                        {s.receiver.city}
                        {linkedManualPay?.reference ? (
                          <>
                            {" "}
                            · Ref{" "}
                            <span className="mono">
                              {linkedManualPay.reference}
                            </span>
                          </>
                        ) : null}
                        <br />
                        {recOnShipWell ? (
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

                  <div className={`dx-bar ${held ? "a" : ""}`}>
                    <i style={{ width: `${pct}%` }} />
                  </div>

                  <div className="dx-pmeta">
                    <span className="mono">{s.code}</span>
                    <span>
                      {fin ? `Delivered ${eta.v}` : `${eta.k} ${eta.v}`}
                    </span>
                    <span>{SERVICES[s.service].name}</span>
                  </div>

                  {open.length > 0 && (
                    <button
                      type="button"
                      className="dx-pact"
                      onClick={() =>
                        openAction(s, open[0], async () => {
                          await refreshOpenAlerts();
                        })
                      }
                    >
                      <span className="ic">{renderAlertIcon(open[0].kind)}</span>
                      <span>
                        {open[0].title}
                        {open.length > 1 ? ` (+${open.length - 1})` : ""}
                      </span>
                      <b>Take action →</b>
                    </button>
                  )}
                </div>

                <Link
                  className={`sw-btn ${payBadge?.cta ? "sw-btn-em" : "sw-btn-ghost"} dx-go`}
                  to={`/dashboard/track/${s.code}`}
                >
                  {payBadge?.cta || "Track live →"}
                </Link>
              </article>
            );
          })
        ) : (
          <div className="dx-empty" style={{ padding: 30 }}>
            <p style={{ margin: 0 }}>Nothing in this filter.</p>
          </div>
        )}
      </div>
    </>
  );
}
