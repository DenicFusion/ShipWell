"use client";

import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Copy, Loader2, Mail, MessageSquare, X } from "lucide-react";
import toast from "react-hot-toast";
import { auth } from "@/lib/firebase";
import { useShipWell } from "@/components/providers/ShipWellProvider";
import { formatTrackingCode } from "@/types/tracking";

const SUPPORT_EMAIL = "support@info.shipwell.cc";

export function ContactModal({
  initialCode = "",
  onClose,
}: {
  initialCode?: string;
  onClose: () => void;
}) {
  const { user, profile } = useShipWell();

  const [name, setName] = useState(
    profile?.name || user?.displayName || ""
  );
  const [email, setEmail] = useState(profile?.email || user?.email || "");
  const [code, setCode] = useState(
    initialCode ? formatTrackingCode(initialCode) : ""
  );
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [hp, setHp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ticketCode, setTicketCode] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const copySupportEmail = async () => {
    try {
      await navigator.clipboard.writeText(SUPPORT_EMAIL);
      toast.success(`Copied ${SUPPORT_EMAIL}`);
    } catch {
      toast.error("Could not copy email address");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!name.trim() || !email.trim().includes("@") || !subject.trim() || !message.trim()) {
      setError("Please fill in your name, email, subject, and message.");
      return;
    }

    setBusy(true);
    try {
      const idToken = await auth.currentUser?.getIdToken().catch(() => null);
      const res = await fetch("/api/support/contact", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          code: code.trim() || undefined,
          subject: subject.trim(),
          message: message.trim(),
          _hp: hp,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Unable to send your message.");
      }
      setTicketCode(data.ticketCode || "TKT-RECEIVED");
      toast.success("Support message sent!");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not send message right now."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="md" role="dialog" aria-modal="true" aria-label="Contact ShipWell Support">
      <div className="md-b" onClick={onClose} />
      <div className="md-c">
        <button type="button" className="md-x" onClick={onClose} aria-label="Close">
          <X className="w-4 h-4" />
        </button>

        {ticketCode ? (
          <div className="au-ok">
            <div className="au-ic">
              <Check className="w-6 h-6" />
            </div>
            <div className="au-t">MESSAGE RECEIVED</div>
            <p>
              Reference <b className="mono">{ticketCode}</b> has been opened for{" "}
              <b>{email}</b>. Our operations desk will reply by email
              {user ? " and inside your Dashboard Support inbox." : "."}
            </p>
            <div className="flex flex-col gap-2">
              {user && (
                <Link
                  to="/dashboard/support"
                  className="sw-btn sw-btn-em sw-btn-block"
                  onClick={onClose}
                >
                  Open Support Inbox
                </Link>
              )}
              <button
                type="button"
                className="sw-btn sw-btn-ghost sw-btn-block"
                onClick={onClose}
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div className="au-ic">
              <MessageSquare className="w-6 h-6" />
            </div>
            <div className="au-t">CONTACT SUPPORT</div>
            <p className="au-r">
              Reach our operations team 24/7 or email{" "}
              <strong style={{ color: "var(--text)" }}>{SUPPORT_EMAIL}</strong> directly.
            </p>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                padding: "10px 12px",
                borderRadius: 12,
                background: "var(--card2)",
                border: "1px solid var(--border)",
                marginBottom: 14,
                fontSize: 12.5,
              }}
            >
              <span className="flex items-center gap-2 min-w-0 truncate">
                <Mail className="w-4 h-4 text-[var(--em)] shrink-0" />
                <span className="mono truncate">{SUPPORT_EMAIL}</span>
              </span>
              <button
                type="button"
                onClick={copySupportEmail}
                className="sp-cp"
                style={{ marginTop: 0, flexShrink: 0 }}
              >
                <Copy className="w-3.5 h-3.5" />
                Copy
              </button>
            </div>

            <form className="au-f" onSubmit={handleSubmit} noValidate>
              {/* Spam honeypot */}
              <div
                aria-hidden="true"
                style={{
                  position: "absolute",
                  left: "-9999px",
                  width: 1,
                  height: 1,
                  overflow: "hidden",
                }}
              >
                <label htmlFor="sp-hp">Leave blank</label>
                <input
                  id="sp-hp"
                  tabIndex={-1}
                  autoComplete="off"
                  value={hp}
                  onChange={(e) => setHp(e.target.value)}
                />
              </div>

              <div className="g2 keep">
                <div className="fw">
                  <label className="lbl" htmlFor="ct-name">
                    Name
                  </label>
                  <input
                    id="ct-name"
                    className="field"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your full name"
                    required
                  />
                </div>
                <div className="fw">
                  <label className="lbl" htmlFor="ct-email">
                    Email
                  </label>
                  <input
                    id="ct-email"
                    className="field"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@domain.com"
                    required
                  />
                </div>
              </div>

              <div className="g2 keep">
                <div className="fw">
                  <label className="lbl" htmlFor="ct-sub">
                    Topic / Subject
                  </label>
                  <input
                    id="ct-sub"
                    className="field"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Customs, delivery, billing..."
                    required
                  />
                </div>
                <div className="fw">
                  <label className="lbl" htmlFor="ct-code">
                    Tracking # (optional)
                  </label>
                  <input
                    id="ct-code"
                    className="field mono"
                    autoCapitalize="characters"
                    value={code}
                    onChange={(e) => setCode(formatTrackingCode(e.target.value))}
                    placeholder="SW-20260531-..."
                  />
                </div>
              </div>

              <div className="fw">
                <label className="lbl" htmlFor="ct-msg">
                  Message
                </label>
                <textarea
                  id="ct-msg"
                  className="field"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="How can we help with your shipment?"
                  required
                />
              </div>

              {error && <div className="au-err">{error}</div>}

              <button
                type="submit"
                disabled={busy}
                className="sw-btn sw-btn-em sw-btn-lg sw-btn-block"
              >
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                Send message
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
