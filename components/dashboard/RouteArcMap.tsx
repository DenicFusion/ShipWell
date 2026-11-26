import React, { useEffect, useState } from "react";
import { Check } from "lucide-react";
import {
  getStagePercent,
  STAGE_SHORT,
  STAGES,
  type ShipmentStage,
} from "@/types/tracking";

export function RouteArcMap({
  originCity,
  originCountry,
  destCity,
  destCountry,
  status,
  isHeld,
}: {
  originCity: string;
  originCountry: string;
  destCity: string;
  destCountry: string;
  status: ShipmentStage;
  isHeld: boolean;
}) {
  const pct = getStagePercent(status);
  const [animatedPct, setAnimatedPct] = useState(0);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      setAnimatedPct(pct);
    });
    return () => cancelAnimationFrame(id);
  }, [pct]);

  const t = Math.max(0.03, Math.min(1, pct / 100));
  const P = [
    [60, 150],
    [300, -30],
    [540, 150],
  ] as const;
  const x =
    (1 - t) * (1 - t) * P[0][0] +
    2 * (1 - t) * t * P[1][0] +
    t * t * P[2][0];
  const y =
    (1 - t) * (1 - t) * P[0][1] +
    2 * (1 - t) * t * P[1][1] +
    t * t * P[2][1];

  const fin = status === "Delivered";
  const col = isHeld && !fin ? "var(--amber)" : "var(--em)";
  const pathD = "M60 150 Q300 -30 540 150";

  return (
    <div className="dx-map">
      <svg
        viewBox="0 0 600 190"
        role="img"
        aria-label={`Route from ${originCity} to ${destCity}, ${pct}% complete`}
        preserveAspectRatio="xMidYMid meet"
      >
        <path
          d={pathD}
          fill="none"
          stroke="var(--border)"
          strokeWidth={3}
          strokeDasharray="2 9"
          strokeLinecap="round"
        />
        <path
          className="pg"
          d={pathD}
          pathLength={100}
          fill="none"
          stroke={col}
          strokeWidth={4}
          strokeLinecap="round"
          strokeDasharray={`${animatedPct} 100`}
        />
        <circle cx="60" cy="150" r="7" fill={col} />
        <circle
          cx="540"
          cy="150"
          r="7"
          fill={fin ? col : "var(--bg)"}
          stroke={col}
          strokeWidth="3"
        />
        {!fin && (
          <circle
            className="pulse"
            cx={x.toFixed(1)}
            cy={y.toFixed(1)}
            r="9"
            fill={col}
            opacity="0.5"
          />
        )}
        <circle
          cx={x.toFixed(1)}
          cy={y.toFixed(1)}
          r="7"
          fill="var(--card)"
          stroke={col}
          strokeWidth="4"
        />
      </svg>
      <div className="dx-mapf">
        <div>
          <b>{originCity}</b>
          <small>{originCountry}</small>
        </div>
        <div style={{ textAlign: "right" }}>
          <b>{destCity}</b>
          <small>{destCountry}</small>
        </div>
      </div>
    </div>
  );
}

export function StageStepper({
  status,
  isHeld,
  events,
  alerts,
}: {
  status: ShipmentStage;
  isHeld: boolean;
  events?: Array<{ stage?: string }>;
  alerts?: Array<{ kind?: string; chargeType?: string }>;
}) {
  // Customs is only shown when it truly applies: the parcel is in customs now,
  // it has been through customs, or a customs charge exists.
  const hasCustoms =
    status === "Customs" ||
    Boolean(events?.some((e) => e.stage === "Customs")) ||
    Boolean(alerts?.some((a) => a.kind === "customs" || a.chargeType));
  const steps = STAGES.filter((st) => st !== "Customs" || hasCustoms);
  const activeIdx = steps.indexOf(status);
  const fin = status === "Delivered";
  const held = isHeld && !fin;

  return (
    <div
      className="dx-steps"
      style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
    >
      {steps.map((st, idx) => {
        const isDone = idx < activeIdx || fin;
        const isNow = idx === activeIdx && !fin;
        const cls = isDone
          ? "done"
          : isNow
            ? `now${held ? " hold" : ""}`
            : "";

        return (
          <div key={st} className={`dxs ${cls}`}>
            <div className="dxd">
              {isDone ? <Check className="w-3.5 h-3.5" /> : null}
            </div>
            <span>{STAGE_SHORT[st]}</span>
          </div>
        );
      })}
    </div>
  );
}
