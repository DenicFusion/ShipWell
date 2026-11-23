"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { User } from "firebase/auth";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import {
  ArrowLeft,
  Copy,
  Loader2,
  Mail,
  MessageSquare,
  Plus,
  Send,
} from "lucide-react";
import toast from "react-hot-toast";
import { db } from "@/lib/firebase";
import { formatDateTime } from "@/lib/quote-engine";
import {
  formatTimeAgo,
  normalizeEmail,
  type ShipmentRecord,
  type SupportMessage,
  type SupportThread,
} from "@/types/tracking";

const TOPICS = [
  "Tracking or delivery question",
  "Customs & duties inquiry",
  "Update receiver or address",
  "Billing or refund",
  "Other",
];

export function DashboardSupport({
  user,
  displayName,
  allUnique,
  routeThreadId,
}: {
  user: User;
  displayName: string;
  allUnique: ShipmentRecord[];
  routeThreadId?: string;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const isNewMode =
    location.pathname.endsWith("/support/new") || routeThreadId === "new";

  const [threads, setThreads] = useState<SupportThread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(true);
  const [msgSnapshot, setMsgSnapshot] = useState<{
    threadId: string;
    items: SupportMessage[];
  } | null>(null);

  // New message state
  const [topic, setTopic] = useState(TOPICS[0]);
  const [relatedCode, setRelatedCode] = useState("");
  const [newMessage, setNewMessage] = useState("");
  const [sendingNew, setSendingNew] = useState(false);

  // Reply state
  const [replyText, setReplyText] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  const msgsEndRef = useRef<HTMLDivElement>(null);

  // Subscribe live to supportThreads owned by this user
  useEffect(() => {
    const cleanEmail = normalizeEmail(user.email || "");
    const uidMap = new Map<string, SupportThread>();
    const emailMap = new Map<string, SupportThread>();
    let gotUid = false;
    let gotEmail = !(user.emailVerified && cleanEmail);

    const mergeAndSet = () => {
      const merged = new Map<string, SupportThread>();
      uidMap.forEach((v, k) => merged.set(k, v));
      emailMap.forEach((v, k) => merged.set(k, v));
      const list = Array.from(merged.values()).sort(
        (a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0)
      );
      setThreads(list);
      if (gotUid && gotEmail) setThreadsLoading(false);
    };

    const unsubUid = onSnapshot(
      query(collection(db, "supportThreads"), where("uid", "==", user.uid)),
      (snap) => {
        uidMap.clear();
        snap.docs.forEach((d) => {
          uidMap.set(d.id, { ...(d.data() as Omit<SupportThread, "id">), id: d.id });
        });
        gotUid = true;
        mergeAndSet();
      },
      () => {
        gotUid = true;
        mergeAndSet();
      }
    );

    const unsubEmail =
      user.emailVerified && cleanEmail
        ? onSnapshot(
            query(
              collection(db, "supportThreads"),
              where("userEmail", "==", cleanEmail)
            ),
            (snap) => {
              emailMap.clear();
              snap.docs.forEach((d) => {
                emailMap.set(d.id, {
                  ...(d.data() as Omit<SupportThread, "id">),
                  id: d.id,
                });
              });
              gotEmail = true;
              mergeAndSet();
            },
            () => {
              gotEmail = true;
              mergeAndSet();
            }
          )
        : () => undefined;

    return () => {
      unsubUid();
      unsubEmail();
    };
  }, [user.uid, user.email, user.emailVerified]);

  const activeThread = useMemo(() => {
    if (isNewMode) return null;
    if (routeThreadId) {
      return threads.find((t) => t.id === routeThreadId) || null;
    }
    return null;
  }, [isNewMode, routeThreadId, threads]);

  const messages = useMemo(
    () =>
      activeThread?.id && msgSnapshot?.threadId === activeThread.id
        ? msgSnapshot.items
        : [],
    [activeThread, msgSnapshot]
  );
  const msgsLoading = Boolean(
    activeThread?.id && msgSnapshot?.threadId !== activeThread.id
  );

  // Subscribe live to active thread messages & clear unreadUser flag
  useEffect(() => {
    const tid = activeThread?.id;
    if (!tid) {
      return;
    }

    if (activeThread.unreadUser) {
      updateDoc(doc(db, "supportThreads", tid), {
        unreadUser: false,
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
      () => {
        setMsgSnapshot({ threadId: tid, items: [] });
      }
    );

    return () => unsub();
  }, [activeThread?.id, activeThread?.unreadUser]);

  const handleCreateThread = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim()) {
      toast.error("Write a short message for our team.");
      return;
    }
    setSendingNew(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/support/contact", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: displayName,
          email: user.email,
          code: relatedCode || undefined,
          subject: topic,
          message: newMessage.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Unable to send message.");
      }
      setNewMessage("");
      toast.success(`Conversation started (${data.ticketCode})`);
      if (data.threadId) {
        navigate(`/dashboard/support/${data.threadId}`);
      } else {
        navigate("/dashboard/support");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to send message.");
    } finally {
      setSendingNew(false);
    }
  };

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeThread || !replyText.trim()) return;
    setSendingReply(true);
    try {
      const token = await user.getIdToken();
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
      if (!res.ok) {
        throw new Error(data.error || "Unable to send reply.");
      }
      setReplyText("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send reply.");
    } finally {
      setSendingReply(false);
    }
  };

  const hasChatOpen = Boolean(isNewMode || routeThreadId);

  return (
    <div className={`sp ${hasChatOpen ? "has-chat" : ""}`}>
      {/* Thread list */}
      <div className="dx-card sp-list">
        <div className="dx-ch">
          <h3>Conversations</h3>
          <Link
            to="/dashboard/support/new"
            className="sw-btn sw-btn-em"
            style={{ padding: "7px 12px", fontSize: 12 }}
          >
            <Plus className="w-3.5 h-3.5" />
            New message
          </Link>
        </div>

        <div className="sp-ths">
          {threadsLoading ? (
            <div className="dx-cb">
              <div className="dx-skel" style={{ height: 64, marginBottom: 8 }} />
              <div className="dx-skel" style={{ height: 64 }} />
            </div>
          ) : threads.length === 0 ? (
            <div className="sp-none">
              No conversations yet. Start a message or email{" "}
              <b className="mono">support@mail.shipwell.cc</b>.
            </div>
          ) : (
            threads.map((th) => {
              const isSelected = th.id === activeThread?.id;
              return (
                <button
                  key={th.id}
                  type="button"
                  className={`sp-th ${isSelected ? "on" : ""}`}
                  onClick={() => navigate(`/dashboard/support/${th.id}`)}
                >
                  <div className="sp-av">
                    <MessageSquare className="w-4 h-4" />
                  </div>
                  <div className="m">
                    <b>{th.subject}</b>
                    <small>
                      {th.code ? `${th.code} · ` : ""}
                      {th.lastMessagePreview || th.ticketCode}
                    </small>
                  </div>
                  <div className="r">
                    <time>
                      {th.lastMessageAt
                        ? formatTimeAgo(th.lastMessageAt)
                        : "now"}
                    </time>
                    {th.unreadUser && <i aria-label="Unread reply" />}
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div
          style={{
            padding: "14px 18px",
            borderTop: "1px solid var(--border)",
            background: "var(--card2)",
          }}
        >
          <div
            style={{
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              color: "var(--faint)",
              marginBottom: 4,
              fontWeight: 700,
            }}
          >
            Support Email
          </div>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="mono" style={{ fontSize: 12.5 }}>
              support@mail.shipwell.cc
            </span>
            <button
              type="button"
              className="sp-cp"
              style={{ marginTop: 0 }}
              onClick={() => {
                navigator.clipboard.writeText("support@mail.shipwell.cc");
                toast.success("Support email copied");
              }}
            >
              <Copy className="w-3 h-3" />
              Copy
            </button>
          </div>
        </div>
      </div>

      {/* Right pane: empty hero, new thread composer, or live conversation */}
      <div className="dx-card sp-pane">
        {isNewMode ? (
          <>
            <div className="dx-ch sp-chh">
              <div>
                <button
                  type="button"
                  className="sp-back"
                  onClick={() => navigate("/dashboard/support")}
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  All conversations
                </button>
                <h3>New support message</h3>
              </div>
              <span className="chip g">Live</span>
            </div>
            <form className="dx-cb sp-form" onSubmit={handleCreateThread}>
              <div className="g2">
                <div className="fw">
                  <label className="lbl" htmlFor="sup-topic">
                    Topic
                  </label>
                  <select
                    id="sup-topic"
                    className="field"
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                  >
                    {TOPICS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="fw">
                  <label className="lbl" htmlFor="sup-parcel">
                    Parcel (optional)
                  </label>
                  <select
                    id="sup-parcel"
                    className="field mono"
                    value={relatedCode}
                    onChange={(e) => setRelatedCode(e.target.value)}
                  >
                    <option value="">General question</option>
                    {allUnique.map((s) => (
                      <option key={s.code} value={s.code}>
                        {s.code} — {s.contents}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="fw">
                <label className="lbl" htmlFor="sup-msg">
                  Message
                </label>
                <textarea
                  id="sup-msg"
                  className="field"
                  rows={5}
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="Describe what you need help with..."
                  required
                />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="sw-btn sw-btn-ghost"
                  onClick={() => navigate("/dashboard/support")}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={sendingNew}
                  className="sw-btn sw-btn-em"
                >
                  {sendingNew ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                  Send message
                </button>
              </div>
            </form>
          </>
        ) : activeThread ? (
          <>
            <div className="dx-ch sp-chh">
              <div>
                <button
                  type="button"
                  className="sp-back"
                  onClick={() => navigate("/dashboard/support")}
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  All conversations
                </button>
                <h3>{activeThread.subject}</h3>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
                  <span className="mono">{activeThread.ticketCode}</span>
                  {activeThread.code && (
                    <>
                      {" · "}
                      <Link
                        to={`/dashboard/track/${activeThread.code}`}
                        style={{ color: "var(--em2)" }}
                      >
                        {activeThread.code}
                      </Link>
                    </>
                  )}
                </div>
              </div>
              <span
                className={`chip ${activeThread.status === "closed" ? "n" : "g"}`}
              >
                {activeThread.status === "closed" ? "Closed" : "Open"}
              </span>
            </div>

            <div className="sp-msgs">
              {msgsLoading ? (
                <div className="dx-skel" style={{ height: 120 }} />
              ) : (
                messages.map((m) => (
                  <div
                    key={m.id}
                    className={`sp-b ${m.from === "user" ? "me" : "them"}`}
                  >
                    <div className="sp-bt">{m.body}</div>
                    <small>
                      {m.from === "user" ? "You" : "ShipWell Support"} ·{" "}
                      {formatDateTime(m.ts)}
                    </small>
                  </div>
                ))
              )}
              <div ref={msgsEndRef} />
            </div>

            <form className="sp-reply" onSubmit={handleSendReply}>
              <textarea
                className="field"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder={
                  activeThread.status === "closed"
                    ? "Reply to reopen this conversation..."
                    : "Write a reply..."
                }
                rows={2}
              />
              <button
                type="submit"
                disabled={sendingReply || !replyText.trim()}
                className="sw-btn sw-btn-em"
              >
                {sendingReply ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                Send
              </button>
            </form>
          </>
        ) : (
          <div className="sp-hero">
            <div className="au-ic" style={{ margin: 0 }}>
              <Mail className="w-6 h-6" />
            </div>
            <h3>HOW CAN WE HELP?</h3>
            <p>
              Message our operations team here for customs assistance, address
              changes, or delivery questions — or email us directly and it threads
              straight into your inbox.
            </p>
            <div className="sp-ch">
              <div>
                <small>Direct support email</small>
                <b className="mono">support@mail.shipwell.cc</b>
                <br />
                <button
                  type="button"
                  className="sp-cp"
                  onClick={() => {
                    navigator.clipboard.writeText("support@mail.shipwell.cc");
                    toast.success("Copied support@mail.shipwell.cc");
                  }}
                >
                  <Copy className="w-3 h-3" />
                  Copy email
                </button>
              </div>
              <div>
                <small>Response time</small>
                <b>24/7 Operations Desk</b>
                <br />
                <span style={{ fontSize: 12, color: "var(--muted)" }}>
                  Replies reach your inbox &amp; email
                </span>
              </div>
            </div>
            <Link to="/dashboard/support/new" className="sw-btn sw-btn-em sw-btn-lg">
              <Plus className="w-4 h-4" />
              Start a conversation
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
