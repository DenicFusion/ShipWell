import React, { Suspense } from "react";
import { TrackingView } from "@/components/tracking/TrackingView";

export default function TrackIndexPage() {
  return (
    <Suspense
      fallback={
        <div className="wrap py-24 text-center text-[var(--muted)]">
          Loading tracking lookup...
        </div>
      }
    >
      <TrackingView />
    </Suspense>
  );
}
