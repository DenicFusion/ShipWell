import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Mail, Users } from "lucide-react";
import { adminPath } from "@/lib/host";
import { AdminShell } from "@/components/admin/AdminShell";
import {
  adminResendReceiverInvite,
  checkAccountExists,
  fetchAllLeadsForAdmin,
  fetchAllShipmentsForAdmin,
  fetchAllUsersForAdmin,
} from "@/lib/firestore-shipments";
import { useShipWell } from "@/components/providers/ShipWellProvider";
import {
  normalizeEmail,
  type BusinessLead,
  type ShipmentRecord,
  type UserProfile,
} from "@/types/tracking";
import toast from "react-hot-toast";

export default function AdminCustomersPage() {
  const { user, isAdmin } = useShipWell();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [shipments, setShipments] = useState<ShipmentRecord[]>([]);
  const [leads, setLeads] = useState<BusinessLead[]>([]);
  const [unregistered, setUnregistered] = useState<
    { email: string; name: string; latestShipment: ShipmentRecord; count: number }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [sendingTo, setSendingTo] = useState("");

  const loadAll = useCallback(async () => {
    try {
      const [uList, sList, lList] = await Promise.all([
        fetchAllUsersForAdmin(),
        fetchAllShipmentsForAdmin(),
        fetchAllLeadsForAdmin(),
      ]);
      setUsers(uList);
      setShipments(sList);
      setLeads(lList);

      const userEmailSet = new Set(
        uList.map((u) => normalizeEmail(u.email))
      );
      const receiverGroups = new Map<
        string,
        { email: string; name: string; latestShipment: ShipmentRecord; count: number }
      >();

      for (const s of sList) {
        const em = normalizeEmail(s.receiverEmail);
        if (!em || userEmailSet.has(em)) continue;
        const existing = receiverGroups.get(em);
        if (existing) {
          existing.count += 1;
        } else {
          receiverGroups.set(em, {
            email: em,
            name: s.receiver.name,
            latestShipment: s,
            count: 1,
          });
        }
      }

      const verifiedUnreg: typeof unregistered = [];
      for (const item of receiverGroups.values()) {
        const exists = await checkAccountExists(item.email);
        if (!exists) verifiedUnreg.push(item);
      }
      setUnregistered(verifiedUnreg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) {
      loadAll();
    }
  }, [isAdmin, loadAll]);

  const awaitingReviewCount = shipments.filter(
    (s) => s.review?.state === "pending"
  ).length;
  const openAlertsCount = shipments.reduce(
    (sum, s) =>
      sum + (s.alerts || []).filter((a) => a.status === "open").length,
    0
  );

  return (
    <AdminShell
      title="Customers"
      awaitingReviewCount={awaitingReviewCount}
      openAlertsCount={openAlertsCount}
    >
      {loading ? (
        <div className="py-20 flex flex-col items-center gap-3 text-[var(--muted)]">
          <Loader2 className="w-7 h-7 animate-spin text-[var(--em)]" />
          <span>Loading customers...</span>
        </div>
      ) : (
        <div className="ad-grid">
          {/* REGISTERED CUSTOMERS */}
          <div className="ad-card">
            <div className="ad-ch">
              <b>Registered customers</b>
              <small>{users.length} accounts</small>
            </div>
            <div className="ad-q">
              {users.map((u) => {
                const em = normalizeEmail(u.email);
                const sentN = shipments.filter(
                  (s) => s.senderId === u.uid || normalizeEmail(s.senderEmail) === em
                ).length;
                const recN = shipments.filter(
                  (s) => normalizeEmail(s.receiverEmail) === em
                ).length;
                return (
                  <div key={u.uid} className="ad-qi">
                    <div className="qd g">
                      <Users className="w-4 h-4" />
                    </div>
                    <div className="t">
                      <b>{u.name}</b>
                      <small>{u.email}</small>
                    </div>
                    <span className="go">
                      Sent {sentN} · Receiving {recN}
                    </span>
                  </div>
                );
              })}
              {users.length === 0 && (
                <div className="ad-ok">No registered customer accounts yet.</div>
              )}
            </div>
          </div>

          {/* RECEIVERS NOT SIGNED UP YET */}
          <div>
            <div className="ad-card">
              <div className="ad-ch">
                <b>Receivers not signed up yet</b>
                <small>{unregistered.length} pending</small>
              </div>
              <div className="ad-q">
                {unregistered.map((item) => (
                  <div key={item.email} className="ad-qi">
                    <div className="qd a">
                      <Mail className="w-4 h-4" />
                    </div>
                    <div className="t">
                      <b>{item.email}</b>
                      <small>
                        {item.name} · {item.count}{" "}
                        {item.count === 1 ? "parcel" : "parcels"} waiting ·{" "}
                        <Link
                          to={adminPath(`shipment/${item.latestShipment.code}`)}
                          style={{ color: "var(--em)" }}
                        >
                          {item.latestShipment.code}
                        </Link>
                      </small>
                    </div>
                    <button
                      type="button"
                      disabled={sendingTo === item.email || !user}
                      className="sw-btn sw-btn-ghost"
                      style={{ padding: "8px 12px", fontSize: 12 }}
                      onClick={async () => {
                        if (!user) return;
                        setSendingTo(item.email);
                        try {
                          await adminResendReceiverInvite({
                            shipment: item.latestShipment,
                            actorUid: user.uid,
                            actorEmail: user.email || "",
                            isReminder: true,
                          });
                          toast.success(`Invite dispatched to ${item.email}`);
                        } catch (err) {
                          toast.error(
                            err instanceof Error
                              ? err.message
                              : "Could not send invite"
                          );
                        } finally {
                          setSendingTo("");
                        }
                      }}
                    >
                      {sendingTo === item.email ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        "Send invite"
                      )}
                    </button>
                  </div>
                ))}
                {unregistered.length === 0 && (
                  <div className="ad-ok">
                    Every recipient currently has a ShipWell account.
                  </div>
                )}
              </div>
            </div>

            {leads.length > 0 && (
              <div className="ad-card">
                <div className="ad-ch">
                  <b>Business enquiries</b>
                  <small>{leads.length} leads</small>
                </div>
                <div className="ad-q">
                  {leads.map((l) => (
                    <div key={l.ref} className="ad-qi">
                      <div className="t">
                        <b>
                          {l.company} ({l.plan})
                        </b>
                        <small>
                          {l.name} · {l.email} · {l.volume}
                        </small>
                      </div>
                      <span className="chip b">{l.ref}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </AdminShell>
  );
}
