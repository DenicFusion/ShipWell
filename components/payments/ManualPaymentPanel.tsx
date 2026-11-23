import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  FileText,
  Loader2,
  RefreshCw,
  Upload,
  XCircle,
} from "lucide-react";
import { auth } from "@/lib/firebase";
import { apiFetch } from "@/lib/api-client";
import { formatUserFacingError, logClientError } from "@/lib/error-logger";
import { uploadPaymentProof } from "@/lib/storage";
import { formatMoney } from "@/lib/quote-engine";
import type { ManualPaymentRecord, ManualPaymentStatus } from "@/types/tracking";
import toast from "react-hot-toast";

function formatCountdown(expiresAt: number, nowMs: number): string {
  const diff = Math.max(0, expiresAt - nowMs);
  if (diff <= 0) return "Expired";
  const totalSec = Math.floor(diff / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h >= 24) {
    const d = Math.floor(h / 24);
    return `${d}d ${h % 24}h ${String(m).padStart(2, "0")}m`;
  }
  return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}

function getStatusBadge(status: ManualPaymentStatus): {
  tone: "g" | "a" | "r" | "b";
  label: string;
} {
  switch (status) {
    case "paid":
      return { tone: "g", label: "Paid" };
    case "pending_review":
      return { tone: "b", label: "Under review" };
    case "rejected":
      return { tone: "r", label: "Rejected" };
    case "info_requested":
      return { tone: "a", label: "Info requested" };
    case "expired":
      return { tone: "r", label: "Expired" };
    case "refunded":
      return { tone: "a", label: "Refunded" };
    default:
      return { tone: "a", label: "Awaiting payment" };
  }
}

export function ManualPaymentPanel({
  payment,
  onUpdated,
  trackingHref,
  compact = false,
}: {
  payment: ManualPaymentRecord;
  onUpdated?: (next: ManualPaymentRecord) => void;
  trackingHref?: string;
  compact?: boolean;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [showProofForm, setShowProofForm] = useState(
    payment.status === "rejected" || payment.status === "info_requested"
  );
  const [uploadingFile, setUploadingFile] = useState(false);
  const [screenshotUrl, setScreenshotUrl] = useState(
    payment.proof?.screenshotUrl || ""
  );
  const [screenshotHash, setScreenshotHash] = useState(
    payment.proof?.screenshotHash || ""
  );
  const [screenshotName, setScreenshotName] = useState(
    payment.proof?.screenshotName || ""
  );
  const [txId, setTxId] = useState(payment.proof?.txId || "");
  const [senderName, setSenderName] = useState(payment.proof?.senderName || "");
  const [paidAt, setPaidAt] = useState(
    payment.proof?.paidAt || new Date().toISOString().slice(0, 16)
  );
  const [note, setNote] = useState(payment.proof?.note || "");
  const [submitting, setSubmitting] = useState(false);
  const [errorBox, setErrorBox] = useState<{
    title: string;
    details: string;
  } | null>(null);

  useEffect(() => {
    if (
      payment.status !== "awaiting_payment" &&
      payment.status !== "rejected" &&
      payment.status !== "info_requested"
    ) {
      return;
    }
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [payment.status]);

  const badge = getStatusBadge(payment.status);
  const decimals = payment.currency === "JPY" ? 0 : 2;
  const amountFormatted = `${Number(payment.convertedAmount || 0).toFixed(decimals)} ${payment.currency}`;
  const isResubmittable =
    payment.status === "awaiting_payment" ||
    payment.status === "rejected" ||
    payment.status === "info_requested";
  const reqFields = payment.proofConfig?.fields || {
    screenshot: true,
    txId: true,
    senderName: false,
    paidAt: false,
  };

  const handleCopy = (val: string, label: string) => {
    if (!val) return;
    navigator.clipboard.writeText(val);
    toast.success(`${label} copied`);
  };

  const handleFileChange = async (file: File | null) => {
    if (!file) return;
    setErrorBox(null);
    const uid = auth.currentUser?.uid || payment.uid;
    if (!uid) {
      setErrorBox({
        title: "Please sign in again before uploading proof.",
        details: "Details: step=upload_proof, code=UNAUTHENTICATED",
      });
      return;
    }
    setUploadingFile(true);
    try {
      const uploaded = await uploadPaymentProof({
        uid,
        paymentId: payment.id,
        file,
      });
      setScreenshotUrl(uploaded.url);
      setScreenshotHash(uploaded.hash);
      setScreenshotName(uploaded.name);
      toast.success("Receipt uploaded");
    } catch (err) {
      const formatted = formatUserFacingError(err, "upload_proof");
      setErrorBox({ title: formatted.title, details: formatted.details });
      logClientError({
        uid,
        step: formatted.step,
        code: formatted.code,
        message: formatted.title,
      });
    } finally {
      setUploadingFile(false);
    }
  };

  const handleSubmitProof = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorBox(null);

    if (payment.proofConfig?.required !== false) {
      if (reqFields.screenshot && !screenshotUrl) {
        setErrorBox({
          title: "Please upload a screenshot or PDF of your payment receipt.",
          details: "Details: step=validate_proof, code=MISSING_RECEIPT",
        });
        return;
      }
      if (reqFields.txId && !txId.trim()) {
        setErrorBox({
          title: "Please enter the transaction ID or reference hash.",
          details: "Details: step=validate_proof, code=MISSING_TXID",
        });
        return;
      }
      if (reqFields.senderName && !senderName.trim()) {
        setErrorBox({
          title: "Please enter the sender / account name used for payment.",
          details: "Details: step=validate_proof, code=MISSING_SENDER_NAME",
        });
        return;
      }
    }

    setSubmitting(true);
    try {
      const idToken = await auth.currentUser?.getIdToken().catch(() => "");
      if (!idToken) {
        setErrorBox({
          title: "Session expired. Please log in again to submit proof.",
          details: "Details: step=submit_proof, code=UNAUTHENTICATED",
        });
        return;
      }

      const data = await apiFetch<{
        ok: boolean;
        payment: ManualPaymentRecord;
        autoApproved: boolean;
      }>(`/api/payments/${encodeURIComponent(payment.id)}/submit-proof`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          screenshotUrl,
          screenshotHash,
          screenshotName,
          txId: txId.trim(),
          senderName: senderName.trim(),
          paidAt: paidAt.trim(),
          note: note.trim(),
        }),
        step: "submit_payment_proof",
      });

      toast.success(
        data.autoApproved
          ? "Payment verified!"
          : "Proof submitted — under review"
      );
      setShowProofForm(false);
      onUpdated?.(data.payment);
    } catch (err) {
      const formatted = formatUserFacingError(err, "submit_payment_proof");
      setErrorBox({ title: formatted.title, details: formatted.details });
      logClientError({
        uid: auth.currentUser?.uid,
        step: formatted.step,
        code: formatted.code,
        message: formatted.title,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="panel" style={{ marginTop: compact ? 12 : 0 }}>
      <div className="panel-h">
        <div className="pi">
          {payment.status === "paid" ? (
            <CheckCircle2 className="w-[17px] h-[17px] text-emerald-400" />
          ) : payment.status === "rejected" || payment.status === "expired" ? (
            <XCircle className="w-[17px] h-[17px] text-rose-400" />
          ) : (
            <Clock className="w-[17px] h-[17px]" />
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <b>{payment.methodName}</b>
            <span className={`chip ${badge.tone}`}>{badge.label}</span>
          </div>
          <small>
            Ref <b>{payment.reference}</b> · Tracking {payment.trackingCode}
          </small>
        </div>
      </div>

      <div className="panel-b">
        {/* Rejection / Info request notice */}
        {(payment.status === "rejected" || payment.status === "info_requested") &&
          payment.reviewNote && (
            <div
              className={`tk-hold ${payment.status === "rejected" ? "r" : "a"}`}
              style={{
                marginBottom: 14,
                borderRadius: 12,
                border:
                  payment.status === "rejected"
                    ? "1px solid rgba(244, 63, 94, 0.35)"
                    : "1px solid rgba(245, 158, 11, 0.35)",
              }}
            >
              <AlertCircle className="w-4 h-4 shrink-0" />
              <div>
                <b>
                  {payment.status === "rejected"
                    ? "Payment proof declined"
                    : "Additional information requested"}
                </b>
                <small>{payment.reviewNote}</small>
              </div>
            </div>
          )}

        {/* Amount + Reference + Window */}
        <div className="rv" style={{ marginBottom: 14 }}>
          <div className="r">
            <span>Amount to send</span>
            <b
              style={{
                color: "var(--em)",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                flexWrap: "wrap",
                justifyContent: "flex-end",
              }}
            >
              <span>{amountFormatted}</span>
              {payment.currency !== "USD" && (
                <small style={{ color: "var(--muted)", fontWeight: 500 }}>
                  (≈ {formatMoney(payment.totalUsd)} USD)
                </small>
              )}
              <button
                type="button"
                className="sw-btn sw-btn-ghost"
                style={{ padding: "3px 8px", fontSize: 11 }}
                onClick={() =>
                  handleCopy(
                    Number(payment.convertedAmount || 0).toFixed(decimals),
                    "Amount"
                  )
                }
              >
                <Copy className="w-3 h-3" />
                Copy
              </button>
            </b>
          </div>

          <div className="r">
            <span>Payment reference</span>
            <b
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <code style={{ fontFamily: "monospace" }}>{payment.reference}</code>
              <button
                type="button"
                className="sw-btn sw-btn-ghost"
                style={{ padding: "3px 8px", fontSize: 11 }}
                onClick={() => handleCopy(payment.reference, "Reference")}
              >
                <Copy className="w-3 h-3" />
                Copy
              </button>
            </b>
          </div>

          {payment.feeAmount !== 0 && (
            <div className="r">
              <span>{payment.feeAmount > 0 ? "Method fee" : "Method discount"}</span>
              <b>
                {payment.feeAmount > 0 ? "+" : "-"}
                {formatMoney(Math.abs(payment.feeAmount))}
              </b>
            </div>
          )}

          {isResubmittable && (
            <div className="r">
              <span>Payment window</span>
              <b style={{ color: payment.expiresAt - nowMs < 3600_000 ? "#f59e0b" : undefined }}>
                {formatCountdown(payment.expiresAt, nowMs)}
              </b>
            </div>
          )}
        </div>

        {/* Payment destination details & QR when awaiting payment */}
        {isResubmittable && (
          <>
            {payment.detailsSnapshot && payment.detailsSnapshot.length > 0 && (
              <div
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  padding: "12px 14px",
                  marginBottom: 14,
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
                    marginBottom: 8,
                  }}
                >
                  Payment details
                </div>
                <div style={{ display: "grid", gap: 8 }}>
                  {payment.detailsSnapshot.map((row, idx) => (
                    <div
                      key={`${row.label}-${idx}`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 10,
                        flexWrap: "wrap",
                        borderBottom:
                          idx < payment.detailsSnapshot.length - 1
                            ? "1px solid var(--border)"
                            : "none",
                        paddingBottom:
                          idx < payment.detailsSnapshot.length - 1 ? 8 : 0,
                      }}
                    >
                      <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
                        {row.label}
                      </span>
                      <div
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 8,
                          minWidth: 0,
                          maxWidth: "100%",
                        }}
                      >
                        <b
                          style={{
                            fontSize: 13,
                            wordBreak: "break-all",
                            textAlign: "right",
                          }}
                        >
                          {row.value}
                        </b>
                        {row.copyable !== false && (
                          <button
                            type="button"
                            className="sw-btn sw-btn-ghost"
                            style={{ padding: "3px 8px", fontSize: 11 }}
                            onClick={() => handleCopy(row.value, row.label)}
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {payment.qrUrlSnapshot && (
              <div
                style={{
                  marginBottom: 14,
                  textAlign: "center",
                  padding: 12,
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                }}
              >
                <img
                  src={payment.qrUrlSnapshot}
                  alt={`${payment.methodName} QR code`}
                  style={{
                    width: 170,
                    height: 170,
                    objectFit: "contain",
                    margin: "0 auto",
                    borderRadius: 8,
                    background: "#fff",
                    padding: 6,
                  }}
                />
                <small
                  style={{
                    display: "block",
                    marginTop: 6,
                    fontSize: 11.5,
                    color: "var(--muted)",
                  }}
                >
                  Scan QR code to pay
                </small>
              </div>
            )}

            {payment.instructionsSnapshot && (
              <div
                style={{
                  fontSize: 13,
                  lineHeight: 1.55,
                  color: "var(--muted)",
                  whiteSpace: "pre-line",
                  marginBottom: 16,
                  padding: "10px 12px",
                  borderLeft: "2px solid var(--em)",
                  background: "rgba(16,185,129,0.05)",
                  borderRadius: "0 8px 8px 0",
                }}
              >
                {payment.instructionsSnapshot}
              </div>
            )}

            {!showProofForm ? (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="sw-btn sw-btn-em"
                  onClick={() => setShowProofForm(true)}
                >
                  <Check className="w-4 h-4" />
                  I have paid — upload proof
                </button>
                {trackingHref && (
                  <Link className="sw-btn sw-btn-ghost" to={trackingHref}>
                    View tracking →
                  </Link>
                )}
              </div>
            ) : (
              <form
                onSubmit={handleSubmitProof}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  padding: 14,
                  display: "grid",
                  gap: 12,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                  }}
                >
                  <b style={{ fontSize: 14 }}>Submit payment proof</b>
                  {payment.status === "awaiting_payment" && (
                    <button
                      type="button"
                      className="sw-btn sw-btn-ghost"
                      style={{ padding: "4px 10px", fontSize: 12 }}
                      onClick={() => setShowProofForm(false)}
                    >
                      Hide
                    </button>
                  )}
                </div>

                {reqFields.screenshot && (
                  <div className="fw" style={{ marginBottom: 0 }}>
                    <label className="lbl" htmlFor={`proof-file-${payment.id}`}>
                      Payment receipt or screenshot (JPG, PNG, WebP, or PDF · max 10 MB)
                    </label>
                    <label
                      htmlFor={`proof-file-${payment.id}`}
                      className="pf"
                      style={{
                        padding: "14px 12px",
                        minHeight: 72,
                        cursor: uploadingFile ? "wait" : "pointer",
                      }}
                    >
                      {uploadingFile ? (
                        <Loader2 className="w-5 h-5 animate-spin text-[var(--em)]" />
                      ) : screenshotUrl ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                      ) : (
                        <Upload className="w-5 h-5 text-[var(--em)]" />
                      )}
                      <b>
                        {uploadingFile
                          ? "Uploading receipt..."
                          : screenshotName
                            ? `Uploaded: ${screenshotName}`
                            : "Tap to upload screenshot or PDF"}
                      </b>
                      <input
                        id={`proof-file-${payment.id}`}
                        type="file"
                        accept="image/*,application/pdf"
                        hidden
                        disabled={uploadingFile}
                        onChange={(e) =>
                          handleFileChange(e.target.files?.[0] || null)
                        }
                      />
                    </label>
                  </div>
                )}

                {reqFields.txId && (
                  <div className="fw" style={{ marginBottom: 0 }}>
                    <label className="lbl" htmlFor={`proof-tx-${payment.id}`}>
                      Transaction ID / Reference hash
                    </label>
                    <input
                      id={`proof-tx-${payment.id}`}
                      className="field"
                      value={txId}
                      onChange={(e) => setTxId(e.target.value)}
                      placeholder="e.g. TXN98234100 or 0x..."
                    />
                  </div>
                )}

                {reqFields.senderName && (
                  <div className="fw" style={{ marginBottom: 0 }}>
                    <label className="lbl" htmlFor={`proof-sender-${payment.id}`}>
                      Sender / Account name
                    </label>
                    <input
                      id={`proof-sender-${payment.id}`}
                      className="field"
                      value={senderName}
                      onChange={(e) => setSenderName(e.target.value)}
                      placeholder="Name on sending account"
                    />
                  </div>
                )}

                {reqFields.paidAt && (
                  <div className="fw" style={{ marginBottom: 0 }}>
                    <label className="lbl" htmlFor={`proof-date-${payment.id}`}>
                      Date &amp; time paid
                    </label>
                    <input
                      id={`proof-date-${payment.id}`}
                      type="datetime-local"
                      className="field"
                      value={paidAt}
                      onChange={(e) => setPaidAt(e.target.value)}
                    />
                  </div>
                )}

                <div className="fw" style={{ marginBottom: 0 }}>
                  <label className="lbl" htmlFor={`proof-note-${payment.id}`}>
                    Note (optional)
                  </label>
                  <input
                    id={`proof-note-${payment.id}`}
                    className="field"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Any helpful transfer note"
                  />
                </div>

                {errorBox && (
                  <div className="au-err" style={{ display: "grid", gap: 4 }}>
                    <span>{errorBox.title}</span>
                    <small style={{ fontSize: 11.5, opacity: 0.85 }}>
                      {errorBox.details}
                    </small>
                  </div>
                )}

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button
                    type="submit"
                    disabled={submitting || uploadingFile}
                    className="sw-btn sw-btn-em"
                  >
                    {submitting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <FileText className="w-4 h-4" />
                    )}
                    {submitting ? "Submitting proof..." : "Submit payment proof"}
                  </button>
                </div>
              </form>
            )}
          </>
        )}

        {payment.status === "pending_review" && (
          <div style={{ display: "grid", gap: 10 }}>
            <p style={{ fontSize: 13.5, color: "var(--muted)", margin: 0, lineHeight: 1.55 }}>
              Thank you — we received your payment proof
              {payment.proof?.txId ? ` (TXID: ${payment.proof.txId})` : ""}. Our team is verifying the transfer and will release dispatch as soon as confirmed.
            </p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {payment.proof?.screenshotUrl && (
                <a
                  href={payment.proof.screenshotUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="sw-btn sw-btn-ghost"
                >
                  View uploaded proof
                </a>
              )}
              {trackingHref && (
                <Link className="sw-btn sw-btn-em" to={trackingHref}>
                  Track shipment →
                </Link>
              )}
            </div>
          </div>
        )}

        {payment.status === "paid" && (
          <div style={{ display: "grid", gap: 10 }}>
            <p style={{ fontSize: 13.5, color: "var(--muted)", margin: 0 }}>
              Payment verified and confirmed.
              {payment.paidAtMs
                ? ` Confirmed ${new Date(payment.paidAtMs).toLocaleString()}.`
                : ""}
            </p>
            {trackingHref && (
              <div>
                <Link className="sw-btn sw-btn-em" to={trackingHref}>
                  Open tracking →
                </Link>
              </div>
            )}
          </div>
        )}

        {payment.status === "expired" && (
          <div style={{ display: "grid", gap: 10 }}>
            <p style={{ fontSize: 13.5, color: "var(--muted)", margin: 0 }}>
              This payment window elapsed before confirmation, so the booking was cancelled without dispatch.
            </p>
            <div>
              <Link className="sw-btn sw-btn-em" to="/ship">
                <RefreshCw className="w-4 h-4" />
                Start a new shipment
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
