import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Package,
  Search,
} from "lucide-react";
import { ShipwellLogo } from "@/components/ShipwellLogo";
import { ThemeSwitch } from "@/components/ThemeSwitch";
import { useShipWell } from "@/components/providers/ShipWellProvider";
import { getInitials } from "@/types/tracking";
import toast from "react-hot-toast";

export function Navbar() {
  const location = useLocation();
  const pathname = location.pathname;
  const navigate = useNavigate();
  const {
    user,
    profile,
    openAlertsCount,
    unreadSupportCount,
    openAuth,
    openContact,
    requireAuthForShip,
    signOutUser,
  } = useShipWell();
  const [scrolled, setScrolled] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  useEffect(() => {
    if (drawerOpen) {
      document.body.classList.add("lock");
    } else {
      document.body.classList.remove("lock");
    }
    return () => document.body.classList.remove("lock");
  }, [drawerOpen]);

  const displayName =
    profile?.name || user?.displayName || user?.email?.split("@")[0] || "Customer";
  const initials = getInitials(displayName);
  const totalBadge = openAlertsCount + unreadSupportCount;

  const handleSignOut = async () => {
    setMenuOpen(false);
    setDrawerOpen(false);
    await signOutUser();
    toast.success("Signed out");
    if (pathname.startsWith("/dashboard")) {
      navigate("/");
    }
  };

  const toggleBurger = () => {
    setMenuOpen(false);
    setDrawerOpen((p) => !p);
  };

  const handleOpenAuth = (mode: "login" | "signup") => {
    setDrawerOpen(false);
    setMenuOpen(false);
    openAuth({ mode });
  };

  const handleShipClick = (e: React.MouseEvent) => {
    setDrawerOpen(false);
    setMenuOpen(false);
    if (!user) {
      e.preventDefault();
      requireAuthForShip("/ship");
    }
  };

  return (
    <>
      <nav className={`sw-nav ${scrolled ? "scrolled" : ""}`}>
        <Link to="/" onClick={() => setDrawerOpen(false)}>
          <ShipwellLogo />
        </Link>

        <ul className="sw-nav-links">
          <li>
            <Link to="/#services">Services</Link>
          </li>
          <li>
            <Link to="/#how-it-works">How It Works</Link>
          </li>
          <li>
            <Link
              to="/quote"
              className={pathname.startsWith("/quote") ? "on" : ""}
            >
              Get a Quote
            </Link>
          </li>
          <li>
            <Link
              to="/business-shipping"
              className={pathname.startsWith("/business-shipping") ? "on" : ""}
            >
              Business
            </Link>
          </li>
          <li>
            <Link
              to="/track"
              className={pathname.startsWith("/track") ? "on" : ""}
            >
              Track
            </Link>
          </li>
        </ul>

        <div className="nav-cta">
          <div className="navacct">
            {user ? (
              <>
                <Link
                  to="/dashboard"
                  className="sw-btn sw-btn-ghost hide-m"
                  style={{ display: "inline-flex", alignItems: "center" }}
                >
                  Dashboard
                  {totalBadge > 0 && <span className="nbadge">{totalBadge}</span>}
                </Link>
                <div className="acct" ref={menuRef}>
                  <button
                    type="button"
                    className="avatarb"
                    aria-label="Account menu"
                    aria-expanded={menuOpen}
                    onClick={(e) => {
                      e.stopPropagation();
                      setDrawerOpen(false);
                      setMenuOpen((p) => !p);
                    }}
                  >
                    {initials}
                    {totalBadge > 0 && <span className="dotb" />}
                  </button>
                  {menuOpen && (
                    <div className="amenu">
                      <div className="who2">
                        <b>{displayName}</b>
                        <small>{user.email}</small>
                      </div>
                      <Link
                        to="/dashboard"
                        onClick={() => setMenuOpen(false)}
                      >
                        <LayoutDashboard className="w-4 h-4" />
                        <span>
                          Dashboard{" "}
                          {totalBadge > 0 && `(${totalBadge})`}
                        </span>
                      </Link>
                      <Link
                        to="/dashboard/support"
                        onClick={() => setMenuOpen(false)}
                      >
                        <MessageSquare className="w-4 h-4" />
                        <span>
                          Support{" "}
                          {unreadSupportCount > 0 && `(${unreadSupportCount})`}
                        </span>
                      </Link>
                      <Link to="/ship" onClick={handleShipClick}>
                        <Package className="w-4 h-4" />
                        <span>Ship a parcel</span>
                      </Link>
                      <Link to="/track" onClick={() => setMenuOpen(false)}>
                        <Search className="w-4 h-4" />
                        <span>Track a shipment</span>
                      </Link>
                      <button
                        type="button"
                        className="amenu-item"
                        onClick={handleSignOut}
                      >
                        <LogOut className="w-4 h-4" />
                        <span>Sign out</span>
                      </button>

                      <div
                        style={{
                          marginTop: 6,
                          padding: "10px 8px 4px",
                          borderTop: "1px solid var(--border)",
                          display: "grid",
                          gap: 6,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 10.5,
                            fontWeight: 700,
                            letterSpacing: "0.14em",
                            textTransform: "uppercase",
                            color: "var(--faint)",
                            paddingLeft: 2,
                          }}
                        >
                          Appearance
                        </span>
                        <ThemeSwitch compact />
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="sw-btn sw-btn-ghost"
                  onClick={() => handleOpenAuth("login")}
                >
                  Log In
                </button>
                <button
                  type="button"
                  className="sw-btn sw-btn-em"
                  onClick={() => handleOpenAuth("signup")}
                >
                  Sign Up
                </button>
              </>
            )}
          </div>

          <button
            type="button"
            className={`burger ${drawerOpen ? "open" : ""}`}
            aria-label={drawerOpen ? "Close menu" : "Open menu"}
            aria-expanded={drawerOpen}
            onClick={toggleBurger}
          >
            <i />
            <i />
            <i />
          </button>
        </div>
      </nav>

      <div className={`sw-drawer ${drawerOpen ? "open" : ""}`}>
        <Link className="dl" to="/ship" onClick={handleShipClick}>
          Ship Now <span>→</span>
        </Link>
        <Link className="dl" to="/quote" onClick={() => setDrawerOpen(false)}>
          Get a Quote <span>→</span>
        </Link>
        <Link className="dl" to="/track" onClick={() => setDrawerOpen(false)}>
          Track Shipment <span>→</span>
        </Link>
        <Link
          className="dl"
          to="/business-shipping"
          onClick={() => setDrawerOpen(false)}
        >
          Business Shipping <span>→</span>
        </Link>
        <Link
          className="dl"
          to="/#services"
          onClick={() => setDrawerOpen(false)}
        >
          Services <span>→</span>
        </Link>
        <Link
          className="dl"
          to="/#how-it-works"
          onClick={() => setDrawerOpen(false)}
        >
          How It Works <span>→</span>
        </Link>
        <button
          type="button"
          className="dl"
          style={{
            background: "transparent",
            borderTop: "none",
            borderLeft: "none",
            borderRight: "none",
            borderBottom: "1px solid var(--border2)",
            textAlign: "left",
          }}
          onClick={() => {
            setDrawerOpen(false);
            openContact();
          }}
        >
          Contact Support <span>→</span>
        </button>

        {user ? (
          <div className="dcta">
            <Link
              to="/dashboard"
              className="sw-btn sw-btn-em sw-btn-lg"
              onClick={() => setDrawerOpen(false)}
            >
              Dashboard{totalBadge > 0 ? ` (${totalBadge})` : ""}
            </Link>
            <button
              type="button"
              className="sw-btn sw-btn-ghost sw-btn-lg"
              onClick={handleSignOut}
            >
              Sign out
            </button>
          </div>
        ) : (
          <div className="dcta">
            <button
              type="button"
              className="sw-btn sw-btn-ghost sw-btn-lg"
              onClick={() => handleOpenAuth("login")}
            >
              Log In
            </button>
            <button
              type="button"
              className="sw-btn sw-btn-em sw-btn-lg"
              onClick={() => handleOpenAuth("signup")}
            >
              Sign Up
            </button>
          </div>
        )}

        <div
          style={{
            marginTop: 22,
            paddingTop: 18,
            borderTop: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "var(--faint)",
            }}
          >
            Appearance
          </span>
          <ThemeSwitch compact />
        </div>
      </div>
    </>
  );
}
