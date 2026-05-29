import { NextRequest, NextResponse } from "next/server"
import { TrackingNumberSchema } from "@/types/tracking"
import { mockShipments } from "@/lib/mock-data"
import { format } from "date-fns"
import { getStatusColor, getEventLabel } from "@/lib/tracking-utils"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ trackingId: string }> }
) {
  try {
    const { trackingId } = await params;
    
    // 1. Validate with Zod
    const validationResult = TrackingNumberSchema.safeParse(trackingId)
    if (!validationResult.success) {
      return NextResponse.json({ error: "Invalid tracking format" }, { status: 422 })
    }

    // Simulate network delay for loading state
    await new Promise(resolve => setTimeout(resolve, 800));

    // 2. Query Data (Fallback to Mock for Sandbox)
    const shipment = mockShipments.find(s => s.trackingNumber === trackingId.toUpperCase());
    
    if (!shipment) {
      return NextResponse.json({ error: "Shipment not found" }, { status: 404 })
    }

    // 3. Serialize Data
    const sortedEvents = [...shipment.events].sort(
      (a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()
    );

    const serialized = {
      trackingNumber: shipment.trackingNumber,
      carrier: shipment.carrier,
      status: shipment.status,
      estimatedDelivery: shipment.estimatedDelivery ? shipment.estimatedDelivery.toISOString() : null,
      origin: {
        city: shipment.originCity,
        state: shipment.originState,
        zip: shipment.originZip,
      },
      destination: {
        city: shipment.destCity,
        state: shipment.destState,
        zip: shipment.destZip,
      },
      events: sortedEvents.map((evt, index) => ({
        id: evt.id,
        eventCode: evt.eventCode,
        label: getEventLabel(evt.eventCode),
        description: evt.description,
        facility: evt.facilityName,
        location: evt.city || evt.zip ? `${evt.city ? evt.city : ''}${evt.city && evt.state ? ', ' : ''}${evt.state ? evt.state : ''} ${evt.zip ? evt.zip : ''}`.trim() : null,
        occurredAt: evt.occurredAt.toISOString(),
        formattedDate: format(evt.occurredAt, "MMMM d, yyyy"),
        formattedTime: format(evt.occurredAt, "h:mm a").toLowerCase(),
        statusColor: getStatusColor(evt.eventCode),
        isLatest: index === 0,
        isLogical: evt.isLogical,
      }))
    };

    return NextResponse.json(serialized, { status: 200 })
    
  } catch (error) {
    console.error("API Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
