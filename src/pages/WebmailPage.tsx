import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import {
  ArrowLeft,
  Ban,
  CheckCheck,
  Copy,
  FileEdit,
  Inbox,
  Loader2,
  LogOut,
  Mail,
  MailOpen,
  Megaphone,
  RefreshCw,
  Reply,
  Search,
  Send,
  ShieldAlert,
  Star,
  Users,
} from "lucide-react";
import toast from "react-hot-toast";
import { auth } from "@/lib/firebase";
import { useShipWell } from "@/components/providers/ShipWellProvider";
import { ShipwellLogo } from "@/components/ShipwellLogo";
import { AdminAppControls } from "@/components/admin/AdminAppControls";
import { AttachPicker, AttachmentList } from "@/components/AttachmentView";
import { toPayload, type AttachmentMeta, type OutgoingAttachment } from "@/lib/attachments";

type Folder = "inbox" | "starred" | "sent" | "drafts" | "spam" | "broadcast" | "team";

interface Me {
  role: "owner" | "support";
  name: string;
  email: string;
  supportAddress: string;
}
interface ThreadRow {
  id: string;
  ticketCode: string;
  userName: string;
  userEmail: string;
  subject: string;
  code: string;
  status: "open" | "closed";
  source: "web" | "email";
  unread: boolean;
  spam: boolean;
  lastMessageAt: number;
  preview: string;
}
interface Msg {
  id: string;
  from: "admin" | "user";
  senderName: string;
  senderEmail: string;
  body: string;
  ts: number;
  source: string;
  attachments: AttachmentMeta[];
}
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
interface Draft {
  id: string;
  kind: "reply" | "broadcast";
  threadId: string;
  toName: string;
  subject: string;
  body: string;
  audience: string;
  ctaLabel: string;
  ctaUrl: string;
  updatedAt: number;
}
interface Member {
  id: string;
  email: string;
  name: string;
  role: "owner" | "support";
  active: boolean;
}
interface Invite {
  id: string;
  email: string;
  name: string;
  expiresAt: number;
}
interface BroadcastRow {
  id: string;
  subject: string;
  audience: string;
  count: number;
  sent: number;
  failed: number;
  by: string;
  at: number;
}

const STAR_KEY = "sw_webmail_stars";
const loadStars = (): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(STAR_KEY) || "[]"));
  } catch {
    return new Set();
  }
};

async function api<T = Record<string, unknown>>(
  path: string,
  method = "GET",
  body?: unknown
): Promise<T> {
  const token = await auth.currentUser?.getIdToken();
  const res = await fetch(path, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${token}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string })?.error || "Something went wrong.");
  return data as T;
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
const fmtFull = (ts: number) =>
  ts ? new Date(ts).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "";

const AVATAR_COLORS = ["#0E9F6E", "#2563EB", "#9333EA", "#D97706", "#DB2777", "#0891B2", "#65A30D"];
function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function Avatar({ name }: { name: string }) {
  return (
    <span className="wm-av" style={{ background: avatarColor(name) }}>
      {(name.trim()[0] || "?").toUpperCase()}
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

/* ───────── sign in / join ───────── */

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
        <p>Team members only.</p>
        <button type="button" className="wm-btn wm-btn-ghost" onClick={google} disabled={busy}>
          Continue with Google
        </button>
        <div className="wm-or">or</div>
        <input className="wm-input" type="email" placeholder="Email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input className="wm-input" type="password" placeholder="Password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <div className="wm-err">{error}</div>}
        <button className="wm-btn" disabled={busy}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Sign in"}
        </button>
      </form>
    </div>
  );
}

function JoinScreen({ token, onDone }: { token: string; onDone: () => void }) {
  const [info, setInfo] = useState<{ name: string; email: string } | null>(null);
  const [bad, setBad] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/team/invite?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d?.error || "This invitation is no longer valid.");
        setInfo(d);
        setName(d.name || "");
      })
      .catch((e) => setBad(e instanceof Error ? e.message : "This invitation is no longer valid."));
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/team/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, name, password }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || "Could not create your account.");
      await signInWithEmailAndPassword(auth, d.email, password);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create your account.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wm-center">
      <form className="wm-card" onSubmit={submit}>
        <ShipwellLogo subtitle="Mail" />
        {bad ? (
          <>
            <h1>Invitation unavailable</h1>
            <p>{bad} Ask the owner to send a new one.</p>
          </>
        ) : !info ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : (
          <>
            <h1>Join the ShipWell team</h1>
            <p>Create your account for {info.email}.</p>
            <input className="wm-input" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={40} />
            <input className="wm-input" type="password" placeholder="Choose a password (8+ characters)" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
            {name.trim().length >= 2 && (
              <p>Customers will see: <b>{name.trim()} from ShipWell</b></p>
            )}
            {error && <div className="wm-err">{error}</div>}
            <button className="wm-btn" disabled={busy}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create account"}
            </button>
          </>
        )}
      </form>
    </div>
  );
}

/* ───────── broadcast ───────── */

function BroadcastPanel({
  drafts,
  refreshDrafts,
  initial,
}: {
  drafts: Draft[];
  refreshDrafts: () => void;
  initial: Draft | null;
}) {
  const [audience, setAudience] = useState(initial?.audience || "me");
  const [subject, setSubject] = useState(initial?.subject || "");
  const [message, setMessage] = useState(initial?.body || "");
  const [ctaLabel, setCtaLabel] = useState(initial?.ctaLabel || "");
  const [ctaUrl, setCtaUrl] = useState(initial?.ctaUrl || "");
  const [draftId, setDraftId] = useState(initial?.id || "");
  const [count, setCount] = useState<number | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<BroadcastRow[]>([]);
  const first = useRef(true);

  const loadHistory = useCallback(() => {
    api<{ items: BroadcastRow[] }>("/api/mail/broadcasts")
      .then((d) => setHistory(d.items))
      .catch(() => undefined);
  }, []);
  useEffect(loadHistory, [loadHistory]);

  useEffect(() => {
    setCount(null);
    setConfirm(false);
    api<{ count: number }>("/api/mail/broadcast/count", "POST", { audience })
      .then((d) => setCount(d.count))
      .catch(() => setCount(null));
  }, [audience]);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => {
      api<{ id: string }>("/api/mail/drafts", "PUT", {
        kind: "broadcast",
        id: draftId,
        subject,
        body: message,
        audience,
        ctaLabel,
        ctaUrl,
      })
        .then((d) => {
          if (d.id) setDraftId(d.id);
          refreshDrafts();
        })
        .catch(() => undefined);
    }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject, message, audience, ctaLabel, ctaUrl]);

  const send = async () => {
    if (count === null) return;
    setBusy(true);
    try {
      const r = await api<{ sent: number; failed: number }>("/api/mail/broadcast/send", "POST", {
        audience,
        subject,
        message,
        ctaLabel,
        ctaUrl,
        confirmCount: count,
        draftId,
      });
      toast.success(`Sent to ${r.sent}${r.failed ? `, ${r.failed} failed` : ""}`);
      setSubject("");
      setMessage("");
      setCtaLabel("");
      setCtaUrl("");
      setDraftId("");
      setConfirm(false);
      refreshDrafts();
      loadHistory();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send the broadcast.");
    } finally {
      setBusy(false);
    }
  };

  const audLabel: Record<string, string> = {
    me: "Only me (test)",
    all: "All registered customers",
    active: "Customers with shipments in progress",
  };

  return (
    <div className="wm-panel">
      <div className="wm-pbox">
        <h2>New broadcast</h2>
        <p className="wm-muted">One email to many customers. Send to yourself first to check how it looks.</p>
        <label className="wm-lbl">Send to</label>
        <select className="wm-input" value={audience} onChange={(e) => setAudience(e.target.value)}>
          {Object.entries(audLabel).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <small className="wm-muted">{count === null ? "Counting…" : `${count} recipient${count === 1 ? "" : "s"}`}</small>
        <label className="wm-lbl">Subject</label>
        <input className="wm-input" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={150} />
        <label className="wm-lbl">Message</label>
        <textarea className="wm-input" rows={8} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={6000} />
        <div className="wm-two">
          <div>
            <label className="wm-lbl">Button text (optional)</label>
            <input className="wm-input" value={ctaLabel} onChange={(e) => setCtaLabel(e.target.value)} maxLength={40} />
          </div>
          <div>
            <label className="wm-lbl">Button link (https)</label>
            <input className="wm-input" value={ctaUrl} onChange={(e) => setCtaUrl(e.target.value)} placeholder="https://shipwell.cc" />
          </div>
        </div>
        {!confirm ? (
          <button className="wm-btn" disabled={busy || count === null || count === 0 || subject.trim().length < 3 || message.trim().length < 5} onClick={() => setConfirm(true)}>
            <Megaphone className="w-4 h-4" /> Review and send
          </button>
        ) : (
          <div className="wm-warn">
            <b>Send “{subject}” to {count} {count === 1 ? "person" : "people"}?</b>
            <span>This cannot be undone.</span>
            <div className="wm-row-btns">
              <button className="wm-btn" disabled={busy} onClick={send}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Yes, send now
              </button>
              <button className="wm-btn wm-btn-ghost" disabled={busy} onClick={() => setConfirm(false)}>Cancel</button>
            </div>
          </div>
        )}
        {drafts.some((d) => d.id === draftId) && <small className="wm-muted">Draft saved</small>}
      </div>

      <div className="wm-pbox">
        <h2>Sent broadcasts</h2>
        {history.length === 0 && <p className="wm-muted">None yet.</p>}
        {history.map((h) => (
          <div key={h.id} className="wm-hrow">
            <b>{h.subject}</b>
            <small className="wm-muted">
              {fmtFull(h.at)} · {audLabel[h.audience] || h.audience} · {h.sent}/{h.count} sent{h.failed ? ` · ${h.failed} failed` : ""} · {h.by}
            </small>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ───────── team ───────── */

function TeamPanel() {
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState("");

  const load = useCallback(() => {
    api<{ members: Member[]; invites: Invite[] }>("/api/mail/team")
      .then((d) => {
        setMembers(d.members);
        setInvites(d.invites);
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Could not load the team."));
  }, []);
  useEffect(load, [load]);

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<{ joinUrl: string; emailStatus: string }>("/api/mail/team/invite", "POST", { name, email });
      setLink(r.joinUrl);
      toast.success(r.emailStatus === "sent" ? "Invitation emailed" : "Invitation created. Copy the link below.");
      setName("");
      setEmail("");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not invite.");
    } finally {
      setBusy(false);
    }
  };

  const copy = (t: string) => {
    navigator.clipboard?.writeText(t).then(
      () => toast.success("Copied"),
      () => toast.error("Could not copy")
    );
  };

  return (
    <div className="wm-panel">
      <div className="wm-pbox">
        <h2>Invite a teammate</h2>
        <p className="wm-muted">They get an email, choose a password and sign in at webmail.shipwell.cc. Customers see “Name from ShipWell”.</p>
        <form onSubmit={invite} className="wm-two">
          <input className="wm-input" placeholder="Name (e.g. Daniel)" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={40} />
          <input className="wm-input" type="email" placeholder="Their email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <button className="wm-btn" disabled={busy}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />} Send invite
          </button>
        </form>
        {link && (
          <div className="wm-warn">
            <b>Invite link (valid 7 days)</b>
            <span className="wm-break">{link}</span>
            <button className="wm-btn wm-btn-ghost wm-sm" onClick={() => copy(link)}><Copy className="w-4 h-4" /> Copy link</button>
          </div>
        )}
      </div>

      <div className="wm-pbox">
        <h2>Team</h2>
        {members.map((m) => (
          <div key={m.id} className="wm-hrow wm-member">
            <div>
              <b>{m.name || m.email}</b> {m.role === "owner" && <em className="wm-tag">Owner</em>}
              {!m.active && <em className="wm-tag off">Off</em>}
              <small className="wm-muted wm-block">{m.email}</small>
            </div>
            {m.role !== "owner" && (
              <button
                className="wm-btn wm-btn-ghost wm-sm"
                onClick={() =>
                  api("/api/mail/team/active", "POST", { id: m.id, active: !m.active })
                    .then(load)
                    .catch((e) => toast.error(e.message))
                }
              >
                {m.active ? "Remove access" : "Restore access"}
              </button>
            )}
          </div>
        ))}
        {invites.length > 0 && <h3>Waiting to join</h3>}
        {invites.map((i) => (
          <div key={i.id} className="wm-hrow wm-member">
            <div>
              <b>{i.name}</b>
              <small className="wm-muted wm-block">{i.email}</small>
            </div>
            <button
              className="wm-btn wm-btn-ghost wm-sm"
              onClick={() => api("/api/mail/team/invite/revoke", "POST", { id: i.id }).then(load).catch((e) => toast.error(e.message))}
            >
              Cancel
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ───────── main ───────── */

export default function WebmailPage() {
  const { user, authReady } = useShipWell();
  const joinToken = useMemo(() => {
    try {
      return new URLSearchParams(window.location.search).get("join") || "";
    } catch {
      return "";
    }
  }, []);
  const [joined, setJoined] = useState(false);

  const [me, setMe] = useState<Me | null>(null);
  const [meState, setMeState] = useState<"loading" | "ok" | "denied">("loading");
  const [folder, setFolder] = useState<Folder>("inbox");
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [msgs, setMsgs] = useState<{ id: string; items: Msg[] }>({ id: "", items: [] });
  const [sent, setSent] = useState<SentMail[]>([]);
  const [sentLoading, setSentLoading] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [openId, setOpenId] = useState("");
  const [q, setQ] = useState("");
  const [stars, setStars] = useState<Set<string>>(() => loadStars());
  const [reply, setReply] = useState("");
  const [files, setFiles] = useState<OutgoingAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [draftNote, setDraftNote] = useState("");
  const [bcDraft, setBcDraft] = useState<Draft | null>(null);
  const [bcKey, setBcKey] = useState(0);
  const [nameEdit, setNameEdit] = useState(false);
  const [nameVal, setNameVal] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const loadedReply = useRef("");

  useEffect(() => {
    document.title = "ShipWell Mail";
  }, []);

  /* who am I */
  useEffect(() => {
    if (!user) {
      setMe(null);
      setMeState("loading");
      return;
    }
    let alive = true;
    api<Me>("/api/mail/me")
      .then((d) => {
        if (!alive) return;
        setMe(d);
        setNameVal(d.name);
        setMeState("ok");
      })
      .catch(() => alive && setMeState("denied"));
    return () => {
      alive = false;
    };
  }, [user, joined]);

  const owner = me?.role === "owner";

  const loadThreads = useCallback(async () => {
    try {
      const d = await api<{ items: ThreadRow[] }>("/api/mail/threads");
      setThreads(d.items);
    } catch {
      /* keep the last list */
    }
  }, []);
  const loadDrafts = useCallback(async () => {
    try {
      const d = await api<{ items: Draft[] }>("/api/mail/drafts");
      setDrafts(d.items);
    } catch {
      /* ignore */
    }
  }, []);
  const loadSent = useCallback(async () => {
    setSentLoading(true);
    try {
      const d = await api<{ items: SentMail[] }>("/api/mail/messages");
      setSent(d.items || []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load sent mail.");
    } finally {
      setSentLoading(false);
    }
  }, []);

  /* live-ish updates: poll every 10s while the tab is visible */
  useEffect(() => {
    if (meState !== "ok") return;
    loadThreads();
    loadDrafts();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") loadThreads();
    }, 10000);
    const onVis = () => document.visibilityState === "visible" && loadThreads();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [meState, loadThreads, loadDrafts]);

  useEffect(() => {
    if (meState === "ok" && owner && folder === "sent" && sent.length === 0) loadSent();
  }, [meState, owner, folder, sent.length, loadSent]);

  /* open a thread from a notification link (?thread=ID) */
  useEffect(() => {
    if (meState !== "ok") return;
    try {
      const id = new URLSearchParams(window.location.search).get("thread");
      if (id) {
        setFolder("inbox");
        setOpenId(id);
      }
    } catch {
      /* ignore */
    }
  }, [meState]);

  const openThread = threads.find((t) => t.id === openId) || null;
  const openMail = folder === "sent" || (folder === "starred" && !openThread) ? sent.find((m) => m.id === openId) || null : null;

  const loadMsgs = useCallback(async (id: string) => {
    try {
      const d = await api<{ messages: Msg[] }>(`/api/mail/thread/${encodeURIComponent(id)}`);
      setMsgs((prev) => {
        const grew = prev.id !== id || prev.items.length !== d.messages.length;
        if (grew) setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 60);
        return { id, items: d.messages };
      });
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!openThread) return;
    const tid = openThread.id;
    loadMsgs(tid).then(loadThreads);
    const t = setInterval(() => {
      if (document.visibilityState === "visible") loadMsgs(tid);
    }, 10000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openThread?.id]);

  /* load the saved reply draft when opening a thread */
  useEffect(() => {
    if (!openThread) return;
    const d = drafts.find((x) => x.kind === "reply" && x.threadId === openThread.id);
    const text = d?.body || "";
    loadedReply.current = text;
    setReply(text);
    setFiles([]);
    setDraftNote(d ? "Draft restored" : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openThread?.id]);

  /* autosave the reply draft */
  useEffect(() => {
    if (!openThread || reply === loadedReply.current) return;
    const tid = openThread.id;
    const t = setTimeout(() => {
      api("/api/mail/drafts", "PUT", {
        kind: "reply",
        threadId: tid,
        toName: openThread.userName,
        subject: openThread.subject,
        body: reply,
      })
        .then(() => {
          loadedReply.current = reply;
          setDraftNote(reply.trim() ? "Draft saved" : "");
          loadDrafts();
        })
        .catch(() => undefined);
    }, 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reply, openThread?.id]);

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
  const match = (t: ThreadRow) =>
    !needle ||
    t.subject.toLowerCase().includes(needle) ||
    t.userName.toLowerCase().includes(needle) ||
    t.userEmail.toLowerCase().includes(needle) ||
    t.preview.toLowerCase().includes(needle);

  const threadRows = useMemo(
    () =>
      threads.filter((t) => {
        if (folder === "spam") return t.spam && match(t);
        if (t.spam) return false;
        if (folder === "starred") return stars.has(t.id) && match(t);
        return match(t);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [threads, folder, stars, needle]
  );
  const sentRows = useMemo(
    () =>
      sent.filter((m) => {
        if (folder === "starred" && !stars.has(m.id)) return false;
        return !needle || m.to.toLowerCase().includes(needle) || m.subject.toLowerCase().includes(needle) || m.code.toLowerCase().includes(needle);
      }),
    [sent, folder, stars, needle]
  );
  const draftRows = useMemo(
    () => drafts.filter((d) => d.kind === "reply" || owner),
    [drafts, owner]
  );

  const unread = threads.filter((t) => t.unread && !t.spam).length;

  const setState = async (id: string, patch: Record<string, unknown>, okMsg?: string) => {
    try {
      await api(`/api/mail/thread/${encodeURIComponent(id)}/state`, "POST", patch);
      if (okMsg) toast.success(okMsg);
      await loadThreads();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update.");
    }
  };

  const sendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!openThread || (!reply.trim() && files.length === 0)) return;
    setSending(true);
    try {
      await api("/api/mail/reply", "POST", {
        threadId: openThread.id,
        message: reply.trim(),
        attachments: toPayload(files),
      });
      loadedReply.current = "";
      setReply("");
      setFiles([]);
      setDraftNote("");
      toast.success(`Sent to ${openThread.userEmail}`);
      await Promise.all([loadMsgs(openThread.id), loadThreads(), loadDrafts()]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send the reply.");
    } finally {
      setSending(false);
    }
  };

  const saveName = async () => {
    try {
      await api("/api/mail/me", "POST", { name: nameVal });
      setMe((m) => (m ? { ...m, name: nameVal.trim() } : m));
      setNameEdit(false);
      toast.success("Name saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save your name.");
    }
  };

  const goFolder = (f: Folder) => {
    setFolder(f);
    setOpenId("");
    if (f === "broadcast") {
      setBcDraft(null);
      setBcKey((k) => k + 1);
    }
  };

  /* ─── gates ─── */
  if (joinToken && !joined && !user) {
    return (
      <>
        <style>{css}</style>
        <JoinScreen
          token={joinToken}
          onDone={() => {
            setJoined(true);
            window.history.replaceState({}, "", window.location.pathname);
          }}
        />
      </>
    );
  }
  if (!authReady || (user && meState === "loading")) {
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
  if (meState === "denied" || !me) {
    return (
      <>
        <style>{css}</style>
        <div className="wm-center">
          <div className="wm-card">
            <h1>No access</h1>
            <p>{user.email} is not on the ShipWell team. Ask the owner to invite you.</p>
            <button className="wm-btn" onClick={() => signOut(auth)}>Sign out</button>
          </div>
        </div>
      </>
    );
  }

  const isPanel = folder === "broadcast" || folder === "team";
  const readingOpen = !isPanel && (Boolean(openThread) || Boolean(openMail));
  const fromLine = `${me.name} from ShipWell`;

  const navItems: Array<[Folder, string, React.ElementType, number]> = [
    ["inbox", "Inbox", Inbox, unread],
    ["starred", "Starred", Star, 0],
    ["drafts", "Drafts", FileEdit, draftRows.length],
    ["spam", "Spam", ShieldAlert, 0],
    ...(owner
      ? ([
          ["sent", "Sent", Send, 0],
          ["broadcast", "Broadcast", Megaphone, 0],
          ["team", "Team", Users, 0],
        ] as Array<[Folder, string, React.ElementType, number]>)
      : []),
  ];

  const listTitle: Record<Folder, string> = {
    inbox: "Customer messages",
    starred: "Starred",
    sent: "Sent by ShipWell",
    drafts: "Drafts",
    spam: "Spam",
    broadcast: "Broadcast",
    team: "Team",
  };

  const Row = ({ t }: { t: ThreadRow }) => (
    <div className={`wm-row ${t.unread ? "unread" : ""} ${openId === t.id ? "sel" : ""}`} onClick={() => setOpenId(t.id)}>
      <Avatar name={t.userName || t.userEmail} />
      <div className="wm-mid">
        <div className="wm-l1">
          <b>{t.userName || t.userEmail}</b>
          <time>{fmtTime(t.lastMessageAt)}</time>
        </div>
        <div className="wm-l2">{t.subject}</div>
        <div className="wm-l3">
          {t.preview}
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
  );

  return (
    <div className={`wm ${readingOpen ? "reading" : ""} ${isPanel ? "panelmode" : ""}`}>
      <style>{css}</style>

      <header className="wm-top">
        <ShipwellLogo subtitle="Mail" />
        <label className="wm-search">
          <Search className="w-4 h-4" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search mail" />
        </label>
        <AdminAppControls />
        <button className="wm-me" onClick={() => setNameEdit((v) => !v)} title="Your sender name">
          <Avatar name={me.name} />
        </button>
        <button className="wm-icon" onClick={() => signOut(auth)} aria-label="Sign out" title="Sign out">
          <LogOut className="w-4 h-4" />
        </button>
      </header>

      {nameEdit && (
        <div className="wm-namebar">
          <div>
            <small className="wm-muted">Customers will see</small>
            <b className="wm-block">{(nameVal.trim() || me.name)} from ShipWell • {me.supportAddress}</b>
          </div>
          <input className="wm-input" value={nameVal} onChange={(e) => setNameVal(e.target.value)} maxLength={40} placeholder="Your name" />
          <button className="wm-btn wm-sm" onClick={saveName}>Save</button>
        </div>
      )}

      <nav className="wm-nav">
        {navItems.map(([key, label, Icon, badge]) => (
          <button key={key} className={folder === key ? "on" : ""} onClick={() => goFolder(key)}>
            <Icon className="w-4 h-4" />
            <span>{label}</span>
            {badge > 0 && <i>{badge}</i>}
          </button>
        ))}
      </nav>

      {folder === "broadcast" && owner && (
        <BroadcastPanel key={bcKey} drafts={drafts} refreshDrafts={loadDrafts} initial={bcDraft} />
      )}
      {folder === "team" && owner && <TeamPanel />}

      {!isPanel && (
        <section className="wm-list">
          <div className="wm-listhead">
            <b>{listTitle[folder]}</b>
            <button
              className="wm-icon"
              onClick={() => (folder === "sent" ? loadSent() : Promise.all([loadThreads(), loadDrafts()]))}
              aria-label="Refresh"
              disabled={sentLoading}
            >
              <RefreshCw className={`w-4 h-4 ${sentLoading ? "animate-spin" : ""}`} />
            </button>
          </div>

          {(folder === "inbox" || folder === "starred" || folder === "spam") &&
            threadRows.map((t) => <Row key={t.id} t={t} />)}

          {(folder === "sent" || folder === "starred") &&
            sentRows.map((m) => (
              <div key={m.id} className={`wm-row ${openId === m.id ? "sel" : ""}`} onClick={() => setOpenId(m.id)}>
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

          {folder === "drafts" &&
            draftRows.map((d) => (
              <div
                key={d.id}
                className="wm-row"
                onClick={() => {
                  if (d.kind === "reply") {
                    setFolder("inbox");
                    setOpenId(d.threadId);
                  } else {
                    setBcDraft(d);
                    setBcKey((k) => k + 1);
                    setFolder("broadcast");
                  }
                }}
              >
                <Avatar name={d.toName || "Broadcast"} />
                <div className="wm-mid">
                  <div className="wm-l1">
                    <b><span className="wm-draft">Draft</span> {d.kind === "broadcast" ? "Broadcast" : d.toName || "Reply"}</b>
                    <time>{fmtTime(d.updatedAt)}</time>
                  </div>
                  <div className="wm-l2">{d.subject || "(no subject)"}</div>
                  <div className="wm-l3">{d.body}</div>
                </div>
                <button
                  className="wm-star"
                  aria-label="Delete draft"
                  onClick={(e) => {
                    e.stopPropagation();
                    api(`/api/mail/drafts/${encodeURIComponent(d.id)}`, "DELETE").then(loadDrafts).catch((er) => toast.error(er.message));
                  }}
                >
                  ✕
                </button>
              </div>
            ))}

          {(folder === "inbox" || folder === "spam") && threadRows.length === 0 && (
            <div className="wm-empty">{folder === "spam" ? "No spam." : "No messages yet."}</div>
          )}
          {folder === "sent" && sentRows.length === 0 && !sentLoading && <div className="wm-empty">No sent mail found.</div>}
          {folder === "drafts" && draftRows.length === 0 && <div className="wm-empty">No drafts. Replies you start are saved here.</div>}
          {folder === "starred" && threadRows.length === 0 && sentRows.length === 0 && <div className="wm-empty">Star a message to find it here.</div>}
          {sentLoading && sent.length === 0 && (
            <div className="wm-empty"><Loader2 className="w-5 h-5 animate-spin" /></div>
          )}
        </section>
      )}

      {!isPanel && (
        <section className="wm-read">
          {!openThread && !openMail && <div className="wm-empty big">Select a message to read it.</div>}

          {openThread && (
            <>
              <div className="wm-rhead">
                <div className="wm-tools">
                  <button className="wm-icon wm-back" onClick={() => setOpenId("")} aria-label="Back" title="Back">
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                  <span className="wm-tsp" />
                  <button className="wm-icon" onClick={() => replyRef.current?.focus()} aria-label="Reply" title="Reply">
                    <Reply className="w-4 h-4" />
                  </button>
                  <button
                    className="wm-icon"
                    onClick={() => setState(openThread.id, { status: openThread.status === "closed" ? "open" : "closed" })}
                    aria-label={openThread.status === "closed" ? "Reopen" : "Close"}
                    title={openThread.status === "closed" ? "Reopen" : "Mark as done"}
                  >
                    <CheckCheck className="w-4 h-4" />
                  </button>
                  <button
                    className="wm-icon"
                    onClick={() => {
                      setState(openThread.id, { unread: true });
                      setOpenId("");
                    }}
                    aria-label="Mark unread"
                    title="Mark unread"
                  >
                    <MailOpen className="w-4 h-4" />
                  </button>
                  {openThread.spam ? (
                    <button className="wm-icon" onClick={() => setState(openThread.id, { spam: false, unblock: true }, "Moved to Inbox")} aria-label="Not spam" title="Not spam">
                      <Inbox className="w-4 h-4" />
                    </button>
                  ) : (
                    <button className="wm-icon" onClick={() => { setState(openThread.id, { spam: true }, "Reported as spam"); setOpenId(""); }} aria-label="Report spam" title="Report spam">
                      <ShieldAlert className="w-4 h-4" />
                    </button>
                  )}
                  {!openThread.spam && (
                    <button className="wm-icon" onClick={() => { setState(openThread.id, { spam: true, block: true }, "Sender blocked"); setOpenId(""); }} aria-label="Block sender" title="Block sender">
                      <Ban className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <h2 className="wm-subject">{openThread.subject}</h2>

                <div className="wm-meta">
                  <div className="wm-line">
                    <span className="wm-k">From</span>
                    <span className="wm-pill">
                      <Avatar name={openThread.userName || openThread.userEmail} />
                      <span className="wm-pt">{openThread.userName || openThread.userEmail}<small>{openThread.userEmail}</small></span>
                    </span>
                  </div>
                  <div className="wm-line">
                    <span className="wm-k">To</span>
                    <span className="wm-pill">
                      <Avatar name={me.name} />
                      <span className="wm-pt">{fromLine}<small>{me.supportAddress}</small></span>
                    </span>
                  </div>
                  <div className="wm-line wm-date">
                    <time>{fmtFull(openThread.lastMessageAt)}</time>
                    <span className="wm-muted">{openThread.ticketCode}{openThread.code ? ` · ${openThread.code}` : ""}</span>
                    <button className={`wm-star ${stars.has(openThread.id) ? "on" : ""}`} onClick={() => toggleStar(openThread.id)} aria-label="Star">
                      <Star className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>

              <div className="wm-scroll">
                {(msgs.id === openThread.id ? msgs.items : []).map((m) => (
                  <div key={m.id} className={`wm-msg ${m.from === "admin" ? "me" : ""}`}>
                    <div className="wm-mh">
                      <b>
                        {m.from === "admin"
                          ? m.senderName && m.senderName !== "ShipWell Support"
                            ? `${m.senderName} from ShipWell`
                            : "ShipWell Support"
                          : m.senderName}
                      </b>
                      <time>{fmtFull(m.ts)}</time>
                    </div>
                    {m.body && <div className="wm-mb">{m.body}</div>}
                    <AttachmentList threadId={openThread.id} items={m.attachments} />
                  </div>
                ))}
                <div ref={endRef} />
              </div>

              {openThread.spam ? (
                <div className="wm-spamnote">This conversation is in Spam. Move it to Inbox to reply.</div>
              ) : (
                <form className="wm-reply" onSubmit={sendReply}>
                  <div className="wm-rtop">
                    <AttachPicker files={files} onChange={setFiles} disabled={sending} />
                    <small className="wm-muted">{draftNote}</small>
                  </div>
                  <div className="wm-rbody">
                    <textarea
                      ref={replyRef}
                      value={reply}
                      onChange={(e) => setReply(e.target.value)}
                      placeholder={`Reply as ${fromLine}`}
                      rows={3}
                    />
                    <button className="wm-btn" disabled={sending || (!reply.trim() && files.length === 0)}>
                      {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send
                    </button>
                  </div>
                </form>
              )}
            </>
          )}

          {openMail && !openThread && (
            <>
              <div className="wm-rhead">
                <div className="wm-tools">
                  <button className="wm-icon wm-back" onClick={() => setOpenId("")} aria-label="Back">
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                  <span className="wm-tsp" />
                </div>
                <h2 className="wm-subject">{openMail.subject}</h2>
                <div className="wm-meta">
                  <div className="wm-line">
                    <span className="wm-k">From</span>
                    <span className="wm-pill"><Mail className="w-4 h-4" /><span className="wm-pt wm-break">{openMail.from}</span></span>
                  </div>
                  <div className="wm-line">
                    <span className="wm-k">To</span>
                    <span className="wm-pill"><Avatar name={openMail.to} /><span className="wm-pt wm-break">{openMail.to}</span></span>
                  </div>
                  <div className="wm-line wm-date">
                    <time>{fmtFull(openMail.ts)}</time>
                    <span className="wm-muted">{openMail.status}</span>
                    <button className={`wm-star ${stars.has(openMail.id) ? "on" : ""}`} onClick={() => toggleStar(openMail.id)} aria-label="Star">
                      <Star className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
              <div className="wm-scroll">
                {openMail.html ? <MailFrame html={openMail.html} /> : <div className="wm-empty">No preview was stored for this email.</div>}
              </div>
            </>
          )}
        </section>
      )}
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
.wm-input { background: var(--card2); border: 1px solid var(--border); color: var(--text); border-radius: 12px; padding: 12px 14px; font: inherit; font-size: 14.5px; width: 100%; min-width: 0; }
textarea.wm-input { resize: vertical; }
.wm-err { font-size: 12.5px; color: #fb7185; background: rgba(244,63,94,.08); border: 1px solid rgba(244,63,94,.25); padding: 9px 12px; border-radius: 10px; }
.wm-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; background: var(--em); color: #04120C; border: 0; border-radius: 12px; padding: 12px 18px; font-weight: 700; font-size: 14px; cursor: pointer; }
.wm-btn:disabled { opacity: .55; cursor: default; }
.wm-btn-ghost { background: var(--card2); color: var(--text); border: 1px solid var(--border); }
.wm-sm { padding: 8px 12px; font-size: 12.5px; white-space: nowrap; }
.wm-icon { width: 38px; height: 38px; border-radius: 10px; border: 1px solid var(--border); background: var(--card2); color: var(--muted); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; }
.wm-icon:hover { color: var(--text); }
.wm-muted { color: var(--muted); font-size: 12.5px; }
.wm-block { display: block; }
.wm-break { overflow-wrap: anywhere; }

.wm { height: 100dvh; display: grid; grid-template-columns: 360px minmax(0,1fr); grid-template-rows: auto auto auto minmax(0,1fr); grid-template-areas: "top top" "name name" "nav nav" "list read"; }
.wm-top { grid-area: top; display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--border); background: var(--card); min-width: 0; }
.wm-me { background: none; border: 0; padding: 0; cursor: pointer; flex-shrink: 0; }
.wm-namebar { grid-area: name; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; padding: 10px 14px; background: var(--card2); border-bottom: 1px solid var(--border); }
.wm-namebar > div { flex: 1 1 220px; min-width: 0; font-size: 13px; overflow-wrap: anywhere; }
.wm-namebar .wm-input { flex: 1 1 160px; max-width: 240px; padding: 9px 12px; }
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
.wm-draft { color: #f87171; font-weight: 700; font-size: 12px; margin-right: 4px; }
.wm-star { background: none; border: 0; color: var(--faint); cursor: pointer; padding: 4px; }
.wm-star.on { color: var(--amber); }
.wm-star.on svg { fill: var(--amber); }
.wm-empty { padding: 28px 16px; color: var(--muted); text-align: center; font-size: 13.5px; }
.wm-empty.big { margin: auto; }

.wm-read { grid-area: read; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.wm-rhead { padding: 10px 14px 12px; border-bottom: 1px solid var(--border); display: grid; gap: 12px; }
.wm-tools { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.wm-tsp { flex: 1; }
.wm-subject { margin: 0; font-size: 1.45rem; line-height: 1.25; font-weight: 800; overflow-wrap: anywhere; }
.wm-meta { display: grid; gap: 8px; }
.wm-line { display: flex; align-items: center; gap: 10px; min-width: 0; }
.wm-k { width: 40px; flex-shrink: 0; color: var(--muted); font-size: 12.5px; }
.wm-pill { display: inline-flex; align-items: center; gap: 8px; min-width: 0; max-width: 100%; background: var(--card2); border: 1px solid var(--border); border-radius: 999px; padding: 4px 14px 4px 4px; }
.wm-pill .wm-av { width: 28px; height: 28px; font-size: 12px; }
.wm-pill svg { margin-left: 8px; color: var(--muted); }
.wm-pt { display: grid; min-width: 0; font-size: 13.5px; font-weight: 600; line-height: 1.2; }
.wm-pt small { color: var(--muted); font-weight: 400; font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wm-date { color: var(--muted); font-size: 12.5px; flex-wrap: wrap; padding-left: 50px; }
.wm-date .wm-star { margin-left: auto; }
.wm-scroll { flex: 1; overflow-y: auto; padding: 14px; min-height: 0; }
.wm-msg { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 12px 14px; margin-bottom: 12px; max-width: 760px; }
.wm-msg.me { background: rgba(16,185,129,.08); border-color: rgba(16,185,129,.3); margin-left: auto; }
.wm-mh { display: flex; justify-content: space-between; gap: 8px; font-size: 12.5px; margin-bottom: 6px; }
.wm-mh time { color: var(--muted); }
.wm-mb { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14.5px; line-height: 1.55; }
.wm-reply { display: grid; gap: 8px; padding: 10px 14px calc(10px + env(safe-area-inset-bottom)); border-top: 1px solid var(--border); background: var(--card); }
.wm-rtop { display: flex; justify-content: space-between; gap: 8px; align-items: center; flex-wrap: wrap; }
.wm-rbody { display: flex; gap: 10px; align-items: flex-end; }
.wm-rbody textarea { flex: 1; min-width: 0; resize: none; background: var(--card2); border: 1px solid var(--border); color: var(--text); border-radius: 12px; padding: 10px 12px; font: inherit; font-size: 14px; }
.wm-spamnote { padding: 14px; text-align: center; color: var(--muted); font-size: 13px; border-top: 1px solid var(--border); }
.wm-frame { width: 100%; border: 0; border-radius: 12px; background: #fff; min-height: 480px; }

.wm-panel { grid-column: 1 / -1; grid-row: 4; overflow-y: auto; padding: 16px; display: grid; gap: 16px; align-content: start; grid-template-columns: minmax(0, 720px); justify-content: center; }
.wm-pbox { background: var(--card); border: 1px solid var(--border); border-radius: 16px; padding: 18px; display: grid; gap: 10px; min-width: 0; }
.wm-pbox h2 { margin: 0; font-size: 1.1rem; }
.wm-pbox h3 { margin: 8px 0 0; font-size: .95rem; color: var(--muted); }
.wm-pbox p { margin: 0; }
.wm-lbl { font-size: 12.5px; color: var(--muted); margin-top: 4px; }
.wm-two { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; align-items: end; }
.wm-warn { display: grid; gap: 8px; background: rgba(245,158,11,.08); border: 1px solid rgba(245,158,11,.35); border-radius: 12px; padding: 12px 14px; font-size: 13.5px; min-width: 0; }
.wm-row-btns { display: flex; gap: 8px; flex-wrap: wrap; }
.wm-hrow { display: grid; gap: 2px; padding: 10px 0; border-top: 1px solid var(--border2); }
.wm-member { grid-template-columns: minmax(0,1fr) auto; align-items: center; gap: 10px; }
.wm-tag { font-style: normal; font-size: 11px; background: rgba(16,185,129,.14); color: var(--em); border-radius: 999px; padding: 2px 8px; margin-left: 6px; font-weight: 700; }
.wm-tag.off { background: rgba(244,63,94,.12); color: #fb7185; }

@media (max-width: 900px) {
  .wm { grid-template-columns: minmax(0,1fr); grid-template-areas: "top" "name" "nav" "list"; }
  .wm-read { display: none; }
  .wm.reading { grid-template-areas: "top" "name" "nav" "read"; }
  .wm.reading .wm-list { display: none; }
  .wm.reading .wm-read { display: flex; }
  .wm.panelmode .wm-list, .wm.panelmode .wm-read { display: none; }
  .wm-panel { grid-row: 4; }
  .wm-top .sw-logo-s, .wm-top .sw-logo-t { display: none; }
  .wm-subject { font-size: 1.25rem; }
  .wm-date { padding-left: 0; }
}
@media (min-width: 901px) { .wm-back { display: none; } }
`;
