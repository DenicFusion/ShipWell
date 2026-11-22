import React, { useEffect, useMemo, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { Mail, Search, X } from "lucide-react";
import { db } from "@/lib/firebase";
import { AdminShell } from "@/components/admin/AdminShell";
import { useShipWell } from "@/components/providers/ShipWellProvider";
import { formatDateTime } from "@/lib/quote-engine";
import { firestoreTimeToMs, type EmailLogRecord } from "@/types/tracking";

export default function AdminMailPage() {
  const { isAdmin } = useShipWell();
  const [logs, setLogs] = useState<EmailLogRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchQ, setSearchQ] = useState("");
  const [previewLog, setPreviewLog] = useState<EmailLogRecord | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    const unsub = onSnapshot(
      query(
        collection(db, "emailLogs"),
        orderBy("createdAt", "desc"),
        limit(120)
      ),
      (snap) => {
        setLogs(
          snap.docs.map((d) => {
            const data = d.data() as Omit<EmailLogRecord, "id">;
            return {
              ...data,
              id: d.id,
              createdAtMs: firestoreTimeToMs(data.createdAt),
            };
          })
        );
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, [isAdmin]);

  const filtered = useMemo(() => {
    const q = searchQ.trim().toLowerCase();
    return logs.filter((l) => {
      if (statusFilter !== "all" && l.status !== statusFilter) return false;
      if (!q) return true;
      return (
        l.to.toLowerCase().includes(q) ||
        l.subject.toLowerCase().includes(q) ||
        l.template.toLowerCase().includes(q) ||
        (l.code && l.code.toLowerCase().includes(q))
      );
    });
  }, [logs, statusFilter, searchQ]);

  const chipFor = (status: string) => {
    if (status === "delivered" || status === "sent") return "g";
    if (status === "bounced" || status === "failed") return "r";
    return "a";
  };

  return (
    <AdminShell title="Email Log">
      <div className="ad-bar">
        <div className="ad-search">
          <Search className="w-4 h-4 text-[var(--faint)]" />
          <input
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="Filter by email, subject, code..."
          />
        </div>
        <div className="ad-tabs2">
          {["all", "sent", "delivered", "bounced", "failed", "queued_preview"].map(
            (st) => (
              <button
                key={st}
                type="button"
                className={statusFilter === st ? "on" : ""}
                onClick={() => setStatusFilter(st)}
              >
                {st === "queued_preview" ? "Preview" : st}
              </button>
            )
          )}
        </div>
      </div>

      <div className="ad-card">
        <div className="ad-ch">
          <b>Outbound Resend Emails</b>
          <small>{filtered.length} logged</small>
        </div>
        {loading ? (
          <div className="ad-cb">
            <div className="dx-skel" style={{ height: 180 }} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="sp-none">No outbound emails match this filter.</div>
        ) : (
          <div className="ml">
            {filtered.map((item) => (
              <button
                key={item.id}
                type="button"
                className="ml-row"
                onClick={() => setPreviewLog(item)}
              >
                <div className="ml-i">
                  <Mail className="w-4 h-4" />
                </div>
                <div className="ml-t">
                  <b>{item.subject}</b>
                  <small>
                    To {item.to} · {item.template}
                    {item.code ? ` · ${item.code}` : ""}
                    {item.createdAtMs ? ` · ${formatDateTime(item.createdAtMs)}` : ""}
                  </small>
                </div>
                <span className={`chip ${chipFor(item.status)}`}>
                  {item.status}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {previewLog && (
        <div className="md" role="dialog" aria-modal="true">
          <div className="md-b" onClick={() => setPreviewLog(null)} />
          <div className="md-c em-md">
            <button
              className="md-x"
              onClick={() => setPreviewLog(null)}
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="em">
              <div className="em-meta">
                <div>
                  <small>To</small> <b>{previewLog.to}</b>
                </div>
                <div>
                  <small>Subject</small> <b>{previewLog.subject}</b>
                </div>
                <div>
                  <small>Template</small>{" "}
                  <span className="mono">{previewLog.template}</span> ·{" "}
                  <span className={`chip ${chipFor(previewLog.status)}`}>
                    {previewLog.status}
                  </span>
                </div>
                {previewLog.providerId && (
                  <div>
                    <small>ID</small>{" "}
                    <span className="mono">{previewLog.providerId}</span>
                  </div>
                )}
              </div>
              <div className="em-body">
                {previewLog.htmlPreview ? (
                  <iframe
                    title="Email preview"
                    srcDoc={previewLog.htmlPreview}
                    sandbox=""
                    style={{
                      width: "100%",
                      height: 400,
                      border: "none",
                      borderRadius: 10,
                    }}
                  />
                ) : (
                  <div className="sp-none">
                    HTML body preview was not stored for this legacy send. New
                    emails via Resend automatically attach their preview here.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
