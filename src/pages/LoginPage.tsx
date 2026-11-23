import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  GoogleAuthProvider,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
} from "firebase/auth";
import { Loader2, Lock } from "lucide-react";
import { auth } from "@/lib/firebase";
import { syncUserProfileDoc } from "@/lib/firestore-shipments";
import { useShipWell } from "@/components/providers/ShipWellProvider";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { normalizeEmail } from "@/types/tracking";
import toast from "react-hot-toast";

function LoginForm() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const redirect = params.get("redirect") || "/dashboard";
  const { user, authReady } = useShipWell();

  const [email, setEmail] = useState(params.get("email") || "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [forgotSent, setForgotSent] = useState("");

  useEffect(() => {
    if (authReady && user) {
      navigate(redirect, { replace: true });
    }
  }, [authReady, user, navigate, redirect]);

  const handleGoogle = async () => {
    setError("");
    setBusy(true);
    try {
      const provider = new GoogleAuthProvider();
      if (email) provider.setCustomParameters({ login_hint: email });
      const cred = await signInWithPopup(auth, provider);
      await syncUserProfileDoc({
        uid: cred.user.uid,
        name: cred.user.displayName || "ShipWell Customer",
        email: cred.user.email || "",
      });
      toast.success("Signed in");
      navigate(redirect, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const clean = normalizeEmail(email);
    if (!clean || !password) {
      setError("Enter your email and password.");
      return;
    }
    setBusy(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, clean, password);
      await syncUserProfileDoc({
        uid: cred.user.uid,
        name: cred.user.displayName || "ShipWell Customer",
        email: clean,
      });
      toast.success("Signed in");
      navigate(redirect, { replace: true });
    } catch (err) {
      const code = (err as { code?: string })?.code || "";
      setError(
        code === "auth/operation-not-allowed"
          ? "Email/password sign-in isn't enabled in Firebase Authentication yet. Please use Google Sign-In below."
          : "That email and password don't match."
      );
    } finally {
      setBusy(false);
    }
  };

  const handleForgot = async () => {
    const clean = normalizeEmail(email);
    if (!clean || !clean.includes("@")) {
      setError("Enter your email address above first.");
      return;
    }
    setBusy(true);
    try {
      await sendPasswordResetEmail(auth, clean);
      setForgotSent(clean);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send reset email.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wrap" style={{ padding: "64px 18px 96px" }}>
      <div className="panel" style={{ maxWidth: 440, margin: "0 auto", padding: "30px 26px" }}>
        <div className="au-ic">
          <Lock className="w-6 h-6" />
        </div>
        <div className="au-t">WELCOME BACK</div>
        <p className="au-r">
          Sign in to see shipments on their way to you and bookings you sent.
        </p>

        <button
          type="button"
          onClick={handleGoogle}
          disabled={busy}
          className="sw-btn sw-btn-ghost sw-btn-block"
          style={{ marginBottom: 16, color: "var(--text)" }}
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <span className="font-bold text-emerald-400">G</span>}
          Continue with Google
        </button>

        <form className="au-f" onSubmit={handleSubmit} noValidate>
          <div className="fw">
            <label className="lbl" htmlFor="login-email">
              Email
            </label>
            <input
              id="login-email"
              className="field"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              required
            />
          </div>
          <div className="fw">
            <label className="lbl" htmlFor="login-pw">
              Password
            </label>
            <input
              id="login-pw"
              className="field"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password"
              required
            />
          </div>
          <button type="button" className="au-link" onClick={handleForgot}>
            Forgot password?
          </button>

          {forgotSent && (
            <div
              style={{
                fontSize: 12.5,
                color: "var(--em2)",
                background: "rgba(16,185,129,0.08)",
                border: "1px solid rgba(16,185,129,0.25)",
                padding: "10px 12px",
                borderRadius: 10,
              }}
            >
              Reset link sent to {forgotSent}.
            </div>
          )}
          {error && <div className="au-err">{error}</div>}

          <button
            type="submit"
            disabled={busy}
            className="sw-btn sw-btn-em sw-btn-lg sw-btn-block"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            Log in
          </button>
        </form>

        <p style={{ textAlign: "center", fontSize: 13, color: "var(--muted)", marginTop: 18 }}>
          New to ShipWell?{" "}
          <Link
            to={`/auth/signup?redirect=${encodeURIComponent(redirect)}`}
            style={{ color: "var(--em)", fontWeight: 600 }}
          >
            Create free account
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="sw-main flex-1">
        <LoginForm />
      </main>
      <Footer />
    </div>
  );
}
