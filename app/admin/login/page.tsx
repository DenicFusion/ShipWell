"use client";
import { useState } from "react";
import { ShipwellLogo } from "@/components/ShipwellLogo";

export default function AdminLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [shake, setShake] = useState(false);

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (email === "admin@shipwell.com" && password === "Admin123") {
      localStorage.setItem("sw_is_admin", "true");
      document.cookie = "sw_is_admin=true; path=/; max-age=86400";
      window.location.href = "/admin";  // hard redirect, not router.push
    } else {
      setError("Invalid admin credentials. Please try again.");
      setShake(true);
      setTimeout(() => setShake(false), 500);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-base">
      <div className={`bg-bg-surface p-10 rounded-2xl border border-border-line text-center max-w-sm w-full ${shake ? 'animate-wiggle' : ''}`}>
        <ShipwellLogo className="mx-auto mb-6" />
        <h2 className="text-xl font-bold mb-2">Admin Portal</h2>
        <p className="text-sm text-text-muted mb-8">Please sign in with your authorized admin account to continue.</p>
        
        {error && <div className="mb-4 text-xs font-bold text-red-500 bg-red-500/10 p-3 rounded-lg">{error}</div>}

        <form onSubmit={handleAdminLogin} className="space-y-4">
          <div>
            <input 
              type="email" 
              placeholder="Email address"
              className="w-full bg-bg-base border border-border-line p-3 rounded-lg focus:outline-none focus:border-brand-primary text-sm"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <input 
              type="password" 
              placeholder="Password"
              className="w-full bg-bg-base border border-border-line p-3 rounded-lg focus:outline-none focus:border-brand-primary text-sm"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
          </div>
          <button type="submit" className="w-full bg-brand-primary text-white font-bold py-3 px-4 rounded-xl hover:opacity-90">
            Sign In
          </button>
        </form>
      </div>
    </div>
  );
}
