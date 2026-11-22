import React, { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Bell,
  Home,
  LayoutGrid,
  Lock,
  MessageSquare,
  Plus,
  Search,
  Truck,
  User as UserIcon,
} from "lucide-react";
import { useShipWell } from "@/components/providers/ShipWellProvider";
import { ThemeSwitch } from "@/components/ThemeSwitch";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { formatTrackingCode, getInitials } from "@/types/tracking";

export type DashboardSection =
  | "overview"
  | "incoming"
  | "sent"
  | "track"
  | "alerts"
  | "support"
  | "account";

export function DashboardShell({
  section,
  title,
  subtitle,
  incomingActiveCount,
  sentCount,
  openAlertsCount,
  loading,
  children,
}: {
  section: DashboardSection;
  title: string;
  subtitle: string;
  incomingActiveCount: number;
  sentCount: number;
  openAlertsCount: number;
  loading?: boolean;
  children: React.ReactNode;
}) {
  const { user, profile, authReady, unreadSupportCount, openAuth, signOutUser } =
    useShipWell();
  const navigate = useNavigate();
  const location = useLocation();
  const [quickCode, setQuickCode] = useState("");

  const handleQuickTrack = (e: React.FormEvent) => {
    e.preventDefault();
    const formatted = formatTrackingCode(quickCode);
    if (formatted.length < 3) return;
    setQuickCode("");
    navigate(`/dashboard/track/${encodeURIComponent(formatted)}`);
  };

  // Loading auth state — render sleek skeleton without blank flash
  if (!authReady) {
    return (
      <div className="dx" aria-busy="true">
        <aside className="dx-side">
          <div className="dx-skel" style={{ height: 48, marginBottom: 14 }} />
          <div className="dx-skel" style={{ height: 220 }} />
          <div
            className="dx-skel"
            style={{ height: 130, marginTop: "auto" }}
          />
        </aside>
        <div className="dx-main">
          <header className="dx-top">
            <div className="dx-skel" style={{ width: 180, height: 28 }} />
          </header>
          <main className="dx-body">
            <div className="dx-skel" style={{ height: 76 }} />
            <div className="dx-stats">
              <div className="dx-skel" style={{ height: 112 }} />
              <div className="dx-skel" style={{ height: 112 }} />
              <div className="dx-skel" style={{ height: 112 }} />
              <div className="dx-skel" style={{ height: 112 }} />
            </div>
            <div className="dx-skel" style={{ height: 320 }} />
          </main>
        </div>
      </div>
    );
  }

  // Logged-out visitor view — shows site Navbar + sign-in screen + Footer, returns to requested dashboard route
  if (!user) {
    const returnTo = location.pathname + location.search;
    return (
      <div className="min-h-screen flex flex-col">
        <Navbar />
        <main className="sw-main flex-1">
          <div className="wrap" style={{ paddingTop: 60, paddingBottom: 90 }}>
            <div className="dx-empty" style={{ maxWidth: 540, margin: "0 auto" }}>
              <div className="au-ic">
                <Lock className="w-6 h-6" />
              </div>
              <h3>SIGN IN TO CONTINUE</h3>
              <p>
                Log in or create a free account. If someone is sending you a
                parcel, sign up with the email they used. It will appear here
                automatically.
              </p>
              <div className="acts">
                <button
                  type="button"
                  className="sw-btn sw-btn-em sw-btn-lg"
                  onClick={() =>
                    openAuth({
                      mode: "signup",
                      onDone: () => navigate(returnTo, { replace: true }),
                    })
                  }
                >
                  Create free account
                </button>
                <button
                  type="button"
                  className="sw-btn sw-btn-ghost sw-btn-lg"
                  onClick={() =>
                    openAuth({
                      mode: "login",
                      onDone: () => navigate(returnTo, { replace: true }),
                    })
                  }
                >
                  Log in
                </button>
              </div>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  const displayName =
    profile?.name ||
    user.displayName ||
    user.email?.split("@")[0] ||
    "ShipWell Customer";
  const initials = getInitials(displayName);

  const navItems: {
    key: DashboardSection;
    label: string;
    href: string;
    icon: React.ReactNode;
    count: number;
    hot?: boolean;
  }[] = [
    {
      key: "overview",
      label: "Overview",
      href: "/dashboard",
      icon: <LayoutGrid className="w-[19px] h-[19px]" />,
      count: 0,
    },
    {
      key: "incoming",
      label: "On Its Way To You",
      href: "/dashboard/incoming",
      icon: <Home className="w-[19px] h-[19px]" />,
      count: incomingActiveCount,
    },
    {
      key: "sent",
      label: "Sent By You",
      href: "/dashboard/sent",
      icon: <Truck className="w-[19px] h-[19px]" />,
      count: sentCount,
    },
    {
      key: "track",
      label: "Track a Parcel",
      href: "/dashboard/track",
      icon: <Search className="w-[19px] h-[19px]" />,
      count: 0,
    },
    {
      key: "alerts",
      label: "Action Required",
      href: "/dashboard/alerts",
      icon: <Bell className="w-[19px] h-[19px]" />,
      count: openAlertsCount,
      hot: true,
    },
    {
      key: "support",
      label: "Support",
      href: "/dashboard/support",
      icon: <MessageSquare className="w-[19px] h-[19px]" />,
      count: unreadSupportCount,
    },
  ];

  const mobileTabs: {
    key: DashboardSection;
    label: string;
    href: string;
    icon: React.ReactNode;
    count: number;
    isCenter?: boolean;
  }[] = [
    {
      key: "overview",
      label: "Home",
      href: "/dashboard",
      icon: <LayoutGrid className="w-[22px] h-[22px]" />,
      count: 0,
    },
    {
      key: "incoming",
      label: "Incoming",
      href: "/dashboard/incoming",
      icon: <Home className="w-[22px] h-[22px]" />,
      count: 0,
    },
    {
      key: "track",
      label: "Track",
      href: "/dashboard/track",
      icon: <Search className="w-[22px] h-[22px]" />,
      count: 0,
      isCenter: true,
    },
    {
      key: "sent",
      label: "Sent",
      href: "/dashboard/sent",
      icon: <Truck className="w-[22px] h-[22px]" />,
      count: 0,
    },
    {
      key: "alerts",
      label: "Actions",
      href: "/dashboard/alerts",
      icon: <Bell className="w-[22px] h-[22px]" />,
      count: openAlertsCount,
    },
    {
      key: "support",
      label: "Support",
      href: "/dashboard/support",
      icon: <MessageSquare className="w-[22px] h-[22px]" />,
      count: unreadSupportCount,
    },
  ];

  const handleSignOut = async () => {
    await signOutUser();
    navigate("/");
  };

  return (
    <div className="dx">
      {/* Desktop Left Sidebar (>= 900px) */}
      <aside className="dx-side">
        <Link className="dx-brand" to="/dashboard">
          <span className="sw-logo-mark">
            <Truck className="w-5 h-5" />
          </span>
          <div>
            <b>ShipWell</b>
            <small>Customer portal</small>
          </div>
        </Link>

        <div className="dx-lbl">Menu</div>
        <nav className="dx-nav" aria-label="Dashboard menu">
          {navItems.map((item) => (
            <Link
              key={item.key}
              to={item.href}
              className={section === item.key ? "on" : ""}
            >
              <span className="ic">{item.icon}</span>
              {item.label}
              {item.count > 0 && (
                <i className={item.hot ? "hot" : ""}>{item.count}</i>
              )}
            </Link>
          ))}
          <Link
            to="/dashboard/account"
            className={section === "account" ? "on" : ""}
          >
            <span className="ic">
              <UserIcon className="w-[19px] h-[19px]" />
            </span>
            Account
          </Link>
        </nav>

        <div className="dx-promo">
          <b>Send something</b>
          <p>
            Book a pickup in under a minute and add item photos for the
            receiver.
          </p>
          <Link className="sw-btn sw-btn-em" to="/ship">
            <Plus className="w-4 h-4" />
            Ship a parcel
          </Link>
        </div>

        <div style={{ margin: "12px 0 10px" }}>
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

        <div className="dx-user">
          <div className="dx-av">{initials}</div>
          <div>
            <b>{displayName}</b>
            <small>{user.email}</small>
          </div>
        </div>

        <div className="dx-out">
          <Link to="/">Website</Link>
          <button type="button" onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="dx-main">
        <header className="dx-top">
          <Link
            className="dx-brandm"
            to="/dashboard"
            aria-label="ShipWell Dashboard"
          >
            <span className="sw-logo-mark" style={{ width: 34, height: 34 }}>
              <Truck className="w-4 h-4" />
            </span>
          </Link>

          <div className="t">
            <h2>{title}</h2>
            <small>{subtitle}</small>
          </div>

          <form className="dx-search" onSubmit={handleQuickTrack} noValidate>
            <span className="ic">
              <Search className="w-4 h-4" />
            </span>
            <input
              value={quickCode}
              onChange={(e) => setQuickCode(formatTrackingCode(e.target.value))}
              placeholder="Track a parcel..."
              aria-label="Tracking number"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
            />
            <button type="submit">Track</button>
          </form>

          <Link
            className="dx-ib"
            to="/dashboard/support"
            aria-label="Support messages"
          >
            <span className="ic">
              <MessageSquare className="w-[19px] h-[19px]" />
            </span>
            {unreadSupportCount > 0 && <em>{unreadSupportCount}</em>}
          </Link>

          <Link
            className="dx-ib"
            to="/dashboard/alerts"
            aria-label="Action required"
          >
            <span className="ic">
              <Bell className="w-[19px] h-[19px]" />
            </span>
            {openAlertsCount > 0 && <em>{openAlertsCount}</em>}
          </Link>

          <Link
            className="dx-ib"
            to="/dashboard/account"
            aria-label="Account settings"
          >
            <span
              className="dx-av"
              style={{
                width: 30,
                height: 30,
                borderRadius: 9,
                fontSize: 11.5,
              }}
            >
              {initials}
            </span>
          </Link>
        </header>

        <main className="dx-body">
          {loading ? (
            <div className="flex flex-col gap-5" aria-busy="true">
              <div className="dx-skel" style={{ height: 74 }} />
              <div className="dx-stats">
                <div className="dx-skel" style={{ height: 110 }} />
                <div className="dx-skel" style={{ height: 110 }} />
                <div className="dx-skel" style={{ height: 110 }} />
                <div className="dx-skel" style={{ height: 110 }} />
              </div>
              <div className="dx-skel" style={{ height: 300 }} />
            </div>
          ) : (
            children
          )}
        </main>
      </div>

      {/* Mobile Bottom Tab Bar (< 900px) */}
      <nav className="dx-tabs" aria-label="Dashboard navigation">
        {mobileTabs.map((tab) => (
          <Link
            key={tab.key}
            to={tab.href}
            className={`${section === tab.key ? "on" : ""} ${
              tab.isCenter ? "trk" : ""
            }`.trim()}
          >
            <span className="ic">{tab.icon}</span>
            <span>{tab.label}</span>
            {tab.count > 0 && <em>{tab.count}</em>}
          </Link>
        ))}
      </nav>
    </div>
  );
}
