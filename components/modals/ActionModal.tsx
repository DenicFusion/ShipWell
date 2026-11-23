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
  type ManualPaymentRecord,
  type PaymentMethodRecord,
  type ShipmentAlert,
  type ShipmentRecord,
} from "@/types/tracking";
import { resolveShipmentAlert } from "@/lib/firestore-shipments";
import { uploadIdAttachment } from "@/lib/storage";
import { auth } from "@/lib/firebase";
import { apiFetch } from "@/lib/api-client";
import { openBachsOverlay } from "@/lib/bachs-overlay";
import {
  DEFAULT_PAYMENT_METHODS,
  filterEligiblePaymentMethods,
} from "@/lib/payment-methods";
import { ManualPaymentPanel } from "@/components/payments/ManualPaymentPanel";
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

  // Duty payment method options & manual payment state
  const [dutyMethods, setDutyMethods] = useState<PaymentMethodRecord[]>([]);
  const [selectedDutyMethodId, setSelectedDutyMethodId] = useState("bachs");
  const [activeManualPayment, setActiveManualPayment] =
    useState<ManualPaymentRecord | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (alert.kind !== "duty") return;
    let active = true;
    const country =
      alert.to === "sender"
        ? shipment.sender.country
        : shipment.receiver.country;
    apiFetch<{ ok: boolean; methods: PaymentMethodRecord[] }>(
      `/api/payment-methods?appliesTo=customs&amount=${Number(alert.amount || 0)}&country=${encodeURIComponent(country)}`,
      { step: "action_load_methods" }
    )
      .then((res) => {
        if (!active) return;
        const list = (
          Array.isArray(res.methods) && res.methods.length > 0
            ? res.methods
            : filterEligiblePaymentMethods({
                methods: DEFAULT_PAYMENT_METHODS,
                appliesTo: "customs",
                amountUsd: Number(alert.amount || 0),
                country,
              })
        ).filter((m) => m.type !== "cash");
        setDutyMethods(list);
        if (list.length > 0) setSelectedDutyMethodId(list[0].id);
      })
      .catch(() => {
        if (!active) return;
        const fallback = filterEligiblePaymentMethods({
          methods: DEFAULT_PAYMENT_METHODS,
          appliesTo: "customs",
          amountUsd: Number(alert.amount || 0),
          country,
        }).filter((m) => m.type !== "cash");
        setDutyMethods(fallback);
        if (fallback.length > 0) setSelectedDutyMethodId(fallback[0].id);
      });

    auth.currentUser
      ?.getIdToken()
      .then((token) =>
        apiFetch<{ ok: boolean; payments: ManualPaymentRecord[] }>(
          `/api/payments/my?code=${encodeURIComponent(shipment.code)}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            step: "action_load_existing_payment",
          }
        )
      )
      .then((res) => {
        if (!active || !Array.isArray(res.payments)) return;
        const found = res.payments.find(
          (p) => p.kind === "customs" && p.alertId === alert.id
        );
        if (found) setActiveManualPayment(found);
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [alert.kind, alert.amount, alert.to, alert.id, shipment.code, shipment.sender.country, shipment.receiver.country]);

  const dutyBreakdown = useMemo(() => {
    const total = Number(alert.amount || 0);
    const vat = Math.round(total * 0.25 * 100) / 100;
    const customs = Math.round((total - vat) * 100) / 100;
    return { total, vat, customs };
  }, [alert.amount]);

  const selectedDutyMethod = useMemo(
    () =>
      dutyMethods.find((m) => m.id === selectedDutyMethodId) ||
      dutyMethods[0] ||
      null,
    [dutyMethods, selectedDutyMethodId]
  );

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
        const data = await apiFetch<{
          checkoutUrl?: string | null;
          provider?: string;
          manualPayment?: ManualPaymentRecord | null;
          error?: string;
        }>("/api/customs/create-checkout", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            code: shipment.code,
            alertId: alert.id,
            paymentMethodId: selectedDutyMethod?.id || undefined,
            gateway: selectedDutyMethod?.gateway || undefined,
          }),
          step: "action_customs_checkout",
        });

        if (data.provider === "manual" && data.manualPayment) {
          setActiveManualPayment(data.manualPayment);
          setBusy(false);
          toast.success(`Payment reference ${data.manualPayment.reference} ready`);
          return;
        }

        if (!data.checkoutUrl) {
          throw new Error(
            data.error || "Unable to create hosted payment session."
          );
        }

        if ((selectedDutyMethod?.gateway || data.provider || "bachs") === "bachs") {
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
        } else {
          window.location.assign(data.checkoutUrl);
        }
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

        {alert.kind === "duty" && activeManualPayment ? (
          <div>
            <ManualPaymentPanel
              compact
              payment={activeManualPayment}
              onUpdated={(next) => {
                setActiveManualPayment(next);
                if (next.status === "paid" || next.status === "pending_review") {
                  onResolved();
                }
              }}
            />
          </div>
        ) : (
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

                {dutyMethods.length > 0 && (
                  <div className="fw" style={{ marginBottom: 4 }}>
                    <label className="lbl" htmlFor="act-duty-method">
                      Payment method
                    </label>
                    <select
                      id="act-duty-method"
                      className="field"
                      value={selectedDutyMethod?.id || ""}
                      onChange={(e) => setSelectedDutyMethodId(e.target.value)}
                    >
                      {dutyMethods.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.currency})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <p style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.55 }}>
                  {selectedDutyMethod?.type === "automatic" || !selectedDutyMethod
                    ? "You will be redirected to secure hosted checkout. ShipWell never stores card numbers, and your parcel hold clears automatically once payment settles."
                    : selectedDutyMethod.subtitle ||
                      "Next you will see payment transfer details and proof upload instructions."}
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
                ? selectedDutyMethod?.type === "automatic" || !selectedDutyMethod
                  ? `Pay with ${selectedDutyMethod?.name || "Bachs"} · ${formatMoney(alert.amount || 0)}`
                  : `Continue with ${selectedDutyMethod.name}`
                : "Submit & Continue"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
