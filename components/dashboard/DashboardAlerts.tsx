import React from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Bell,
  Calendar,
  Check,
  CreditCard,
  MapPin,
  Shield,
} from "lucide-react";
import { useShipWell } from "@/components/providers/ShipWellProvider";
import { formatMoney } from "@/lib/quote-engine";
import {
  formatTimeAgo,
  type AlertKind,
  type ShipmentAlert,
  type ShipmentRecord,
} from "@/types/tracking";

function renderAlertIcon(kind: AlertKind, done: boolean) {
  if (done) return <Check className="w-[22px] h-[22px]" />;
  if (kind === "duty") return <CreditCard className="w-[22px] h-[22px]" />;
  if (kind === "address") return <MapPin className="w-[22px] h-[22px]" />;
  if (kind === "id") return <Shield className="w-[22px] h-[22px]" />;
  if (kind === "reschedule") return <Calendar className="w-[22px] h-[22px]" />;
  if (kind === "item") return <AlertTriangle className="w-[22px] h-[22px]" />;
  return <Bell className="w-[22px] h-[22px]" />;
}

export function DashboardAlerts({
  openAlerts,
  resolvedAlerts,
}: {
  openAlerts: { shipment: ShipmentRecord; alert: ShipmentAlert }[];
  resolvedAlerts: { shipment: ShipmentRecord; alert: ShipmentAlert }[];
}) {
  const { openAction, refreshOpenAlerts } = useShipWell();

  const renderCard = (item: { shipment: ShipmentRecord; alert: ShipmentAlert }) => {
    const { shipment, alert } = item;
    const done = alert.status === "resolved";
    const ts = done
      ? alert.resolvedAtMs || alert.createdAtMs || 0
      : alert.createdAtMs || 0;
    const timeLabel = ts ? formatTimeAgo(ts) : "just now";

    return (
      <div key={`${shipment.code}_${alert.id}`} className={`dx-al ${done ? "done" : ""}`}>
        <div className="ai">
          <span className="ic">{renderAlertIcon(alert.kind, done)}</span>
        </div>
        <div className="tx">
          <b>{alert.title}</b>
          <p>
            {alert.message}
            {alert.amount > 0 && !done && (
              <>
                {" "}
                <b style={{ color: "var(--text)", display: "inline" }}>
                  {formatMoney(alert.amount)}
                </b>
              </>
            )}
          </p>
          <small>
            <Link to={`/dashboard/track/${shipment.code}`}>
              {shipment.code}
            </Link>{" "}
            · {shipment.contents} ·{" "}
            {done
              ? `Completed ${timeLabel}${
                  alert.response ? ` — ${alert.response}` : ""
                }`
              : `Requested ${timeLabel}`}
          </small>
          {!done && (
            <button
              type="button"
              className="sw-btn sw-btn-em"
              onClick={() =>
                openAction(shipment, alert, async () => {
                  await refreshOpenAlerts();
                })
              }
            >
              Take action
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      {openAlerts.length > 0 ? (
        <div className="dx-list">{openAlerts.map(renderCard)}</div>
      ) : (
        <div className="dx-empty">
          <div className="au-ic">
            <Check className="w-6 h-6" />
          </div>
          <h3>ALL CAUGHT UP</h3>
          <p>
            Nothing needs your attention. If ShipWell needs something from you,
            such as a duty payment, ID or a new delivery slot, it shows up here
            and in your email.
          </p>
          <div className="acts">
            <Link className="sw-btn sw-btn-ghost sw-btn-lg" to="/dashboard">
              Back to overview
            </Link>
          </div>
        </div>
      )}

      {resolvedAlerts.length > 0 && (
        <>
          <div className="dx-h">Completed</div>
          <div className="dx-list">{resolvedAlerts.map(renderCard)}</div>
        </>
      )}
    </>
  );
}
