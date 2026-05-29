'use client';

import { useTrackingQuery } from "@/hooks/useTrackingQuery"
import { ShipmentSummaryCard } from "@/components/tracking/ShipmentSummaryCard"
import { TrackingTimeline } from "@/components/tracking/TrackingTimeline"
import Loading from "./loading"
import ErrorPage from "./error"
import { use, useEffect } from "react"
import { useTrackingStore } from "@/store/trackingStore"

export default function TrackingPage({ params }: { params: Promise<{ trackingId: string }> }) {
  const { trackingId } = use(params);
  const { data, isLoading, isError, error, refetch } = useTrackingQuery(trackingId);
  const setShipment = useTrackingStore(state => state.setShipment);

  useEffect(() => {
    if (data) {
      setShipment(data);
    }
  }, [data, setShipment]);

  if (isLoading) {
    return <Loading />;
  }

  if (isError || !data) {
    // We render the Error boundary-like UI here manually since client fetching errors 
    // won't trigger the Next.js error.tsx boundary properly unless thrown during render.
    return <ErrorPage error={error as Error || new Error("Not found")} reset={refetch} />;
  }

  return (
    <div className="w-full max-w-[1024px] mx-auto px-10 py-10">
      <div className="grid grid-cols-1 md:grid-cols-[360px_1fr] gap-10">
        <div className="md:col-span-1">
          <ShipmentSummaryCard shipment={data} />
        </div>
        <div className="md:col-span-1">
           <TrackingTimeline shipment={data} />
        </div>
      </div>
    </div>
  )
}
