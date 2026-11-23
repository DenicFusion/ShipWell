import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  Loader2,
  Package,
} from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { fetchAllShipmentsForAdmin } from "@/lib/firestore-shipments";
import { useShipWell } from "@/components/providers/ShipWellProvider";
import {
  formatTimeAgo,
  STAGES,
  type ShipmentRecord,
  type TrackingEvent,
} from "@/types/tracking";

export default function AdminOverviewPage() {
  const { isAdmin } = useShipWell();
  const [shipments, setShipments] = useState<ShipmentRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAdmin) return;
    fetchAllShipmentsForAdmin()
      .then(setShipments)
      .finally(() => setLoading(false));
  }, [isAdmin]);

  const awaitingReview = shipments.filter(
    (s) => s.review?.state === "pending"
  );
  const held = shipments.filter((s) => Boolean(s.hold));
  const delivered = shipments.filter((s) => s.status === "Delivered");
  const inTransit = shipments.filter(
    (s) => s.status !== "Delivered" && !s.hold
  );
  const openAlerts = shipments.flatMap((s) =>
    (s.alerts || [])
      .filter((a) => a.status === "open")
      .map((alert) => ({ shipment: s, alert }))
  );

  const stageCounts = STAGES.map((stage) => ({
    stage,
    count: shipments.filter((s) => s.status === stage).length,
  }));
  const maxStage = Math.max(1, ...stageCounts.map((x) => x.count));

  const recentFeed: { code: string; event: TrackingEvent }[] = [];
  shipments.forEach((s) => {
    (s.events || []).forEach((ev) => {
      recentFeed.push({ code: s.code, event: ev });
    });
  });
  recentFeed.sort((a, b) => b.event.ts - a.event.ts);

  return (
    <AdminShell
      title="Overview"
      awaitingReviewCount={awaitingReview.length}
      openAlertsCount={openAlerts.length}
    >
      {loading ? (
        <div className="py-20 flex flex-col items-center gap-3 text-[var(--muted)]">
          <Loader2 className="w-7 h-7 animate-spin text-[var(--em)]" />
          <span>Loading live operations data...</span>
        </div>
      ) : (
        <>
          <div className="ad-kpis">
            <Link to="/admin/shipments" className="ad-kpi">
              <small>Total shipments</small>
              <b>{shipments.length}</b>
            </Link>
            <Link to="/admin/shipments?status=transit" className="ad-kpi b">
              <small>In transit</small>
              <b>{inTransit.length}</b>
            </Link>
            <Link to="/admin/shipments?status=review" className="ad-kpi a">
              <small>Awaiting review</small>
              <b>{awaitingReview.length}</b>
            </Link>
            <Link to="/admin/shipments?status=hold" className="ad-kpi r">
              <small>Delayed / held</small>
              <b>{held.length}</b>
            </Link>
            <Link to="/admin/alerts" className="ad-kpi b">
              <small>Open actions</small>
              <b>{openAlerts.length}</b>
            </Link>
            <Link
              to="/admin/shipments?status=delivered"
              className="ad-kpi g"
            >
              <small>Delivered</small>
              <b>{delivered.length}</b>
            </Link>
          </div>

          <div className="ad-grid">
            <div className="ad-card">
              <div className="ad-ch">
                <b>Needs attention</b>
                <small>
                  {awaitingReview.length + held.length + openAlerts.length} items
                </small>
              </div>
              <div className="ad-q">
                {awaitingReview.map((s) => (
                  <Link
                    key={`rev_${s.code}`}
                    to={`/admin/shipment/${s.code}`}
                    className="ad-qi"
                  >
                    <div className="qd a">
                      <Package className="w-4 h-4" />
                    </div>
                    <div className="t">
                      <b>Review {s.code}</b>
                      <small>
                        {s.contents} · {s.sender.name} → {s.receiver.name}
                      </small>
                    </div>
                    <span className="go">Review →</span>
                  </Link>
                ))}

                {held.map((s) => (
                  <Link
                    key={`hold_${s.code}`}
                    to={`/admin/shipment/${s.code}`}
                    className="ad-qi"
                  >
                    <div className="qd r">
                      <AlertTriangle className="w-4 h-4" />
                    </div>
                    <div className="t">
                      <b>
                        {s.hold?.type}: {s.code}
                      </b>
                      <small>{s.hold?.reason}</small>
                    </div>
                    <span className="go">Manage →</span>
                  </Link>
                ))}

                {openAlerts.map(({ shipment, alert }) => (
                  <Link
                    key={`al_${shipment.code}_${alert.id}`}
                    to={`/admin/shipment/${shipment.code}`}
                    className="ad-qi"
                  >
                    <div className="qd b">
                      <AlertCircle className="w-4 h-4" />
                    </div>
                    <div className="t">
                      <b>
                        Waiting on {alert.to}: {shipment.code}
                      </b>
                      <small>{alert.title}</small>
                    </div>
                    <span className="go">Inspect →</span>
                  </Link>
                ))}

                {awaitingReview.length === 0 &&
                  held.length === 0 &&
                  openAlerts.length === 0 && (
                    <div className="ad-ok">
                      <Check className="w-5 h-5 mx-auto mb-2 text-[var(--em)]" />
                      All shipments reviewed and clear.
                    </div>
                  )}
              </div>
            </div>

            <div>
              <div className="ad-card">
                <div className="ad-ch">
                  <b>Shipments by stage</b>
                  <small>{shipments.length} total</small>
                </div>
                <div className="ad-cb">
                  <div className="ad-bars">
                    {stageCounts.map((item) => (
                      <div className="ad-bar" key={item.stage}>
                        <span>{item.stage}</span>
                        <div className="t">
                          <i
                            style={{
                              width: `${Math.round((item.count / maxStage) * 100)}%`,
                            }}
                          />
                        </div>
                        <b>{item.count}</b>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="ad-card">
                <div className="ad-ch">
                  <b>Recent activity</b>
                  <small>Latest events</small>
                </div>
                <div className="ad-feed">
                  {recentFeed.slice(0, 8).map((item, idx) => (
                    <div className="ad-fi" key={`${item.code}_${idx}`}>
                      <i
                        className={
                          item.event.kind === "delay"
                            ? "d"
                            : item.event.kind === "action"
                              ? "a"
                              : ""
                        }
                      />
                      <div className="min-w-0 flex-1">
                        <b>{item.code}</b> — {item.event.label}
                        <small>
                          {item.event.loc ? `${item.event.loc} · ` : ""}
                          {formatTimeAgo(item.event.ts)}
                        </small>
                      </div>
                    </div>
                  ))}
                  {recentFeed.length === 0 && (
                    <div className="ad-ok">No shipment events logged yet.</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </AdminShell>
  );
}
