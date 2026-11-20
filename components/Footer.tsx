"use client";

import React from "react";
import Link from "next/link";
import { Globe, Mail, MessageSquare, Share2 } from "lucide-react";
import { ShipwellLogo } from "@/components/ShipwellLogo";
import toast from "react-hot-toast";

export function Footer() {
  const handleComingSoon = (e: React.MouseEvent) => {
    e.preventDefault();
    toast("Documentation & support pages are handled through our operations desk.");
  };

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
                <a href="#about" onClick={handleComingSoon}>
                  About Us
                </a>
              </li>
              <li>
                <a href="#careers" onClick={handleComingSoon}>
                  Careers
                </a>
              </li>
              <li>
                <a href="#sustainability" onClick={handleComingSoon}>
                  Sustainability
                </a>
              </li>
              <li>
                <Link href="/business-shipping">Business</Link>
              </li>
              <li>
                <Link href="/admin">Admin Portal</Link>
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
                <Link href="/dashboard">Customer Dashboard</Link>
              </li>
              <li>
                <a href="#help" onClick={handleComingSoon}>
                  Help Center
                </a>
              </li>
              <li>
                <a href="#locations" onClick={handleComingSoon}>
                  Find a Location
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h5>Legal</h5>
            <ul>
              <li>
                <a href="#terms" onClick={handleComingSoon}>
                  Terms of Use
                </a>
              </li>
              <li>
                <a href="#privacy" onClick={handleComingSoon}>
                  Privacy Policy
                </a>
              </li>
              <li>
                <a href="#cookies" onClick={handleComingSoon}>
                  Cookie Policy
                </a>
              </li>
              <li>
                <a href="#fraud" onClick={handleComingSoon}>
                  Fraud Awareness
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="fb">
          <span>© 2026 ShipWell Logistics Ltd. All rights reserved.</span>
          <div className="soc">
            <a href="#globe" onClick={handleComingSoon} aria-label="Global Network">
              <Globe className="w-4 h-4" />
            </a>
            <a href="#share" onClick={handleComingSoon} aria-label="Share">
              <Share2 className="w-4 h-4" />
            </a>
            <a href="#support" onClick={handleComingSoon} aria-label="Messages">
              <MessageSquare className="w-4 h-4" />
            </a>
            <a href="#email" onClick={handleComingSoon} aria-label="Email Support">
              <Mail className="w-4 h-4" />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
