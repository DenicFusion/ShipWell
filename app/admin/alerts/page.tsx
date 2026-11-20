"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { fetchAllShipmentsForAdmin } from "@/lib/firestore-shipments";
import { useShipWell } from "@/components/providers/ShipWellProvider";
import type { ShipmentAlert, ShipmentRecord } from "@/types/tracking";

export default function AdminAlertsPage() {
  const { isAdmin } = useShipWell();
  const [shipments, setShipments] = useState<ShipmentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"open" | "resolved" | "all">("open");

  useEffect(() => {
    if (!isAdmin) return;
    fetchAllShipmentsForAdmin()
      .then(setShipments)
      .finally(() => setLoading(false));
  }, [isAdmin]);

  const awaitingReviewCount = shipments.filter(
    (s) => s.review?.state === "pending"
  ).length;
  const rows: { shipment: ShipmentRecord; alert: ShipmentAlert }[] = [];
  shipments.forEach((s) => {
    (s.alerts || []).forEach((alert) => rows.push({ shipment: s, alert }));
  });

  const openRows = rows.filter((r) => r.alert.status === "open");
  const resolvedRows = rows.filter((r) => r.alert.status === "resolved");
  const visible =
    tab === "open" ? openRows : tab === "resolved" ? resolvedRows : rows;

  return (
    <AdminShell
      title="Receiver actions"
      awaitingReviewCount={awaitingReviewCount}
      openAlertsCount={openRows.length}
    >
      <div className="ds-tabs" style={{ maxWidth: 460 }}>
        <button
          type="button"
          className={tab === "open" ? "on" : ""}
          onClick={() => setTab("open")}
        >
          Open <i>{openRows.length}</i>
        </button>
        <button
          type="button"
          className={tab === "resolved" ? "on" : ""}
          onClick={() => setTab("resolved")}
        >
          Resolved <i>{resolvedRows.length}</i>
        </button>
        <button
          type="button"
          className={tab === "all" ? "on" : ""}
          onClick={() => setTab("all")}
        >
          All <i>{rows.length}</i>
        </button>
      </div>

      {loading ? (
        <div className="py-20 flex flex-col items-center gap-3 text-[var(--muted)]">
          <Loader2 className="w-7 h-7 animate-spin text-[var(--em)]" />
          <span>Loading customer action requests...</span>
        </div>
      ) : visible.length === 0 ? (
        <div className="ad-card ad-ok">
          No {tab === "all" ? "" : tab} action alerts found.
        </div>
      ) : (
        <div className="ad-card">
          <div className="ad-q">
            {visible.map(({ shipment, alert }) => (
              <Link
                key={`${shipment.code}_${alert.id}`}
                href={`/admin/shipment/${shipment.code}`}
                className="ad-qi"
              >
                <div
                  className={`qd ${alert.status === "open" ? "b" : "g"}`}
                >
                  {alert.status === "open" ? (
                    <AlertCircle className="w-4 h-4" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                </div>
                <div className="t">
                  <b>
                    {alert.title} · {shipment.code}
                  </b>
                  <small>
                    To {alert.to} (
                    {alert.to === "receiver"
                      ? shipment.receiver.email
                      : shipment.sender.email}
                    ) —{" "}
                    {alert.response
                      ? `Resolved: ${alert.response}`
                      : alert.message}
                  </small>
                </div>
                <span className={`chip ${alert.status === "open" ? "b" : "g"}`}>
                  {alert.status}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </AdminShell>
  );
}
