import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Mail,
  MessageSquare,
  RotateCcw,
  Search,
  Send,
} from "lucide-react";
import toast from "react-hot-toast";
import { auth, db } from "@/lib/firebase";
import { AdminShell } from "@/components/admin/AdminShell";
import { useShipWell } from "@/components/providers/ShipWellProvider";
import { formatDateTime } from "@/lib/quote-engine";
import {
  formatTimeAgo,
  type SupportMessage,
  type SupportThread,
} from "@/types/tracking";

const CANNED_REPLIES = [
  "Thanks for reaching out — we are checking this with our hub team right now and will update you shortly.",
  "Your customs charge is verified in Bachs. As soon as payment confirms, your parcel releases automatically.",
  "We have updated your delivery instructions on the courier manifest.",
];

export default function AdminMessagesPage() {
  const { id: routeId } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const { isAdmin } = useShipWell();

  const [threads, setThreads] = useState<SupportThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterMode, setFilterMode] = useState<"all" | "unread" | "open" | "closed">("all");
  const [searchQ, setSearchQ] = useState("");
  const [msgSnapshot, setMsgSnapshot] = useState<{
    threadId: string;
    items: SupportMessage[];
  } | null>(null);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const msgsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isAdmin) return;
    const unsub = onSnapshot(
      query(
        collection(db, "supportThreads"),
        orderBy("lastMessageAt", "desc"),
        limit(120)
      ),
      (snap) => {
        setThreads(
          snap.docs.map((d) => ({
            ...(d.data() as Omit<SupportThread, "id">),
            id: d.id,
          }))
        );
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, [isAdmin]);

  const activeThread = useMemo(
    () => (routeId ? threads.find((t) => t.id === routeId) || null : null),
    [threads, routeId]
  );

  const messages = useMemo(
    () =>
      activeThread?.id && msgSnapshot?.threadId === activeThread.id
        ? msgSnapshot.items
        : [],
    [activeThread, msgSnapshot]
  );

  useEffect(() => {
    const tid = activeThread?.id;
    if (!tid) {
      return;
    }

    if (activeThread.unreadAdmin) {
      updateDoc(doc(db, "supportThreads", tid), {
        unreadAdmin: false,
        updatedAt: serverTimestamp(),
      }).catch(() => undefined);
    }

    const unsub = onSnapshot(
      query(
        collection(db, "supportThreads", tid, "messages"),
        orderBy("ts", "asc")
      ),
      (snap) => {
        setMsgSnapshot({
          threadId: tid,
          items: snap.docs.map((d) => ({
            ...(d.data() as Omit<SupportMessage, "id">),
            id: d.id,
          })),
        });
        setTimeout(() => {
          msgsEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }, 50);
      },
      () => undefined
    );
    return () => unsub();
  }, [activeThread?.id, activeThread?.unreadAdmin]);

  const filtered = useMemo(() => {
    const q = searchQ.trim().toLowerCase();
    return threads.filter((t) => {
      if (filterMode === "unread" && !t.unreadAdmin) return false;
      if (filterMode === "open" && t.status !== "open") return false;
      if (filterMode === "closed" && t.status !== "closed") return false;
      if (!q) return true;
      return (
        t.userEmail.toLowerCase().includes(q) ||
        t.userName.toLowerCase().includes(q) ||
        t.subject.toLowerCase().includes(q) ||
        t.ticketCode.toLowerCase().includes(q) ||
        (t.code && t.code.toLowerCase().includes(q))
      );
    });
  }, [threads, filterMode, searchQ]);

  const sendAdminReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeThread || !replyText.trim()) return;
    setSending(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch("/api/support/reply", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          threadId: activeThread.id,
          message: replyText.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Unable to send reply.");
      setReplyText("");
      toast.success(`Reply emailed to ${activeThread.userEmail}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send reply.");
    } finally {
      setSending(false);
    }
  };

  const toggleStatus = async () => {
    if (!activeThread) return;
    const nextStatus = activeThread.status === "closed" ? "open" : "closed";
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch("/api/support/reply", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          threadId: activeThread.id,
          status: nextStatus,
        }),
      });
      if (!res.ok) throw new Error("Unable to update thread status.");
      toast.success(nextStatus === "closed" ? "Thread closed" : "Thread reopened");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed.");
    }
  };

  return (
    <AdminShell title="Support Messages">
      <div className={`sp ${routeId ? "has-chat" : ""}`}>
        {/* Inbox list */}
        <div className="ad-card sp-list" style={{ marginBottom: 0 }}>
          <div className="ad-ch">
            <b>Inbox</b>
            <small>{filtered.length} threads</small>
          </div>
          <div style={{ padding: "12px 14px", display: "grid", gap: 10 }}>
            <div className="ad-search" style={{ maxWidth: "none" }}>
              <Search className="w-4 h-4 text-[var(--faint)]" />
              <input
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder="Search email, ticket, code..."
              />
            </div>
            <div className="ad-tabs2">
              {(
                [
                  ["all", "All"],
                  ["unread", "Unread"],
                  ["open", "Open"],
                  ["closed", "Closed"],
                ] as const
              ).map(([k, lbl]) => (
                <button
                  key={k}
                  type="button"
                  className={filterMode === k ? "on" : ""}
                  onClick={() => setFilterMode(k)}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          <div className="sp-ths">
            {loading ? (
              <div className="ad-cb">
                <div className="dx-skel" style={{ height: 64 }} />
              </div>
            ) : filtered.length === 0 ? (
              <div className="sp-none">No support threads match.</div>
            ) : (
              filtered.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`sp-th ${activeThread?.id === t.id ? "on" : ""}`}
                  onClick={() => navigate(`/admin/thread/${t.id}`)}
                >
                  <div className="sp-av">
                    <MessageSquare className="w-4 h-4" />
                  </div>
                  <div className="m">
                    <b>
                      {t.userName} · {t.subject}
                    </b>
                    <small>
                      {t.userEmail} · {t.lastMessagePreview || t.ticketCode}
                    </small>
                  </div>
                  <div className="r">
                    <time>{formatTimeAgo(t.lastMessageAt)}</time>
                    {t.unreadAdmin && <i aria-label="Unread message" />}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Thread view */}
        <div className="ad-card sp-pane" style={{ marginBottom: 0 }}>
          {activeThread ? (
            <>
              <div className="ad-ch sp-chh">
                <div>
                  <button
                    type="button"
                    className="sp-back"
                    onClick={() => navigate("/admin/messages")}
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    Back to inbox
                  </button>
                  <b>{activeThread.subject}</b>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
                    {activeThread.userName} ({activeThread.userEmail}) ·{" "}
                    <span className="mono">{activeThread.ticketCode}</span>
                    {activeThread.code && (
                      <>
                        {" · "}
                        <Link
                          to={`/admin/shipment/${activeThread.code}`}
                          style={{ color: "var(--em2)", fontWeight: 600 }}
                        >
                          {activeThread.code} →
                        </Link>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`chip ${
                      activeThread.status === "closed" ? "n" : "g"
                    }`}
                  >
                    {activeThread.status}
                  </span>
                  <button
                    type="button"
                    className="sw-btn sw-btn-ghost"
                    style={{ padding: "6px 12px", fontSize: 12 }}
                    onClick={toggleStatus}
                  >
                    {activeThread.status === "closed" ? (
                      <>
                        <RotateCcw className="w-3.5 h-3.5" /> Reopen
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5" /> Close
                      </>
                    )}
                  </button>
                </div>
              </div>

              <div className="sp-msgs">
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`sp-b ${m.from === "admin" ? "me" : "them"}`}
                  >
                    <div className="sp-bt">{m.body}</div>
                    <small>
                      {m.senderName} ({m.source}) · {formatDateTime(m.ts)}
                    </small>
                  </div>
                ))}
                <div ref={msgsEndRef} />
              </div>

              <div className="sp-canned">
                {CANNED_REPLIES.map((snippet, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setReplyText(snippet)}
                  >
                    {snippet.slice(0, 56)}…
                  </button>
                ))}
              </div>

              <form className="sp-reply" onSubmit={sendAdminReply}>
                <textarea
                  className="field"
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder={`Reply to ${activeThread.userEmail} (emailed via support@info.shipwell.cc)...`}
                  rows={2}
                />
                <button
                  type="submit"
                  disabled={sending || !replyText.trim()}
                  className="sw-btn sw-btn-em"
                >
                  {sending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                  Send reply
                </button>
              </form>
            </>
          ) : (
            <div className="sp-hero">
              <div className="au-ic" style={{ margin: 0 }}>
                <Mail className="w-6 h-6" />
              </div>
              <h3>SELECT A CONVERSATION</h3>
              <p>
                Every message submitted through the Contact modal, Dashboard
                Support, or emailed to <code>support@info.shipwell.cc</code>{" "}
                threads here live.
              </p>
            </div>
          )}
        </div>
      </div>
    </AdminShell>
  );
}
