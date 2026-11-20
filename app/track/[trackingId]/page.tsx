"use client";

import React, { Suspense, use } from "react";
import { TrackingView } from "@/components/tracking/TrackingView";

export default function TrackCodePage({
  params,
}: {
  params: Promise<{ trackingId: string }>;
}) {
  const { trackingId } = use(params);
  return (
    <Suspense
      fallback={
        <div className="wrap py-24 text-center text-[var(--muted)]">
          Loading shipment {trackingId}...
        </div>
      }
    >
      <TrackingView initialCode={decodeURIComponent(trackingId || "")} />
    </Suspense>
  );
}
