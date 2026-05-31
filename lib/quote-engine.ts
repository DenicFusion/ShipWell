export interface QuoteInput {
  originCountry: string;
  destinationCountry: string;
  weightKg: number;
  serviceType: string;
  declaredValue?: number;
}

export interface QuoteResult {
  serviceType: string;
  basePrice: number;
  fuelSurcharge: number;
  tax: number;
  total: number;
  estimatedDays: string;
  currency: string;
}

const SERVICE_BASE: Record<string, number> = {
  "Same-Day":     80,
  "Express (1-2d)": 48,
  "Standard (3-5d)": 28,
  "Economy (5-7d)": 16,
  "Freight":      10,
};

const SERVICE_DAYS: Record<string, string> = {
  "Same-Day":     "Same day",
  "Express (1-2d)": "1-2 business days",
  "Standard (3-5d)": "3-5 business days",
  "Economy (5-7d)": "5-7 business days",
  "Freight":      "7-14 business days",
};

export function calculateQuote(input: QuoteInput): QuoteResult {
  const isInternational = input.originCountry !== input.destinationCountry;
  const base = SERVICE_BASE[input.serviceType] ?? 28;
  const perKg = input.serviceType === "Freight" ? 3.2 : 5.8;
  const internationalFee = isInternational ? 18 : 0;
  const subtotal = base + (input.weightKg * perKg) + internationalFee;
  const fuel = subtotal * 0.05;  // 5% fuel surcharge
  const tax = (subtotal + fuel) * 0.085;  // 8.5% tax
  const total = subtotal + fuel + tax;

  return {
    serviceType: input.serviceType,
    basePrice: parseFloat(subtotal.toFixed(2)),
    fuelSurcharge: parseFloat(fuel.toFixed(2)),
    tax: parseFloat(tax.toFixed(2)),
    total: parseFloat(total.toFixed(2)),
    estimatedDays: SERVICE_DAYS[input.serviceType] ?? "3-5 business days",
    currency: "USD",
  };
}
