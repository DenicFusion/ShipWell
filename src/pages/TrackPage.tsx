import React from "react";
import { useParams } from "react-router-dom";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { TrackingView } from "@/components/tracking/TrackingView";

export default function TrackPage() {
  const { trackingId } = useParams<{ trackingId?: string }>();
  const decoded = trackingId ? decodeURIComponent(trackingId) : "";

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="sw-main flex-1">
        <TrackingView initialCode={decoded} />
      </main>
      <Footer />
    </div>
  );
}
