import { NextRequest, NextResponse } from "next/server";
import {
  COUNTRIES,
  calculateShippingPricing,
} from "@/lib/quote-engine";
import type { ServiceTier } from "@/types/tracking";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      from?: string;
      to?: string;
      weightKg?: number;
      declaredValue?: number;
      service?: ServiceTier;
    };

    const from = body.from && COUNTRIES.includes(body.from) ? body.from : "Nigeria";
    const to = body.to && COUNTRIES.includes(body.to) ? body.to : "Germany";
    const weightKg = Math.min(50000, Math.max(0.1, Number(body.weightKg) || 1));
    const declaredValue = Math.max(0, Number(body.declaredValue) || 0);
    const service: ServiceTier =
      body.service === "economy" ||
      body.service === "express" ||
      body.service === "standard"
        ? body.service
        : "standard";

    const quote = calculateShippingPricing(
      from,
      to,
      weightKg,
      declaredValue,
      service
    );
    return NextResponse.json({ quote });
  } catch {
    return NextResponse.json(
      { error: "Invalid quote payload." },
      { status: 400 }
    );
  }
}
