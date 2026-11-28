import crypto from "node:crypto";
import type express from "express";
import type { DocumentReference } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import {
  buildBroadcastEmail,
  buildStaffInviteEmail,
  buildSupportReplyEmail,
  sanitizeHeaderText,
} from "../email/templates.ts";
import { dispatchTransactionalEmail } from "../email/sender.ts";
import { removeAdminPushToken, saveAdminPushToken } from "./admin-push.ts";
import { getAdminAuth, getAdminDb, verifyFirebaseAdminAuth } from "./firebase-admin.ts";
import { loadSettingsBundle, resolveEmailSender } from "./settings-store.ts";
import { ADMIN_EMAIL, normalizeEmail } from "../../types/tracking.ts";

/* ───────────── shared helpers ───────────── */

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 40);

export function cleanDisplayName(v: unknown): string {
  return String(v || "")
    .replace(/[<>"\\\r\n\t]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
}

export interface MailActor {
  uid: string;
  email: string;
  role: "owner" | "support";
  name: string;
}

export async function getMailActor(
  headers: Record<string, string | string[] | undefined>
): Promise<MailActor | null> {
  const a = await verifyFirebaseAdminAuth(headers);
  if (!a || !a.emailVerified || !a.email) return null;
  const snap = await getAdminDb().collection("staffMembers").doc(sha(a.email)).get();
  const x = snap.exists ? (snap.data() as Record<string, unknown>) : null;
  if (a.isAdmin) {
    return {
      uid: a.uid,
      email: a.email,
      role: "owner",
      name: cleanDisplayName(x?.displayName) || "ShipWell Support",
    };
  }
  if (x && x.active === true) {
    return {
      uid: a.uid,
      email: a.email,
      role: "support",
      name: cleanDisplayName(x.displayName) || cleanDisplayName(a.email.split("@")[0]) || "Support",
    };
  }
  return null;
}

export async function isBlockedSender(email: string): Promise<boolean> {
  const e = normalizeEmail(email);
  if (!e) return false;
  const snap = await getAdminDb().collection("mailBlocklist").doc(sha(e)).get();
  return snap.exists;
}

async function supportAddress(): Promise<string> {
  const { publicSettings } = await loadSettingsBundle();
  const from = resolveEmailSender(publicSettings, "support").from;
  return (from.match(/<([^>]+)>/)?.[1] || from).trim();
}

/* ───────────── attachments ───────────── */

const MAX_FILES = 3;
export const MAX_FILE_BYTES = 700 * 1024;
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

export interface IncomingAttachment {
  name: string;
  type: string;
  data: string; // base64
}
export interface AttachmentMeta {
  id: string;
  name: string;
  type: string;
  size: number;
}

export function validateAttachments(raw: unknown): IncomingAttachment[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new Error("Attachments are invalid.");
  if (raw.length > MAX_FILES) throw new Error(`You can attach up to ${MAX_FILES} files.`);
  return raw.map((f) => {
    const x = (f || {}) as Record<string, unknown>;
    const type = String(x.type || "").toLowerCase();
    const name = String(x.name || "file").replace(/[\\/\r\n\0]/g, "_").slice(0, 120) || "file";
    const data = String(x.data || "").replace(/^data:[^,]*,/, "");
    if (!ALLOWED_TYPES.has(type)) {
      throw new Error(`"${name}" is not an allowed file type (images, PDF, Word, Excel, text).`);
    }
    if (!/^[A-Za-z0-9+/=]+$/.test(data) || data.length < 4) {
      throw new Error(`"${name}" could not be read.`);
    }
    const bytes = Math.floor((data.length * 3) / 4);
    if (bytes > MAX_FILE_BYTES) {
      throw new Error(`"${name}" is too large (max ${Math.round(MAX_FILE_BYTES / 1024)} KB per file).`);
    }
    return { name, type, data };
  });
}

/** Stores files under the thread and returns the message metadata plus Resend attachments. */
export async function saveAttachments(
  threadRef: DocumentReference,
  atts: IncomingAttachment[]
): Promise<{ meta: AttachmentMeta[]; email: Array<{ filename: string; content: string }> }> {
  const meta: AttachmentMeta[] = [];
  for (const a of atts) {
    const ref = threadRef.collection("files").doc();
    const size = Math.floor((a.data.length * 3) / 4);
    await ref.set({
      name: a.name,
      type: a.type,
      size,
      data: a.data,
      createdAt: FieldValue.serverTimestamp(),
    });
    meta.push({ id: ref.id, name: a.name, type: a.type, size });
  }
  return { meta, email: atts.map((a) => ({ filename: a.name, content: a.data })) };
}

/* ───────────── routes ───────────── */

interface Deps {
  handleServerError: (res: express.Response, err: unknown, fallback: string, step?: string) => void;
  getOrigin: (req: express.Request) => string;
}

const USER_FACING = /^(Enter|Write|Add|Attach|You |"|Attachments|Password|This |That |Invalid|Choose|Type|Confirm|Only|Pick|Name|Email|Message|Subject|Your |The )/;

export function registerWebmailRoutes(app: express.Express, deps: Deps) {
  const { handleServerError, getOrigin } = deps;

  const fail = (res: express.Response, err: unknown, fallback: string, step: string) => {
    if (err instanceof Error && USER_FACING.test(err.message)) {
      res.status(400).json({ error: err.message });
      return;
    }
    handleServerError(res, err, fallback, step);
  };

  const needActor = async (
    req: express.Request,
    res: express.Response,
    ownerOnly = false
  ): Promise<MailActor | null> => {
    const actor = await getMailActor(req.headers);
    if (!actor) {
      res.status(403).json({ error: "This mailbox is for the ShipWell team." });
      return null;
    }
    if (ownerOnly && actor.role !== "owner") {
      res.status(403).json({ error: "Only the owner can do this." });
      return null;
    }
    return actor;
  };

  const webmailBase = (req: express.Request): string => {
    const origin = getOrigin(req);
    return origin === "https://shipwell.cc" ? "https://webmail.shipwell.cc" : `${origin}/webmail`;
  };

  /* ── who am I ── */
  app.get("/api/mail/me", async (req, res) => {
    try {
      const actor = await needActor(req, res);
      if (!actor) return;
      res.json({
        role: actor.role,
        name: actor.name,
        email: actor.email,
        supportAddress: await supportAddress(),
      });
    } catch (err) {
      fail(res, err, "Could not load your profile.", "mail_me");
    }
  });

  app.post("/api/mail/me", async (req, res) => {
    try {
      const actor = await needActor(req, res);
      if (!actor) return;
      const name = cleanDisplayName((req.body || {}).name);
      if (name.length < 2) throw new Error("Enter your name (at least 2 letters).");
      await getAdminDb()
        .collection("staffMembers")
        .doc(sha(actor.email))
        .set(
          {
            email: actor.email,
            displayName: name,
            ...(actor.role === "owner" ? { role: "owner", active: true } : {}),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      res.json({ ok: true, name });
    } catch (err) {
      fail(res, err, "Could not save your name.", "mail_me_save");
    }
  });

  /* ── push token (webmail devices) ── */
  app.post("/api/mail/push-token", async (req, res) => {
    try {
      const actor = await needActor(req, res);
      if (!actor) return;
      await saveAdminPushToken({
        uid: actor.uid,
        email: actor.email,
        token: String((req.body || {}).token || ""),
        userAgent: String(req.headers["user-agent"] || ""),
        host: "webmail",
        role: actor.role,
      });
      res.json({ ok: true });
    } catch (err) {
      fail(res, err, "Could not save notification settings.", "mail_push_token");
    }
  });

  app.delete("/api/mail/push-token", async (req, res) => {
    try {
      const actor = await needActor(req, res);
      if (!actor) return;
      await removeAdminPushToken(String((req.body || {}).token || ""));
      res.json({ ok: true });
    } catch (err) {
      fail(res, err, "Could not update notification settings.", "mail_push_token");
    }
  });

  /* ── threads ── */
  app.get("/api/mail/threads", async (req, res) => {
    try {
      const actor = await needActor(req, res);
      if (!actor) return;
      const snap = await getAdminDb()
        .collection("supportThreads")
        .orderBy("lastMessageAt", "desc")
        .limit(200)
        .get();
      const items = snap.docs.map((d) => {
        const x = d.data();
        return {
          id: d.id,
          ticketCode: String(x.ticketCode || ""),
          userName: String(x.userName || ""),
          userEmail: String(x.userEmail || ""),
          subject: String(x.subject || "(no subject)"),
          code: String(x.code || ""),
          status: x.status === "closed" ? "closed" : "open",
          source: x.source === "email" ? "email" : "web",
          unread: x.unreadAdmin === true,
          spam: x.spam === true,
          lastMessageAt: Number(x.lastMessageAt || 0),
          preview: String(x.lastMessagePreview || ""),
        };
      });
      res.json({ items });
    } catch (err) {
      fail(res, err, "Could not load messages.", "mail_threads");
    }
  });

  app.get("/api/mail/thread/:id", async (req, res) => {
    try {
      const actor = await needActor(req, res);
      if (!actor) return;
      const ref = getAdminDb().collection("supportThreads").doc(String(req.params.id));
      const snap = await ref.get();
      if (!snap.exists) {
        res.status(404).json({ error: "Thread not found." });
        return;
      }
      const msgs = await ref.collection("messages").orderBy("ts", "asc").limit(300).get();
      if (snap.data()?.unreadAdmin === true) {
        await ref.update({ unreadAdmin: false });
      }
      res.json({
        messages: msgs.docs.map((d) => {
          const m = d.data();
          return {
            id: d.id,
            from: m.from === "admin" ? "admin" : "user",
            senderName: String(m.senderName || ""),
            senderEmail: String(m.senderEmail || ""),
            body: String(m.body || ""),
            ts: Number(m.ts || 0),
            source: m.source === "email" ? "email" : "web",
            attachments: Array.isArray(m.attachments) ? m.attachments : [],
          };
        }),
      });
    } catch (err) {
      fail(res, err, "Could not open this message.", "mail_thread");
    }
  });

  app.post("/api/mail/thread/:id/state", async (req, res) => {
    try {
      const actor = await needActor(req, res);
      if (!actor) return;
      const body = (req.body || {}) as Record<string, unknown>;
      const ref = getAdminDb().collection("supportThreads").doc(String(req.params.id));
      const snap = await ref.get();
      if (!snap.exists) {
        res.status(404).json({ error: "Thread not found." });
        return;
      }
      const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
      if (body.status === "open" || body.status === "closed") patch.status = body.status;
      if (typeof body.spam === "boolean") {
        patch.spam = body.spam;
        if (body.spam) patch.unreadAdmin = false;
      }
      if (typeof body.unread === "boolean") patch.unreadAdmin = body.unread;
      await ref.update(patch);
      const email = normalizeEmail(String(snap.data()?.userEmail || ""));
      if (body.block === true && email && email !== ADMIN_EMAIL) {
        await getAdminDb()
          .collection("mailBlocklist")
          .doc(sha(email))
          .set({ email, by: actor.email, at: Date.now() });
      }
      if (body.unblock === true && email) {
        await getAdminDb().collection("mailBlocklist").doc(sha(email)).delete();
      }
      res.json({ ok: true });
    } catch (err) {
      fail(res, err, "Could not update this message.", "mail_thread_state");
    }
  });

  /* ── reply (with attachments) ── */
  app.post("/api/mail/reply", async (req, res) => {
    try {
      const actor = await needActor(req, res);
      if (!actor) return;
      const body = (req.body || {}) as Record<string, unknown>;
      const threadId = String(body.threadId || "");
      const message = String(body.message || "").trim().slice(0, 5000);
      const atts = validateAttachments(body.attachments);
      if (!message && atts.length === 0) throw new Error("Write a message or attach a file.");
      const db = getAdminDb();
      const ref = db.collection("supportThreads").doc(threadId);
      const snap = await ref.get();
      if (!snap.exists) {
        res.status(404).json({ error: "Thread not found." });
        return;
      }
      const t = snap.data() as Record<string, string>;
      const saved = await saveAttachments(ref, atts);
      const now = Date.now();
      const text = message || `Sent ${atts.length} attachment${atts.length > 1 ? "s" : ""}`;
      const batch = db.batch();
      batch.set(ref.collection("messages").doc(), {
        from: "admin",
        senderName: actor.name,
        senderEmail: actor.email,
        body: message,
        attachments: saved.meta,
        source: "web",
        ts: now,
        createdAt: FieldValue.serverTimestamp(),
      });
      batch.update(ref, {
        status: "open",
        unreadAdmin: false,
        unreadUser: true,
        lastMessageAt: now,
        lastMessagePreview: text.slice(0, 140),
        updatedAt: FieldValue.serverTimestamp(),
      });
      batch.delete(db.collection("mailDrafts").doc(`reply_${threadId}_${sha(actor.email)}`));
      await batch.commit();

      const addr = await supportAddress();
      const payload = buildSupportReplyEmail({
        baseUrl: getOrigin(req),
        ticketCode: t.ticketCode,
        recipientName: t.userName || "Customer",
        subject: t.subject,
        replyBody: text,
        trackingCode: t.code || null,
        threadId,
      });
      const result = await dispatchTransactionalEmail(t.userEmail, payload, {
        template: "support_reply",
        category: "support",
        code: t.code || null,
        createdBy: actor.uid,
        fromOverride: `${actor.name} from ShipWell <${addr}>`,
        replyToOverride: addr,
        attachments: saved.email,
      });
      res.json({ ok: true, emailStatus: result.status });
    } catch (err) {
      fail(res, err, "Could not send the reply.", "mail_reply");
    }
  });

  /* ── attachment download (team, or the customer who owns the thread) ── */
  app.get("/api/mail/file", async (req, res) => {
    try {
      const a = await verifyFirebaseAdminAuth(req.headers);
      if (!a) {
        res.status(401).json({ error: "Please sign in." });
        return;
      }
      const threadId = String(req.query.thread || "");
      const fileId = String(req.query.file || "");
      const ref = getAdminDb().collection("supportThreads").doc(threadId);
      const [tSnap, fSnap] = await Promise.all([ref.get(), ref.collection("files").doc(fileId).get()]);
      if (!tSnap.exists || !fSnap.exists) {
        res.status(404).json({ error: "File not found." });
        return;
      }
      const t = tSnap.data() as Record<string, unknown>;
      const isOwner =
        (t.uid && t.uid === a.uid) || normalizeEmail(String(t.userEmail || "")) === a.email;
      const staff = a.isAdmin ? true : Boolean(await getMailActor(req.headers));
      if (!isOwner && !staff) {
        res.status(403).json({ error: "You cannot open this file." });
        return;
      }
      const f = fSnap.data() as { name: string; type: string; data: string };
      const inline = /^image\/(jpeg|png|webp|gif)$/.test(f.type);
      res.setHeader("Content-Type", f.type);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "private, max-age=300");
      res.setHeader(
        "Content-Disposition",
        `${inline ? "inline" : "attachment"}; filename="${f.name.replace(/"/g, "")}"`
      );
      res.send(Buffer.from(f.data, "base64"));
    } catch (err) {
      fail(res, err, "Could not open the file.", "mail_file");
    }
  });

  /* ── drafts ── */
  app.get("/api/mail/drafts", async (req, res) => {
    try {
      const actor = await needActor(req, res);
      if (!actor) return;
      const snap = await getAdminDb()
        .collection("mailDrafts")
        .where("owner", "==", sha(actor.email))
        .get();
      const items = snap.docs
        .map((d) => {
          const x = d.data();
          return {
            id: d.id,
            kind: x.kind === "broadcast" ? "broadcast" : "reply",
            threadId: String(x.threadId || ""),
            toName: String(x.toName || ""),
            subject: String(x.subject || ""),
            body: String(x.body || ""),
            audience: String(x.audience || ""),
            ctaLabel: String(x.ctaLabel || ""),
            ctaUrl: String(x.ctaUrl || ""),
            updatedAt: Number(x.updatedAt || 0),
          };
        })
        .sort((a, b) => b.updatedAt - a.updatedAt);
      res.json({ items });
    } catch (err) {
      fail(res, err, "Could not load drafts.", "mail_drafts");
    }
  });

  app.put("/api/mail/drafts", async (req, res) => {
    try {
      const actor = await needActor(req, res);
      if (!actor) return;
      const b = (req.body || {}) as Record<string, unknown>;
      const kind = b.kind === "broadcast" ? "broadcast" : "reply";
      if (kind === "broadcast" && actor.role !== "owner") {
        res.status(403).json({ error: "Only the owner can write broadcasts." });
        return;
      }
      const owner = sha(actor.email);
      const threadId = String(b.threadId || "");
      const id =
        kind === "reply"
          ? `reply_${threadId}_${owner}`
          : String(b.id || "").startsWith(`bc_${owner}_`)
            ? String(b.id)
            : `bc_${owner}_${crypto.randomBytes(4).toString("hex")}`;
      const bodyText = String(b.body || "").slice(0, 8000);
      const ref = getAdminDb().collection("mailDrafts").doc(id);
      if (!bodyText.trim() && !String(b.subject || "").trim()) {
        await ref.delete();
        res.json({ ok: true, id, deleted: true });
        return;
      }
      if (kind === "reply" && !threadId) throw new Error("Message is missing its thread.");
      await ref.set({
        owner,
        kind,
        threadId,
        toName: String(b.toName || "").slice(0, 80),
        subject: String(b.subject || "").slice(0, 200),
        body: bodyText,
        audience: String(b.audience || "").slice(0, 20),
        ctaLabel: String(b.ctaLabel || "").slice(0, 40),
        ctaUrl: String(b.ctaUrl || "").slice(0, 300),
        updatedAt: Date.now(),
      });
      res.json({ ok: true, id });
    } catch (err) {
      fail(res, err, "Could not save the draft.", "mail_draft_save");
    }
  });

  app.delete("/api/mail/drafts/:id", async (req, res) => {
    try {
      const actor = await needActor(req, res);
      if (!actor) return;
      const id = String(req.params.id);
      if (!id.endsWith(sha(actor.email)) && !id.startsWith(`bc_${sha(actor.email)}_`)) {
        res.status(403).json({ error: "Not your draft." });
        return;
      }
      await getAdminDb().collection("mailDrafts").doc(id).delete();
      res.json({ ok: true });
    } catch (err) {
      fail(res, err, "Could not delete the draft.", "mail_draft_delete");
    }
  });

  /* ── team (owner only) ── */
  app.get("/api/mail/team", async (req, res) => {
    try {
      const actor = await needActor(req, res, true);
      if (!actor) return;
      const db = getAdminDb();
      const [staff, invites] = await Promise.all([
        db.collection("staffMembers").get(),
        db.collection("staffInvites").where("status", "==", "pending").get(),
      ]);
      res.json({
        members: staff.docs
          .map((d) => {
            const x = d.data();
            return {
              id: d.id,
              email: String(x.email || ""),
              name: String(x.displayName || ""),
              role: x.role === "owner" ? "owner" : "support",
              active: x.active !== false,
            };
          })
          .filter((m) => m.email),
        invites: invites.docs
          .map((d) => {
            const x = d.data();
            return {
              id: d.id,
              email: String(x.email || ""),
              name: String(x.name || ""),
              expiresAt: Number(x.expiresAt || 0),
            };
          })
          .filter((i) => i.expiresAt > Date.now()),
      });
    } catch (err) {
      fail(res, err, "Could not load the team.", "mail_team");
    }
  });

  app.post("/api/mail/team/invite", async (req, res) => {
    try {
      const actor = await needActor(req, res, true);
      if (!actor) return;
      const name = cleanDisplayName((req.body || {}).name);
      const email = normalizeEmail(String((req.body || {}).email || ""));
      if (name.length < 2) throw new Error("Enter the teammate's name.");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");
      if (email === ADMIN_EMAIL || email === actor.email) throw new Error("That is already the owner's email.");
      const db = getAdminDb();
      const existing = await db.collection("staffMembers").doc(sha(email)).get();
      if (existing.exists && existing.data()?.active !== false) {
        throw new Error("This person is already on the team.");
      }
      const token = crypto.randomBytes(32).toString("base64url");
      await db.collection("staffInvites").doc(sha(token)).set({
        email,
        name,
        invitedBy: actor.name,
        invitedByEmail: actor.email,
        status: "pending",
        expiresAt: Date.now() + 7 * 24 * 3600 * 1000,
        createdAt: FieldValue.serverTimestamp(),
      });
      const joinUrl = `${webmailBase(req)}/?join=${token}`;
      const mail = await dispatchTransactionalEmail(
        email,
        buildStaffInviteEmail({ joinUrl, inviteeName: name, invitedBy: actor.name, baseUrl: getOrigin(req) }),
        { template: "staff_invite", category: "support", createdBy: actor.uid }
      );
      res.json({ ok: true, joinUrl, emailStatus: mail.status });
    } catch (err) {
      fail(res, err, "Could not create the invitation.", "mail_team_invite");
    }
  });

  app.post("/api/mail/team/invite/revoke", async (req, res) => {
    try {
      const actor = await needActor(req, res, true);
      if (!actor) return;
      await getAdminDb()
        .collection("staffInvites")
        .doc(String((req.body || {}).id || ""))
        .update({ status: "revoked" });
      res.json({ ok: true });
    } catch (err) {
      fail(res, err, "Could not revoke the invitation.", "mail_team_revoke");
    }
  });

  app.post("/api/mail/team/active", async (req, res) => {
    try {
      const actor = await needActor(req, res, true);
      if (!actor) return;
      const id = String((req.body || {}).id || "");
      const ref = getAdminDb().collection("staffMembers").doc(id);
      const snap = await ref.get();
      if (!snap.exists || snap.data()?.role === "owner") {
        res.status(404).json({ error: "Teammate not found." });
        return;
      }
      await ref.update({ active: Boolean((req.body || {}).active) });
      res.json({ ok: true });
    } catch (err) {
      fail(res, err, "Could not update the teammate.", "mail_team_active");
    }
  });

  /* ── public: accept an invitation ── */
  app.get("/api/team/invite", async (req, res) => {
    try {
      const snap = await getAdminDb()
        .collection("staffInvites")
        .doc(sha(String(req.query.token || "")))
        .get();
      const x = snap.data();
      if (!x || x.status !== "pending" || Number(x.expiresAt) < Date.now()) {
        res.status(404).json({ error: "This invitation is no longer valid." });
        return;
      }
      res.json({ name: String(x.name || ""), email: String(x.email || "") });
    } catch (err) {
      fail(res, err, "Could not check the invitation.", "team_invite_get");
    }
  });

  app.post("/api/team/join", async (req, res) => {
    try {
      const b = (req.body || {}) as Record<string, unknown>;
      const password = String(b.password || "");
      const name = cleanDisplayName(b.name);
      if (name.length < 2) throw new Error("Enter your name.");
      if (password.length < 8) throw new Error("Password must be at least 8 characters.");
      const db = getAdminDb();
      const inviteRef = db.collection("staffInvites").doc(sha(String(b.token || "")));
      const snap = await inviteRef.get();
      const inv = snap.data();
      if (!inv || inv.status !== "pending" || Number(inv.expiresAt) < Date.now()) {
        res.status(404).json({ error: "This invitation is no longer valid." });
        return;
      }
      const email = normalizeEmail(String(inv.email));
      const auth = getAdminAuth();
      try {
        const u = await auth.getUserByEmail(email);
        // The invite went to this mailbox, so the link holder owns it: set the chosen password.
        await auth.updateUser(u.uid, { password, displayName: name, emailVerified: true });
      } catch (e) {
        if ((e as { code?: string })?.code === "auth/user-not-found") {
          await auth.createUser({ email, password, displayName: name, emailVerified: true });
        } else {
          throw e;
        }
      }
      await db.collection("staffMembers").doc(sha(email)).set(
        {
          email,
          displayName: name,
          role: "support",
          active: true,
          invitedBy: String(inv.invitedByEmail || ""),
          createdAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      await inviteRef.update({ status: "used" });
      res.json({ ok: true, email });
    } catch (err) {
      fail(res, err, "Could not create your account.", "team_join");
    }
  });

  /* ── broadcast (owner only) ── */
  async function resolveAudience(audience: string, me: string): Promise<string[]> {
    const db = getAdminDb();
    const out = new Set<string>();
    if (audience === "me") out.add(me);
    else if (audience === "all") {
      const snap = await db.collection("users").limit(3000).get();
      snap.docs.forEach((d) => {
        const e = normalizeEmail(String(d.data().email || ""));
        if (e) out.add(e);
      });
    } else if (audience === "active") {
      const snap = await db.collection("shipments").where("status", "!=", "Delivered").limit(1500).get();
      snap.docs.forEach((d) => {
        const x = d.data();
        for (const k of ["senderEmail", "receiverEmail"]) {
          const e = normalizeEmail(String(x[k] || ""));
          if (e) out.add(e);
        }
      });
    } else {
      throw new Error("Choose who should receive this broadcast.");
    }
    return [...out].filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  }

  app.post("/api/mail/broadcast/count", async (req, res) => {
    try {
      const actor = await needActor(req, res, true);
      if (!actor) return;
      const list = await resolveAudience(String((req.body || {}).audience || ""), actor.email);
      res.json({ count: list.length });
    } catch (err) {
      fail(res, err, "Could not count recipients.", "mail_broadcast_count");
    }
  });

  app.get("/api/mail/broadcasts", async (req, res) => {
    try {
      const actor = await needActor(req, res, true);
      if (!actor) return;
      const snap = await getAdminDb().collection("broadcasts").orderBy("at", "desc").limit(30).get();
      res.json({
        items: snap.docs.map((d) => {
          const x = d.data();
          return {
            id: d.id,
            subject: String(x.subject || ""),
            audience: String(x.audience || ""),
            count: Number(x.count || 0),
            sent: Number(x.sent || 0),
            failed: Number(x.failed || 0),
            by: String(x.by || ""),
            at: Number(x.at || 0),
          };
        }),
      });
    } catch (err) {
      fail(res, err, "Could not load broadcasts.", "mail_broadcasts");
    }
  });

  app.post("/api/mail/broadcast/send", async (req, res) => {
    try {
      const actor = await needActor(req, res, true);
      if (!actor) return;
      const b = (req.body || {}) as Record<string, unknown>;
      const audience = String(b.audience || "");
      const subject = sanitizeHeaderText(String(b.subject || "")).slice(0, 150);
      const message = String(b.message || "").trim().slice(0, 6000);
      const ctaLabel = String(b.ctaLabel || "").trim().slice(0, 40);
      let ctaUrl = String(b.ctaUrl || "").trim().slice(0, 300);
      if (subject.length < 3) throw new Error("Enter a subject.");
      if (message.length < 5) throw new Error("Write your message.");
      if (ctaUrl && !/^https:\/\//i.test(ctaUrl)) ctaUrl = "";
      const list = await resolveAudience(audience, actor.email);
      if (list.length === 0) throw new Error("No recipients found for this audience.");
      if (list.length > 1000) throw new Error("This audience is above 1,000 people. Send to a smaller group.");
      if (Number(b.confirmCount) !== list.length) {
        throw new Error("Confirm the number of recipients before sending.");
      }
      const { publicSettings, secrets } = await loadSettingsBundle();
      const apiKey = secrets.resendApiKey || process.env.RESEND_API_KEY || "";
      if (!apiKey) throw new Error("Email sending is not configured (Resend key missing).");
      const from = resolveEmailSender(publicSettings, "notifications").from;
      const payload = buildBroadcastEmail({
        subject,
        message,
        ctaLabel,
        ctaUrl,
        baseUrl: getOrigin(req),
      });
      let sent = 0;
      let failed = 0;
      for (let i = 0; i < list.length; i += 100) {
        const chunk = list.slice(i, i + 100);
        try {
          const r = await fetch("https://api.resend.com/emails/batch", {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify(
              chunk.map((to) => ({
                from,
                to: [to],
                subject: payload.subject,
                html: payload.html,
                text: payload.text,
              }))
            ),
            signal: AbortSignal.timeout(20000),
          });
          if (r.ok) sent += chunk.length;
          else failed += chunk.length;
        } catch {
          failed += chunk.length;
        }
      }
      const rec = getAdminDb().collection("broadcasts").doc();
      await rec.set({
        subject,
        audience,
        count: list.length,
        sent,
        failed,
        by: actor.name,
        byEmail: actor.email,
        at: Date.now(),
      });
      const draftId = String(b.draftId || "");
      if (draftId.startsWith(`bc_${sha(actor.email)}_`)) {
        await getAdminDb().collection("mailDrafts").doc(draftId).delete().catch(() => null);
      }
      res.json({ ok: true, sent, failed, count: list.length });
    } catch (err) {
      fail(res, err, "Could not send the broadcast.", "mail_broadcast_send");
    }
  });
}
