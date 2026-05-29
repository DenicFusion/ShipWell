import { ShipmentStatus, EventCode } from '@/types/tracking';

export const mockShipments = [
  {
    id: "clx123",
    trackingNumber: "9400111899223450980545",
    carrier: "USPS",
    status: ShipmentStatus.IN_TRANSIT,
    originCity: "Denver",
    originState: "CO",
    originZip: "80201",
    destCity: "Los Angeles",
    destState: "CA",
    destZip: "90001",
    recipientName: "John Doe",
    estimatedDelivery: new Date(Date.now() + 86400000 * 2), // +2 days
    deliveredAt: null,
    createdAt: new Date(Date.now() - 86400000 * 3), // -3 days
    updatedAt: new Date(),
    events: [
      {
        id: "evt1",
        eventCode: EventCode.LABEL_CREATED,
        facilityName: null,
        city: "Denver",
        state: "CO",
        zip: "80201",
        country: "US",
        description: "Shipping label created, USPS awaiting item",
        isLogical: false,
        occurredAt: new Date(Date.now() - 86400000 * 3)
      },
      {
        id: "evt2",
        eventCode: EventCode.ORIGIN_ACCEPTANCE,
        facilityName: "DENVER POST OFFICE",
        city: "Denver",
        state: "CO",
        zip: "80202",
        country: "US",
        description: "USPS in possession of item",
        isLogical: false,
        occurredAt: new Date(Date.now() - 86400000 * 2.8)
      },
      {
        id: "evt3",
        eventCode: EventCode.ARRIVED_AT_REGIONAL,
        facilityName: "DENVER CO DISTRIBUTION CENTER",
        city: "Denver",
        state: "CO",
        zip: "80266",
        country: "US",
        description: "Arrived at USPS Regional Facility",
        isLogical: false,
        occurredAt: new Date(Date.now() - 86400000 * 2.5)
      },
      {
        id: "evt4",
        eventCode: EventCode.DEPARTED_REGIONAL,
        facilityName: "DENVER CO DISTRIBUTION CENTER",
        city: "Denver",
        state: "CO",
        zip: "80266",
        country: "US",
        description: "Departed USPS Regional Facility",
        isLogical: false,
        occurredAt: new Date(Date.now() - 86400000 * 2.2)
      },
      {
        id: "evt5",
        eventCode: EventCode.IN_TRANSIT,
        facilityName: null,
        city: null,
        state: null,
        zip: null,
        country: "US",
        description: "In Transit to Next Facility",
        isLogical: true,
        occurredAt: new Date(Date.now() - 86400000 * 1.5)
      },
      {
        id: "evt6",
        eventCode: EventCode.ARRIVED_AT_FACILITY,
        facilityName: "LOS ANGELES CA DISTRIBUTION CENTER",
        city: "Los Angeles",
        state: "CA",
        zip: "90052",
        country: "US",
        description: "Arrived at USPS Facility",
        isLogical: false,
        occurredAt: new Date(Date.now() - 86400000 * 0.5)
      }
    ]
  }
];
