import React from "react";
import { Truck } from "lucide-react";

export function ShipwellLogo({
  subtitle = "Track · Deliver · Repeat",
  subtitleAmber = false,
  className = "",
}: {
  subtitle?: string;
  subtitleAmber?: boolean;
  className?: string;
}) {
  return (
    <span className={`sw-logo ${className}`}>
      <span className="sw-logo-mark" aria-hidden="true">
        <Truck className="w-5 h-5" />
      </span>
      <span>
        <span className="sw-logo-t">ShipWell</span>
        <span
          className="sw-logo-s"
          style={subtitleAmber ? { color: "var(--amber)" } : undefined}
        >
          {subtitle}
        </span>
      </span>
    </span>
  );
}