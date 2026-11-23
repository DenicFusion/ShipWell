import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  updateProfile,
} from "firebase/auth";
import { Loader2, UserPlus } from "lucide-react";
import { auth } from "@/lib/firebase";
import { syncUserProfileDoc } from "@/lib/firestore-shipments";
import { apiFetch } from "@/lib/api-client";
import { migrateGuestDraftToFirestore } from "@/lib/drafts";
import { useShipWell } from "@/components/providers/ShipWellProvider";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { normalizeEmail } from "@/types/tracking";
import toast from "react-hot-toast";

function SignupForm() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const redirect = params.get("redirect") || "/dashboard";
  const { user, authReady } = useShipWell();

  const [name, setName] = useState("");
  const [email, setEmail] = useState(params.get("email") || "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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
      await migrateGuestDraftToFirestore(cred.user.uid, cred.user.email);
      toast.success("Account connected");
      navigate(redirect, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-up failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const clean = normalizeEmail(email);
    if (!name.trim()) {
      setError("Enter your full name.");
      return;
    }
    if (!clean || !clean.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setBusy(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, clean, password);
      await updateProfile(cred.user, { displayName: name.trim() });
      await syncUserProfileDoc({
        uid: cred.user.uid,
        name: name.trim(),
        email: clean,
      });
      await migrateGuestDraftToFirestore(cred.user.uid, clean);
      // Branded verification email via Resend (never blocks sign-up if Resend fails)
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
      toast.success("Account created! Check your email to verify.");
      navigate(redirect, { replace: true });
    } catch (err) {
      const code = (err as { code?: string })?.code || "";
      setError(
        code === "auth/operation-not-allowed"
          ? "Email/password sign-up isn't enabled in Firebase Authentication yet. Use Google Sign-In above."
          : code === "auth/email-already-in-use"
            ? "An account with this email already exists."
            : err instanceof Error
              ? err.message
              : "Could not create account."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wrap" style={{ padding: "64px 18px 96px" }}>
      <div className="panel" style={{ maxWidth: 440, margin: "0 auto", padding: "30px 26px" }}>
        <div className="au-ic">
          <UserPlus className="w-6 h-6" />
        </div>
        <div className="au-t">CREATE ACCOUNT</div>
        <p className="au-r">
          Use the email your parcels are sent to and they appear automatically.
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
            <label className="lbl" htmlFor="su-name">
              Full name
            </label>
            <input
              id="su-name"
              className="field"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="John Doe"
              required
            />
          </div>
          <div className="fw">
            <label className="lbl" htmlFor="su-email">
              Email
            </label>
            <input
              id="su-email"
              className="field"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              required
            />
          </div>
          <div className="fw">
            <label className="lbl" htmlFor="su-pw">
              Password
            </label>
            <input
              id="su-pw"
              className="field"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
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
            Create free account
          </button>
        </form>

        <p style={{ textAlign: "center", fontSize: 13, color: "var(--muted)", marginTop: 18 }}>
          Already have an account?{" "}
          <Link
            to={`/auth/login?redirect=${encodeURIComponent(redirect)}`}
            style={{ color: "var(--em)", fontWeight: 600 }}
          >
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function SignupPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="sw-main flex-1">
        <SignupForm />
      </main>
      <Footer />
    </div>
  );
}
