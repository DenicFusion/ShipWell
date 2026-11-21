import React from "react";
import { Link } from "react-router-dom";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Shield } from "lucide-react";

export default function LegalPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />

      <main className="sw-main flex-1">
        <div className="wrap" style={{ paddingBottom: 90 }}>
          <div className="phead">
            <div className="eyebrow">Trust &amp; Governance</div>
            <h1>
              LEGAL &amp;
              <br />
              CARRIAGE TERMS
            </h1>
            <p>
              Policies governing ShipWell carriage bookings, recipient privacy,
              and shipment verification.
            </p>
          </div>

          <div style={{ display: "grid", gap: 18, maxWidth: 820 }}>
            <section id="terms" className="panel">
              <div className="panel-h">
                <div className="pi">
                  <Shield className="w-4 h-4" />
                </div>
                <div>
                  <b>Terms of Use &amp; Carriage</b>
                  <small>Effective 2026 · ShipWell Logistics Ltd.</small>
                </div>
              </div>
              <div className="panel-b" style={{ color: "var(--muted)", fontSize: 14, lineHeight: 1.7 }}>
                <p>
                  All shipments booked on ShipWell require accurate sender and
                  recipient contact information, declared contents, and 1–4 item
                  inspection photographs. ShipWell operations reserves the right
                  to inspect, hold, or request additional documentation for
                  customs compliance before dispatch.
                </p>
              </div>
            </section>

            <section id="privacy" className="panel">
              <div className="panel-h">
                <div className="pi">
                  <Shield className="w-4 h-4" />
                </div>
                <div>
                  <b>Privacy Policy</b>
                  <small>PII isolation &amp; recipient verification</small>
                </div>
              </div>
              <div className="panel-b" style={{ color: "var(--muted)", fontSize: 14, lineHeight: 1.7 }}>
                <p>
                  Public tracking queries expose only route cities, status,
                  service tier, weight, estimated delivery, and the latest
                  checkpoint summary. Item photographs, full street addresses,
                  and action alerts are strictly restricted to the verified
                  sender, the verified recipient matching the booking email, and
                  authorized ShipWell operations administrators.
                </p>
              </div>
            </section>

            <section id="cookies" className="panel">
              <div className="panel-h">
                <div className="pi">
                  <Shield className="w-4 h-4" />
                </div>
                <div>
                  <b>Cookie &amp; Session Policy</b>
                  <small>Authentication &amp; essential storage</small>
                </div>
              </div>
              <div className="panel-b" style={{ color: "var(--muted)", fontSize: 14, lineHeight: 1.7 }}>
                <p>
                  ShipWell uses strictly essential session tokens for Firebase
                  Authentication and fraud prevention. We do not sell customer
                  tracking data or serve third-party advertising trackers.
                </p>
              </div>
            </section>

            <section id="fraud" className="panel">
              <div className="panel-h">
                <div className="pi">
                  <Shield className="w-4 h-4" />
                </div>
                <div>
                  <b>Fraud Awareness</b>
                  <small>Protecting recipients and senders</small>
                </div>
              </div>
              <div className="panel-b" style={{ color: "var(--muted)", fontSize: 14, lineHeight: 1.7 }}>
                <p>
                  Genuine ShipWell tracking codes follow the uppercase format{" "}
                  <code className="mono text-[var(--em)]">SW-YYYYMMDD-XXXXXXXX</code>
                  . If you receive an unexpected parcel invitation, click{" "}
                  &ldquo;I don&apos;t know this sender&rdquo; at the bottom of the
                  email to pause notifications and flag the booking for review.
                </p>
              </div>
            </section>

            <div>
              <Link to="/" className="sw-btn sw-btn-ghost">
                ← Back to ShipWell Home
              </Link>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
