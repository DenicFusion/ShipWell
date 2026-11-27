import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from "firebase/auth";
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
  CheckCheck,
  Inbox,
  Loader2,
  LogOut,
  RefreshCw,
  Search,
  Send,
  Star,
} from "lucide-react";
import toast from "react-hot-toast";
import { auth, db } from "@/lib/firebase";
import { useShipWell } from "@/components/providers/ShipWellProvider";
import { ShipwellLogo } from "@/components/ShipwellLogo";
import type { SupportMessage, SupportThread } from "@/types/tracking";

type Folder = "inbox" | "sent" | "starred";

interface SentMail {
  id: string;
  to: string;
  from: string;
  subject: string;
  template: string;
  code: string;
  status: string;
  ts: number;
  html: string;
}

const STAR_KEY = "sw_webmail_stars";

function loadStars(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(STAR_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function fmtTime(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString([], { day: "numeric", month: "short" });
  }
  return d.toLocaleDateString([], { day: "numeric", month: "short", year: "2-digit" });
}

function fmtFull(ts: number): string {
  return ts ? new Date(ts).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "";
}

const AVATAR_COLORS = ["#0E9F6E", "#2563EB", "#9333EA", "#D97706", "#DB2777", "#0891B2", "#65A30D"];
function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function Avatar({ name }: { name: string }) {
  const letter = (name.trim()[0] || "?").toUpperCase();
  return (
    <span className="wm-av" style={{ background: avatarColor(name) }}>
      {letter}
    </span>
  );
}

function MailFrame({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const srcDoc = `<base target="_blank"><style>body{margin:0;background:#fff}img{max-width:100%;height:auto}</style>${html}`;
  const fit = () => {
    const f = ref.current;
    const h = f?.contentDocument?.documentElement?.scrollHeight;
    if (f && h) f.style.height = `${h + 8}px`;
  };
  return (
    <iframe
      ref={ref}
      title="Email"
      className="wm-frame"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      srcDoc={srcDoc}
      onLoad={fit}
    />
  );
}

function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const google = async () => {
    setBusy(true);
    setError("");
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in failed.");
    } finally {
      setBusy(false);
    }
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch {
      setError("Incorrect email or password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wm-center">
      <form className="wm-card" onSubmit={submit}>
        <ShipwellLogo subtitle="Mail" />
        <h1>Sign in to ShipWell Mail</h1>
        <p>Admin and support team only.</p>
        <button type="button" className="wm-btn wm-btn-ghost" onClick={google} disabled={busy}>
          Continue with Google
        </button>
        <div className="wm-or">or</div>
        <input
          className="wm-input"
          type="email"
          placeholder="Email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          className="wm-input"
          type="password"
          placeholder="Password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && <div className="wm-err">{error}</div>}
        <button className="wm-btn" disabled={busy}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Sign in"}
        </button>
      </form>
    </div>
  );
}

export default function WebmailPage() {
  const { user, authReady, isAdmin } = useShipWell();
  const [folder, setFolder] = useState<Folder>("inbox");
  const [threads, setThreads] = useState<SupportThread[]>([]);
  const [msgs, setMsgs] = useState<{ id: string; items: SupportMessage[] }>({ id: "", items: [] });
  const [sent, setSent] = useState<SentMail[]>([]);
  const [sentLoading, setSentLoading] = useState(false);
  const [openId, setOpenId] = useState("");
  const [q, setQ] = useState("");
  const [stars, setStars] = useState<Set<string>>(() => loadStars());
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = "ShipWell Mail";
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    return onSnapshot(
      query(collection(db, "supportThreads"), orderBy("lastMessageAt", "desc"), limit(150)),
      (snap) =>
        setThreads(snap.docs.map((d) => ({ ...(d.data() as Omit<SupportThread, "id">), id: d.id }))),
      () => undefined
    );
  }, [isAdmin]);

  const loadSent = useCallback(async () => {
    setSentLoading(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch("/api/mail/messages", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Could not load sent mail.");
      setSent(data.items || []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load sent mail.");
    } finally {
      setSentLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin && (folder === "sent" || folder === "starred") && sent.length === 0) loadSent();
  }, [isAdmin, folder, sent.length, loadSent]);

  const openThread = threads.find((t) => t.id === openId) || null;
  const openMail = sent.find((m) => m.id === openId) || null;

  useEffect(() => {
    if (!openThread) return;
    if (openThread.unreadAdmin) {
      updateDoc(doc(db, "supportThreads", openThread.id), {
        unreadAdmin: false,
        updatedAt: serverTimestamp(),
      }).catch(() => undefined);
    }
    const tid = openThread.id;
    return onSnapshot(
      query(collection(db, "supportThreads", tid, "messages"), orderBy("ts", "asc")),
      (snap) => {
        setMsgs({
          id: tid,
          items: snap.docs.map((d) => ({ ...(d.data() as Omit<SupportMessage, "id">), id: d.id })),
        });
        setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 60);
      },
      () => undefined
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openThread?.id]);

  const toggleStar = (id: string) => {
    setStars((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(STAR_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const needle = q.trim().toLowerCase();
  const threadRows = useMemo(
    () =>
      threads.filter((t) => {
        if (folder === "starred" && !stars.has(t.id)) return false;
        if (!needle) return true;
        return (
          t.subject.toLowerCase().includes(needle) ||
          t.userName.toLowerCase().includes(needle) ||
          t.userEmail.toLowerCase().includes(needle) ||
          (t.lastMessagePreview || "").toLowerCase().includes(needle)
        );
      }),
    [threads, folder, stars, needle]
  );
  const sentRows = useMemo(
    () =>
      sent.filter((m) => {
        if (folder === "starred" && !stars.has(m.id)) return false;
        if (!needle) return true;
        return (
          m.to.toLowerCase().includes(needle) ||
          m.subject.toLowerCase().includes(needle) ||
          m.code.toLowerCase().includes(needle)
        );
      }),
    [sent, folder, stars, needle]
  );

  const unread = threads.filter((t) => t.unreadAdmin).length;

  const sendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!openThread || !reply.trim()) return;
    setSending(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch("/api/support/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ threadId: openThread.id, message: reply.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Could not send the reply.");
      setReply("");
      toast.success(`Reply emailed to ${openThread.userEmail}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send the reply.");
    } finally {
      setSending(false);
    }
  };

  const toggleClosed = async () => {
    if (!openThread) return;
    await updateDoc(doc(db, "supportThreads", openThread.id), {
      status: openThread.status === "closed" ? "open" : "closed",
      updatedAt: serverTimestamp(),
    }).catch(() => toast.error("Could not update the thread."));
  };

  if (!authReady) {
    return (
      <div className="wm-center">
        <Loader2 className="w-6 h-6 animate-spin" />
        <style>{css}</style>
      </div>
    );
  }
  if (!user) {
    return (
      <>
        <style>{css}</style>
        <SignIn />
      </>
    );
  }
  if (!isAdmin) {
    return (
      <>
        <style>{css}</style>
        <div className="wm-center">
          <div className="wm-card">
            <h1>No access</h1>
            <p>{user.email} is not a ShipWell admin account.</p>
            <button className="wm-btn" onClick={() => signOut(auth)}>
              Sign out
            </button>
          </div>
        </div>
      </>
    );
  }

  const showingThread = folder !== "sent" && Boolean(openThread);
  const showingMail = folder === "sent" && Boolean(openMail);
  const readingOpen = showingThread || showingMail || (folder === "starred" && Boolean(openMail));

  return (
    <div className={`wm ${readingOpen ? "reading" : ""}`}>
      <style>{css}</style>

      <header className="wm-top">
        <ShipwellLogo subtitle="Mail" />
        <label className="wm-search">
          <Search className="w-4 h-4" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search mail" />
        </label>
        <button className="wm-icon" onClick={() => signOut(auth)} aria-label="Sign out" title="Sign out">
          <LogOut className="w-4 h-4" />
        </button>
      </header>

      <nav className="wm-nav">
        {(
          [
            ["inbox", "Inbox", Inbox, unread],
            ["sent", "Sent", Send, 0],
            ["starred", "Starred", Star, 0],
          ] as const
        ).map(([key, label, Icon, badge]) => (
          <button
            key={key}
            className={folder === key ? "on" : ""}
            onClick={() => {
              setFolder(key);
              setOpenId("");
            }}
          >
            <Icon className="w-4 h-4" />
            <span>{label}</span>
            {badge > 0 && <i>{badge}</i>}
          </button>
        ))}
      </nav>

      <section className="wm-list">
        <div className="wm-listhead">
          <b>{folder === "inbox" ? "Customer messages" : folder === "sent" ? "Sent by ShipWell" : "Starred"}</b>
          {(folder === "sent" || folder === "starred") && (
            <button className="wm-icon" onClick={loadSent} aria-label="Refresh" disabled={sentLoading}>
              <RefreshCw className={`w-4 h-4 ${sentLoading ? "animate-spin" : ""}`} />
            </button>
          )}
        </div>

        {(folder === "inbox" || folder === "starred") &&
          threadRows.map((t) => (
            <div
              key={t.id}
              className={`wm-row ${t.unreadAdmin ? "unread" : ""} ${openId === t.id ? "sel" : ""}`}
              onClick={() => setOpenId(t.id)}
            >
              <Avatar name={t.userName || t.userEmail} />
              <div className="wm-mid">
                <div className="wm-l1">
                  <b>{t.userName || t.userEmail}</b>
                  <time>{fmtTime(t.lastMessageAt)}</time>
                </div>
                <div className="wm-l2">{t.subject}</div>
                <div className="wm-l3">
                  {t.lastMessagePreview}
                  {t.status === "closed" && <em> · Closed</em>}
                </div>
              </div>
              <button
                className={`wm-star ${stars.has(t.id) ? "on" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleStar(t.id);
                }}
                aria-label="Star"
              >
                <Star className="w-4 h-4" />
              </button>
            </div>
          ))}

        {(folder === "sent" || folder === "starred") &&
          sentRows.map((m) => (
            <div
              key={m.id}
              className={`wm-row ${openId === m.id ? "sel" : ""}`}
              onClick={() => setOpenId(m.id)}
            >
              <Avatar name={m.to} />
              <div className="wm-mid">
                <div className="wm-l1">
                  <b>To: {m.to}</b>
                  <time>{fmtTime(m.ts)}</time>
                </div>
                <div className="wm-l2">{m.subject}</div>
                <div className="wm-l3">
                  {m.template}
                  {m.code ? ` · ${m.code}` : ""}
                  {m.status === "failed" || m.status === "bounced" ? ` · ${m.status}` : ""}
                </div>
              </div>
              <button
                className={`wm-star ${stars.has(m.id) ? "on" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleStar(m.id);
                }}
                aria-label="Star"
              >
                <Star className="w-4 h-4" />
              </button>
            </div>
          ))}

        {folder === "inbox" && threadRows.length === 0 && <div className="wm-empty">No messages yet.</div>}
        {folder === "sent" && sentRows.length === 0 && !sentLoading && (
          <div className="wm-empty">No sent mail found.</div>
        )}
        {folder === "starred" && threadRows.length === 0 && sentRows.length === 0 && (
          <div className="wm-empty">Star a message to find it here.</div>
        )}
        {sentLoading && sent.length === 0 && (
          <div className="wm-empty">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        )}
      </section>

      <section className="wm-read">
        {!openThread && !openMail && <div className="wm-empty big">Select a message to read it.</div>}

        {openThread && (
          <>
            <div className="wm-rhead">
              <button className="wm-icon wm-back" onClick={() => setOpenId("")} aria-label="Back">
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div className="wm-rtitle">
                <h2>{openThread.subject}</h2>
                <small>
                  {openThread.userName} &lt;{openThread.userEmail}&gt; · {openThread.ticketCode}
                  {openThread.code ? ` · ${openThread.code}` : ""}
                </small>
              </div>
              <button className="wm-btn wm-btn-ghost wm-sm" onClick={toggleClosed}>
                <CheckCheck className="w-4 h-4" /> {openThread.status === "closed" ? "Reopen" : "Close"}
              </button>
            </div>
            <div className="wm-scroll">
              {(msgs.id === openThread.id ? msgs.items : []).map((m) => (
                <div key={m.id} className={`wm-msg ${m.from === "admin" ? "me" : ""}`}>
                  <div className="wm-mh">
                    <b>{m.from === "admin" ? "ShipWell Support" : m.senderName}</b>
                    <time>{fmtFull(m.ts)}</time>
                  </div>
                  <div className="wm-mb">{m.body}</div>
                </div>
              ))}
              <div ref={endRef} />
            </div>
            <form className="wm-reply" onSubmit={sendReply}>
              <textarea
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder={`Reply to ${openThread.userName}. It is emailed from support@mail.shipwell.cc`}
                rows={3}
              />
              <button className="wm-btn" disabled={sending || !reply.trim()}>
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send
              </button>
            </form>
          </>
        )}

        {openMail && !openThread && (
          <>
            <div className="wm-rhead">
              <button className="wm-icon wm-back" onClick={() => setOpenId("")} aria-label="Back">
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div className="wm-rtitle">
                <h2>{openMail.subject}</h2>
                <small>
                  From {openMail.from} · To {openMail.to}
                </small>
                <small>{fmtFull(openMail.ts)} · {openMail.status}</small>
              </div>
            </div>
            <div className="wm-scroll">
              {openMail.html ? (
                <MailFrame html={openMail.html} />
              ) : (
                <div className="wm-empty">No preview was stored for this email.</div>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

const css = `
.wm, .wm-center { font-family: var(--font-outfit), system-ui, sans-serif; color: var(--text); background: var(--bg); }
.wm-center { min-height: 100dvh; display: flex; align-items: center; justify-content: center; padding: 16px; }
.wm-card { width: 100%; max-width: 380px; background: var(--card); border: 1px solid var(--border); border-radius: 20px; padding: 26px 22px; display: grid; gap: 12px; }
.wm-card h1 { font-size: 1.3rem; margin: 6px 0 0; }
.wm-card p { color: var(--muted); font-size: 13.5px; margin: 0 0 4px; }
.wm-or { text-align: center; color: var(--muted); font-size: 12px; }
.wm-input { background: var(--card2); border: 1px solid var(--border); color: var(--text); border-radius: 12px; padding: 12px 14px; font-size: 14.5px; width: 100%; min-width: 0; }
.wm-err { font-size: 12.5px; color: #fb7185; background: rgba(244,63,94,.08); border: 1px solid rgba(244,63,94,.25); padding: 9px 12px; border-radius: 10px; }
.wm-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; background: var(--em); color: #04120C; border: 0; border-radius: 12px; padding: 12px 18px; font-weight: 700; font-size: 14px; cursor: pointer; }
.wm-btn:disabled { opacity: .55; cursor: default; }
.wm-btn-ghost { background: var(--card2); color: var(--text); border: 1px solid var(--border); }
.wm-sm { padding: 8px 12px; font-size: 12.5px; white-space: nowrap; }
.wm-icon { width: 38px; height: 38px; border-radius: 10px; border: 1px solid var(--border); background: var(--card2); color: var(--muted); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; }

.wm { height: 100dvh; display: grid; grid-template-columns: 360px minmax(0,1fr); grid-template-rows: auto auto minmax(0,1fr); grid-template-areas: "top top" "nav nav" "list read"; }
.wm-top { grid-area: top; display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-bottom: 1px solid var(--border); background: var(--card); }
.wm-search { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; background: var(--card2); border: 1px solid var(--border); border-radius: 12px; padding: 0 12px; color: var(--muted); max-width: 520px; }
.wm-search input { flex: 1; min-width: 0; background: none; border: 0; outline: 0; color: var(--text); padding: 10px 0; font-size: 14px; }
.wm-nav { grid-area: nav; display: flex; gap: 6px; padding: 8px 12px; border-bottom: 1px solid var(--border); background: var(--card); overflow-x: auto; }
.wm-nav button { display: inline-flex; align-items: center; gap: 7px; padding: 8px 14px; border-radius: 999px; border: 1px solid var(--border); background: var(--card2); color: var(--muted); font-size: 13.5px; font-weight: 600; cursor: pointer; white-space: nowrap; }
.wm-nav button.on { background: rgba(16,185,129,.14); color: var(--em); border-color: rgba(16,185,129,.4); }
.wm-nav i { font-style: normal; background: var(--em); color: #04120C; border-radius: 999px; font-size: 11px; padding: 1px 7px; font-weight: 800; }

.wm-list { grid-area: list; overflow-y: auto; border-right: 1px solid var(--border); min-width: 0; }
.wm-listhead { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; position: sticky; top: 0; background: var(--bg); z-index: 1; border-bottom: 1px solid var(--border); font-size: 13px; color: var(--muted); }
.wm-row { display: flex; gap: 12px; padding: 12px 14px; border-bottom: 1px solid var(--border2); cursor: pointer; align-items: flex-start; min-width: 0; }
.wm-row:hover { background: var(--card2); }
.wm-row.sel { background: rgba(16,185,129,.09); }
.wm-av { width: 38px; height: 38px; border-radius: 50%; color: #fff; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
.wm-mid { flex: 1; min-width: 0; }
.wm-l1 { display: flex; justify-content: space-between; gap: 8px; font-size: 14px; }
.wm-l1 b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.wm-row.unread .wm-l1 b, .wm-row.unread .wm-l2 { font-weight: 800; color: var(--text); }
.wm-l1 time { color: var(--muted); font-size: 11.5px; flex-shrink: 0; }
.wm-l2 { font-size: 13.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wm-l3 { font-size: 12.5px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wm-star { background: none; border: 0; color: var(--faint); cursor: pointer; padding: 4px; }
.wm-star.on { color: var(--amber); }
.wm-star.on svg { fill: var(--amber); }
.wm-empty { padding: 28px 16px; color: var(--muted); text-align: center; font-size: 13.5px; }
.wm-empty.big { margin: auto; }

.wm-read { grid-area: read; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.wm-rhead { display: flex; align-items: flex-start; gap: 10px; padding: 12px 14px; border-bottom: 1px solid var(--border); }
.wm-rtitle { flex: 1; min-width: 0; display: grid; gap: 2px; }
.wm-rtitle h2 { margin: 0; font-size: 1.1rem; overflow-wrap: anywhere; }
.wm-rtitle small { color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
.wm-back { display: none; }
.wm-scroll { flex: 1; overflow-y: auto; padding: 14px; min-height: 0; }
.wm-msg { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 12px 14px; margin-bottom: 12px; max-width: 760px; }
.wm-msg.me { background: rgba(16,185,129,.08); border-color: rgba(16,185,129,.3); margin-left: auto; }
.wm-mh { display: flex; justify-content: space-between; gap: 8px; font-size: 12.5px; margin-bottom: 6px; }
.wm-mh time { color: var(--muted); }
.wm-mb { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14.5px; line-height: 1.55; }
.wm-reply { display: flex; gap: 10px; align-items: flex-end; padding: 10px 14px calc(10px + env(safe-area-inset-bottom)); border-top: 1px solid var(--border); background: var(--card); }
.wm-reply textarea { flex: 1; min-width: 0; resize: none; background: var(--card2); border: 1px solid var(--border); color: var(--text); border-radius: 12px; padding: 10px 12px; font: inherit; font-size: 14px; }
.wm-frame { width: 100%; border: 0; border-radius: 12px; background: #fff; min-height: 480px; }

@media (max-width: 900px) {
  .wm { grid-template-columns: minmax(0,1fr); grid-template-areas: "top" "nav" "list"; }
  .wm-read { display: none; }
  .wm.reading { grid-template-areas: "top" "nav" "read"; }
  .wm.reading .wm-list { display: none; }
  .wm.reading .wm-read { display: flex; }
  .wm-back { display: inline-flex; }
  .wm-top .sw-logo-s, .wm-top .sw-logo-t { display: none; }
}
`;
