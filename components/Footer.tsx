import React from "react";
import { Link } from "react-router-dom";
import { Copy, Globe, Mail, MapPin, Shield } from "lucide-react";
import toast from "react-hot-toast";
import { ShipwellLogo } from "@/components/ShipwellLogo";
import { ThemeSwitch } from "@/components/ThemeSwitch";
import { useShipWell } from "@/components/providers/ShipWellProvider";

const SUPPORT_EMAIL = "support@info.shipwell.cc";

export function Footer() {
  const { user, openContact, requireAuthForShip } = useShipWell();

  const copySupport = async () => {
    try {
      await navigator.clipboard.writeText(SUPPORT_EMAIL);
      toast.success(`Copied ${SUPPORT_EMAIL}`);
    } catch {
      toast.error("Could not copy email");
    }
  };

  return (
    <footer className="sw-footer">
      <div className="wrap">
        <div className="fg">
          <div>
            <Link to="/">
              <ShipwellLogo />
            </Link>
            <p>
              The luxury logistics platform connecting people and businesses to
              every corner of the globe — with precision.
            </p>
          </div>

          <div>
            <h5>Services</h5>
            <ul>
              <li>
                <Link
                  to="/ship"
                  onClick={(e) => {
                    if (!user) {
                      e.preventDefault();
                      requireAuthForShip("/ship");
                    }
                  }}
                >
                  Ship Now
                </Link>
              </li>
              <li>
                <Link to="/quote">Get a Quote</Link>
              </li>
              <li>
                <Link to="/#services">Express Delivery</Link>
              </li>
              <li>
                <Link to="/#services">Freight &amp; Cargo</Link>
              </li>
              <li>
                <Link to="/#services">Customs Brokerage</Link>
              </li>
            </ul>
          </div>

          <div>
            <h5>Company</h5>
            <ul>
              <li>
                <Link to="/#two-sides">How ShipWell Works</Link>
              </li>
              <li>
                <Link to="/#how-it-works">4-Step Process</Link>
              </li>
              <li>
                <Link to="/#testimonials">Customer Stories</Link>
              </li>
              <li>
                <Link to="/business-shipping">Business</Link>
              </li>
            </ul>
          </div>

          <div>
            <h5>Support</h5>
            <ul>
              <li>
                <Link to="/track">Track Package</Link>
              </li>
              <li>
                <Link to="/quote">Cost Calculator</Link>
              </li>
              <li>
                <button
                  type="button"
                  className="fcontact"
                  onClick={() => openContact()}
                >
                  Contact Us
                </button>
              </li>
              <li>
                <Link to="/business-shipping#bizForm">Contact Sales</Link>
              </li>
              <li>
                <div className="flex items-center gap-2 flex-wrap">
                  <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
                  <button
                    type="button"
                    onClick={copySupport}
                    aria-label="Copy support email"
                    style={{
                      background: "transparent",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      padding: "2px 6px",
                      color: "var(--muted)",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      fontSize: 11,
                    }}
                  >
                    <Copy className="w-3 h-3" />
                    Copy
                  </button>
                </div>
              </li>
            </ul>
          </div>

          <div>
            <h5>Legal</h5>
            <ul>
              <li>
                <Link to="/legal#terms">Terms of Use</Link>
              </li>
              <li>
                <Link to="/legal#privacy">Privacy Policy</Link>
              </li>
              <li>
                <Link to="/legal#cookies">Cookie Policy</Link>
              </li>
              <li>
                <Link to="/legal#fraud">Fraud Awareness</Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="fb">
          <span>© 2026 ShipWell Logistics Ltd. All rights reserved.</span>

          <div className="flex items-center gap-3 flex-wrap">
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "var(--faint)",
              }}
            >
              Appearance
            </span>
            <div style={{ minWidth: 220 }}>
              <ThemeSwitch compact />
            </div>
          </div>

          <div className="soc">
            <Link to="/track" aria-label="Global Network Tracking">
              <Globe className="w-4 h-4" />
            </Link>
            <Link to="/quote" aria-label="Route Coverage">
              <MapPin className="w-4 h-4" />
            </Link>
            <Link to="/legal#fraud" aria-label="Security & Compliance">
              <Shield className="w-4 h-4" />
            </Link>
            <button
              type="button"
              onClick={() => openContact()}
              aria-label="Contact Support"
            >
              <Mail className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </footer>
  );
}
