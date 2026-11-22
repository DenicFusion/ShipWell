"use client";

import React from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useShipWell } from "@/components/providers/ShipWellProvider";
import type { ThemePreference } from "@/types/tracking";

const OPTIONS: { key: ThemePreference; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "system", label: "System", Icon: Monitor },
  { key: "dark", label: "Dark", Icon: Moon },
  { key: "light", label: "Light", Icon: Sun },
];

export function ThemeSwitch({
  compact = false,
  className = "",
}: {
  compact?: boolean;
  className?: string;
}) {
  const { themePreference, setThemePreference } = useShipWell();

  return (
    <div
      className={`seg ${compact ? "compact" : ""} ${className}`.trim()}
      role="group"
      aria-label="Theme appearance"
    >
      {OPTIONS.map(({ key, label, Icon }) => {
        const active = themePreference === key;
        return (
          <button
            key={key}
            type="button"
            className={active ? "on" : ""}
            aria-pressed={active}
            onClick={() => setThemePreference(key)}
          >
            <Icon className={compact ? "w-3.5 h-3.5 shrink-0" : "w-4 h-4 shrink-0"} />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}