"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import {
  CheckCircle2,
  Copy,
  CreditCard,
  Download,
  FileText,
  Loader2,
  Printer,
  ShieldCheck,
  X,
} from "lucide-react";
import toast from "react-hot-toast";
import { auth, db } from "@/lib/firebase";
import { apiFetch } from "@/lib/api-client";
import { openBachsOverlay } from "@/lib/bachs-overlay";
import {
  DEFAULT_PAYMENT_METHODS,
  filterEligiblePaymentMethods,
} from "@/lib/payment-methods";
import { formatDateTime } from "@/lib/quote-engine";
import { ManualPaymentPanel } from "@/components/payments/ManualPaymentPanel";
import {
  formatUsd,
  type AdminPaymentSettingsPublic,
  type GatewayId,
  type ManualPaymentRecord,
  type PaymentMethodRecord,
  type ShipmentAlert,
  type ShipmentRecord,
} from "@/types/tracking";

const GATEWAY_LABEL: Record<GatewayId, string> = {
  bachs: "Bachs",
  stripe: "Stripe",
  paystack: "Paystack",
  manual: "Manual / Wire",
};

export function CustomsLedger({
  shipment,
  viewerRole,
  isAdmin,
}: {
  shipment: ShipmentRecord;
  viewerRole: "receiver" | "sender" | "admin" | "public";
  isAdmin: boolean;
}) {
  const [searchParams] = useSearchParams();
  const paidQuery = searchParams.get("paid");

  const [payingKey, setPayingKey] = useState<string | null>(null);
  const [confirmingAlertId, setConfirmingAlertId] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string>("");
  const [receiptAlert, setReceiptAlert] = useState<ShipmentAlert | null>(null);
  const [allMethods, setAllMethods] = useState<PaymentMethodRecord[]>([]);
  const [customsPayments, setCustomsPayments] = useState<
    Record<string, ManualPaymentRecord>
  >({});
  const [gatewayConfig, setGatewayConfig] = useState<{
    primary: GatewayId;
    offerChoice: boolean;
    enabledGateways: GatewayId[];
  }>({
    primary: "bachs",
    offerChoice: false,
    enabledGateways: ["bachs"],
  });

  useEffect(() => {
    apiFetch<{ ok: boolean; methods: PaymentMethodRecord[] }>(
      "/api/payment-methods?appliesTo=customs",
      { step: "customs_load_methods" }
    )
      .then((res) => {
        if (Array.isArray(res.methods) && res.methods.length > 0) {
          setAllMethods(res.methods);
        } else {
          setAllMethods(DEFAULT_PAYMENT_METHODS);
        }
      })
      .catch(() => {
        setAllMethods(DEFAULT_PAYMENT_METHODS);
      });

    if (!auth.currentUser) return;
    getDoc(doc(db, "adminSettings", "payments"))
      .then((snap) => {
        if (!snap.exists()) return;
        const data = snap.data() as Partial<AdminPaymentSettingsPublic>;
        const primary = (data.routing?.primaryGateway || "bachs") as GatewayId;
        const offerChoice = Boolean(data.routing?.offerChoice);
        const list: GatewayId[] = ["bachs"];
        if (data.stripe?.enabled) list.push("stripe");
        if (data.paystack?.enabled) list.push("paystack");
        if (!list.includes(primary)) list.unshift(primary);
        setGatewayConfig({
          primary,
          offerChoice,
          enabledGateways: Array.from(new Set(list)),
        });
      })
      .catch(() => undefined);

    auth.currentUser
      .getIdToken()
      .then((token) =>
        apiFetch<{ ok: boolean; payments: ManualPaymentRecord[] }>(
          `/api/payments/my?code=${encodeURIComponent(shipment.code)}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            step: "customs_load_payments",
          }
        )
      )
      .then((res) => {
        if (!Array.isArray(res.payments)) return;
        const map: Record<string, ManualPaymentRecord> = {};
        for (const p of res.payments) {
          if (p.kind === "customs" && p.alertId && !map[p.alertId]) {
            map[p.alertId] = p;
          }
        }
        setCustomsPayments(map);
      })
      .catch(() => undefined);
  }, [shipment.code]);

  const dutyAlerts = useMemo(() => {
    return (shipment.alerts || [])
      .filter((a) => a.kind === "duty")
      .sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
  }, [shipment.alerts]);

  const totals = useMemo(() => {
    let paid = 0;
    let outstanding = 0;
    for (const al of dutyAlerts) {
      const amt = Number(al.amount || 0);
      if (al.payment?.status === "paid" || al.status === "resolved") {
        paid += amt;
      } else {
        const alreadyPaid = Number(al.payment?.amountPaid || 0);
        outstanding += Math.max(0, amt - alreadyPaid);
      }
    }
    return { paid, outstanding };
  }, [dutyAlerts]);

  const openDutyCount = useMemo(
    () =>
      dutyAlerts.filter(
        (al) => al.status === "open" && al.payment?.status !== "paid"
      ).length,
    [dutyAlerts]
  );

  if (dutyAlerts.length === 0) return null;

  const startMethodCheckout = async (
    al: ShipmentAlert,
    method: PaymentMethodRecord
  ) => {
    setCheckoutError("");
    setPayingKey(`${al.id}_${method.id}`);
    try {
      const token = await auth.currentUser?.getIdToken().catch(() => null);
      if (!token) {
        throw new Error("Please sign in to pay customs charges.");
      }
      const data = await apiFetch<{
        checkoutUrl?: string | null;
        checkoutId?: string;
        provider?: string;
        manualPayment?: ManualPaymentRecord | null;
        error?: string;
      }>("/api/customs/create-checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          code: shipment.code,
          alertId: al.id,
          paymentMethodId: method.id,
          gateway: method.gateway || undefined,
        }),
        step: "customs_create_checkout",
      });

      if (data.provider === "manual" && data.manualPayment) {
        setCustomsPayments((prev) => ({
          ...prev,
          [al.id]: data.manualPayment!,
        }));
        setPayingKey(null);
        toast.success(`Created payment reference ${data.manualPayment.reference}`);
        return;
      }

      if (!data.checkoutUrl) {
        throw new Error(
          data.error || "Unable to start hosted checkout session."
        );
      }

      const activeGw = (method.gateway || data.provider || "bachs") as GatewayId;
      if (activeGw === "bachs") {
        await openBachsOverlay(data.checkoutUrl, (eventType) => {
          if (eventType === "checkout.completed") {
            setConfirmingAlertId(al.id);
            setPayingKey(null);
            toast.success("Payment received — waiting for webhook confirmation");
          } else if (
            eventType === "checkout.failed" ||
            eventType === "checkout.error"
          ) {
            setPayingKey(null);
            setCheckoutError("Payment could not be completed. Please try again.");
          } else if (eventType === "checkout.closed") {
            setPayingKey(null);
          }
        });
      } else {
        window.location.assign(data.checkoutUrl);
      }
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "Checkout creation failed. Please try again.";
      setCheckoutError(msg);
      toast.error(msg);
      setPayingKey(null);
    }
  };

  const startGatewayCheckout = async (al: ShipmentAlert, gateway: GatewayId) => {
    setCheckoutError("");
    setPayingKey(`${al.id}_${gateway}`);
    try {
      const token = await auth.currentUser?.getIdToken().catch(() => null);
      if (!token) {
        throw new Error("Please sign in to pay customs charges.");
      }
      const data = await apiFetch<{
        checkoutUrl?: string;
        error?: string;
      }>("/api/customs/create-checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          code: shipment.code,
          alertId: al.id,
          gateway,
        }),
        step: "customs_gateway_checkout",
      });
      if (!data.checkoutUrl) {
        throw new Error(data.error || "Unable to start hosted checkout session.");
      }
      if (gateway === "bachs") {
        await openBachsOverlay(data.checkoutUrl, (eventType) => {
          if (eventType === "checkout.completed") {
            setConfirmingAlertId(al.id);
            setPayingKey(null);
            toast.success("Payment received — waiting for webhook confirmation");
          } else if (
            eventType === "checkout.failed" ||
            eventType === "checkout.error"
          ) {
            setPayingKey(null);
            setCheckoutError("Payment could not be completed. Please try again.");
          } else if (eventType === "checkout.closed") {
            setPayingKey(null);
          }
        });
      } else {
        window.location.assign(data.checkoutUrl);
      }
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "Checkout creation failed. Please try again.";
      setCheckoutError(msg);
      toast.error(msg);
      setPayingKey(null);
    }
  };

  const downloadReceiptHtml = (al: ShipmentAlert) => {
    const paidAtText = al.payment?.paidAt
      ? formatDateTime(al.payment.paidAt)
      : "Confirmed";
    const refText = al.payment?.reference || `chg_${shipment.code}_${al.id}`;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>ShipWell Receipt — ${shipment.code}</title>
<style>body{font-family:Inter,Arial,sans-serif;background:#f8fafc;color:#0f172a;padding:32px}
.card{max-width:560px;margin:0 auto;background:#fff;border:1px solid #cbd5e1;border-radius:14px;padding:28px}
h1{font-size:20px;margin:0 0 6px}small{color:#64748b}
.row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #e2e8f0;font-size:14px}
.tot{font-size:18px;font-weight:700;color:#059669}</style></head>
<body><div class="card"><h1>ShipWell Customs Payment Receipt</h1>
<small>Official confirmation · shipwell.cc</small>
<div class="row"><span>Tracking code</span><b>${shipment.code}</b></div>
<div class="row"><span>Charge</span><b>${al.chargeType || al.title}</b></div>
<div class="row"><span>Payer</span><b>${al.to === "sender" ? shipment.sender.name : shipment.receiver.name}</b></div>
<div class="row"><span>Gateway</span><b>${GATEWAY_LABEL[al.payment?.provider || "bachs"]} (${al.payment?.environment || "live"})</b></div>
<div class="row"><span>Payment ID</span><b>${al.payment?.paymentId || al.payment?.checkoutId || "Verified"}</b></div>
<div class="row"><span>Reference</span><b>${refText}</b></div>
<div class="row"><span>Paid on</span><b>${paidAtText}</b></div>
<div class="row tot"><span>Amount paid</span><span>${formatUsd(al.amount, al.currency || "USD")}</span></div>
</div></body></html>`;
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ShipWell-Receipt-${shipment.code}-${al.id}.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="dx-card">
      <div className="dx-ch">
        <h3>Duties &amp; charges</h3>
        {openDutyCount > 0 ? (
          <span className="chip a">{openDutyCount} due</span>
        ) : (
          <span className="chip g">All paid</span>
        )}
      </div>

      <div className="dx-cb">
        {(paidQuery === "1" || confirmingAlertId !== null) && (
          <div
            className={`tk-hold ${openDutyCount === 0 ? "g" : "a"}`}
            style={{
              marginBottom: 14,
              background:
                openDutyCount === 0
                  ? "rgb(var(--em-rgb) / 0.08)"
                  : "rgb(var(--amber-rgb) / 0.08)",
              borderColor:
                openDutyCount === 0
                  ? "rgb(var(--em-rgb) / 0.35)"
                  : "rgb(var(--amber-rgb) / 0.35)",
              color: openDutyCount === 0 ? "var(--em)" : "var(--amber)",
            }}
          >
            {openDutyCount === 0 ? (
              <CheckCircle2 className="w-5 h-5 shrink-0" />
            ) : (
              <Loader2 className="w-5 h-5 shrink-0 animate-spin" />
            )}
            <div>
              <b>
                {openDutyCount === 0
                  ? "Payment confirmed — parcel released"
                  : "Confirming your payment…"}
              </b>
              <small style={{ color: "var(--muted)" }}>
                {openDutyCount === 0
                  ? "All customs charges on this parcel are settled."
                  : shipment.hold
                    ? "Your charge status updates live as soon as confirmed, or if another payment is still pending."
                    : "Waiting for confirmation from gateway."}
              </small>
            </div>
          </div>
        )}

        {paidQuery === "0" && (
          <div className="tk-hold a" style={{ marginBottom: 14 }}>
            <CreditCard className="w-5 h-5 hi shrink-0" />
            <div>
              <b>Checkout canceled</b>
              <small>No charge was made. You can resume payment anytime below.</small>
            </div>
          </div>
        )}

        {checkoutError && (
          <div className="au-err" style={{ marginBottom: 12 }}>
            {checkoutError}
          </div>
        )}

        <div className="cl-t">
          <span>
            Paid:{" "}
            <strong style={{ color: "var(--em)" }}>
              {formatUsd(totals.paid)}
            </strong>
          </span>
          <span>
            Outstanding:{" "}
            <strong
              style={{
                color: totals.outstanding > 0 ? "var(--amber)" : "var(--text)",
              }}
            >
              {formatUsd(totals.outstanding)}
            </strong>
          </span>
        </div>

        <div className="cl">
          {dutyAlerts.map((al) => {
            const payStatus =
              al.payment?.status || (al.status === "resolved" ? "paid" : "unpaid");
            const isPaid = payStatus === "paid" || al.status === "resolved";
            const isRefunded = payStatus === "refunded";
            const isUnderpaid = payStatus === "underpaid";
            const canPay =
              !isPaid && !isRefunded && (isAdmin || viewerRole === al.to);
            const currency = al.currency || al.payment?.currency || "USD";
            const createdLabel = al.createdAtMs
              ? formatDateTime(al.createdAtMs)
              : "";
            const underpaidMissing =
              isUnderpaid && al.payment?.amountPaid != null
                ? Math.max(0, Number(al.amount || 0) - Number(al.payment.amountPaid))
                : 0;

            const existingManualPay = customsPayments[al.id];
            const eligibleCustomMethods = filterEligiblePaymentMethods({
              methods: allMethods,
              appliesTo: "customs",
              amountUsd: Number(al.amount || 0),
              country:
                al.to === "sender"
                  ? shipment.sender.country
                  : shipment.receiver.country,
            }).filter((m) => m.type !== "cash");

            const extraGateways: GatewayId[] = gatewayConfig.offerChoice
              ? gatewayConfig.enabledGateways.filter((gw) => gw !== "bachs")
              : [];

            return (
              <div key={al.id} style={{ display: "grid", gap: 10 }}>
                <div className="cl-r">
                  <span className={`cl-d ${isPaid ? "p" : "o"}`} />
                  <div className="cl-m">
                    <b>{al.chargeType || al.title}</b>
                    <small>
                      {al.message}
                      {createdLabel ? ` · ${createdLabel}` : ""}
                    </small>
                    {isUnderpaid && underpaidMissing > 0 && (
                      <small style={{ color: "var(--rose-t)", fontWeight: 600 }}>
                        Underpaid by {formatUsd(underpaidMissing, currency)} — please pay the balance
                      </small>
                    )}
                    {al.payment?.lastError && !isPaid && (
                      <small style={{ color: "var(--amber)" }}>
                        {al.payment.lastError}
                      </small>
                    )}
                  </div>

                  <strong>{formatUsd(al.amount, currency)}</strong>

                  {isRefunded ? (
                    <span className="chip n">Refunded</span>
                  ) : isPaid ? (
                    <span className="chip g">Paid</span>
                  ) : existingManualPay?.status === "pending_review" ? (
                    <span className="chip b">Proof under review</span>
                  ) : isUnderpaid ? (
                    <span className="chip r">Underpaid</span>
                  ) : payStatus === "pending" ? (
                    <span className="chip b">Pending</span>
                  ) : (
                    <span className="chip a">Unpaid</span>
                  )}

                  <div className="cl-acts">
                    {canPay &&
                      eligibleCustomMethods.map((m, idx) => {
                        const busy = payingKey === `${al.id}_${m.id}`;
                        return (
                          <button
                            key={m.id}
                            type="button"
                            disabled={payingKey !== null}
                            className={`sw-btn ${
                              idx === 0 && !existingManualPay
                                ? "sw-btn-em"
                                : "sw-btn-ghost"
                            }`}
                            style={{ padding: "8px 14px", fontSize: 12.5 }}
                            onClick={() => startMethodCheckout(al, m)}
                          >
                            {busy ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <CreditCard className="w-3.5 h-3.5" />
                            )}
                            {m.type === "automatic"
                              ? m.name
                              : `Pay via ${m.name}`}
                          </button>
                        );
                      })}

                    {canPay &&
                      extraGateways.map((gw) => {
                        const busy = payingKey === `${al.id}_${gw}`;
                        return (
                          <button
                            key={gw}
                            type="button"
                            disabled={payingKey !== null}
                            className="sw-btn sw-btn-ghost"
                            style={{ padding: "8px 14px", fontSize: 12.5 }}
                            onClick={() => startGatewayCheckout(al, gw)}
                          >
                            {busy ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <CreditCard className="w-3.5 h-3.5" />
                            )}
                            Pay with {GATEWAY_LABEL[gw]}
                          </button>
                        );
                      })}

                    {isPaid && (
                      <button
                        type="button"
                        className="sw-btn sw-btn-ghost"
                        style={{ padding: "7px 12px", fontSize: 12 }}
                        onClick={() => setReceiptAlert(al)}
                      >
                        <FileText className="w-3.5 h-3.5" />
                        Receipt
                      </button>
                    )}
                  </div>
                </div>

                {existingManualPay && !isPaid && (
                  <ManualPaymentPanel
                    compact
                    payment={existingManualPay}
                    onUpdated={(next) =>
                      setCustomsPayments((prev) => ({ ...prev, [al.id]: next }))
                    }
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* IN-APP RECEIPT MODAL */}
      {receiptAlert && (
        <div
          className="md"
          role="dialog"
          aria-modal="true"
          aria-label="Customs payment receipt"
        >
          <div className="md-b" onClick={() => setReceiptAlert(null)} />
          <div className="md-c">
            <button
              type="button"
              className="md-x"
              onClick={() => setReceiptAlert(null)}
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="au-ic">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div className="au-t">PAYMENT RECEIPT</div>
            <p className="au-r">
              Verified customs duty settlement for{" "}
              <b className="mono">{shipment.code}</b>.
            </p>

            <div
              className="rv"
              style={{
                background: "var(--card2)",
                border: "1px solid var(--border)",
                borderRadius: 14,
                padding: 16,
                marginBottom: 16,
              }}
            >
              <div className="r">
                <span>Charge</span>
                <b>{receiptAlert.chargeType || receiptAlert.title}</b>
              </div>
              <div className="r">
                <span>Amount paid</span>
                <b style={{ color: "var(--em)" }}>
                  {formatUsd(
                    receiptAlert.amount,
                    receiptAlert.currency || "USD"
                  )}
                </b>
              </div>
              <div className="r">
                <span>Gateway</span>
                <b>
                  {GATEWAY_LABEL[receiptAlert.payment?.provider || "bachs"]} (
                  {receiptAlert.payment?.environment || "live"})
                </b>
              </div>
              <div className="r">
                <span>Payment ID</span>
                <b className="mono" style={{ fontSize: 12 }}>
                  {receiptAlert.payment?.paymentId ||
                    receiptAlert.payment?.checkoutId ||
                    "Verified"}
                </b>
              </div>
              <div className="r">
                <span>Reference</span>
                <b className="mono" style={{ fontSize: 12 }}>
                  {receiptAlert.payment?.reference ||
                    `chg_${shipment.code}_${receiptAlert.id}`}
                </b>
              </div>
              <div className="r">
                <span>Paid on</span>
                <b>
                  {receiptAlert.payment?.paidAt
                    ? formatDateTime(receiptAlert.payment.paidAt)
                    : "Confirmed"}
                </b>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="sw-btn sw-btn-em flex-1"
                onClick={() => downloadReceiptHtml(receiptAlert)}
              >
                <Download className="w-4 h-4" />
                Download receipt
              </button>
              <button
                type="button"
                className="sw-btn sw-btn-ghost"
                onClick={() => window.print()}
              >
                <Printer className="w-4 h-4" />
                Print
              </button>
              <button
                type="button"
                className="sw-btn sw-btn-ghost"
                onClick={() => {
                  const ref =
                    receiptAlert.payment?.reference ||
                    `chg_${shipment.code}_${receiptAlert.id}`;
                  navigator.clipboard.writeText(ref);
                  toast.success("Reference copied");
                }}
              >
                <Copy className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
