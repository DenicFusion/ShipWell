export enum ShipmentStatus {
  IN_TRANSIT = "IN_TRANSIT",
  DELIVERED = "DELIVERED",
  EXCEPTION = "EXCEPTION",
  OUT_FOR_DELIVERY = "OUT_FOR_DELIVERY",
  RETURNED = "RETURNED"
}
export interface TrackingEventData {
  id: string;
  isLogical: boolean;
  isLatest: boolean;
  statusColor: string;
  eventCode: string;
  label: string;
  description: string;
  facility?: string;
  location?: string;
  formattedDate: string;
  formattedTime: string;
}
export interface ShipmentData {
  status: ShipmentStatus;
  carrier: string;
  trackingNumber: string;
  estimatedDelivery?: string;
  origin: { city: string; state: string; zip: string };
  destination: { city: string; state: string; zip: string };
  events: TrackingEventData[];
}