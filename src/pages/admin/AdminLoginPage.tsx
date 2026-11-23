import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
} from "firebase/auth";
import { Loader2, LogOut, ShieldAlert, ShieldCheck } from "lucide-react";
import { auth } from "@/lib/firebase";
import { syncUserProfileDoc } from "@/lib/firestore-shipments";
import { adminPath, getPublicOrigin, isAdminHostname } from "@/lib/host";
import { ShipwellLogo } from "@/components/ShipwellLogo";
import { useShipWell } from "@/components/providers/ShipWellProvider";
import { ADMIN_EMAIL, normalizeEmail } from "@/types/tracking";
import toast from "react-hot-toast";

export default function AdminLoginPage() {
  const navigate = useNavigate();
  const { user, authReady, isAdmin, signOutUser } = useShipWell();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rateLimitedMsg, setRateLimitedMsg] = useState("");

  useEffect(() => {
    if (authReady && isAdmin) {
      navigate(adminPath(""), { replace: true });
    }
  }, [authReady, isAdmin, navigate]);

  const recordLoginAttempt = async (
    attemptEmail: string,
    outcome: "failed" | "non_admin",
    reason: string
  ) => {
    try {
      const res = await fetch("/api/admin/login-attempt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: attemptEmail, outcome, reason }),
      });
      if (res.status === 429) {
        const data = await res.json().catch(() => ({}));
        setRateLimitedMsg(
          data.error || "Too many failed attempts. Please wait 15 minutes."
        );
      }
    } catch {
      // non-blocking
    }
  };

  const handleGoogle = async () => {
    setError("");
    setBusy(true);
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ login_hint: ADMIN_EMAIL });
      const cred = await signInWithPopup(auth, provider);
      await syncUserProfileDoc({
        uid: cred.user.uid,
        name: cred.user.displayName || "ShipWell Operations",
        email: cred.user.email || "",
      });
      if (
        !cred.user.emailVerified ||
        normalizeEmail(cred.user.email || "") !== ADMIN_EMAIL
      ) {
        await recordLoginAttempt(
          cred.user.email || "",
          "non_admin",
          "Google login without admin permissions"
        );
        setError(
          `Signed in as ${cred.user.email}. Operations access is restricted to verified ShipWell administrators.`
        );
      } else {
        toast.success("Operations session active");
        navigate(adminPath(""), { replace: true });
      }
    } catch (err) {
      await recordLoginAttempt(
        email,
        "failed",
        err instanceof Error ? err.message : "Google login failed"
      );
      setError(err instanceof Error ? err.message : "Google sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (rateLimitedMsg) {
      setError(rateLimitedMsg);
      return;
    }
    const clean = normalizeEmail(email);
    if (!clean || !password) {
      setError("Enter admin email and password.");
      return;
    }
    setBusy(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, clean, password);
      await syncUserProfileDoc({
        uid: cred.user.uid,
        name: cred.user.displayName || "ShipWell Operations",
        email: clean,
      });
      if (!cred.user.emailVerified || clean !== ADMIN_EMAIL) {
        await recordLoginAttempt(
          clean,
          "non_admin",
          "Signed in as non-admin account on operations portal"
        );
        setError(
          `Signed in as ${clean}, which does not have verified administrator privileges.`
        );
      } else {
        toast.success("Operations session active");
        navigate(adminPath(""), { replace: true });
      }
    } catch (err) {
      const code = (err as { code?: string })?.code || "";
      await recordLoginAttempt(clean, "failed", code || "auth_error");
      setError(
        code === "auth/operation-not-allowed"
          ? "Email/password sign-in isn't enabled in Firebase Auth yet. Use Continue with Google below."
          : "Invalid administrator credentials."
      );
    } finally {
      setBusy(false);
    }
  };

  const onAdminDomain = isAdminHostname();
  const publicOrigin = getPublicOrigin();

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <div className="ad-login">
        <div className="panel" style={{ padding: "30px 26px" }}>
          <div className="flex justify-center mb-5">
            <ShipwellLogo subtitle="Operations" subtitleAmber />
          </div>

          <div className="au-ic">
            {user && !isAdmin && onAdminDomain ? (
              <ShieldAlert className="w-6 h-6 text-rose-400" />
            ) : (
              <ShieldCheck className="w-6 h-6" />
            )}
          </div>
          <div className="au-t">
            {user && !isAdmin && onAdminDomain
              ? "ACCESS DENIED"
              : "OPERATIONS SIGN IN"}
          </div>
          <p className="au-r">
            {user && !isAdmin && onAdminDomain
              ? "Your account does not have administrator permissions for ShipWell Operations."
              : "Sign in with your verified ShipWell operations administrator account."}
          </p>

          {user && !isAdmin && (
            <div className="au-err" style={{ marginBottom: 16 }}>
              <div>
                Currently signed in as <b>{user.email}</b>, which is a standard
                customer account.
              </div>
              <div className="grid gap-2 mt-3">
                <button
                  type="button"
                  className="sw-btn sw-btn-ghost sw-btn-block"
                  style={{ padding: "8px 12px", fontSize: 12.5 }}
                  onClick={() => signOutUser()}
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Sign out and switch account
                </button>
                {onAdminDomain && (
                  <a
                    href={publicOrigin}
                    className="sw-btn sw-btn-em sw-btn-block"
                    style={{ padding: "8px 12px", fontSize: 12.5 }}
                  >
                    Go to ShipWell website →
                  </a>
                )}
              </div>
            </div>
          )}

          {rateLimitedMsg && (
            <div className="au-err" style={{ marginBottom: 14 }}>
              {rateLimitedMsg}
            </div>
          )}

          <button
            type="button"
            onClick={handleGoogle}
            disabled={busy || Boolean(rateLimitedMsg)}
            className="sw-btn sw-btn-em sw-btn-lg sw-btn-block"
            style={{ marginBottom: 16 }}
          >
            {busy ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <span className="font-bold">G</span>
            )}
            Sign in with Google
          </button>

          <form className="au-f" onSubmit={handleSubmit} noValidate>
            <div className="fw">
              <label className="lbl" htmlFor="adm-email">
                Operations email
              </label>
              <input
                id="adm-email"
                className="field"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ops@shipwell.com"
                required
              />
            </div>
            <div className="fw">
              <label className="lbl" htmlFor="adm-pw">
                Password
              </label>
              <input
                id="adm-pw"
                className="field"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                required
              />
            </div>

            {error && <div className="au-err">{error}</div>}

            <button
              type="submit"
              disabled={busy || Boolean(rateLimitedMsg)}
              className="sw-btn sw-btn-ghost sw-btn-lg sw-btn-block"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              Sign in with password
            </button>
          </form>

          <div className="mt-5 text-center">
            <a
              href={publicOrigin}
              style={{ fontSize: 13, color: "var(--muted)" }}
            >
              ← Back to website
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
