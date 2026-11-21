import React from "react";
import { Link } from "react-router-dom";
import { Globe, Mail, MapPin, Shield } from "lucide-react";
import { ShipwellLogo } from "@/components/ShipwellLogo";

export function Footer() {
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
                <Link to="/ship">Ship Now</Link>
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
                <Link to="/business-shipping#bizForm">Contact Sales</Link>
              </li>
              <li>
                <a href="mailto:support@shipwell.example">Email Operations</a>
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
            <a href="mailto:support@shipwell.example" aria-label="Email Support">
              <Mail className="w-4 h-4" />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
