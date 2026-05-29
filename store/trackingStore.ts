import { create } from 'zustand';
import { ShipmentData } from '@/types/tracking';

interface TrackingState {
  currentShipment: ShipmentData | null;
  setShipment: (shipment: ShipmentData) => void;
  clearShipment: () => void;
  recentSearches: string[];
  addSearch: (trackingNumber: string) => void;
}

export const useTrackingStore = create<TrackingState>((set) => ({
  currentShipment: null,
  setShipment: (shipment) => set({ currentShipment: shipment }),
  clearShipment: () => set({ currentShipment: null }),
  recentSearches: [],
  addSearch: (trackingNumber) => set((state) => {
    const updated = [trackingNumber, ...state.recentSearches.filter(t => t !== trackingNumber)].slice(0, 5);
    return { recentSearches: updated };
  }),
}));
