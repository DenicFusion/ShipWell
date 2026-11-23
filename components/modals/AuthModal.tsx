"use client";

import React, { useEffect, useState } from "react";
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from "firebase/auth";
import { Mail, Lock, X, Loader2 } from "lucide-react";
import { auth } from "@/lib/firebase";
import { syncUserProfileDoc } from "@/lib/firestore-shipments";
import { apiFetch } from "@/lib/api-client";
import { migrateGuestDraftToFirestore } from "@/lib/drafts";
import { normalizeEmail } from "@/types/tracking";
import toast from "react-hot-toast";

export interface AuthModalOptions {
  mode?: "login" | "signup" | "forgot";
  prompt?: string;
  prefillEmail?: string;
  prefillName?: string;
  prefillPhone?: string;
  lockEmail?: boolean;
  trackingCode?: string;
  onDone?: (user: User, isNew: boolean) => void;
}

export function AuthModal({
  options,
  onClose,
  onAuthenticated,
}: {
  options: AuthModalOptions;
  onClose: () => void;
  onAuthenticated: (user: User, isNew: boolean) => void;
}) {
  const [tab, setTab] = useState<"login" | "signup" | "forgot">(
    options.mode || "login"
  );
  const [name, setName] = useState(options.prefillName || "");
  const [email, setEmail] = useState(options.prefillEmail || "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [resetSentTo, setResetSentTo] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const mapAuthError = (err: unknown): string => {
    const code = (err as { code?: string })?.code || "";
    if (code === "auth/operation-not-allowed") {
      return "Email/password sign-in isn't enabled in Firebase Authentication yet. Use Google Sign-In below or enable Email/Password in Firebase Console.";
    }
    if (code === "auth/email-already-in-use") {
      return "An account with this email already exists. Try signing in instead.";
    }
    if (
      code === "auth/invalid-credential" ||
      code === "auth/wrong-password" ||
      code === "auth/user-not-found"
    ) {
      return "That email and password don't match.";
    }
    if (code === "auth/weak-password") {
      return "Please choose a password of at least 8 characters.";
    }
    if (code === "auth/popup-closed-by-user") {
      return "Google sign-in popup was closed.";
    }
    return err instanceof Error ? err.message : "Authentication failed.";
  };

  const handleGoogle = async () => {
    setError("");
    setBusy(true);
    try {
      const provider = new GoogleAuthProvider();
      if (options.prefillEmail) {
        provider.setCustomParameters({ login_hint: options.prefillEmail });
      }
      const cred = await signInWithPopup(auth, provider);
      const signedEmail = normalizeEmail(cred.user.email || "");
      if (
        options.lockEmail &&
        options.prefillEmail &&
        signedEmail !== normalizeEmail(options.prefillEmail)
      ) {
        await signOut(auth);
        setError(
          `This parcel was sent to ${options.prefillEmail}. Please sign in with that Google account so it links to your dashboard.`
        );
        setBusy(false);
        return;
      }
      await syncUserProfileDoc({
        uid: cred.user.uid,
        name: cred.user.displayName || options.prefillName || "ShipWell Customer",
        email: signedEmail,
        phone: options.prefillPhone || "",
      });
      await migrateGuestDraftToFirestore(cred.user.uid, signedEmail);
      toast.success(`Signed in as ${cred.user.displayName || signedEmail}`);
      onAuthenticated(cred.user, false);
    } catch (err) {
      setError(mapAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const cleanEmail = normalizeEmail(email);

    if (!cleanEmail || !cleanEmail.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }

    if (tab === "forgot") {
      setBusy(true);
      try {
        await apiFetch("/api/auth/send-password-reset", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: cleanEmail }),
          step: "send_password_reset",
        });
        setResetSentTo(cleanEmail);
      } catch (err) {
        setError(mapAuthError(err));
      } finally {
        setBusy(false);
      }
      return;
    }

    if (tab === "signup") {
      if (!name.trim()) {
        setError("Enter your full name.");
        return;
      }
      if (password.length < 8) {
        setError("Password must be at least 8 characters.");
        return;
      }
      setBusy(true);
      try {
        const cred = await createUserWithEmailAndPassword(
          auth,
          cleanEmail,
          password
        );
        await updateProfile(cred.user, { displayName: name.trim() });
        await syncUserProfileDoc({
          uid: cred.user.uid,
          name: name.trim(),
          email: cleanEmail,
          phone: options.prefillPhone || "",
        });
        await migrateGuestDraftToFirestore(cred.user.uid, cleanEmail);
        // Branded verification email via Resend (non-blocking)
        cred.user
          .getIdToken()
          .then((idToken) =>
            apiFetch("/api/auth/send-verification", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${idToken}`,
              },
              body: JSON.stringify({ name: name.trim() }),
              step: "send_verification",
            })
          )
          .catch(() => null);
        toast.success(`Welcome to ShipWell, ${name.trim().split(/\s+/)[0]}!`);
        onAuthenticated(cred.user, true);
      } catch (err) {
        setError(mapAuthError(err));
      } finally {
        setBusy(false);
      }
      return;
    }

    // Login
    if (password.length < 6) {
      setError("Enter your password.");
      return;
    }
    setBusy(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, cleanEmail, password);
      await syncUserProfileDoc({
        uid: cred.user.uid,
        name: cred.user.displayName || "ShipWell Customer",
        email: cleanEmail,
      });
      await migrateGuestDraftToFirestore(cred.user.uid, cleanEmail);
      toast.success("Signed in");
      onAuthenticated(cred.user, false);
    } catch (err) {
      setError(mapAuthError(err));
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

        {tab === "forgot" ? (
          resetSentTo ? (
            <div className="au-ok">
              <div className="au-ic">
                <Mail className="w-6 h-6" />
              </div>
              <div className="au-t">CHECK YOUR INBOX</div>
              <p>
                We sent a password reset link to <b>{resetSentTo}</b>. Follow
                the link to choose a new password.
              </p>
              <button
                type="button"
                className="sw-btn sw-btn-em sw-btn-block"
                onClick={() => {
                  setResetSentTo("");
                  setTab("login");
                }}
              >
                Back to Sign In
              </button>
            </div>
          ) : (
            <div>
              <div className="au-ic">
                <Lock className="w-6 h-6" />
              </div>
              <div className="au-t">RESET PASSWORD</div>
              <p className="au-r">
                Enter your email and we will send a password reset link.
              </p>
              <form className="au-f" onSubmit={handleSubmit} noValidate>
                <div className="fw">
                  <label className="lbl" htmlFor="auth-forgot-email">
                    Email
                  </label>
                  <input
                    id="auth-forgot-email"
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
                  className="sw-btn sw-btn-em sw-btn-lg sw-btn-block"
                  disabled={busy}
                >
                  {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                  Send Reset Link
                </button>
                <button
                  type="button"
                  className="au-link"
                  onClick={() => {
                    setError("");
                    setTab("login");
                  }}
                >
                  Back to log in
                </button>
              </form>
            </div>
          )
        ) : (
          <div>
            <div className="au-ic">
              <Lock className="w-6 h-6" />
            </div>
            <div className="au-t">
              {tab === "signup" ? "CREATE ACCOUNT" : "WELCOME BACK"}
            </div>
            <p className="au-r">
              {options.prompt ||
                (tab === "signup"
                  ? "Use the email your parcels are sent to and they appear automatically."
                  : "Sign in to manage shipments and track live progress.")}
            </p>

            {!options.lockEmail && (
              <div className="au-tabs">
                <button
                  type="button"
                  className={tab === "login" ? "on" : ""}
                  onClick={() => {
                    setError("");
                    setTab("login");
                  }}
                >
                  Log in
                </button>
                <button
                  type="button"
                  className={tab === "signup" ? "on" : ""}
                  onClick={() => {
                    setError("");
                    setTab("signup");
                  }}
                >
                  Sign up
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={handleGoogle}
              disabled={busy}
              className="sw-btn sw-btn-ghost sw-btn-block"
              style={{ marginBottom: 14, color: "var(--text)" }}
            >
              {busy ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <span className="font-bold text-emerald-400">G</span>
              )}
              Continue with Google
            </button>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 14,
                fontSize: 11,
                color: "var(--faint)",
                textTransform: "uppercase",
                letterSpacing: "0.14em",
              }}
            >
              <span
                style={{ flex: 1, height: 1, background: "var(--border)" }}
              />
              or with email
              <span
                style={{ flex: 1, height: 1, background: "var(--border)" }}
              />
            </div>

            <form className="au-f" onSubmit={handleSubmit} noValidate>
              {tab === "signup" && (
                <div className="fw">
                  <label className="lbl" htmlFor="auth-name">
                    Full name
                  </label>
                  <input
                    id="auth-name"
                    className="field"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="John Doe"
                    required
                  />
                </div>
              )}

              <div className="fw">
                <label className="lbl" htmlFor="auth-email">
                  Email
                </label>
                <input
                  id="auth-email"
                  className="field"
                  type="email"
                  value={email}
                  readOnly={Boolean(options.lockEmail)}
                  onChange={(e) => {
                    if (!options.lockEmail) setEmail(e.target.value);
                  }}
                  placeholder="you@company.com"
                  required
                />
                {options.lockEmail && (
                  <small style={{ color: "var(--muted)", fontSize: 12 }}>
                    Locked to your parcel recipient email so{" "}
                    {options.trackingCode || "this shipment"} links
                    automatically.{" "}
                    <button
                      type="button"
                      className="au-link"
                      style={{ display: "inline", marginLeft: 4 }}
                      onClick={() => setTab(tab === "signup" ? "login" : "signup")}
                    >
                      {tab === "signup"
                        ? "Already have an account? Sign in"
                        : "Create new account"}
                    </button>
                  </small>
                )}
              </div>

              <div className="fw">
                <label className="lbl" htmlFor="auth-pw">
                  Password
                </label>
                <input
                  id="auth-pw"
                  className="field"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={
                    tab === "signup" ? "At least 8 characters" : "Your password"
                  }
                  required
                />
              </div>

              {tab === "login" && (
                <button
                  type="button"
                  className="au-link"
                  onClick={() => {
                    setError("");
                    setTab("forgot");
                  }}
                >
                  Forgot password?
                </button>
              )}

              {error && <div className="au-err">{error}</div>}

              <button
                type="submit"
                className="sw-btn sw-btn-em sw-btn-lg sw-btn-block"
                disabled={busy}
              >
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                {tab === "signup" ? "Create free account" : "Log in"}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
