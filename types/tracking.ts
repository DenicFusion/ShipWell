import { z } from 'zod';

export const TrackingNumberSchema = z.string().min(10).max(30).regex(/^[A-Z0-9]+$/);

export enum ShipmentStatus {
  PRE_SHIPMENT = 'PRE_SHIPMENT',
  ACCEPTED = 'ACCEPTED',
  IN_TRANSIT = 'IN_TRANSIT',
  OUT_FOR_DELIVERY = 'OUT_FOR_DELIVERY',
  DELIVERED = 'DELIVERED',
  EXCEPTION = 'EXCEPTION',
  RETURNED = 'RETURNED'
}

export enum EventCode {
  LABEL_CREATED = 'LABEL_CREATED',
  ORIGIN_ACCEPTANCE = 'ORIGIN_ACCEPTANCE',
  ARRIVED_AT_FACILITY = 'ARRIVED_AT_FACILITY',
  DEPARTED_FACILITY = 'DEPARTED_FACILITY',
  IN_TRANSIT = 'IN_TRANSIT',
  ARRIVED_AT_REGIONAL = 'ARRIVED_AT_REGIONAL',
  DEPARTED_REGIONAL = 'DEPARTED_REGIONAL',
  ARRIVED_AT_UNIT = 'ARRIVED_AT_UNIT',
  OUT_FOR_DELIVERY = 'OUT_FOR_DELIVERY',
  DELIVERY_ATTEMPTED = 'DELIVERY_ATTEMPTED',
  DELIVERED = 'DELIVERED',
  EXCEPTION = 'EXCEPTION',
  RETURN_TO_SENDER = 'RETURN_TO_SENDER'
}

export interface TrackingEventData {
  id: string;
  eventCode: EventCode;
  label: string;
  description: string;
  facility: string | null;
  location: string | null;
  occurredAt: string;
  formattedDate: string;
  formattedTime: string;
  statusColor: string;
  isLatest: boolean;
  isLogical: boolean;
}

export interface ShipmentData {
  trackingNumber: string;
  carrier: string;
  status: ShipmentStatus;
  estimatedDelivery: string | null;
  origin: { city: string; state: string; zip: string; };
  destination: { city: string; state: string; zip: string; };
  events: TrackingEventData[];
}
