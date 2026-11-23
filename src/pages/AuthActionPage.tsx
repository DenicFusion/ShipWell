import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  applyActionCode,
  confirmPasswordReset,
  verifyPasswordResetCode,
} from "firebase/auth";
import { CheckCircle2, AlertTriangle, Loader2, Lock, MailCheck } from "lucide-react";
import { auth } from "@/lib/firebase";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { apiFetch } from "@/lib/api-client";
import toast from "react-hot-toast";

export default function AuthActionPage() {
  const [params] = useSearchParams();
  const mode = params.get("mode") || "";
  const oobCode = params.get("oobCode") || "";
  const continueUrl = params.get("continueUrl") || "";

  const [status, setStatus] = useState<
    "loading" | "verified" | "reset_ready" | "reset_done" | "error"
  >("loading");
  const [verifiedEmail, setVerifiedEmail] = useState("");
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = window.setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [resendCooldown]);

  useEffect(() => {
    let active = true;
    const run = async () => {
      if (!oobCode) {
        if (active) {
          setError("This link is incomplete or missing a verification code.");
          setStatus("error");
        }
        return;
      }
      if (mode === "verifyEmail") {
        try {
          await applyActionCode(auth, oobCode);
          if (auth.currentUser) {
            await auth.currentUser.reload().catch(() => null);
            await auth.currentUser.getIdToken(true).catch(() => null);
          }
          if (active) setStatus("verified");
        } catch (err) {
          if (active) {
            setError(
              err instanceof Error
                ? err.message
                : "This verification link has expired or has already been used."
            );
            setStatus("error");
          }
        }
        return;
      }

      if (mode === "resetPassword") {
        try {
          const email = await verifyPasswordResetCode(auth, oobCode);
          if (active) {
            setVerifiedEmail(email);
            setStatus("reset_ready");
          }
        } catch (err) {
          if (active) {
            setError(
              err instanceof Error
                ? err.message
                : "This password reset link has expired or has already been used."
            );
            setStatus("error");
          }
        }
        return;
      }

      if (active) {
        setError("Unsupported action link.");
        setStatus("error");
      }
    };

    run();
    return () => {
      active = false;
    };
  }, [mode, oobCode]);

  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPw) {
      setError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    try {
      await confirmPasswordReset(auth, oobCode, password);
      setStatus("reset_done");
      toast.success("Password updated");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not reset password. Please request a new link."
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleResendVerification = async () => {
    const current = auth.currentUser;
    if (!current || resendCooldown > 0) return;
    setSubmitting(true);
    try {
      const idToken = await current.getIdToken();
      await apiFetch("/api/auth/send-verification", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({}),
        step: "resend_verification",
      });
      setResendCooldown(60);
      toast.success("Verification email sent");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not resend verification email.");
    } finally {
      setSubmitting(false);
    }
  };

  const nextPath = (() => {
    if (!continueUrl) return "/dashboard";
    try {
      const parsed = new URL(continueUrl);
      if (parsed.origin === window.location.origin) {
        return parsed.pathname + parsed.search;
      }
    } catch {
      if (continueUrl.startsWith("/")) return continueUrl;
    }
    return "/dashboard";
  })();

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="sw-main flex-1">
        <div className="wrap" style={{ padding: "64px 18px 96px" }}>
          <div
            className="panel"
            style={{ maxWidth: 460, margin: "0 auto", padding: "32px 26px" }}
          >
            {status === "loading" && (
              <div className="au-ok">
                <div className="au-ic">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
                <div className="au-t">CHECKING LINK</div>
                <p>Validating your ShipWell security link…</p>
              </div>
            )}

            {status === "verified" && (
              <div className="au-ok">
                <div className="au-ic">
                  <MailCheck className="w-6 h-6 text-emerald-400" />
                </div>
                <div className="au-t">EMAIL VERIFIED</div>
                <p>
                  Your ShipWell email address is confirmed. Shipments sent to your email will appear automatically on your dashboard.
                </p>
                <Link
                  to={auth.currentUser ? nextPath : "/login"}
                  className="sw-btn sw-btn-em sw-btn-lg sw-btn-block"
                >
                  {auth.currentUser ? "Open Dashboard" : "Log In to Continue"}
                </Link>
              </div>
            )}

            {status === "reset_ready" && (
              <div>
                <div className="au-ic">
                  <Lock className="w-6 h-6" />
                </div>
                <div className="au-t">CHOOSE NEW PASSWORD</div>
                <p className="au-r">
                  {verifiedEmail
                    ? `Enter a new password for ${verifiedEmail}.`
                    : "Enter a strong new password for your account."}
                </p>
                <form className="au-f" onSubmit={handleResetSubmit} noValidate>
                  <div className="fw">
                    <label className="lbl" htmlFor="reset-pw">
                      New password
                    </label>
                    <input
                      id="reset-pw"
                      className="field"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="At least 8 characters"
                      required
                    />
                  </div>
                  <div className="fw">
                    <label className="lbl" htmlFor="reset-pw2">
                      Confirm password
                    </label>
                    <input
                      id="reset-pw2"
                      className="field"
                      type="password"
                      value={confirmPw}
                      onChange={(e) => setConfirmPw(e.target.value)}
                      placeholder="Repeat password"
                      required
                    />
                  </div>
                  {error && <div className="au-err">{error}</div>}
                  <button
                    type="submit"
                    disabled={submitting}
                    className="sw-btn sw-btn-em sw-btn-lg sw-btn-block"
                  >
                    {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                    Save New Password
                  </button>
                </form>
              </div>
            )}

            {status === "reset_done" && (
              <div className="au-ok">
                <div className="au-ic">
                  <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                </div>
                <div className="au-t">PASSWORD UPDATED</div>
                <p>
                  Your ShipWell password has been reset. You can sign in now with your new password.
                </p>
                <Link
                  to="/login"
                  className="sw-btn sw-btn-em sw-btn-lg sw-btn-block"
                >
                  Log In
                </Link>
              </div>
            )}

            {status === "error" && (
              <div className="au-ok">
                <div className="au-ic">
                  <AlertTriangle className="w-6 h-6 text-amber-400" />
                </div>
                <div className="au-t">LINK EXPIRED OR INVALID</div>
                <p>{error || "This link can no longer be used."}</p>
                <div style={{ display: "grid", gap: 10 }}>
                  {mode === "verifyEmail" && auth.currentUser && !auth.currentUser.emailVerified ? (
                    <button
                      type="button"
                      disabled={submitting || resendCooldown > 0}
                      onClick={handleResendVerification}
                      className="sw-btn sw-btn-em sw-btn-lg sw-btn-block"
                    >
                      {resendCooldown > 0
                        ? `Resend available in ${resendCooldown}s`
                        : "Send New Verification Email"}
                    </button>
                  ) : (
                    <Link
                      to={mode === "resetPassword" ? "/forgot-password" : "/login"}
                      className="sw-btn sw-btn-em sw-btn-lg sw-btn-block"
                    >
                      {mode === "resetPassword" ? "Request New Reset Link" : "Back to Log In"}
                    </Link>
                  )}
                  <Link to="/" className="sw-btn sw-btn-ghost sw-btn-block">
                    Return Home
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
