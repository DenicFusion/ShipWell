'use client';

import { useState, useEffect } from "react";
import { auth, db } from "@/lib/firebase";
import { 
  createUserWithEmailAndPassword, 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged 
} from "firebase/auth";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShipwellLogo } from "@/components/ShipwellLogo";
import { ThemeSwitch } from "@/components/ThemeSwitch";
import { Truck, Mail, Lock, User, Shield, Loader2, AlertCircle, Phone, Building } from "lucide-react";

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        if (user.email === "denic9426@gmail.com" || user.email === "admin@shipwell.com") {
          router.push("/admin");
        } else {
          router.push("/dashboard");
        }
      }
    });
    return unsubscribe;
  }, [router]);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      // Create profile doc in Firestore
      await setDoc(doc(db, "users", user.uid), {
        uid: user.uid,
        name: name,
        email: email,
        phone: phone || "",
        company: company || "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      router.push("/dashboard");
    } catch (err: any) {
      console.error(err);
      if (err.code === "auth/email-already-in-use") {
        setError("This email address is already registered. Try logging in.");
      } else if (err.code === "auth/weak-password") {
        setError("Password should be at least 6 characters.");
      } else {
        setError(err.message || "Registration failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignup = async () => {
    setError("");
    setGoogleLoading(true);
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const user = result.user;

      // Create or merge user details in firestore
      await setDoc(doc(db, "users", user.uid), {
        uid: user.uid,
        name: user.displayName || "Shipwell Customer",
        email: user.email,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }, { merge: true });

      if (user.email === "denic9426@gmail.com" || user.email === "admin@shipwell.com") {
        router.push("/admin");
      } else {
        router.push("/dashboard");
      }
    } catch (err: any) {
      console.error(err);
      setError("Google Signup was aborted.");
    } finally {
      setGoogleLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-bg-base flex flex-col relative overflow-hidden font-sans select-none">
      {/* Background dot-grid & ambient glows */}
      <div className="absolute inset-0 dot-grid opacity-[0.35] pointer-events-none" />
      <div className="absolute top-[20%] left-[50%] -translate-x-1/2 w-[400px] h-[400px] bg-brand-primary/10 rounded-full blur-[100px] pointer-events-none" />

      {/* Floating Header */}
      <header className="w-full h-16 flex items-center justify-between px-6 border-b border-border-line/40 backdrop-blur-md relative z-20">
        <Link href="/" className="flex items-center gap-2 decoration-transparent">
          <div className="w-[34px] h-[34px] rounded-lg bg-emerald-950/20 border border-brand-primary/20 flex items-center justify-center">
            <Truck className="w-[18px] h-[18px] text-brand-primary" />
          </div>
          <span className="font-display font-extrabold text-lg text-text-base tracking-tight">Shipwell</span>
        </Link>
        <div className="flex items-center gap-4">
          <ThemeSwitch />
          <Link href="/" className="text-xs font-semibold text-text-muted hover:text-text-base transition-colors">
            Back to Home
          </Link>
        </div>
      </header>

      {/* Core Auth Panel */}
      <div className="flex-1 flex items-center justify-center p-6 relative z-10">
        <div className="w-full max-w-lg bg-bg-card border border-border-line/75 rounded-2xl p-8 md:p-10 shadow-2xl relative">
          <div className="text-center mb-6">
            <h1 className="font-display font-[800] text-3xl tracking-tight text-text-base mb-2 uppercase">
              Create Account
            </h1>
            <p className="text-xs text-text-muted">
              Register now for immediate instant booking, shipment historical tracking, and corporate discounts.
            </p>
          </div>

          {error && (
            <div className="bg-brand-danger/10 border border-brand-danger/20 text-brand-danger text-xs px-4 py-3 rounded-lg flex items-center gap-2 mb-6">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSignup} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Your Name</label>
                <div className="relative flex items-center">
                  <User className="absolute left-3 w-4 h-4 text-text-muted/60" />
                  <input 
                    type="text" 
                    required
                    placeholder="John Doe" 
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-bg-base border border-border-line pl-10 pr-4 py-3 rounded-xl text-sm focus:outline-none focus:border-brand-primary text-text-base"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Email Address</label>
                <div className="relative flex items-center">
                  <Mail className="absolute left-3 w-4 h-4 text-text-muted/60" />
                  <input 
                    type="email" 
                    required
                    placeholder="name@company.com" 
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-bg-base border border-border-line pl-10 pr-4 py-3 rounded-xl text-sm focus:outline-none focus:border-brand-primary text-text-base"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Phone (Optional)</label>
                <div className="relative flex items-center">
                  <Phone className="absolute left-3 w-4 h-4 text-text-muted/60" />
                  <input 
                    type="tel" 
                    placeholder="+233 24 000 0000" 
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full bg-bg-base border border-border-line pl-10 pr-4 py-3 rounded-xl text-sm focus:outline-none focus:border-brand-primary text-text-base"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Company Name (Optional)</label>
                <div className="relative flex items-center">
                  <Building className="absolute left-3 w-4 h-4 text-text-muted/60" />
                  <input 
                    type="text" 
                    placeholder="Acme Logistics LLC" 
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    className="w-full bg-bg-base border border-border-line pl-10 pr-4 py-3 rounded-xl text-sm focus:outline-none focus:border-brand-primary text-text-base"
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Security Password</label>
              <div className="relative flex items-center">
                <Lock className="absolute left-3 w-4 h-4 text-text-muted/60" />
                <input 
                  type="password" 
                  required
                  placeholder="Min 6 characters" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-bg-base border border-border-line pl-10 pr-4 py-3 rounded-xl text-sm focus:outline-none focus:border-brand-primary text-text-base"
                />
              </div>
            </div>

            <button 
              type="submit"
              disabled={loading || googleLoading}
              className="w-full bg-brand-primary hover:bg-brand-primary-hover text-white text-xs font-bold tracking-wider uppercase py-4 rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-brand-primary/10 transition-colors cursor-pointer mt-4"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
              <span>Verify and Register</span>
            </button>
          </form>

          {/* Social Divider */}
          <div className="flex items-center gap-4 my-6">
            <div className="flex-1 h-px bg-border-line/40" />
            <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider shrink-0">Or register via</span>
            <div className="flex-1 h-px bg-border-line/40" />
          </div>

          <button 
            type="button"
            onClick={handleGoogleSignup}
            disabled={loading || googleLoading}
            className="w-full bg-bg-base hover:bg-bg-card text-text-base border border-border-line font-bold text-xs py-3.5 rounded-xl flex items-center justify-center gap-2.5 transition-colors cursor-pointer"
          >
            {googleLoading ? (
              <Loader2 className="w-4 h-4 animate-spin text-brand-primary" />
            ) : (
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12.24 10.285V13.4h6.887c-.275 1.565-1.88 4.604-6.887 4.604-4.33 0-7.866-3.577-7.866-8s3.536-8 7.866-8c2.46 0 4.105 1.025 5.047 1.926l2.427-2.334C18.155 1.485 15.42 0 12.24 0 5.58 0 0 5.37 0 12s5.58 12 12.24 12c6.96 0 11.57-4.814 11.57-11.79 0-.79-.085-1.39-.188-1.925H12.24z"/>
              </svg>
            )}
            <span>Sign up with Google Secure</span>
          </button>

          <p className="text-center text-xs text-text-muted mt-6 text-emerald-950 dark:text-emerald-300">
            Already have an account?{" "}
            <Link href="/auth/login" className="text-brand-primary font-bold hover:underline">
              Sign in &rarr;
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
