"use client";

import React, { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import {
  checkAccountExists,
  fetchAllShipmentsForAdmin,
} from "@/lib/firestore-shipments";
import { useShipWell } from "@/components/providers/ShipWellProvider";
import { formatShortDay } from "@/lib/quote-engine";
import { getShipmentChip, type ShipmentRecord } from "@/types/tracking";

function ShipmentsListContent() {
  const searchParams = useSearchParams();
  const initialFilter = searchParams.get("status") || "all";
  const { isAdmin } = useShipWell();

  const [shipments, setShipments] = useState<ShipmentRecord[]>([]);
  const [receiverMap, setReceiverMap] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [queryText, setQueryText] = useState("");
  const [filter, setFilter] = useState(initialFilter);

  useEffect(() => {
    if (!isAdmin) return;
    fetchAllShipmentsForAdmin()
      .then(async (items) => {
        setShipments(items);
        const emails = Array.from(
          new Set(items.map((s) => s.receiverEmail).filter(Boolean))
        );
        const entries = await Promise.all(
          emails.map(async (e) => [e, await checkAccountExists(e)] as const)
        );
        setReceiverMap(Object.fromEntries(entries));
      })
      .finally(() => setLoading(false));
  }, [isAdmin]);

  const awaitingReviewCount = shipments.filter(
    (s) => s.review?.state === "pending"
  ).length;
  const openAlertsCount = shipments.reduce(
    (sum, s) =>
      sum + (s.alerts || []).filter((a) => a.status === "open").length,
    0
  );

  const filtered = shipments.filter((s) => {
    const q = queryText.trim().toLowerCase();
    const matchesSearch =
      !q ||
      s.code.toLowerCase().includes(q) ||
      s.sender.name.toLowerCase().includes(q) ||
      s.receiver.name.toLowerCase().includes(q) ||
      s.receiverEmail.toLowerCase().includes(q) ||
      s.contents.toLowerCase().includes(q);

    if (!matchesSearch) return false;
    if (filter === "review") return s.review?.state === "pending";
    if (filter === "transit") return s.status !== "Delivered" && !s.hold;
    if (filter === "hold") return Boolean(s.hold);
    if (filter === "delivered") return s.status === "Delivered";
    return true;
  });

  return (
    <AdminShell
      title="Shipments"
      awaitingReviewCount={awaitingReviewCount}
      openAlertsCount={openAlertsCount}
    >
      <div className="ad-tool">
        <input
          className="field"
          value={queryText}
          onChange={(e) => setQueryText(e.target.value)}
          placeholder="Search tracking code, name, email, or contents..."
          aria-label="Search shipments"
        />
        <select
          className="field"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter shipments"
        >
          <option value="all">All ({shipments.length})</option>
          <option value="review">Awaiting review ({awaitingReviewCount})</option>
          <option value="transit">In transit</option>
          <option value="hold">Delayed / on hold</option>
          <option value="delivered">Delivered</option>
        </select>
      </div>

      {loading ? (
        <div className="py-20 flex flex-col items-center gap-3 text-[var(--muted)]">
          <Loader2 className="w-7 h-7 animate-spin text-[var(--em)]" />
          <span>Loading shipments...</span>
        </div>
      ) : (
        <div className="ad-rows">
          <div className="ad-rh">
            <div>Tracking / Contents</div>
            <div>Route</div>
            <div>Parties</div>
            <div>Status</div>
            <div>ETA / Review</div>
            <div />
          </div>

          {filtered.length === 0 ? (
            <div className="ad-ok">No shipments match your filter.</div>
          ) : (
            filtered.map((s) => {
              const chip = getShipmentChip(s);
              const signedUp = receiverMap[s.receiverEmail];
              return (
                <Link
                  key={s.code}
                  href={`/admin/shipment/${s.code}`}
                  className="ad-row"
                >
                  <div className="c1">
                    <b>{s.code}</b>
                    <small>{s.contents}</small>
                  </div>
                  <div className="c2">
                    <span className="m">
                      {s.sender.city} → {s.receiver.city}
                    </span>
                  </div>
                  <div className="c3">
                    <span>
                      {s.sender.name} → {s.receiver.name}
                    </span>
                    <small>
                      {signedUp ? "✓ receiver on ShipWell" : "not signed up"}
                    </small>
                  </div>
                  <div className="c4">
                    <span className={`chip ${chip.tone}`}>{chip.label}</span>
                  </div>
                  <div className="c5">
                    <span>
                      {s.status === "Delivered"
                        ? "Delivered"
                        : `ETA ${formatShortDay(s.eta)}`}
                    </span>
                    <small>Review: {s.review?.state || "pending"}</small>
                  </div>
                  <div className="arr">→</div>
                </Link>
              );
            })
          )}
        </div>
      )}
    </AdminShell>
  );
}

export default function AdminShipmentsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] text-[var(--muted)]">
          Loading shipments...
        </div>
      }
    >
      <ShipmentsListContent />
    </Suspense>
  );
}
