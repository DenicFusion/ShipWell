import { EventCode, ShipmentStatus } from '@/types/tracking';

export function getStatusColor(status: ShipmentStatus | EventCode): string {
  switch (status) {
    case ShipmentStatus.DELIVERED:
    case EventCode.DELIVERED:
      return 'text-[#10B981] border-[#10B981]'; // Success green
    case ShipmentStatus.EXCEPTION:
    case ShipmentStatus.RETURNED:
    case EventCode.EXCEPTION:
    case EventCode.RETURN_TO_SENDER:
      return 'text-[#EF4444] border-[#EF4444]'; // Danger red
    case ShipmentStatus.IN_TRANSIT:
    case ShipmentStatus.OUT_FOR_DELIVERY:
    case EventCode.IN_TRANSIT:
    case EventCode.OUT_FOR_DELIVERY:
    case EventCode.ARRIVED_AT_FACILITY:
    case EventCode.DEPARTED_FACILITY:
    case EventCode.ARRIVED_AT_REGIONAL:
    case EventCode.DEPARTED_REGIONAL:
    case EventCode.ARRIVED_AT_UNIT:
      return 'text-[#F59E0B] border-[#F59E0B]'; // Amber in transit
    default:
      return 'text-[#64748B] border-[#64748B]'; // Slate for initial
  }
}

export function getEventLabel(code: EventCode): string {
  const map: Record<EventCode, string> = {
    [EventCode.LABEL_CREATED]: 'Shipping Label Created',
    [EventCode.ORIGIN_ACCEPTANCE]: 'Accepted at Origin Facility',
    [EventCode.ARRIVED_AT_FACILITY]: 'Arrived at Facility',
    [EventCode.DEPARTED_FACILITY]: 'Departed Facility',
    [EventCode.IN_TRANSIT]: 'In Transit',
    [EventCode.ARRIVED_AT_REGIONAL]: 'Arrived at Regional Facility',
    [EventCode.DEPARTED_REGIONAL]: 'Departed Regional Facility',
    [EventCode.ARRIVED_AT_UNIT]: 'Arrived at Post Office',
    [EventCode.OUT_FOR_DELIVERY]: 'Out for Delivery',
    [EventCode.DELIVERY_ATTEMPTED]: 'Delivery Attempted',
    [EventCode.DELIVERED]: 'Delivered',
    [EventCode.EXCEPTION]: 'Processing Exception',
    [EventCode.RETURN_TO_SENDER]: 'Returned to Sender'
  };
  return map[code] || 'Unknown Event';
}
