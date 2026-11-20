"use client";

import React, { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { collection, doc, onSnapshot, orderBy, query } from "firebase/firestore";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Check,
  Clock,
  Loader2,
  Mail,
  Send,
  Shield,
  Truck,
  Undo2,
  X,
} from "lucide-react";
import { db } from "@/lib/firebase";
import { AdminShell } from "@/components/admin/AdminShell";
import { useShipWell } from "@/components/providers/ShipWellProvider";
import {
  adminAddCheckpoint,
  adminApproveShipmentItem,
  adminClearHold,
  adminFlagShipmentItem,
  adminResendReceiverInvite,
  adminSaveNextStop,
  adminSendAlert,
  adminSetHold,
  adminUndoLastEvent,
  checkAccountExists,
  fetchFullShipmentBundle,
} from "@/lib/firestore-shipments";
import {
  formatDateTime,
  formatMoney,
  formatShortDay,
  SERVICES,
} from "@/lib/quote-engine";
import {
  firestoreTimeToMs,
  getShipmentChip,
  STAGES,
  type AlertKind,
  type AlertTarget,
  type ShipmentAlert,
  type ShipmentRecord,
  type ShipmentStage,
  type TrackingEvent,
} from "@/types/tracking";
import toast from "react-hot-toast";

const HUB_LOCATIONS = [
  "Lagos Hub, NG",
  "Accra Hub, GH",
  "Nairobi Hub, KE",
  "Johannesburg Hub, ZA",
  "London Heathrow Hub, UK",
  "London East Delivery Depot, UK",
  "Frankfurt Air Hub, DE",
  "Paris Charles de Gaulle Hub, FR",
  "Dubai Logistics Hub, UAE",
  "Mumbai Air Cargo Hub, IN",
  "Shanghai Pudong Hub, CN",
  "Tokyo Narita Hub, JP",
  "New York JFK Hub, US",
  "Toronto Pearson Hub, CA",
];

const ALERT_TEMPLATES: Record<
  AlertKind,
  { title: string; message: string; amount: string }
> = {
  duty: {
    title: "Customs duty payment due",
    message:
      "Import duty and clearance handling charges are required by destination customs before release.",
    amount: "48.50",
  },
  address: {
    title: "Confirm delivery address",
    message:
      "Courier requires a confirmed street number, flat/unit, or access note before dispatch.",
    amount: "0",
  },
  id: {
    title: "Upload government photo ID",
    message:
      "Destination customs requires a copy of the recipient's passport or national ID for clearance.",
    amount: "0",
  },
  reschedule: {
    title: "Choose a delivery slot",
    message:
      "Select your preferred date and time window for final door-to-door delivery.",
    amount: "0",
  },
  custom: {
    title: "Information needed for your shipment",
    message: "Please reply with the requested information so your parcel can proceed.",
    amount: "0",
  },
  item: {
    title: "Item needs attention",
    message: "Please clarify or update the item details.",
    amount: "0",
  },
};

export default function AdminShipmentDetailPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = use(params);
  const cleanCode = decodeURIComponent(code || "").toUpperCase();
  const { user, isAdmin, openPhotoZoom } = useShipWell();

  const [shipment, setShipment] = useState<ShipmentRecord | null>(null);
  const [receiverSignedUp, setReceiverSignedUp] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState("");

  // Flag item custom React modal (NO window.prompt)
  const [flagModalOpen, setFlagModalOpen] = useState(false);
  const [flagReason, setFlagReason] = useState("");

  // Add checkpoint form
  const [cpStage, setCpStage] = useState<ShipmentStage>("In Transit");
  const [cpLabel, setCpLabel] = useState("");
  const [cpLoc, setCpLoc] = useState("");
  const [cpNote, setCpNote] = useState("");
  const [cpTime, setCpTime] = useState("");

  // Next stop & ETA form
  const [nsLabel, setNsLabel] = useState("");
  const [nsLoc, setNsLoc] = useState("");
  const [nsEta, setNsEta] = useState("");
  const [deliveryEta, setDeliveryEta] = useState("");

  // Delay / hold form
  const [holdType, setHoldType] = useState<"Delayed" | "On Hold">("Delayed");
  const [holdReason, setHoldReason] = useState("");

  // Alert form
  const [alTo, setAlTo] = useState<AlertTarget>("receiver");
  const [alKind, setAlKind] = useState<AlertKind>("duty");
  const [alTitle, setAlTitle] = useState(ALERT_TEMPLATES.duty.title);
  const [alMsg, setAlMsg] = useState(ALERT_TEMPLATES.duty.message);
  const [alAmt, setAlAmt] = useState(ALERT_TEMPLATES.duty.amount);
  const [alHold, setAlHold] = useState(true);

  const loadDetail = useCallback(async () => {
    try {
      const s = await fetchFullShipmentBundle(cleanCode);
      setShipment(s);
      if (s) {
        setCpStage(s.status);
        setCpTime(new Date().toISOString().slice(0, 16));
        setNsLabel(s.nextStop?.label || "");
        setNsLoc(s.nextStop?.loc || "");
        setNsEta(
          s.nextStop?.eta
            ? new Date(s.nextStop.eta).toISOString().slice(0, 16)
            : ""
        );
        setDeliveryEta(new Date(s.eta).toISOString().slice(0, 10));
        const signed = await checkAccountExists(s.receiverEmail);
        setReceiverSignedUp(signed);
      }
    } finally {
      setLoading(false);
    }
  }, [cleanCode]);

  useEffect(() => {
    if (!isAdmin) return;
    loadDetail();

    const unsubShip = onSnapshot(
      doc(db, "shipments", cleanCode),
      (snap) => {
        if (snap.exists()) {
          setShipment((prev) =>
            prev ? { ...prev, ...(snap.data() as ShipmentRecord) } : null
          );
        }
      },
      () => undefined
    );

    const unsubEv = onSnapshot(
      query(
        collection(db, "shipments", cleanCode, "events"),
        orderBy("ts", "asc")
      ),
      (snap) => {
        const events: TrackingEvent[] = snap.docs.map((d) => ({
          ...(d.data() as Omit<TrackingEvent, "id">),
          id: d.id,
        }));
        setShipment((prev) => (prev ? { ...prev, events } : null));
      },
      () => undefined
    );

    const unsubAl = onSnapshot(
      collection(db, "shipments", cleanCode, "alerts"),
      (snap) => {
        const alerts: ShipmentAlert[] = snap.docs.map((d) => ({
          ...(d.data() as Omit<ShipmentAlert, "id">),
          id: d.id,
          createdAtMs: firestoreTimeToMs(d.data().createdAt),
          resolvedAtMs: d.data().resolvedAt
            ? firestoreTimeToMs(d.data().resolvedAt)
            : undefined,
        }));
        setShipment((prev) => (prev ? { ...prev, alerts } : null));
      },
      () => undefined
    );

    return () => {
      unsubShip();
      unsubEv();
      unsubAl();
    };
  }, [isAdmin, cleanCode, loadDetail]);

  const applyTemplate = (kind: AlertKind) => {
    setAlKind(kind);
    const tpl = ALERT_TEMPLATES[kind];
    setAlTitle(tpl.title);
    setAlMsg(tpl.message);
    setAlAmt(tpl.amount);
  };

  if (loading) {
    return (
      <AdminShell title={`Shipment ${cleanCode}`}>
        <div className="py-20 flex flex-col items-center gap-3 text-[var(--muted)]">
          <Loader2 className="w-7 h-7 animate-spin text-[var(--em)]" />
          <span>Loading shipment {cleanCode}...</span>
        </div>
      </AdminShell>
    );
  }

  if (!shipment || !user) {
    return (
      <AdminShell title="Shipment not found">
        <div className="ad-card p-8 text-center">
          <p className="text-[var(--muted)] mb-4">
            Shipment <b>{cleanCode}</b> was not found.
          </p>
          <Link href="/admin/shipments" className="sw-btn sw-btn-ghost">
            ← Back to shipments
          </Link>
        </div>
      </AdminShell>
    );
  }

  const chip = getShipmentChip(shipment);
  const sortedEvents = [...(shipment.events || [])].sort(
    (a, b) => b.ts - a.ts
  );
  const openAlertsCount = (shipment.alerts || []).filter(
    (a) => a.status === "open"
  ).length;
  const adminEmail = user.email || "";

  return (
    <AdminShell
      title={shipment.code}
      openAlertsCount={openAlertsCount}
      topAction={
        <Link
          href={`/track/${shipment.code}`}
          className="sw-btn sw-btn-ghost"
        >
          Customer view →
        </Link>
      }
    >
      <Link href="/admin/shipments" className="ad-back">
        <ArrowLeft className="w-4 h-4" />
        All shipments
      </Link>

      <div className="ad-hd">
        <div>
          <div className="code">{shipment.code}</div>
          <small>
            {shipment.sender.city} → {shipment.receiver.city} ·{" "}
            {SERVICES[shipment.service].name} · {shipment.weightKg.toFixed(1)}{" "}
            kg · {formatMoney(shipment.priceTotal)}
          </small>
        </div>
        <span className={`chip ${chip.tone}`}>{chip.label}</span>
      </div>

      <div className="ad-split">
        {/* LEFT COLUMN */}
        <div>
          {/* 1. REVIEW ITEM */}
          <div className="ad-card">
            <div className="ad-ch">
              <div>
                <b>1. Review item</b>
                <span
                  className={`mini ${
                    shipment.review.state === "approved"
                      ? "g"
                      : shipment.review.state === "flagged"
                        ? "r"
                        : "a"
                  }`}
                >
                  {shipment.review.state}
                </span>
              </div>
              <small>{shipment.photos?.length || 0} photos</small>
            </div>
            <div className="ad-cb">
              <div className="ad-kv">
                <div>
                  <small>Contents</small>
                  <b>{shipment.contents}</b>
                </div>
                <div>
                  <small>Package / Declared value</small>
                  <b>
                    {shipment.packageType} ·{" "}
                    {formatMoney(shipment.declaredValue)}
                  </b>
                </div>
              </div>

              {shipment.photos && shipment.photos.length > 0 && (
                <div className="gal">
                  {shipment.photos.map((src, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => openPhotoZoom(src, `${shipment.contents} ${i + 1}`)}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={src} alt={`Item ${i + 1}`} />
                    </button>
                  ))}
                </div>
              )}

              {shipment.review.note && (
                <div className="ad-cur a">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{shipment.review.note}</span>
                </div>
              )}

              <div className="ad-rev">
                <button
                  type="button"
                  disabled={busyAction !== ""}
                  className="sw-btn sw-btn-em"
                  onClick={async () => {
                    setBusyAction("approve");
                    try {
                      await adminApproveShipmentItem({
                        shipment,
                        actorUid: user.uid,
                        actorEmail: adminEmail,
                      });
                      toast.success("Item approved");
                      await loadDetail();
                    } finally {
                      setBusyAction("");
                    }
                  }}
                >
                  {busyAction === "approve" ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                  Approve item
                </button>

                <button
                  type="button"
                  disabled={busyAction !== ""}
                  className="sw-btn sw-btn-red"
                  onClick={() => {
                    setFlagReason("");
                    setFlagModalOpen(true);
                  }}
                >
                  <AlertTriangle className="w-4 h-4" />
                  Flag an issue
                </button>
              </div>
            </div>
          </div>

          {/* 2. ADD CHECKPOINT */}
          <div className="ad-card">
            <div className="ad-ch">
              <b>2. Add checkpoint</b>
              <small>Live timeline update</small>
            </div>
            <form
              className="ad-cb ad-form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!cpLabel.trim()) {
                  toast.error("Enter a checkpoint headline.");
                  return;
                }
                setBusyAction("checkpoint");
                try {
                  await adminAddCheckpoint({
                    shipment,
                    stage: cpStage,
                    label: cpLabel,
                    loc: cpLoc,
                    note: cpNote,
                    ts: cpTime ? new Date(cpTime).getTime() : Date.now(),
                    actorUid: user.uid,
                    actorEmail: adminEmail,
                  });
                  setCpLabel("");
                  setCpNote("");
                  toast.success("Checkpoint added & pushed live");
                  await loadDetail();
                } finally {
                  setBusyAction("");
                }
              }}
            >
              <div className="g2">
                <div className="fw">
                  <label className="lbl" htmlFor="cp-stage">
                    Stage
                  </label>
                  <select
                    id="cp-stage"
                    className="field"
                    value={cpStage}
                    onChange={(e) =>
                      setCpStage(e.target.value as ShipmentStage)
                    }
                  >
                    {STAGES.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="fw">
                  <label className="lbl" htmlFor="cp-time">
                    Date &amp; time
                  </label>
                  <input
                    id="cp-time"
                    className="field"
                    type="datetime-local"
                    value={cpTime}
                    onChange={(e) => setCpTime(e.target.value)}
                  />
                </div>
              </div>

              <div className="fw">
                <label className="lbl" htmlFor="cp-label">
                  Headline
                </label>
                <input
                  id="cp-label"
                  className="field"
                  value={cpLabel}
                  onChange={(e) => setCpLabel(e.target.value)}
                  placeholder="e.g. Arrived at Frankfurt Air Hub"
                  required
                />
              </div>

              <div className="fw">
                <label className="lbl" htmlFor="cp-loc">
                  Location
                </label>
                <input
                  id="cp-loc"
                  className="field"
                  list="sw-hub-locs"
                  value={cpLoc}
                  onChange={(e) => setCpLoc(e.target.value)}
                  placeholder="City or Hub"
                />
                <datalist id="sw-hub-locs">
                  {HUB_LOCATIONS.map((l) => (
                    <option key={l} value={l} />
                  ))}
                </datalist>
              </div>

              <div className="fw">
                <label className="lbl" htmlFor="cp-note">
                  Note to customer (optional)
                </label>
                <input
                  id="cp-note"
                  className="field"
                  value={cpNote}
                  onChange={(e) => setCpNote(e.target.value)}
                  placeholder="Flight manifest cleared, moving to next leg"
                />
              </div>

              <button
                type="submit"
                disabled={busyAction !== ""}
                className="sw-btn sw-btn-em"
              >
                {busyAction === "checkpoint" ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Truck className="w-4 h-4" />
                )}
                Add checkpoint &amp; notify
              </button>
            </form>
          </div>

          {/* 3. NEXT STOP & ETA */}
          <div className="ad-card">
            <div className="ad-ch">
              <b>3. Next stop &amp; ETA</b>
              <small>Shown on customer timeline</small>
            </div>
            <form
              className="ad-cb ad-form"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusyAction("nextstop");
                try {
                  await adminSaveNextStop({
                    shipment,
                    label: nsLabel,
                    loc: nsLoc,
                    nextEta: nsEta ? new Date(nsEta).getTime() : null,
                    deliveryEta: deliveryEta
                      ? new Date(`${deliveryEta}T17:00:00`).getTime()
                      : shipment.eta,
                    actorUid: user.uid,
                    actorEmail: adminEmail,
                  });
                  toast.success("Next stop & ETA saved");
                  await loadDetail();
                } finally {
                  setBusyAction("");
                }
              }}
            >
              <div className="fw">
                <label className="lbl" htmlFor="ns-lbl">
                  Next checkpoint label (leave blank to clear)
                </label>
                <input
                  id="ns-lbl"
                  className="field"
                  value={nsLabel}
                  onChange={(e) => setNsLabel(e.target.value)}
                  placeholder="e.g. Customs clearance in London"
                />
              </div>
              <div className="g2">
                <div className="fw">
                  <label className="lbl" htmlFor="ns-loc">
                    Next location
                  </label>
                  <input
                    id="ns-loc"
                    className="field"
                    list="sw-hub-locs"
                    value={nsLoc}
                    onChange={(e) => setNsLoc(e.target.value)}
                    placeholder="London Heathrow, UK"
                  />
                </div>
                <div className="fw">
                  <label className="lbl" htmlFor="ns-eta">
                    Next stop time
                  </label>
                  <input
                    id="ns-eta"
                    className="field"
                    type="datetime-local"
                    value={nsEta}
                    onChange={(e) => setNsEta(e.target.value)}
                  />
                </div>
              </div>
              <div className="fw">
                <label className="lbl" htmlFor="del-eta">
                  Estimated delivery date
                </label>
                <input
                  id="del-eta"
                  className="field"
                  type="date"
                  value={deliveryEta}
                  onChange={(e) => setDeliveryEta(e.target.value)}
                />
              </div>
              <button
                type="submit"
                disabled={busyAction !== ""}
                className="sw-btn sw-btn-ghost"
              >
                <Clock className="w-4 h-4" />
                Save next stop &amp; ETA
              </button>
            </form>
          </div>

          {/* 4. DELAY OR HOLD */}
          <div className="ad-card">
            <div className="ad-ch">
              <b>4. Delay or hold</b>
              <small>Banner shown to customer</small>
            </div>
            <div className="ad-cb">
              {shipment.hold && (
                <div className="ad-cur a flex-col items-start">
                  <div>
                    <b>Current status: {shipment.hold.type}</b>
                    <div>{shipment.hold.reason}</div>
                  </div>
                  <button
                    type="button"
                    disabled={busyAction !== ""}
                    className="sw-btn sw-btn-em"
                    style={{ padding: "8px 14px", fontSize: 12.5 }}
                    onClick={async () => {
                      setBusyAction("clearhold");
                      try {
                        await adminClearHold({
                          shipment,
                          actorUid: user.uid,
                          actorEmail: adminEmail,
                        });
                        toast.success("Hold cleared");
                        await loadDetail();
                      } finally {
                        setBusyAction("");
                      }
                    }}
                  >
                    Clear hold / delay
                  </button>
                </div>
              )}

              <form
                className="ad-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!holdReason.trim()) {
                    toast.error("Enter a reason for the customer banner.");
                    return;
                  }
                  setBusyAction("sethold");
                  try {
                    await adminSetHold({
                      shipment,
                      type: holdType,
                      reason: holdReason,
                      actorUid: user.uid,
                      actorEmail: adminEmail,
                    });
                    setHoldReason("");
                    toast.success(`${holdType} status set`);
                    await loadDetail();
                  } finally {
                    setBusyAction("");
                  }
                }}
              >
                <div className="fw">
                  <label className="lbl" htmlFor="hold-type">
                    Banner type
                  </label>
                  <select
                    id="hold-type"
                    className="field"
                    value={holdType}
                    onChange={(e) =>
                      setHoldType(e.target.value as "Delayed" | "On Hold")
                    }
                  >
                    <option value="Delayed">Delayed (amber)</option>
                    <option value="On Hold">On Hold (red)</option>
                  </select>
                </div>
                <div className="fw">
                  <label className="lbl" htmlFor="hold-reason">
                    Reason shown to customer
                  </label>
                  <input
                    id="hold-reason"
                    className="field"
                    value={holdReason}
                    onChange={(e) => setHoldReason(e.target.value)}
                    placeholder="e.g. Weather diversion at hub · 24h delay"
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={busyAction !== ""}
                  className="sw-btn sw-btn-amber"
                >
                  Apply delay / hold
                </button>
              </form>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN */}
        <div>
          {/* 5. SEND ACTION ALERT */}
          <div className="ad-card">
            <div className="ad-ch">
              <b>5. Ask receiver (or sender) to act</b>
              <small>Creates dashboard &amp; email alert</small>
            </div>
            <div className="ad-cb">
              <form
                className="ad-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!alTitle.trim() || !alMsg.trim()) {
                    toast.error("Enter alert title and message.");
                    return;
                  }
                  setBusyAction("alert");
                  try {
                    await adminSendAlert({
                      shipment,
                      to: alTo,
                      kind: alKind,
                      title: alTitle,
                      message: alMsg,
                      amount: Number(alAmt || 0),
                      holdShipment: alHold,
                      actorUid: user.uid,
                      actorEmail: adminEmail,
                    });
                    toast.success(`Action alert sent to ${alTo}`);
                    await loadDetail();
                  } finally {
                    setBusyAction("");
                  }
                }}
              >
                <div className="g2">
                  <div className="fw">
                    <label className="lbl" htmlFor="al-to">
                      Ask who
                    </label>
                    <select
                      id="al-to"
                      className="field"
                      value={alTo}
                      onChange={(e) => setAlTo(e.target.value as AlertTarget)}
                    >
                      <option value="receiver">Receiver</option>
                      <option value="sender">Sender</option>
                    </select>
                  </div>
                  <div className="fw">
                    <label className="lbl" htmlFor="al-kind">
                      Template
                    </label>
                    <select
                      id="al-kind"
                      className="field"
                      value={alKind}
                      onChange={(e) =>
                        applyTemplate(e.target.value as AlertKind)
                      }
                    >
                      <option value="duty">Pay import duty</option>
                      <option value="address">Confirm address</option>
                      <option value="id">Upload ID</option>
                      <option value="reschedule">Reschedule delivery</option>
                      <option value="custom">Custom request</option>
                    </select>
                  </div>
                </div>

                <div className="fw">
                  <label className="lbl" htmlFor="al-title">
                    Alert headline
                  </label>
                  <input
                    id="al-title"
                    className="field"
                    value={alTitle}
                    onChange={(e) => setAlTitle(e.target.value)}
                    required
                  />
                </div>

                <div className="fw">
                  <label className="lbl" htmlFor="al-msg">
                    Instructions
                  </label>
                  <textarea
                    id="al-msg"
                    className="field"
                    value={alMsg}
                    onChange={(e) => setAlMsg(e.target.value)}
                    required
                  />
                </div>

                {alKind === "duty" && (
                  <div className="fw">
                    <label className="lbl" htmlFor="al-amt">
                      Amount due (USD)
                    </label>
                    <input
                      id="al-amt"
                      className="field"
                      type="number"
                      step="0.01"
                      min="0"
                      value={alAmt}
                      onChange={(e) => setAlAmt(e.target.value)}
                    />
                  </div>
                )}

                <label className="chk">
                  <input
                    type="checkbox"
                    checked={alHold}
                    onChange={(e) => setAlHold(e.target.checked)}
                  />
                  <span>
                    Hold shipment until resolved (auto-releases when completed)
                  </span>
                </label>

                <button
                  type="submit"
                  disabled={busyAction !== ""}
                  className="sw-btn sw-btn-blue"
                >
                  {busyAction === "alert" ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                  Send action request
                </button>
              </form>

              {(shipment.alerts || []).length > 0 && (
                <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                  <div className="lbl">Alert history</div>
                  {(shipment.alerts || []).map((al) => (
                    <div
                      key={al.id}
                      style={{
                        padding: 12,
                        borderRadius: 12,
                        background: "var(--card2)",
                        border: "1px solid var(--border)",
                        fontSize: 12.5,
                      }}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <b>
                          {al.title} ({al.to})
                        </b>
                        <span
                          className={`chip ${al.status === "open" ? "b" : "g"}`}
                        >
                          {al.status}
                        </span>
                      </div>
                      <div style={{ color: "var(--muted)" }}>{al.message}</div>
                      {al.response && (
                        <div
                          style={{
                            marginTop: 6,
                            color: "var(--em2)",
                            fontWeight: 600,
                          }}
                        >
                          Response: {al.response}
                        </div>
                      )}
                      {al.attachmentUrl && (
                        <div style={{ marginTop: 6 }}>
                          <a
                            href={al.attachmentUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              color: "var(--blue)",
                              fontWeight: 600,
                              textDecoration: "underline",
                            }}
                          >
                            View uploaded document ({al.attachmentName || "file"})
                          </a>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 6. PARTIES & INVITES */}
          <div className="ad-card">
            <div className="ad-ch">
              <b>6. Parties &amp; receiver invites</b>
              <small>Linking &amp; email status</small>
            </div>

            <div className="ad-party">
              <small>Sender</small>
              <b>{shipment.sender.name}</b>
              <span>
                {shipment.sender.email} · {shipment.sender.phone}
              </span>
              <span>
                {shipment.sender.address}, {shipment.sender.city},{" "}
                {shipment.sender.country}
              </span>
              <span className="ok">✓ signed up</span>
            </div>

            <div className="ad-party">
              <small>Receiver</small>
              <b>{shipment.receiver.name}</b>
              <span>
                {shipment.receiver.email} · {shipment.receiver.phone}
              </span>
              <span>
                {shipment.receiver.address}, {shipment.receiver.city},{" "}
                {shipment.receiver.country}
              </span>
              {receiverSignedUp ? (
                <span className="ok">✓ signed up on ShipWell</span>
              ) : (
                <span className="wait">
                  Waiting for {shipment.receiver.email} to sign up
                </span>
              )}

              <div className="mt-2 flex gap-2 flex-wrap">
                <button
                  type="button"
                  disabled={busyAction !== ""}
                  className="sw-btn sw-btn-ghost"
                  style={{ padding: "8px 14px", fontSize: 12.5 }}
                  onClick={async () => {
                    setBusyAction("invite");
                    try {
                      const res = await adminResendReceiverInvite({
                        shipment,
                        actorUid: user.uid,
                        actorEmail: adminEmail,
                        isReminder: (shipment.invites || []).length > 0,
                      });
                      toast.success(
                        `Email ${res.status === "sent" ? "delivered" : "queued"} to ${shipment.receiverEmail}`
                      );
                      await loadDetail();
                    } catch (err) {
                      toast.error(
                        err instanceof Error ? err.message : "Failed to send invite"
                      );
                    } finally {
                      setBusyAction("");
                    }
                  }}
                >
                  <Mail className="w-3.5 h-3.5" />
                  {(shipment.invites || []).length > 0
                    ? "Send reminder invite email"
                    : "Send invite email"}
                </button>
              </div>

              {(shipment.invites || []).length > 0 && (
                <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
                  <small>Invite log</small>
                  {(shipment.invites || []).map((inv) => (
                    <div
                      key={inv.id}
                      style={{
                        fontSize: 12,
                        color: "var(--muted)",
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 8,
                      }}
                    >
                      <span>
                        {inv.template} · {inv.status}
                      </span>
                      <span className="mono">
                        {formatDateTime(inv.sentAt)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 7. TIMELINE + UNDO LAST */}
          <div className="ad-card">
            <div className="ad-ch">
              <b>7. Timeline</b>
              <button
                type="button"
                disabled={busyAction !== "" || sortedEvents.length <= 1}
                className="sw-btn sw-btn-ghost"
                style={{ padding: "7px 12px", fontSize: 12 }}
                onClick={async () => {
                  setBusyAction("undo");
                  try {
                    const ok = await adminUndoLastEvent({
                      shipment,
                      actorUid: user.uid,
                      actorEmail: adminEmail,
                    });
                    if (ok) {
                      toast.success("Last checkpoint removed");
                      await loadDetail();
                    } else {
                      toast("Cannot undo the initial booking event.");
                    }
                  } finally {
                    setBusyAction("");
                  }
                }}
              >
                <Undo2 className="w-3.5 h-3.5" />
                Undo last
              </button>
            </div>
            <div className="ad-tl">
              {sortedEvents.map((ev, idx) => (
                <div
                  key={ev.id}
                  className={`ev ${idx === 0 ? "active" : "done"} ${
                    ev.kind === "delay"
                      ? "k-delay"
                      : ev.kind === "action"
                        ? "k-action"
                        : ""
                  }`}
                >
                  <div className="dot">
                    {ev.kind === "delay" ? (
                      <AlertTriangle className="w-3 h-3" />
                    ) : ev.kind === "action" ? (
                      <AlertCircle className="w-3 h-3" />
                    ) : (
                      <Shield className="w-3 h-3" />
                    )}
                  </div>
                  <div className="evc">
                    <div className="evt">
                      <b>
                        {ev.label}{" "}
                        <span className="mini">{ev.stage}</span>
                      </b>
                      <time>{formatDateTime(ev.ts)}</time>
                    </div>
                    {ev.loc && <small>{ev.loc}</small>}
                    {ev.note && <small className="nt">{ev.note}</small>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* CUSTOM REACT FLAG ITEM MODAL (ZERO window.prompt) */}
      {flagModalOpen && (
        <div className="md" role="dialog" aria-modal="true">
          <div className="md-b" onClick={() => setFlagModalOpen(false)} />
          <div className="md-c">
            <button
              className="md-x"
              onClick={() => setFlagModalOpen(false)}
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="au-ic" style={{ color: "#fb7185", borderColor: "rgba(244,63,94,0.3)", background: "rgba(244,63,94,0.1)" }}>
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div className="au-t">FLAG AN ISSUE</div>
            <p className="au-r">
              Explain what is missing or needs attention. This creates a sender
              action alert and puts {shipment.code} on hold automatically.
            </p>
            <form
              className="au-f"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!flagReason.trim()) {
                  toast.error("Please enter a reason.");
                  return;
                }
                setBusyAction("flag");
                try {
                  await adminFlagShipmentItem({
                    shipment,
                    reason: flagReason,
                    actorUid: user.uid,
                    actorEmail: adminEmail,
                  });
                  setFlagModalOpen(false);
                  toast.success("Item flagged & sender notified");
                  await loadDetail();
                } finally {
                  setBusyAction("");
                }
              }}
            >
              <div className="fw">
                <label className="lbl" htmlFor="flag-reason">
                  Issue details
                </label>
                <textarea
                  id="flag-reason"
                  className="field"
                  value={flagReason}
                  onChange={(e) => setFlagReason(e.target.value)}
                  placeholder="e.g. Photos are blurry — please upload a clear image showing serial numbers."
                  required
                />
              </div>
              <button
                type="submit"
                disabled={busyAction === "flag"}
                className="sw-btn sw-btn-red sw-btn-lg sw-btn-block"
              >
                {busyAction === "flag" && (
                  <Loader2 className="w-4 h-4 animate-spin" />
                )}
                Flag item &amp; notify sender
              </button>
            </form>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
