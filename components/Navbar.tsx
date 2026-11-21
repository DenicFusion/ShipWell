import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  LogOut,
  Package,
  Search,
  ShieldCheck,
} from "lucide-react";
import { ShipwellLogo } from "@/components/ShipwellLogo";
import { useShipWell } from "@/components/providers/ShipWellProvider";
import { getInitials } from "@/types/tracking";
import toast from "react-hot-toast";

export function Navbar() {
  const location = useLocation();
  const pathname = location.pathname;
  const navigate = useNavigate();
  const { user, profile, isAdmin, openAlertsCount, openAuth, signOutUser } =
    useShipWell();
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
                  {openAlertsCount > 0 && (
                    <span className="nbadge">{openAlertsCount}</span>
                  )}
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
                    {openAlertsCount > 0 && <span className="dotb" />}
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
                          {openAlertsCount > 0 && `(${openAlertsCount})`}
                        </span>
                      </Link>
                      {isAdmin && (
                        <Link
                          to="/admin"
                          onClick={() => setMenuOpen(false)}
                        >
                          <ShieldCheck className="w-4 h-4 text-amber-400" />
                          <span>Admin panel</span>
                        </Link>
                      )}
                      <Link to="/ship" onClick={() => setMenuOpen(false)}>
                        <Package className="w-4 h-4" />
                        <span>Ship a parcel</span>
                      </Link>
                      <Link to="/track" onClick={() => setMenuOpen(false)}>
                        <Search className="w-4 h-4" />
                        <span>Track a shipment</span>
                      </Link>
                      <button type="button" onClick={handleSignOut}>
                        <LogOut className="w-4 h-4" />
                        <span>Sign out</span>
                      </button>
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
        <Link className="dl" to="/ship" onClick={() => setDrawerOpen(false)}>
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

        {user ? (
          <div className="dcta">
            <Link
              to="/dashboard"
              className="sw-btn sw-btn-em sw-btn-lg"
              onClick={() => setDrawerOpen(false)}
            >
              Dashboard{openAlertsCount > 0 ? ` (${openAlertsCount})` : ""}
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
      </div>
    </>
  );
}
