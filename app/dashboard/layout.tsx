'use client';

import { useEffect, useState } from "react";
import { auth } from "@/lib/firebase";
import { onAuthStateChanged, signOut, User } from "firebase/auth";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { ShipwellLogo } from "@/components/ShipwellLogo";
import { ThemeSwitch } from "@/components/ThemeSwitch";
import { 
  getFirestore, doc, getDoc 
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { 
  LayoutDashboard, 
  Package, 
  HelpCircle, 
  User as UserIcon, 
  LogOut, 
  Menu, 
  X, 
  Truck, 
  ShieldCheck,
  Loader2
} from "lucide-react";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    let fired = false;
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      fired = true;
      if (!u) {
        router.push("/auth/login");
      } else {
        setUser(u);
        try {
          const userDoc = await getDoc(doc(db, "users", u.uid));
          if (userDoc.exists()) {
            setProfile(userDoc.data());
          }
        } catch (err) {
          console.error("Error reading profile:", err);
        }
        setLoading(false);
      }
    });

    const timeout = setTimeout(() => {
       if (!fired) {
          router.push("/auth/login");
       }
    }, 3000);

    return () => {
       unsubscribe();
       clearTimeout(timeout);
    };
  }, [router]);

  const handleLogout = async () => {
    await signOut(auth);
    router.push("/auth/login");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-bg-base flex flex-col justify-center items-center gap-4">
        <div className="w-12 h-12 border-4 border-brand-primary border-t-transparent rounded-full animate-spin" />
        <span className="text-sm font-medium text-text-muted">Loading workspace parameters...</span>
      </div>
    );
  }

  const navItems = [
    { name: "My Dashboard", href: "/dashboard", icon: LayoutDashboard },
  ];

  const isAdminUser = user?.email === "denic9426@gmail.com" || user?.email === "admin@shipwell.com";

  return (
    <div className="min-h-screen bg-bg-base flex flex-col font-sans transition-colors duration-300">
      
      {/* Top Header Row (Mobile) */}
      <header className="lg:hidden h-16 bg-bg-base/85 backdrop-blur-xl border-b border-border-line/60 px-6 flex items-center justify-between sticky top-0 z-50">
        <Link href="/dashboard" className="flex items-center gap-2 decoration-transparent">
          <Truck className="w-5 h-5 text-brand-primary" />
          <span className="font-display font-extrabold text-lg text-text-base tracking-tight">Shipwell</span>
        </Link>
        <div className="flex items-center gap-4">
          <ThemeSwitch />
          <button 
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-2 border border-border-line rounded-lg text-text-muted text-sm hover:text-text-base hover:bg-bg-card transition-colors focus:outline-none"
          >
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </header>

      <div className="flex flex-1 relative">
        
        {/* SIDEBAR NAVIGATION (Desktop & Drawed Mobile) */}
        <aside className={`
          fixed lg:static inset-y-0 left-0 z-40 w-64 border-r border-border-line bg-bg-card/40 backdrop-blur-2xl p-6 flex flex-col justify-between
          transform transition-transform duration-300 ease-in-out lg:translate-x-0
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
          ${sidebarOpen ? "top-16" : "top-0"}
        `}>
          <div className="flex flex-col gap-8">
            {/* Logo Row (Desktop Only) */}
            <div className="hidden lg:flex items-center gap-2">
              <div className="w-[34px] h-[34px] rounded-lg bg-emerald-950/20 border border-brand-primary/20 flex items-center justify-center">
                <Truck className="w-18 h-18 text-brand-primary" />
              </div>
              <div className="flex flex-col">
                <span className="font-display font-extrabold text-base text-text-base tracking-tight leading-none">Shipwell</span>
                <span className="text-[9px] font-semibold tracking-widest uppercase text-brand-primary mt-1">LOGISTICS HUB</span>
              </div>
            </div>

            {/* Profile badge summary */}
            <div className="bg-bg-base/60 border border-border-line/60 rounded-xl p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-brand-primary/10 border border-brand-primary/20 flex items-center justify-center font-display font-extrabold text-brand-primary">
                {(profile?.name || user?.displayName || user?.email || "U")
                  .substring(0, 2)
                  .toUpperCase()}
              </div>
              <div className="flex flex-col overflow-hidden text-left">
                <span className="text-xs font-bold text-text-base leading-tight truncate">
                  {profile?.name || user?.displayName || "Shipwell Customer"}
                </span>
                <span className="text-[10px] text-text-muted truncate mt-0.5">
                  {profile?.company || "Standard Tier Account"}
                </span>
              </div>
            </div>

            {/* Navigation links */}
            <nav className="flex flex-col gap-1.5">
              {navItems.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link 
                    key={item.name}
                    href={item.href}
                    onClick={() => setSidebarOpen(false)}
                    className={`
                      flex items-center gap-3 px-4 py-2.5 rounded-lg text-xs font-bold tracking-wide uppercase transition-all duration-200 decoration-transparent
                      ${isActive ? "bg-brand-primary/10 text-brand-primary" : "text-text-muted hover:bg-border-line/30 hover:text-text-base"}
                    `}
                  >
                    <item.icon className="w-4 h-4 shrink-0" />
                    <span>{item.name}</span>
                  </Link>
                );
              })}

              {isAdminUser && (
                <Link 
                  href="/admin"
                  className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-xs font-bold tracking-wide uppercase text-brand-primary hover:bg-brand-primary/5 transition-all decoration-transparent mt-4 border-t border-border-line/20 pt-4"
                >
                  <ShieldCheck className="w-4 h-4 text-brand-primary" />
                  <span>Admin Panel</span>
                </Link>
              )}
            </nav>
          </div>

          <div className="flex flex-col gap-4">
            {/* Desktop Theme Switch */}
            <div className="hidden lg:flex items-center justify-between border-t border-border-line/20 pt-4">
              <span className="text-xs font-bold text-text-muted uppercase tracking-wider">Appearance</span>
              <ThemeSwitch />
            </div>

            {/* Logout Trigger */}
            <button 
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-4 py-3 border border-border-line hover:border-brand-danger/30 rounded-xl text-xs font-bold tracking-wide uppercase text-text-muted hover:text-brand-danger hover:bg-brand-danger/5 transition-all duration-200 cursor-pointer"
            >
              <LogOut className="w-4 h-4 text-brand-danger" />
              <span>Log out session</span>
            </button>
          </div>
        </aside>

        {/* CORE SCROLLING PANEL */}
        <main className="flex-1 p-6 md:p-10 lg:p-12 overflow-auto bg-bg-base">
          <div className="max-w-6xl mx-auto">
            {children}
          </div>
        </main>

      </div>
    </div>
  );
}
