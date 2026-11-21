import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Bell,
  Box,
  Calendar,
  CreditCard,
  Home,
  MapPin,
  Shield,
  Truck,
} from "lucide-react";
import { useShipWell } from "@/components/providers/ShipWellProvider";
import {
  getEtaSummary,
  lastTsOf,
  myOpenAlertsForShipment,
} from "@/components/dashboard/useDashboardShipments";
import { SERVICES } from "@/lib/quote-engine";
import {
  getShipmentChip,
  getStagePercent,
  normalizeEmail,
  type AlertKind,
  type ShipmentRecord,
} from "@/types/tracking";

type FilterKind = "all" | "active" | "attention" | "delivered";

function renderAlertIcon(kind: AlertKind) {
  if (kind === "duty") return <CreditCard className="w-[15px] h-[15px]" />;
  if (kind === "address") return <MapPin className="w-[15px] h-[15px]" />;
  if (kind === "id") return <Shield className="w-[15px] h-[15px]" />;
  if (kind === "reschedule") return <Calendar className="w-[15px] h-[15px]" />;
  if (kind === "item") return <AlertTriangle className="w-[15px] h-[15px]" />;
  return <Bell className="w-[15px] h-[15px]" />;
}

export function DashboardParcelList({
  mode,
  list,
  userEmail,
  receiverStatusMap,
}: {
  mode: "incoming" | "sent";
  list: ShipmentRecord[];
  userEmail: string;
  receiverStatusMap: Record<string, boolean>;
}) {
  const { openAction, refreshOpenAlerts } = useShipWell();
  const [filter, setFilter] = useState<FilterKind>("all");

  const sorted = useMemo(() => {
    return [...list].sort(
      (a, b) =>
        Number(a.status === "Delivered") - Number(b.status === "Delivered") ||
        lastTsOf(b) - lastTsOf(a)
    );
  }, [list]);

  const counts = useMemo(
    () => ({
      all: sorted.length,
      active: sorted.filter((s) => s.status !== "Delivered").length,
      attention: sorted.filter(
        (s) =>
          Boolean(s.hold) ||
          myOpenAlertsForShipment(s, userEmail).length > 0
      ).length,
      delivered: sorted.filter((s) => s.status === "Delivered").length,
    }),
    [sorted, userEmail]
  );

  const shown = useMemo(() => {
    return sorted.filter((s) => {
      if (filter === "all") return true;
      if (filter === "active") return s.status !== "Delivered";
      if (filter === "attention") {
        return (
          Boolean(s.hold) ||
          myOpenAlertsForShipment(s, userEmail).length > 0
        );
      }
      return s.status === "Delivered";
    });
  }, [sorted, filter, userEmail]);

  if (sorted.length === 0) {
    if (mode === "incoming") {
      return (
        <div className="dx-empty">
          <div className="au-ic">
            <Home className="w-6 h-6" />
          </div>
          <h3>NOTHING ON ITS WAY YET</h3>
          <p>
            Whenever someone ships a parcel to <b>{userEmail}</b> it appears
            here automatically, with the sender&rsquo;s item photos and live
            updates.
          </p>
          <div className="acts">
            <Link
              className="sw-btn sw-btn-em sw-btn-lg"
              to="/dashboard/track"
            >
              Track a parcel
            </Link>
            <Link className="sw-btn sw-btn-ghost sw-btn-lg" to="/ship">
              Ship something
            </Link>
          </div>
        </div>
      );
    }

    return (
      <div className="dx-empty">
        <div className="au-ic">
          <Truck className="w-6 h-6" />
        </div>
        <h3>NO SHIPMENTS SENT</h3>
        <p>
          Book your first shipment. Add photos of the item and the
          receiver&rsquo;s email so it shows up on their dashboard.
        </p>
        <div className="acts">
          <Link className="sw-btn sw-btn-em sw-btn-lg" to="/ship">
            Ship now →
          </Link>
        </div>
      </div>
    );
  }

  const pills: [FilterKind, string][] = [
    ["all", "All"],
    ["active", "Active"],
    ["attention", "Needs attention"],
    ["delivered", "Delivered"],
  ];

  return (
    <>
      <div className="dx-pills" role="tablist" aria-label="Filter parcels">
        {pills.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={filter === key}
            className={filter === key ? "on" : ""}
            onClick={() => setFilter(key)}
          >
            {label}
            <i>{counts[key]}</i>
          </button>
        ))}
      </div>

      <div className="dx-list">
        {shown.length > 0 ? (
          shown.map((s) => {
            const chip = getShipmentChip(s);
            const pct = getStagePercent(s.status);
            const fin = s.status === "Delivered";
            const held = Boolean(s.hold) && !fin;
            const open = myOpenAlertsForShipment(s, userEmail);
            const eta = getEtaSummary(s);
            const recEmail = normalizeEmail(s.receiverEmail || s.receiver.email);
            const recOnShipWell = Boolean(receiverStatusMap[recEmail]);

            return (
              <article key={`${mode}_${s.code}`} className="dx-parcel">
                <Link
                  className="dx-pth"
                  to={`/dashboard/track/${s.code}`}
                  aria-label={`Track ${s.code}`}
                >
                  {s.photos && s.photos.length > 0 ? (
                    <>
                      <img
                        src={s.photos[0]}
                        alt={`${s.contents} photo`}
                        loading="lazy"
                      />
                      {s.photos.length > 1 && (
                        <em>{s.photos.length} photos</em>
                      )}
                    </>
                  ) : (
                    <span className="ic">
                      <Box className="w-[30px] h-[30px]" />
                    </span>
                  )}
                </Link>

                <div className="dx-pm">
                  <div className="dx-pt">
                    <b>{s.contents}</b>
                    <span className={`chip ${chip.tone}`}>{chip.label}</span>
                  </div>

                  <div className="dx-ps">
                    {mode === "incoming" ? (
                      <>
                        From <b>{s.sender.name}</b> · {s.sender.city} →{" "}
                        {s.receiver.city}
                      </>
                    ) : (
                      <>
                        To <b>{s.receiver.name}</b> · {s.sender.city} →{" "}
                        {s.receiver.city}
                        <br />
                        {recOnShipWell ? (
                          <span className="ok">
                            ✓ {s.receiver.email} is on ShipWell
                          </span>
                        ) : (
                          <span className="wait">
                            Waiting for {s.receiver.email} to sign up
                          </span>
                        )}
                      </>
                    )}
                  </div>

                  <div className={`dx-bar ${held ? "a" : ""}`}>
                    <i style={{ width: `${pct}%` }} />
                  </div>

                  <div className="dx-pmeta">
                    <span className="mono">{s.code}</span>
                    <span>
                      {fin ? `Delivered ${eta.v}` : `${eta.k} ${eta.v}`}
                    </span>
                    <span>{SERVICES[s.service].name}</span>
                  </div>

                  {open.length > 0 && (
                    <button
                      type="button"
                      className="dx-pact"
                      onClick={() =>
                        openAction(s, open[0], async () => {
                          await refreshOpenAlerts();
                        })
                      }
                    >
                      <span className="ic">{renderAlertIcon(open[0].kind)}</span>
                      <span>
                        {open[0].title}
                        {open.length > 1 ? ` (+${open.length - 1})` : ""}
                      </span>
                      <b>Take action →</b>
                    </button>
                  )}
                </div>

                <Link
                  className="sw-btn sw-btn-ghost dx-go"
                  to={`/dashboard/track/${s.code}`}
                >
                  Track live →
                </Link>
              </article>
            );
          })
        ) : (
          <div className="dx-empty" style={{ padding: 30 }}>
            <p style={{ margin: 0 }}>Nothing in this filter.</p>
          </div>
        )}
      </div>
    </>
  );
}
