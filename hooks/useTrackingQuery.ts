import { useQuery } from '@tanstack/react-query';
import { ShipmentData } from '@/types/tracking';

async function fetchTracking(trackingId: string): Promise<ShipmentData> {
  const res = await fetch(`/api/track/${trackingId}`);
  if (!res.ok) {
    if (res.status === 404) throw new Error('Shipment not found');
    throw new Error('Failed to fetch tracking data');
  }
  return res.json();
}

export function useTrackingQuery(trackingId: string) {
  return useQuery({
    queryKey: ['tracking', trackingId],
    queryFn: () => fetchTracking(trackingId),
    enabled: !!trackingId,
    retry: 1,
    staleTime: 30000, // 30 seconds
  });
}
