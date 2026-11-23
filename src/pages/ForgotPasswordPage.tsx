import React, { useState } from "react";
import { Link } from "react-router-dom";
import { sendPasswordResetEmail } from "firebase/auth";
import { Loader2, Lock, Mail } from "lucide-react";
import { auth } from "@/lib/firebase";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { normalizeEmail } from "@/types/tracking";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const clean = normalizeEmail(email);
    if (!clean || !clean.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }
    setBusy(true);
    try {
      await sendPasswordResetEmail(auth, clean);
      setSentTo(clean);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not send password reset email."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="sw-main flex-1">
        <div className="wrap" style={{ padding: "64px 18px 96px" }}>
          <div
            className="panel"
            style={{ maxWidth: 440, margin: "0 auto", padding: "30px 26px" }}
          >
            {sentTo ? (
              <div className="au-ok">
                <div className="au-ic">
                  <Mail className="w-6 h-6" />
                </div>
                <div className="au-t">CHECK YOUR INBOX</div>
                <p>
                  We sent a password reset link to <b>{sentTo}</b>. Follow the
                  link to choose a new password.
                </p>
                <Link
                  to="/login"
                  className="sw-btn sw-btn-em sw-btn-lg sw-btn-block"
                >
                  Back to Log in
                </Link>
              </div>
            ) : (
              <>
                <div className="au-ic">
                  <Lock className="w-6 h-6" />
                </div>
                <div className="au-t">RESET PASSWORD</div>
                <p className="au-r">
                  Enter the email address for your ShipWell account and we&apos;ll
                  send you a password reset link.
                </p>
                <form className="au-f" onSubmit={handleSubmit} noValidate>
                  <div className="fw">
                    <label className="lbl" htmlFor="fp-email">
                      Email
                    </label>
                    <input
                      id="fp-email"
                      className="field"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@company.com"
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
                    Send Reset Link
                  </button>
                </form>
                <p
                  style={{
                    textAlign: "center",
                    fontSize: 13,
                    color: "var(--muted)",
                    marginTop: 18,
                  }}
                >
                  Remembered your password?{" "}
                  <Link
                    to="/login"
                    style={{ color: "var(--em)", fontWeight: 600 }}
                  >
                    Log in
                  </Link>
                </p>
              </>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
