'use client';
import { ShipmentSummaryCard } from "@/components/tracking/ShipmentSummaryCard"
import { TrackingTimeline } from "@/components/tracking/TrackingTimeline"
import { ShipmentData, ShipmentStatus } from "@/types/tracking"
import { useParams } from "next/navigation"

const MOCK_DATA: ShipmentData = {
  status: ShipmentStatus.IN_TRANSIT,
  carrier: "USPS",
  trackingNumber: "SW9483021948",
  estimatedDelivery: new Date(Date.now() + 86400000 * 2).toISOString(),
  origin: { city: "Los Angeles", state: "CA", zip: "90001" },
  destination: { city: "New York", state: "NY", zip: "10001" },
  events: [
    {
      id: "1",
      isLatest: true,
      isLogical: false,
      statusColor: "bg-brand-primary",
      eventCode: "IN_TRANSIT",
      label: "In Transit to Next Facility",
      description: "Package is moving within the USPS network.",
      facility: "Sortation Center",
      location: "Denver, CO",
      formattedDate: "Today",
      formattedTime: "08:42 AM"
    },
    {
      id: "2",
      isLatest: false,
      isLogical: false,
      statusColor: "bg-brand-primary",
      eventCode: "ARRIVED",
      label: "Arrived at Facility",
      description: "Package arrived at regional hub.",
      facility: "Regional Facility",
      location: "Los Angeles, CA",
      formattedDate: "Yesterday",
      formattedTime: "11:30 PM"
    },
    {
      id: "3",
      isLatest: false,
      isLogical: false,
      statusColor: "bg-brand-primary",
      eventCode: "PICKUP",
      label: "Shipment Picked Up",
      description: "Carrier has received the package from the sender.",
      location: "Sender Location",
      formattedDate: "Yesterday",
      formattedTime: "04:15 PM"
    }
  ]
}

export default function TrackingPage() {
  const params = useParams()
  const data = { ...MOCK_DATA, trackingNumber: ((params.trackingId as string) || "SW9483021948").toUpperCase() };

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