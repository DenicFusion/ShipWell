import React from "react";
import { Link } from "react-router-dom";
import { Compass, PackageSearch } from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { ShipwellLogo } from "@/components/ShipwellLogo";
import { adminPath, getPublicOrigin } from "@/lib/host";

export default function NotFoundPage({ adminMode = false }: { adminMode?: boolean }) {
  if (adminMode) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6">
        <div className="panel" style={{ maxWidth: 440, width: "100%", padding: "32px 26px", textAlign: "center" }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
            <ShipwellLogo />
          </div>
          <div className="au-t">404 · PAGE NOT FOUND</div>
          <p className="au-r" style={{ marginBottom: 20 }}>
            That admin route does not exist or has moved.
          </p>
          <div style={{ display: "grid", gap: 10 }}>
            <Link to={adminPath("")} className="sw-btn sw-btn-em sw-btn-block">
              Back to Admin Overview
            </Link>
            <a href={getPublicOrigin()} className="sw-btn sw-btn-ghost sw-btn-block">
              Open Public Website
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="sw-main flex-1">
        <div className="wrap" style={{ padding: "84px 18px 110px" }}>
          <div
            className="panel"
            style={{
              maxWidth: 500,
              margin: "0 auto",
              padding: "36px 28px",
              textAlign: "center",
            }}
          >
            <div className="au-ic" style={{ marginInline: "auto" }}>
              <Compass className="w-6 h-6" />
            </div>
            <div className="au-t" style={{ marginTop: 12 }}>
              404 · ROUTE NOT FOUND
            </div>
            <p className="au-r" style={{ marginBottom: 24 }}>
              The page you requested could not be found. Check the address or jump back to tracking or shipping.
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
              <Link to="/" className="sw-btn sw-btn-em">
                Back to Home
              </Link>
              <Link to="/track" className="sw-btn sw-btn-ghost">
                <PackageSearch className="w-4 h-4" />
                Track a Parcel
              </Link>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
