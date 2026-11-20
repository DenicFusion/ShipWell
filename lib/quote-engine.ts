import type { ServiceTier } from "@/types/tracking";

export interface PlaceInfo {
  city: string;
  lat: number;
  lon: number;
}

export const PLACES: Record<string, PlaceInfo> = {
  Nigeria: { city: "Lagos", lat: 6.52, lon: 3.38 },
  Ghana: { city: "Accra", lat: 5.6, lon: -0.19 },
  "South Africa": { city: "Johannesburg", lat: -26.2, lon: 28.04 },
  Kenya: { city: "Nairobi", lat: -1.29, lon: 36.82 },
  "United Kingdom": { city: "London", lat: 51.51, lon: -0.13 },
  Germany: { city: "Berlin", lat: 52.52, lon: 13.4 },
  France: { city: "Paris", lat: 48.86, lon: 2.35 },
  "United Arab Emirates": { city: "Dubai", lat: 25.2, lon: 55.27 },
  India: { city: "Mumbai", lat: 19.08, lon: 72.88 },
  China: { city: "Shanghai", lat: 31.23, lon: 121.47 },
  Japan: { city: "Tokyo", lat: 35.68, lon: 139.69 },
  Australia: { city: "Sydney", lat: -33.87, lon: 151.21 },
  "United States": { city: "New York", lat: 40.71, lon: -74.01 },
  Canada: { city: "Toronto", lat: 43.65, lon: -79.38 },
};

export const COUNTRIES = Object.keys(PLACES);

export const SERVICES: Record<
  ServiceTier,
  { name: string; mult: number; blurb: string; popular?: boolean }
> = {
  economy: {
    name: "Economy",
    mult: 0.55,
    blurb: "Consolidated road & sea · best for non-urgent parcels",
  },
  standard: {
    name: "Standard",
    mult: 1,
    blurb: "Air + road with milestone tracking · our most popular",
    popular: true,
  },
  express: {
    name: "Express",
    mult: 1.85,
    blurb: "Priority air, door-to-door · insured & signature on delivery",
  },
};

export interface ShippingQuote {
  service: ServiceTier;
  base: number;
  fuel: number;
  cover: number;
  duty: number;
  total: number;
  days: [number, number];
  dist: number;
  intl: boolean;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function distanceKm(a: PlaceInfo, b: PlaceInfo): number {
  const R = 6371;
  const d = Math.PI / 180;
  const dLat = (b.lat - a.lat) * d;
  const dLon = (b.lon - a.lon) * d;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * d) * Math.cos(b.lat * d) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function calculateShippingPricing(
  from: string,
  to: string,
  kg: number,
  declaredValue: number,
  svc: ServiceTier
): ShippingQuote {
  const A = PLACES[from] ?? PLACES.Nigeria;
  const B = PLACES[to] ?? PLACES.Germany;
  const intl = from !== to;
  const dist = intl ? distanceKm(A, B) : 120;
  const perKg = 1.9 + dist / 3800;
  const base = r2((8 + Math.max(kg, 0.1) * perKg) * SERVICES[svc].mult);
  const fuel = r2(base * 0.12);
  const cover = r2(Math.max(2.5, (declaredValue || 0) * 0.008));
  const duty = intl ? r2(base * 0.08) : 0;
  const total = r2(base + fuel + cover + duty);

  let days: [number, number];
  if (!intl) {
    days = { express: [1, 1], standard: [1, 2], economy: [3, 4] }[svc] as [
      number,
      number,
    ];
  } else if (svc === "express") {
    const d = Math.max(1, Math.ceil(1 + dist / 9000));
    days = [d, d + 1];
  } else if (svc === "standard") {
    const d = Math.ceil(2 + dist / 3500);
    days = [d, d + 2];
  } else {
    const d = Math.ceil(5 + dist / 1800);
    days = [d, d + 3];
  }

  return {
    service: svc,
    base,
    fuel,
    cover,
    duty,
    total,
    days,
    dist: Math.round(dist),
    intl,
  };
}

export function addBusinessDays(date: Date | number, count: number): Date {
  const d = new Date(date);
  let remaining = count;
  while (remaining > 0) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() % 6 !== 0) remaining--;
  }
  return d;
}

export function formatMoney(n: number): string {
  return (
    "$" +
    Number(n || 0).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

export function formatShortDay(d: Date | number): string {
  return new Date(d).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

export function formatDateTime(ts: number): string {
  const d = new Date(ts);
  return (
    formatShortDay(d) +
    " · " +
    d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
  );
}
