"use client";

import React from "react";
import Link from "next/link";
import { Globe, Mail, MapPin, Shield } from "lucide-react";
import { ShipwellLogo } from "@/components/ShipwellLogo";

export function Footer() {
  return (
    <footer className="sw-footer">
      <div className="wrap">
        <div className="fg">
          <div>
            <Link href="/">
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
                <Link href="/ship">Ship Now</Link>
              </li>
              <li>
                <Link href="/quote">Get a Quote</Link>
              </li>
              <li>
                <Link href="/#services">Express Delivery</Link>
              </li>
              <li>
                <Link href="/#services">Freight &amp; Cargo</Link>
              </li>
              <li>
                <Link href="/#services">Customs Brokerage</Link>
              </li>
            </ul>
          </div>

          <div>
            <h5>Company</h5>
            <ul>
              <li>
                <Link href="/#two-sides">How ShipWell Works</Link>
              </li>
              <li>
                <Link href="/#how-it-works">4-Step Process</Link>
              </li>
              <li>
                <Link href="/#testimonials">Customer Stories</Link>
              </li>
              <li>
                <Link href="/business-shipping">Business</Link>
              </li>
            </ul>
          </div>

          <div>
            <h5>Support</h5>
            <ul>
              <li>
                <Link href="/track">Track Package</Link>
              </li>
              <li>
                <Link href="/quote">Cost Calculator</Link>
              </li>
              <li>
                <Link href="/business-shipping#bizForm">Contact Sales</Link>
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
                <Link href="/legal#terms">Terms of Use</Link>
              </li>
              <li>
                <Link href="/legal#privacy">Privacy Policy</Link>
              </li>
              <li>
                <Link href="/legal#cookies">Cookie Policy</Link>
              </li>
              <li>
                <Link href="/legal#fraud">Fraud Awareness</Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="fb">
          <span>© 2026 ShipWell Logistics Ltd. All rights reserved.</span>
          <div className="soc">
            <Link href="/track" aria-label="Global Network Tracking">
              <Globe className="w-4 h-4" />
            </Link>
            <Link href="/quote" aria-label="Route Coverage">
              <MapPin className="w-4 h-4" />
            </Link>
            <Link href="/legal#fraud" aria-label="Security & Compliance">
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
