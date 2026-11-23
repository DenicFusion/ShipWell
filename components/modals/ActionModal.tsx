"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Calendar,
  Check,
  CreditCard,
  Loader2,
  MapPin,
  Shield,
  Upload,
  X,
} from "lucide-react";
import {
  ADMIN_EMAIL,
  type ShipmentAlert,
  type ShipmentRecord,
} from "@/types/tracking";
import { resolveShipmentAlert } from "@/lib/firestore-shipments";
import { uploadIdAttachment } from "@/lib/storage";
import { auth } from "@/lib/firebase";
import { openBachsOverlay } from "@/lib/bachs-overlay";
import { formatMoney, formatShortDay } from "@/lib/quote-engine";
import toast from "react-hot-toast";

export function ActionModal({
  shipment,
  alert,
  actorUid,
  onClose,
  onResolved,
}: {
  shipment: ShipmentRecord;
  alert: ShipmentAlert;
  actorUid: string;
  onClose: () => void;
  onResolved: () => void;
}) {
  const [address, setAddress] = useState(shipment.receiver.address || "");
  const [city, setCity] = useState(shipment.receiver.city || "");
  const [idFile, setIdFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState("");
  const [dateOptions] = useState<{ value: string; label: string }[]>(() => {
    const out: { value: string; label: string }[] = [];
    for (let i = 1; i <= 5; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const iso = d.toISOString().slice(0, 10);
      out.push({ value: iso, label: formatShortDay(d.getTime()) });
    }
    return out;
  });
  const [reschedDate, setReschedDate] = useState(
    () => dateOptions[0]?.value || ""
  );
  const [reschedSlot, setReschedSlot] = useState("09:00 – 12:00");
  const [customNote, setCustomNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const dutyBreakdown = useMemo(() => {
    const total = Number(alert.amount || 0);
    const vat = Math.round(total * 0.25 * 100) / 100;
    const customs = Math.round((total - vat) * 100) / 100;
    return { total, vat, customs };
  }, [alert.amount]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (alert.kind === "duty") {
      setBusy(true);
      try {
        const idToken = await auth.currentUser?.getIdToken().catch(() => null);
        if (!idToken) {
          throw new Error("Please log in to settle customs charges.");
        }
        const res = await fetch("/api/customs/create-checkout", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            code: shipment.code,
            alertId: alert.id,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.checkoutUrl) {
          throw new Error(
            data.error || "Unable to create hosted payment session."
          );
        }
        await openBachsOverlay(data.checkoutUrl, (eventType) => {
          if (eventType === "checkout.completed") {
            setBusy(false);
            toast.success("Payment received — confirming with carrier...");
            onClose();
          } else if (
            eventType === "checkout.failed" ||
            eventType === "checkout.error"
          ) {
            setBusy(false);
            setError("Payment was not completed. Please try again.");
          } else if (eventType === "checkout.closed") {
            setBusy(false);
          }
        });
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Could not start payment checkout."
        );
        setBusy(false);
      }
      return;
    }

    let response = "";
    let updatedAddress: string | undefined;

    if (alert.kind === "address") {
      if (!address.trim() || !city.trim()) {
        setError("Please enter both street address and city.");
        return;
      }
      updatedAddress = address.trim();
      response = `Confirmed address: ${address.trim()}, ${city.trim()}`;
    } else if (alert.kind === "id") {
      if (!idFile || !fileName) {
        setError("Please choose an ID document photo or PDF to upload.");
        return;
      }
      response = `ID uploaded (${fileName})`;
    } else if (alert.kind === "reschedule") {
      response = `Rescheduled delivery to ${reschedDate} (${reschedSlot})`;
    } else {
      if (!customNote.trim()) {
        setError("Please enter a short reply before submitting.");
        return;
      }
      response = customNote.trim();
    }

    setBusy(true);
    try {
      let attachmentName: string | undefined = fileName || undefined;
      let attachmentUrl: string | undefined;
      if (alert.kind === "id" && idFile) {
        const uploaded = await uploadIdAttachment({
          code: shipment.code,
          alertId: alert.id,
          file: idFile,
        });
        attachmentName = uploaded.name;
        attachmentUrl = uploaded.url;
      }

      await resolveShipmentAlert({
        shipment,
        alert,
        actorUid,
        response,
        updatedAddress,
        attachmentName,
        attachmentUrl,
      });

      const idToken = await auth.currentUser?.getIdToken().catch(() => null);
      await fetch("/api/shipments/notify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          code: shipment.code,
          toEmail: ADMIN_EMAIL,
          recipientName: "ShipWell Operations",
          senderFullName: shipment.sender.name,
          updateType: "checkpoint",
          headline: `Action resolved on ${shipment.code}`,
          details: `${alert.title} — ${response}`,
          hasAccount: true,
        }),
      }).catch(() => null);

      toast.success("Action completed — thank you!");
      onResolved();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not complete action."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="md" role="dialog" aria-modal="true">
      <div className="md-b" onClick={onClose} />
      <div className="md-c">
        <button className="md-x" onClick={onClose} aria-label="Close">
          <X className="w-4 h-4" />
        </button>

        <div className="au-ic">
          {alert.kind === "duty" ? (
            <CreditCard className="w-6 h-6" />
          ) : alert.kind === "address" ? (
            <MapPin className="w-6 h-6" />
          ) : alert.kind === "id" ? (
            <Shield className="w-6 h-6" />
          ) : alert.kind === "reschedule" ? (
            <Calendar className="w-6 h-6" />
          ) : (
            <AlertCircle className="w-6 h-6" />
          )}
        </div>

        <div className="au-t">{alert.title.toUpperCase()}</div>
        <p className="au-r">{alert.message}</p>

        <form className="au-f" onSubmit={handleSubmit} noValidate>
          {alert.kind === "duty" && (
            <>
              <div
                style={{
                  background: "var(--card2)",
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  padding: 14,
                  display: "grid",
                  gap: 8,
                  fontSize: 13,
                }}
              >
                <div className="flex justify-between">
                  <span style={{ color: "var(--muted)" }}>
                    {alert.chargeType || "Customs duty"}
                  </span>
                  <b>{formatMoney(dutyBreakdown.customs)}</b>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: "var(--muted)" }}>
                    Clearance &amp; processing
                  </span>
                  <b>{formatMoney(dutyBreakdown.vat)}</b>
                </div>
                <hr style={{ borderColor: "var(--border)" }} />
                <div className="flex justify-between items-baseline">
                  <b>Total due</b>
                  <b
                    className="bebas"
                    style={{ fontSize: 28, color: "var(--em)" }}
                  >
                    {formatMoney(dutyBreakdown.total)}
                  </b>
                </div>
              </div>
              <p style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.55 }}>
                You will be redirected to Bachs&apos; secure hosted checkout.
                ShipWell never stores card numbers, and your parcel hold clears
                automatically once payment settles.
              </p>
            </>
          )}

          {alert.kind === "address" && (
            <>
              <div className="fw">
                <label className="lbl" htmlFor="act-addr">
                  Full street address &amp; flat/unit
                </label>
                <input
                  id="act-addr"
                  className="field"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="22 Bishopsgate, Suite 4"
                  required
                />
              </div>
              <div className="fw">
                <label className="lbl" htmlFor="act-city">
                  City
                </label>
                <input
                  id="act-city"
                  className="field"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  required
                />
              </div>
            </>
          )}

          {alert.kind === "id" && (
            <div className="fw">
              <label className="lbl">Photo of Passport / National ID</label>
              <label className="pf-zone">
                <Upload className="w-6 h-6 text-emerald-400" />
                <b>{fileName || "Tap to select ID document"}</b>
                <small>JPG, PNG or PDF · max 5 MB · uploaded securely</small>
                <input
                  type="file"
                  accept="image/*,.pdf"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      setIdFile(f);
                      setFileName(f.name);
                    }
                  }}
                />
              </label>
            </div>
          )}

          {alert.kind === "reschedule" && (
            <>
              <div className="fw">
                <label className="lbl" htmlFor="act-rdate">
                  Preferred delivery date
                </label>
                <select
                  id="act-rdate"
                  className="field"
                  value={reschedDate}
                  onChange={(e) => setReschedDate(e.target.value)}
                >
                  {dateOptions.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label} ({d.value})
                    </option>
                  ))}
                </select>
              </div>
              <div className="fw">
                <label className="lbl" htmlFor="act-rslot">
                  Time window
                </label>
                <select
                  id="act-rslot"
                  className="field"
                  value={reschedSlot}
                  onChange={(e) => setReschedSlot(e.target.value)}
                >
                  <option>09:00 – 12:00</option>
                  <option>12:00 – 15:00</option>
                  <option>15:00 – 18:00</option>
                </select>
              </div>
            </>
          )}

          {(alert.kind === "custom" || alert.kind === "item") && (
            <div className="fw">
              <label className="lbl" htmlFor="act-note">
                Your response
              </label>
              <textarea
                id="act-note"
                className="field"
                value={customNote}
                onChange={(e) => setCustomNote(e.target.value)}
                placeholder="Provide the requested details or confirmation..."
                required
              />
            </div>
          )}

          {error && <div className="au-err">{error}</div>}

          <button
            type="submit"
            disabled={busy}
            className="sw-btn sw-btn-em sw-btn-lg sw-btn-block"
          >
            {busy ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : alert.kind === "duty" ? (
              <CreditCard className="w-4 h-4" />
            ) : (
              <Check className="w-4 h-4" />
            )}
            {alert.kind === "duty"
              ? `Pay with Bachs · ${formatMoney(alert.amount || 0)}`
              : "Submit & Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
