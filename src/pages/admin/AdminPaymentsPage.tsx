import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { EmailAuthProvider, reauthenticateWithCredential } from "firebase/auth";
import {
  AlertTriangle,
  Check,
  Clock,
  Copy,
  CreditCard,
  ExternalLink,
  FileText,
  KeyRound,
  Loader2,
  MessageSquare,
  RefreshCw,
  RotateCcw,
  Search,
  X,
  XCircle,
} from "lucide-react";
import toast from "react-hot-toast";
import { auth } from "@/lib/firebase";
import { apiFetch } from "@/lib/api-client";
import { adminPath } from "@/lib/host";
import { formatDateTime, formatMoney } from "@/lib/quote-engine";
import { AdminShell } from "@/components/admin/AdminShell";
import { useShipWell } from "@/components/providers/ShipWellProvider";
import type { ManualPaymentRecord, ManualPaymentStatus } from "@/types/tracking";

type FilterStatus =
  | "all"
  | "pending_review"
  | "awaiting_payment"
  | "paid"
  | "rejected"
  | "info_requested"
  | "expired"
  | "refunded";

function statusChip(status: ManualPaymentStatus): { cls: string; label: string } {
  switch (status) {
    case "paid":
      return { cls: "g", label: "Paid" };
    case "pending_review":
      return { cls: "b", label: "Pending review" };
    case "awaiting_payment":
      return { cls: "a", label: "Awaiting payment" };
    case "info_requested":
      return { cls: "a", label: "Info requested" };
    case "rejected":
      return { cls: "r", label: "Rejected" };
    case "expired":
      return { cls: "r", label: "Expired" };
    case "refunded":
      return { cls: "n", label: "Refunded" };
    default:
      return { cls: "a", label: status };
  }
}

export default function AdminPaymentsPage() {
  const { user, isAdmin, openPhotoZoom } = useShipWell();
  const [payments, setPayments] = useState<ManualPaymentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("all");
  const [methodFilter, setMethodFilter] = useState("all");
  const [searchQ, setSearchQ] = useState("");
  const [selected, setSelected] = useState<ManualPaymentRecord | null>(null);
  const [busyId, setBusyId] = useState("");
  const [reasonMode, setReasonMode] = useState<null | "reject" | "request_info">(null);
  const [reasonText, setReasonText] = useState("");
  const [extendMinutes, setExtendMinutes] = useState("1440");

  // Password re-authentication modal for Refund
  const [refundTarget, setRefundTarget] = useState<ManualPaymentRecord | null>(null);
  const [refundReason, setRefundReason] = useState("Refund approved by administrator");
  const [refundPassword, setRefundPassword] = useState("");
  const [refundNeedsReauth, setRefundNeedsReauth] = useState(false);

  const [loadedAt, setLoadedAt] = useState(() => Date.now());

  const loadPayments = useCallback(async () => {
    if (!auth.currentUser) return;
    try {
      const token = await auth.currentUser.getIdToken();
      const data = await apiFetch<{ ok: boolean; payments: ManualPaymentRecord[] }>(
        "/api/admin/payments",
        {
          headers: { Authorization: `Bearer ${token}` },
          step: "admin_list_payments",
        }
      );
      const list = data.payments || [];
      setErrorMsg("");
      setLoadedAt(Date.now());
      setPayments(list);
      setSelected((prev) => (prev ? list.find((p) => p.id === prev.id) || prev : list[0] || null));
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Could not load payments queue."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    (async () => {
      if (!auth.currentUser || !active) return;
      await loadPayments();
    })();
    return () => {
      active = false;
    };
  }, [isAdmin, loadPayments]);

  const methodOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of payments) {
      if (p.methodId) map.set(p.methodId, p.methodName || p.methodId);
    }
    return Array.from(map.entries());
  }, [payments]);

  const kpis = useMemo(() => {
    const dayAgo = loadedAt - 24 * 60 * 60 * 1000;
    const pendingReview = payments.filter((p) => p.status === "pending_review").length;
    const awaitingPayment = payments.filter(
      (p) => p.status === "awaiting_payment" || p.status === "info_requested"
    ).length;
    const paidToday = payments.filter(
      (p) => p.status === "paid" && Number(p.paidAtMs || p.updatedAtMs || 0) >= dayAgo
    ).length;
    const totalReceivedUsd = payments
      .filter((p) => p.status === "paid")
      .reduce((sum, p) => sum + Number(p.totalUsd || 0), 0);
    return { pendingReview, awaitingPayment, paidToday, totalReceivedUsd };
  }, [payments, loadedAt]);

  const filtered = useMemo(() => {
    const q = searchQ.trim().toLowerCase();
    return payments.filter((p) => {
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      if (methodFilter !== "all" && p.methodId !== methodFilter) return false;
      if (!q) return true;
      return (
        p.reference.toLowerCase().includes(q) ||
        p.trackingCode.toLowerCase().includes(q) ||
        p.userEmail.toLowerCase().includes(q) ||
        (p.proof?.txId || "").toLowerCase().includes(q) ||
        p.methodName.toLowerCase().includes(q)
      );
    });
  }, [payments, statusFilter, methodFilter, searchQ]);

  const runAction = async (
    paymentId: string,
    action: "approve" | "reject" | "request_info" | "mark_received" | "refund" | "extend_window",
    extra?: { reason?: string; extraMinutes?: number }
  ) => {
    if (!auth.currentUser) return;
    setBusyId(paymentId);
    try {
      const token = await auth.currentUser.getIdToken(true);
      const data = await apiFetch<{ ok: boolean; payment: ManualPaymentRecord }>(
        `/api/admin/payments/${encodeURIComponent(paymentId)}/action`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            action,
            ...(extra?.reason ? { reason: extra.reason } : {}),
            ...(extra?.extraMinutes ? { extraMinutes: extra.extraMinutes } : {}),
          }),
          step: "admin_payment_action",
        }
      );
      const updated = data.payment;
      setPayments((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      setSelected(updated);
      setReasonMode(null);
      setReasonText("");
      toast.success(`Payment ${action.replace("_", " ")} applied`);
    } catch (err) {
      const code = (err as { code?: string })?.code || "";
      if (action === "refund" && code === "RECENT_AUTH_REQUIRED") {
        setRefundNeedsReauth(true);
        toast("Confirm your password to issue this refund.");
        return;
      }
      toast.error(err instanceof Error ? err.message : "Payment update failed.");
    } finally {
      setBusyId("");
    }
  };

  const handleExpireOverdue = async () => {
    if (!auth.currentUser) return;
    setBusyId("expire_all");
    try {
      const token = await auth.currentUser.getIdToken();
      const res = await apiFetch<{
        ok: boolean;
        expiredPayments: number;
        expiredBookings: number;
      }>("/api/bookings/expire-stale", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        step: "expire_stale_payments",
      });
      toast.success(
        `Expired ${res.expiredPayments} overdue payment(s) and ${res.expiredBookings} booking(s)`
      );
      await loadPayments();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Expiry sweep failed.");
    } finally {
      setBusyId("");
    }
  };

  return (
    <AdminShell
      title="Payments Queue"
      topAction={
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="sw-btn sw-btn-ghost"
            disabled={busyId === "expire_all"}
            onClick={handleExpireOverdue}
          >
            {busyId === "expire_all" ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Clock className="w-4 h-4" />
            )}
            Expire overdue
          </button>
          <button
            type="button"
            className="sw-btn sw-btn-ghost"
            onClick={loadPayments}
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      }
    >
      <div className="ad-kpis">
        <button
          type="button"
          className="ad-kpi b text-left"
          onClick={() => setStatusFilter("pending_review")}
        >
          <small>Pending review</small>
          <b>{kpis.pendingReview}</b>
        </button>
        <button
          type="button"
          className="ad-kpi a text-left"
          onClick={() => setStatusFilter("awaiting_payment")}
        >
          <small>Awaiting payment</small>
          <b>{kpis.awaitingPayment}</b>
        </button>
        <button
          type="button"
          className="ad-kpi g text-left"
          onClick={() => setStatusFilter("paid")}
        >
          <small>Paid (24h)</small>
          <b>{kpis.paidToday}</b>
        </button>
        <button
          type="button"
          className="ad-kpi text-left"
          onClick={() => setStatusFilter("all")}
        >
          <small>Total verified USD</small>
          <b>{formatMoney(kpis.totalReceivedUsd)}</b>
        </button>
      </div>

      {errorMsg && (
        <div className="ad-cur a" style={{ marginBottom: 16 }}>
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <div>
            <b>Could not load payment queue</b>
            <div style={{ fontSize: 12.5 }}>{errorMsg}</div>
          </div>
        </div>
      )}

      <div className="ad-bar" style={{ flexWrap: "wrap", gap: 10 }}>
        <div className="ad-search">
          <Search className="w-4 h-4 text-[var(--faint)]" />
          <input
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="Search ref (SW-PAY-...), tracking, email, TXID..."
          />
        </div>
        <select
          className="field"
          style={{ width: "auto", minWidth: 180 }}
          value={methodFilter}
          onChange={(e) => setMethodFilter(e.target.value)}
          aria-label="Filter by payment method"
        >
          <option value="all">All payment methods</option>
          {methodOptions.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <div className="ad-tabs2">
          {(
            [
              ["all", "All"],
              ["pending_review", "Pending review"],
              ["awaiting_payment", "Awaiting"],
              ["info_requested", "Info req"],
              ["paid", "Paid"],
              ["rejected", "Rejected"],
              ["expired", "Expired"],
              ["refunded", "Refunded"],
            ] as const
          ).map(([k, lbl]) => (
            <button
              key={k}
              type="button"
              className={statusFilter === k ? "on" : ""}
              onClick={() => setStatusFilter(k)}
            >
              {lbl}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="py-20 flex flex-col items-center gap-3 text-[var(--muted)]">
          <Loader2 className="w-7 h-7 animate-spin text-[var(--em)]" />
          <span>Loading payment verifications...</span>
        </div>
      ) : (
        <div className="ad-split">
          {/* LEFT: QUEUE LIST */}
          <div>
            <div className="ad-card">
              <div className="ad-ch">
                <b>Payment records</b>
                <small>{filtered.length} shown</small>
              </div>
              <div className="ad-q">
                {filtered.length === 0 ? (
                  <div className="ad-ok">
                    No payment records match the selected filters.
                  </div>
                ) : (
                  filtered.map((p) => {
                    const chip = statusChip(p.status);
                    const decimals = p.currency === "JPY" ? 0 : 2;
                    const amtStr = `${Number(p.convertedAmount || 0).toFixed(decimals)} ${p.currency}`;
                    const isSelected = selected?.id === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          setSelected(p);
                          setReasonMode(null);
                          setReasonText("");
                        }}
                        className="ad-qi w-full text-left"
                        style={
                          isSelected
                            ? {
                                background: "rgba(16,185,129,0.08)",
                                borderLeft: "3px solid var(--em)",
                              }
                            : undefined
                        }
                      >
                        <div className={`qd ${chip.cls}`}>
                          <CreditCard className="w-4 h-4" />
                        </div>
                        <div className="t">
                          <b className="flex items-center gap-2 flex-wrap">
                            <span className="mono">{p.reference}</span>
                            <span>· {amtStr}</span>
                            {p.duplicateWarning && (
                              <span className="chip r" style={{ fontSize: 10 }}>
                                Duplicate proof
                              </span>
                            )}
                          </b>
                          <small>
                            {p.methodName} · {p.trackingCode} · {p.userEmail} ·{" "}
                            {formatDateTime(p.createdAtMs)}
                          </small>
                        </div>
                        <span className={`chip ${chip.cls}`}>{chip.label}</span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* RIGHT: PROOF & DECISION WORKSPACE */}
          <div>
            {!selected ? (
              <div className="ad-card ad-ok">
                Select a payment record from the queue to review proof details and approve or reject.
              </div>
            ) : (
              <div className="ad-card">
                <div className="ad-ch">
                  <div>
                    <b className="mono">{selected.reference}</b>
                    <span className={`mini ${statusChip(selected.status).cls}`}>
                      {statusChip(selected.status).label}
                    </span>
                  </div>
                  <small>
                    {selected.kind === "customs" ? "Customs fee" : "Shipment booking"}
                  </small>
                </div>

                <div className="ad-cb">
                  {selected.duplicateWarning && (
                    <div className="ad-cur r" style={{ marginBottom: 14 }}>
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <div>
                        <b>Possible duplicate proof detected</b>
                        <div style={{ fontSize: 12.5 }}>{selected.duplicateWarning}</div>
                      </div>
                    </div>
                  )}

                  {selected.reviewNote && (
                    <div className="ad-cur a" style={{ marginBottom: 14 }}>
                      <MessageSquare className="w-4 h-4 shrink-0" />
                      <div>
                        <b>Last review note</b>
                        <div style={{ fontSize: 12.5 }}>{selected.reviewNote}</div>
                      </div>
                    </div>
                  )}

                  <div className="ad-kv">
                    <div>
                      <small>Method</small>
                      <b>{selected.methodName}</b>
                    </div>
                    <div>
                      <small>Amount due</small>
                      <b style={{ color: "var(--em)" }}>
                        {Number(selected.convertedAmount || 0).toFixed(
                          selected.currency === "JPY" ? 0 : 2
                        )}{" "}
                        {selected.currency}
                        {selected.currency !== "USD"
                          ? ` (${formatMoney(selected.totalUsd)} USD)`
                          : ""}
                      </b>
                    </div>
                    <div>
                      <small>Tracking code</small>
                      <b>
                        <Link
                          to={adminPath(`shipment/${selected.trackingCode}`)}
                          style={{ color: "var(--em)" }}
                          className="mono"
                        >
                          {selected.trackingCode} →
                        </Link>
                      </b>
                    </div>
                    <div>
                      <small>Customer</small>
                      <b>
                        {selected.userName || selected.userEmail}{" "}
                        <span className="text-[var(--muted)] font-normal">
                          ({selected.userEmail})
                        </span>
                      </b>
                    </div>
                    <div>
                      <small>Created</small>
                      <b>{formatDateTime(selected.createdAtMs)}</b>
                    </div>
                    <div>
                      <small>Payment window expires</small>
                      <b>{formatDateTime(selected.expiresAt)}</b>
                    </div>
                  </div>

                  {/* CUSTOMER PROOF PANEL */}
                  <div
                    style={{
                      marginTop: 14,
                      padding: 14,
                      borderRadius: 12,
                      border: "1px solid var(--border)",
                      background: "var(--surface-2, rgba(255,255,255,0.02))",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: "0.1em",
                        textTransform: "uppercase",
                        color: "var(--muted)",
                        marginBottom: 10,
                      }}
                    >
                      Submitted Proof
                    </div>
                    {!selected.proof ? (
                      <div style={{ fontSize: 13, color: "var(--muted)" }}>
                        No customer proof has been uploaded yet.
                      </div>
                    ) : (
                      <div style={{ display: "grid", gap: 10 }}>
                        {selected.proof.txId && (
                          <div className="flex items-center justify-between gap-2">
                            <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
                              TXID / Hash
                            </span>
                            <div className="flex items-center gap-2">
                              <code className="mono text-[13px] break-all">
                                {selected.proof.txId}
                              </code>
                              <button
                                type="button"
                                className="sw-btn sw-btn-ghost"
                                style={{ padding: "3px 8px", fontSize: 11 }}
                                onClick={() => {
                                  navigator.clipboard.writeText(selected.proof?.txId || "");
                                  toast.success("TXID copied");
                                }}
                              >
                                <Copy className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        )}
                        {selected.proof.senderName && (
                          <div className="flex items-center justify-between gap-2">
                            <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
                              Sender / Account
                            </span>
                            <b>{selected.proof.senderName}</b>
                          </div>
                        )}
                        {selected.proof.paidAt && (
                          <div className="flex items-center justify-between gap-2">
                            <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
                              Paid at
                            </span>
                            <b>{selected.proof.paidAt}</b>
                          </div>
                        )}
                        {selected.proof.note && (
                          <div>
                            <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
                              Customer note:
                            </span>{" "}
                            <span>{selected.proof.note}</span>
                          </div>
                        )}
                        {selected.proof.screenshotUrl && (
                          <div style={{ marginTop: 4 }}>
                            {selected.proof.screenshotName?.toLowerCase().endsWith(".pdf") ? (
                              <a
                                href={selected.proof.screenshotUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="sw-btn sw-btn-ghost"
                              >
                                <FileText className="w-4 h-4" />
                                Open PDF receipt ({selected.proof.screenshotName})
                                <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                            ) : (
                              <button
                                type="button"
                                onClick={() =>
                                  openPhotoZoom(
                                    selected.proof?.screenshotUrl || "",
                                    `Payment proof ${selected.reference}`
                                  )
                                }
                                style={{
                                  border: "1px solid var(--border)",
                                  borderRadius: 10,
                                  overflow: "hidden",
                                  maxWidth: 280,
                                  display: "block",
                                }}
                              >
                                <img
                                  src={selected.proof.screenshotUrl}
                                  alt={`Proof for ${selected.reference}`}
                                  style={{ width: "100%", height: "auto", display: "block" }}
                                />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* ACTIONS */}
                  <div className="ad-rev" style={{ marginTop: 14, flexWrap: "wrap" }}>
                    {selected.status !== "paid" && selected.status !== "refunded" && (
                      <button
                        type="button"
                        disabled={busyId !== ""}
                        className="sw-btn sw-btn-em"
                        onClick={() => runAction(selected.id, "approve")}
                      >
                        {busyId === selected.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Check className="w-4 h-4" />
                        )}
                        Approve payment
                      </button>
                    )}

                    {selected.status === "awaiting_payment" && (
                      <button
                        type="button"
                        disabled={busyId !== ""}
                        className="sw-btn sw-btn-ghost"
                        onClick={() =>
                          runAction(selected.id, "mark_received", {
                            reason: "Marked received manually by operations",
                          })
                        }
                      >
                        <Check className="w-4 h-4" />
                        Mark received
                      </button>
                    )}

                    {selected.status !== "paid" &&
                      selected.status !== "refunded" &&
                      selected.status !== "rejected" && (
                        <button
                          type="button"
                          disabled={busyId !== ""}
                          className="sw-btn sw-btn-red"
                          onClick={() => {
                            setReasonMode("reject");
                            setReasonText("");
                          }}
                        >
                          <XCircle className="w-4 h-4" />
                          Reject
                        </button>
                      )}

                    {selected.status !== "paid" && selected.status !== "refunded" && (
                      <button
                        type="button"
                        disabled={busyId !== ""}
                        className="sw-btn sw-btn-amber"
                        onClick={() => {
                          setReasonMode("request_info");
                          setReasonText("");
                        }}
                      >
                        <MessageSquare className="w-4 h-4" />
                        Request more info
                      </button>
                    )}

                    {selected.status === "paid" && (
                      <button
                        type="button"
                        disabled={busyId !== ""}
                        className="sw-btn sw-btn-ghost"
                        onClick={() => {
                          setRefundTarget(selected);
                          setRefundReason("Refund approved by administrator");
                          setRefundPassword("");
                          setRefundNeedsReauth(false);
                        }}
                      >
                        <RotateCcw className="w-4 h-4" />
                        Mark refunded
                      </button>
                    )}
                  </div>

                  {/* INLINE REJECT / REQUEST INFO FORM */}
                  {reasonMode && (
                    <form
                      style={{
                        marginTop: 14,
                        padding: 14,
                        border: "1px solid var(--border)",
                        borderRadius: 12,
                        display: "grid",
                        gap: 10,
                      }}
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!reasonText.trim()) {
                          toast.error("Please enter a clear message for the customer.");
                          return;
                        }
                        runAction(selected.id, reasonMode, {
                          reason: reasonText.trim(),
                        });
                      }}
                    >
                      <label className="lbl" htmlFor="pay-reason-input">
                        {reasonMode === "reject"
                          ? "Rejection reason (emailed to customer)"
                          : "What additional proof is needed? (emailed to customer)"}
                      </label>
                      <textarea
                        id="pay-reason-input"
                        className="field"
                        rows={3}
                        value={reasonText}
                        onChange={(e) => setReasonText(e.target.value)}
                        placeholder={
                          reasonMode === "reject"
                            ? "e.g. Amount received did not match total or reference missing"
                            : "e.g. Please upload a clearer bank receipt showing the full TXID"
                        }
                        required
                      />
                      <div className="flex gap-2">
                        <button
                          type="submit"
                          disabled={busyId !== ""}
                          className={`sw-btn ${reasonMode === "reject" ? "sw-btn-red" : "sw-btn-amber"}`}
                        >
                          {reasonMode === "reject" ? "Confirm reject" : "Send request"}
                        </button>
                        <button
                          type="button"
                          className="sw-btn sw-btn-ghost"
                          onClick={() => {
                            setReasonMode(null);
                            setReasonText("");
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  )}

                  {/* EXTEND PAYMENT WINDOW */}
                  {selected.status !== "paid" && selected.status !== "refunded" && (
                    <div
                      style={{
                        marginTop: 14,
                        paddingTop: 14,
                        borderTop: "1px solid var(--border)",
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        flexWrap: "wrap",
                      }}
                    >
                      <select
                        className="field"
                        style={{ width: "auto" }}
                        value={extendMinutes}
                        onChange={(e) => setExtendMinutes(e.target.value)}
                        aria-label="Extension duration"
                      >
                        <option value="180">+3 hours</option>
                        <option value="720">+12 hours</option>
                        <option value="1440">+24 hours</option>
                        <option value="2880">+48 hours</option>
                      </select>
                      <button
                        type="button"
                        disabled={busyId !== ""}
                        className="sw-btn sw-btn-ghost"
                        onClick={() =>
                          runAction(selected.id, "extend_window", {
                            extraMinutes: Number(extendMinutes) || 1440,
                          })
                        }
                      >
                        <Clock className="w-4 h-4" />
                        Extend payment window
                      </button>
                    </div>
                  )}

                  {/* AUDIT HISTORY */}
                  {Array.isArray(selected.audit) && selected.audit.length > 0 && (
                    <div style={{ marginTop: 16 }}>
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          letterSpacing: "0.1em",
                          textTransform: "uppercase",
                          color: "var(--muted)",
                          marginBottom: 8,
                        }}
                      >
                        Payment Audit Log
                      </div>
                      <div className="ad-feed" style={{ padding: 0 }}>
                        {[...selected.audit].reverse().map((entry, idx) => (
                          <div className="ad-fi" key={`${entry.at}_${idx}`}>
                            <i className={entry.action === "approve" ? "" : "a"} />
                            <div className="min-w-0 flex-1">
                              <b>{entry.action}</b> — {entry.actor}
                              {entry.note ? ` · ${entry.note}` : ""}
                              <small>{formatDateTime(entry.at)}</small>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* REFUND MODAL WITH PASSWORD RE-AUTH */}
      {refundTarget && (
        <div className="md" role="dialog" aria-modal="true">
          <div className="md-b" onClick={() => setRefundTarget(null)} />
          <div className="md-c">
            <button
              className="md-x"
              onClick={() => setRefundTarget(null)}
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="au-ic">
              <KeyRound className="w-6 h-6" />
            </div>
            <div className="au-t">MARK PAYMENT REFUNDED</div>
            <p className="au-r">
              Mark payment <b className="mono">{refundTarget.reference}</b> (
              {refundTarget.convertedAmount} {refundTarget.currency}) as refunded
              and notify {refundTarget.userEmail}.
            </p>
            <form
              className="au-f"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusyId(refundTarget.id);
                try {
                  if (refundNeedsReauth && auth.currentUser && user?.email) {
                    if (!refundPassword) {
                      throw new Error("Enter your administrator password.");
                    }
                    const cred = EmailAuthProvider.credential(
                      user.email,
                      refundPassword
                    );
                    await reauthenticateWithCredential(auth.currentUser, cred);
                  }
                  const token = await auth.currentUser?.getIdToken(true);
                  const data = await apiFetch<{
                    ok: boolean;
                    payment: ManualPaymentRecord;
                  }>(
                    `/api/admin/payments/${encodeURIComponent(refundTarget.id)}/action`,
                    {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                      },
                      body: JSON.stringify({
                        action: "refund",
                        reason: refundReason.trim(),
                      }),
                      step: "admin_payment_refund",
                    }
                  );
                  setPayments((prev) =>
                    prev.map((p) => (p.id === data.payment.id ? data.payment : p))
                  );
                  setSelected(data.payment);
                  setRefundTarget(null);
                  setRefundNeedsReauth(false);
                  toast.success("Payment marked as refunded");
                } catch (err) {
                  const code = (err as { code?: string })?.code || "";
                  if (code === "RECENT_AUTH_REQUIRED") {
                    setRefundNeedsReauth(true);
                    toast("Confirm your password to authorize refund.");
                  } else {
                    toast.error(
                      err instanceof Error ? err.message : "Refund update failed."
                    );
                  }
                } finally {
                  setBusyId("");
                }
              }}
            >
              <div className="fw">
                <label className="lbl" htmlFor="pm-ref-reason">
                  Reason
                </label>
                <input
                  id="pm-ref-reason"
                  className="field"
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  required
                />
              </div>
              {refundNeedsReauth && (
                <div className="fw">
                  <label className="lbl" htmlFor="pm-ref-pw">
                    Confirm administrator password
                  </label>
                  <input
                    id="pm-ref-pw"
                    type="password"
                    className="field"
                    value={refundPassword}
                    onChange={(e) => setRefundPassword(e.target.value)}
                    required
                  />
                </div>
              )}
              <button
                type="submit"
                disabled={busyId === refundTarget.id}
                className="sw-btn sw-btn-red sw-btn-lg sw-btn-block"
              >
                {busyId === refundTarget.id && (
                  <Loader2 className="w-4 h-4 animate-spin" />
                )}
                Confirm refund status
              </button>
            </form>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
