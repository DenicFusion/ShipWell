"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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
  const pathname = usePathname();
  const router = useRouter();
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
    const onClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("click", onClickOutside);
    return () => document.removeEventListener("click", onClickOutside);
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
      router.push("/");
    }
  };

  return (
    <>
      <nav className={`sw-nav ${scrolled ? "scrolled" : ""}`}>
        <Link href="/" onClick={() => setDrawerOpen(false)}>
          <ShipwellLogo />
        </Link>

        <ul className="sw-nav-links">
          <li>
            <Link href="/#services" className={pathname === "/" ? "" : ""}>
              Services
            </Link>
          </li>
          <li>
            <Link href="/#how-it-works">How It Works</Link>
          </li>
          <li>
            <Link
              href="/quote"
              className={pathname.startsWith("/quote") ? "on" : ""}
            >
              Get a Quote
            </Link>
          </li>
          <li>
            <Link
              href="/business-shipping"
              className={pathname.startsWith("/business-shipping") ? "on" : ""}
            >
              Business
            </Link>
          </li>
          <li>
            <Link
              href="/track"
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
                  href="/dashboard"
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
                        href="/dashboard"
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
                          href="/admin"
                          onClick={() => setMenuOpen(false)}
                        >
                          <ShieldCheck className="w-4 h-4 text-amber-400" />
                          <span>Admin panel</span>
                        </Link>
                      )}
                      <Link href="/ship" onClick={() => setMenuOpen(false)}>
                        <Package className="w-4 h-4" />
                        <span>Ship a parcel</span>
                      </Link>
                      <Link href="/track" onClick={() => setMenuOpen(false)}>
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
                  onClick={() => openAuth({ mode: "login" })}
                >
                  Log In
                </button>
                <button
                  type="button"
                  className="sw-btn sw-btn-em"
                  onClick={() => openAuth({ mode: "signup" })}
                >
                  Sign Up
                </button>
              </>
            )}
          </div>

          <button
            type="button"
            className={`burger ${drawerOpen ? "open" : ""}`}
            aria-label="Menu"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen((p) => !p)}
          >
            <i />
            <i />
            <i />
          </button>
        </div>
      </nav>

      <div className={`sw-drawer ${drawerOpen ? "open" : ""}`}>
        <Link className="dl" href="/ship" onClick={() => setDrawerOpen(false)}>
          Ship Now <span>→</span>
        </Link>
        <Link
          className="dl"
          href="/quote"
          onClick={() => setDrawerOpen(false)}
        >
          Get a Quote <span>→</span>
        </Link>
        <Link
          className="dl"
          href="/track"
          onClick={() => setDrawerOpen(false)}
        >
          Track Shipment <span>→</span>
        </Link>
        <Link
          className="dl"
          href="/business-shipping"
          onClick={() => setDrawerOpen(false)}
        >
          Business Shipping <span>→</span>
        </Link>
        <Link
          className="dl"
          href="/#services"
          onClick={() => setDrawerOpen(false)}
        >
          Services <span>→</span>
        </Link>
        <Link
          className="dl"
          href="/#how-it-works"
          onClick={() => setDrawerOpen(false)}
        >
          How It Works <span>→</span>
        </Link>

        {user ? (
          <div className="dcta">
            <Link
              href="/dashboard"
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
              onClick={() => {
                setDrawerOpen(false);
                openAuth({ mode: "login" });
              }}
            >
              Log In
            </button>
            <button
              type="button"
              className="sw-btn sw-btn-em sw-btn-lg"
              onClick={() => {
                setDrawerOpen(false);
                openAuth({ mode: "signup" });
              }}
            >
              Sign Up
            </button>
          </div>
        )}
      </div>
    </>
  );
}
