import React, { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import {
  ArrowUpRight,
  Bell,
  LayoutDashboard,
  Loader2,
  LogOut,
  Mail,
  MessageSquare,
  Package,
  Settings,
  Users,
} from "lucide-react";
import { db } from "@/lib/firebase";
import { ShipwellLogo } from "@/components/ShipwellLogo";
import { ThemeSwitch } from "@/components/ThemeSwitch";
import { useShipWell } from "@/components/providers/ShipWellProvider";
import { getInitials } from "@/types/tracking";
import toast from "react-hot-toast";

export function AdminShell({
  title,
  awaitingReviewCount = 0,
  openAlertsCount = 0,
  topAction,
  children,
}: {
  title: string;
  awaitingReviewCount?: number;
  openAlertsCount?: number;
  topAction?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user, profile, authReady, isAdmin, signOutUser } = useShipWell();
  const [rawUnreadMessagesCount, setRawUnreadMessagesCount] = useState(0);

  useEffect(() => {
    if (authReady && (!user || !isAdmin)) {
      navigate("/admin/login", { replace: true });
    }
  }, [authReady, user, isAdmin, navigate]);

  useEffect(() => {
    if (!authReady || !user || !isAdmin) {
      return;
    }
    const unsub = onSnapshot(
      query(collection(db, "supportThreads"), where("unreadAdmin", "==", true)),
      (snap) => setRawUnreadMessagesCount(snap.size),
      () => undefined
    );
    return () => unsub();
  }, [authReady, user, isAdmin]);

  const unreadMessagesCount = authReady && user && isAdmin ? rawUnreadMessagesCount : 0;

  if (!authReady || !user || !isAdmin) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-[var(--bg)]">
        <Loader2 className="w-8 h-8 animate-spin text-[var(--em)]" />
        <span className="text-sm text-[var(--muted)]">
          Verifying ShipWell operations session...
        </span>
      </div>
    );
  }

  const displayName = profile?.name || user.displayName || "Operations Admin";
  const initials = getInitials(displayName);

  const navItems = [
    {
      href: "/admin",
      label: "Overview",
      icon: LayoutDashboard,
      active: pathname === "/admin",
      badge: 0,
    },
    {
      href: "/admin/shipments",
      label: "Shipments",
      icon: Package,
      active:
        pathname.startsWith("/admin/shipments") ||
        pathname.startsWith("/admin/shipment/"),
      badge: awaitingReviewCount,
    },
    {
      href: "/admin/alerts",
      label: "Receiver actions",
      icon: Bell,
      active: pathname.startsWith("/admin/alerts"),
      badge: openAlertsCount,
    },
    {
      href: "/admin/messages",
      label: "Messages",
      icon: MessageSquare,
      active:
        pathname.startsWith("/admin/messages") ||
        pathname.startsWith("/admin/thread/"),
      badge: unreadMessagesCount,
    },
    {
      href: "/admin/mail",
      label: "Email log",
      icon: Mail,
      active: pathname.startsWith("/admin/mail"),
      badge: 0,
    },
    {
      href: "/admin/customers",
      label: "Customers",
      icon: Users,
      active: pathname.startsWith("/admin/customers"),
      badge: 0,
    },
    {
      href: "/admin/settings",
      label: "Settings",
      icon: Settings,
      active: pathname.startsWith("/admin/settings"),
      badge: 0,
    },
  ];

  const handleSignOut = async () => {
    await signOutUser();
    toast.success("Signed out of operations");
    navigate("/admin/login", { replace: true });
  };

  return (
    <div className="ad">
      <aside className="ad-side">
        <Link to="/admin" className="ad-brand">
          <ShipwellLogo subtitle="Operations" subtitleAmber />
        </Link>

        <nav className="ad-nav" aria-label="Operations navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                to={item.href}
                className={item.active ? "on" : ""}
              >
                <Icon className="w-[18px] h-[18px] shrink-0" />
                <span>{item.label}</span>
                {item.badge > 0 && <i>{item.badge}</i>}
              </Link>
            );
          })}
        </nav>

        <div className="ad-foot">
          <div style={{ marginBottom: 10 }}>
            <div
              style={{
                fontSize: 10,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "var(--faint)",
                fontWeight: 700,
                marginBottom: 6,
              }}
            >
              Appearance
            </div>
            <ThemeSwitch compact />
          </div>

          <div className="ad-user">
            <div className="av">{initials}</div>
            <div className="min-w-0">
              <b className="truncate">{displayName}</b>
              <small>{user.email}</small>
            </div>
          </div>
          <Link to="/" className="sw-btn sw-btn-ghost sw-btn-block">
            <ArrowUpRight className="w-4 h-4" />
            View website
          </Link>
          <button
            type="button"
            onClick={handleSignOut}
            className="sw-btn sw-btn-ghost sw-btn-block"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      </aside>

      <div className="ad-main">
        <div className="ad-top">
          <h2>{title}</h2>
          <div className="r">
            {topAction}
            <Link to="/" className="sw-btn sw-btn-ghost hide-s">
              <ArrowUpRight className="w-4 h-4" />
              Website
            </Link>
          </div>
        </div>

        <nav className="ad-tabs" aria-label="Mobile operations navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                to={item.href}
                className={item.active ? "on" : ""}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
                {item.badge > 0 && <i>{item.badge}</i>}
              </Link>
            );
          })}
        </nav>

        <div className="ad-body">{children}</div>
      </div>
    </div>
  );
}
