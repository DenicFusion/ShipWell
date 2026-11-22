import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { useShipWell } from "@/components/providers/ShipWellProvider";
import { ShipWizard } from "@/components/ship/ShipWizard";

export default function ShipPage() {
  const { user, authReady } = useShipWell();
  const location = useLocation();

  if (authReady && user) {
    return <Navigate to={`/dashboard/ship${location.search}`} replace />;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="sw-main ship flex-1">
        <ShipWizard embedded={false} />
      </main>
      <Footer />
    </div>
  );
}
