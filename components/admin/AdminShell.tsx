import React, { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import {
  ArrowUpRight,
  Bell,
  CreditCard,
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
import { adminPath, getPublicOrigin } from "@/lib/host";
import { ShipwellLogo } from "@/components/ShipwellLogo";
import { ThemeSwitch } from "@/components/ThemeSwitch";
import { AdminAppControls } from "@/components/admin/AdminAppControls";
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
  const [rawPendingPaymentsCount, setRawPendingPaymentsCount] = useState(0);

  useEffect(() => {
    if (authReady && (!user || !isAdmin)) {
      navigate(adminPath("login"), { replace: true });
    }
  }, [authReady, user, isAdmin, navigate]);

  useEffect(() => {
    if (!authReady || !user || !isAdmin) {
      return;
    }
    const unsubMsg = onSnapshot(
      query(collection(db, "supportThreads"), where("unreadAdmin", "==", true)),
      (snap) => setRawUnreadMessagesCount(snap.size),
      () => undefined
    );
    const unsubPay = onSnapshot(
      query(collection(db, "payments"), where("status", "==", "pending_review")),
      (snap) => setRawPendingPaymentsCount(snap.size),
      () => undefined
    );
    return () => {
      unsubMsg();
      unsubPay();
    };
  }, [authReady, user, isAdmin]);

  const unreadMessagesCount = authReady && user && isAdmin ? rawUnreadMessagesCount : 0;
  const pendingPaymentsCount = authReady && user && isAdmin ? rawPendingPaymentsCount : 0;

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
  const rootHref = adminPath("");
  const shipmentsHref = adminPath("shipments");
  const alertsHref = adminPath("alerts");
  const paymentsHref = adminPath("payments");
  const messagesHref = adminPath("messages");
  const mailHref = adminPath("mail");
  const customersHref = adminPath("customers");
  const settingsHref = adminPath("settings");
  const publicOrigin = getPublicOrigin();

  const navItems = [
    {
      href: rootHref,
      label: "Overview",
      icon: LayoutDashboard,
      active: pathname === "/" || pathname === "/admin",
      badge: 0,
    },
    {
      href: shipmentsHref,
      label: "Shipments",
      icon: Package,
      active:
        pathname.startsWith("/admin/shipments") ||
        pathname.startsWith("/admin/shipment/") ||
        pathname.startsWith("/shipments") ||
        pathname.startsWith("/shipment/"),
      badge: awaitingReviewCount,
    },
    {
      href: paymentsHref,
      label: "Payments",
      icon: CreditCard,
      active:
        pathname.startsWith("/admin/payments") ||
        pathname.startsWith("/payments"),
      badge: pendingPaymentsCount,
    },
    {
      href: alertsHref,
      label: "Receiver actions",
      icon: Bell,
      active:
        pathname.startsWith("/admin/alerts") ||
        pathname.startsWith("/alerts"),
      badge: openAlertsCount,
    },
    {
      href: messagesHref,
      label: "Messages",
      icon: MessageSquare,
      active:
        pathname.startsWith("/admin/messages") ||
        pathname.startsWith("/admin/thread/") ||
        pathname.startsWith("/messages") ||
        pathname.startsWith("/thread/"),
      badge: unreadMessagesCount,
    },
    {
      href: mailHref,
      label: "Email log",
      icon: Mail,
      active:
        pathname.startsWith("/admin/mail") || pathname.startsWith("/mail"),
      badge: 0,
    },
    {
      href: customersHref,
      label: "Customers",
      icon: Users,
      active:
        pathname.startsWith("/admin/customers") ||
        pathname.startsWith("/customers"),
      badge: 0,
    },
    {
      href: settingsHref,
      label: "Settings",
      icon: Settings,
      active:
        pathname.startsWith("/admin/settings") ||
        pathname.startsWith("/settings"),
      badge: 0,
    },
  ];

  const handleSignOut = async () => {
    await signOutUser();
    toast.success("Signed out of operations");
    navigate(adminPath("login"), { replace: true });
  };

  return (
    <div className="ad">
      <aside className="ad-side">
        <Link to={rootHref} className="ad-brand">
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
          <a href={publicOrigin} className="sw-btn sw-btn-ghost sw-btn-block">
            <ArrowUpRight className="w-4 h-4" />
            View website
          </a>
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
            <AdminAppControls />
            {topAction}
            <a href={publicOrigin} className="sw-btn sw-btn-ghost hide-s">
              <ArrowUpRight className="w-4 h-4" />
              Website
            </a>
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
