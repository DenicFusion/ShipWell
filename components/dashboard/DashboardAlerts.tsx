import React, { useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Bell,
  Calendar,
  Check,
  CreditCard,
  Loader2,
  MapPin,
  Shield,
} from "lucide-react";
import toast from "react-hot-toast";
import { auth } from "@/lib/firebase";
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
  const [payingId, setPayingId] = useState<string | null>(null);

  const handlePayDuty = async (shipment: ShipmentRecord, alert: ShipmentAlert) => {
    const key = `${shipment.code}_${alert.id}`;
    setPayingId(key);
    try {
      const token = await auth.currentUser?.getIdToken().catch(() => null);
      if (!token) throw new Error("Please log in to continue.");
      const res = await fetch("/api/customs/create-checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          code: shipment.code,
          alertId: alert.id,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.checkoutUrl) {
        throw new Error(data.error || "Unable to create payment session.");
      }
      window.location.assign(data.checkoutUrl);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Payment failed.");
      setPayingId(null);
    }
  };

  const renderCard = (item: { shipment: ShipmentRecord; alert: ShipmentAlert }) => {
    const { shipment, alert } = item;
    const done = alert.status === "resolved";
    const ts = done
      ? alert.resolvedAtMs || alert.createdAtMs || 0
      : alert.createdAtMs || 0;
    const timeLabel = ts ? formatTimeAgo(ts) : "just now";
    const isBusy = payingId === `${shipment.code}_${alert.id}`;

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
            <div className="flex flex-wrap gap-2">
              {alert.kind === "duty" ? (
                <button
                  type="button"
                  disabled={payingId !== null}
                  className="sw-btn sw-btn-em"
                  onClick={() => handlePayDuty(shipment, alert)}
                >
                  {isBusy ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CreditCard className="w-4 h-4" />
                  )}
                  Pay with Bachs
                </button>
              ) : (
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
              <Link
                to={`/dashboard/track/${shipment.code}`}
                className="sw-btn sw-btn-ghost"
              >
                View parcel
              </Link>
            </div>
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
