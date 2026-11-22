import crypto from "node:crypto";
import express from "express";
import { Bachs, webhooks as bachsWebhooks } from "@bachs/sdk";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore, type Firestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import {
  onDocumentCreated,
  onDocumentWritten,
} from "firebase-functions/v2/firestore";

if (getApps().length === 0) {
  initializeApp();
}

function db(): Firestore {
  const dbId = process.env.SHIPWELL_FIRESTORE_DB;
  if (dbId && dbId !== "(default)") {
    return getFirestore(dbId);
  }
  return getFirestore();
}

const ADMIN_EMAIL = "denic9426@gmail.com";
const DEFAULT_APP_URL = "https://shipwell.cc";
const DEFAULT_EMAIL_FROM = "ShipWell <notifications@info.shipwell.cc>";
const DEFAULT_EMAIL_REPLY_TO = "support@info.shipwell.cc";
const DEFAULT_SUPPORT_INBOX = "support@info.shipwell.cc";
const CODE_RE = /^SW-\d{8}-[A-F0-9]{8}$/;

// ── AES-256-GCM Secret Crypto ──
function deriveKey(): Buffer {
  const raw = process.env.SETTINGS_ENCRYPTION_KEY || "";
  if (!raw.trim()) {
    throw new Error("SETTINGS_ENCRYPTION_KEY secret is missing.");
  }
  return crypto.createHash("sha256").update(raw.trim(), "utf8").digest();
}

function encryptSecret(plaintext: string): string {
  const key = deriveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

function decryptSecret(payload: string): string {
  if (!payload || !payload.startsWith("v1:")) return "";
  const parts = payload.split(":");
  if (parts.length !== 4) return "";
  const key = deriveKey();
  const iv = Buffer.from(parts[1], "base64");
  const tag = Buffer.from(parts[2], "base64");
  const data = Buffer.from(parts[3], "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

function maskSecret(val: string, updatedBy = "admin") {
  const clean = String(val || "").trim();
  const idx = clean.indexOf("_", clean.indexOf("_") + 1);
  const prefix = idx > 0 ? clean.slice(0, idx + 1) : clean.slice(0, 4);
  const last4 = clean.slice(-4);
  return {
    configured: Boolean(clean),
    prefix,
    last4,
    masked: `${prefix}••••${last4}`,
    updatedAt: Date.now(),
    updatedBy,
  };
}

interface SettingsBundle {
  pub: Record<string, unknown>;
  sec: {
    bachsSandboxKey: string;
    bachsLiveKey: string;
    bachsSandboxWebhook: string;
    bachsLiveWebhook: string;
    bachsPreviousWebhook: string;
    resendApiKey: string;
    resendInboundSecret: string;
    stripeSecretKey: string;
    stripeWebhookSecret: string;
    paystackSecretKey: string;
    paystackWebhookSecret: string;
  };
  environment: "sandbox" | "live";
  defaultCurrency: string;
  checkoutExpiryMinutes: number;
  emailFrom: string;
  emailReplyTo: string;
  supportInbox: string;
}

let bundleCache: { data: SettingsBundle; expiresAt: number } | null = null;

async function loadSettings(): Promise<SettingsBundle> {
  if (bundleCache && bundleCache.expiresAt > Date.now()) {
    return bundleCache.data;
  }
  const database = db();
  const [pubSnap, secSnap] = await Promise.all([
    database.collection("adminSettings").doc("payments").get(),
    database.collection("adminSecrets").doc("payments").get(),
  ]);
  const pubData = (pubSnap.exists ? pubSnap.data() : {}) as Record<string, unknown>;
  const secData = (secSnap.exists ? secSnap.data() : {}) as Record<string, string>;
  const dec = (k: string) => {
    try {
      return secData[k] ? decryptSecret(secData[k]) : "";
    } catch {
      return "";
    }
  };
  const bachsObj = (pubData.bachs || {}) as Record<string, unknown>;
  const resendObj = (pubData.resend || {}) as Record<string, unknown>;

  const bundle: SettingsBundle = {
    pub: {
      bachs: {
        environment: bachsObj.environment === "live" ? "live" : "sandbox",
        organizationId: bachsObj.organizationId || "",
        defaultCurrency: bachsObj.defaultCurrency || "USD",
        checkoutExpiryMinutes: bachsObj.checkoutExpiryMinutes || 60,
        lastWebhookAt: bachsObj.lastWebhookAt || null,
        secrets: (bachsObj.secrets as Record<string, unknown>) || {
          sandboxSecretKey: { configured: false },
          liveSecretKey: { configured: false },
          sandboxWebhookSecret: { configured: false },
          liveWebhookSecret: { configured: false },
          previousWebhookSecret: { configured: false },
        },
      },
      resend: {
        from: (resendObj.from as string) || process.env.EMAIL_FROM || DEFAULT_EMAIL_FROM,
        replyTo: (resendObj.replyTo as string) || process.env.EMAIL_REPLY_TO || DEFAULT_EMAIL_REPLY_TO,
        supportInbox:
          (resendObj.supportInbox as string) || process.env.SUPPORT_INBOX || DEFAULT_SUPPORT_INBOX,
        secrets: (resendObj.secrets as Record<string, unknown>) || {
          apiKey: { configured: Boolean(process.env.RESEND_API_KEY) },
          inboundWebhookSecret: { configured: false },
        },
      },
      stripe: (pubData.stripe as Record<string, unknown>) || {
        enabled: false,
        publicKey: "",
        secrets: { secretKey: { configured: false }, webhookSecret: { configured: false } },
      },
      paystack: (pubData.paystack as Record<string, unknown>) || {
        enabled: false,
        publicKey: "",
        secrets: { secretKey: { configured: false }, webhookSecret: { configured: false } },
      },
      routing: (pubData.routing as Record<string, unknown>) || {
        primaryGateway: "bachs",
        fallbackOrder: ["bachs"],
        offerChoice: false,
      },
      updatedAt: pubData.updatedAt || null,
      updatedBy: pubData.updatedBy || null,
      encryptionReady: Boolean(process.env.SETTINGS_ENCRYPTION_KEY),
    },
    sec: {
      bachsSandboxKey: dec("bachsSandboxKey"),
      bachsLiveKey: dec("bachsLiveKey"),
      bachsSandboxWebhook: dec("bachsSandboxWebhook"),
      bachsLiveWebhook: dec("bachsLiveWebhook"),
      bachsPreviousWebhook: dec("bachsPreviousWebhook"),
      resendApiKey: dec("resendApiKey") || process.env.RESEND_API_KEY || "",
      resendInboundSecret: dec("resendInboundSecret"),
      stripeSecretKey: dec("stripeSecretKey"),
      stripeWebhookSecret: dec("stripeWebhookSecret"),
      paystackSecretKey: dec("paystackSecretKey"),
      paystackWebhookSecret: dec("paystackWebhookSecret"),
    },
    environment: bachsObj.environment === "live" ? "live" : "sandbox",
    defaultCurrency: String(bachsObj.defaultCurrency || "USD").toUpperCase(),
    checkoutExpiryMinutes: Number(bachsObj.checkoutExpiryMinutes || 60),
    emailFrom: String(resendObj.from || process.env.EMAIL_FROM || DEFAULT_EMAIL_FROM),
    emailReplyTo: String(
      resendObj.replyTo || process.env.EMAIL_REPLY_TO || DEFAULT_EMAIL_REPLY_TO
    ),
    supportInbox: String(
      resendObj.supportInbox || process.env.SUPPORT_INBOX || DEFAULT_SUPPORT_INBOX
    ),
  };

  bundleCache = { data: bundle, expiresAt: Date.now() + 180_000 };
  return bundle;
}

// ── Auth Helper ──
interface VerifiedActor {
  uid: string;
  email: string;
  emailVerified: boolean;
  isAdmin: boolean;
  authTime: number;
}

async function verifyActor(req: express.Request): Promise<VerifiedActor | null> {
  const raw = req.headers.authorization || "";
  const match = raw.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) return null;
  try {
    const decoded = await getAuth().verifyIdToken(match[1].trim(), false);
    const email = String(decoded.email || "").trim().toLowerCase();
    const emailVerified = Boolean(decoded.email_verified);
    return {
      uid: decoded.uid,
      email,
      emailVerified,
      isAdmin: decoded.admin === true || (email === ADMIN_EMAIL && emailVerified),
      authTime: Number(decoded.auth_time || Math.floor(Date.now() / 1000)),
    };
  } catch {
    return null;
  }
}

function escapeHtml(str: string): string {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderSimpleMailHtml(params: {
  baseUrl: string;
  heading: string;
  bodyHtml: string;
  ctaLabel: string;
  ctaUrl: string;
  footer: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<body style="margin:0;padding:24px 12px;background:#07090F;color:#F1F5F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;margin:0 auto;background:#0D1117;border:1px solid #1E293B;border-radius:18px;">
    <tr><td style="padding:32px;">
      <p style="margin:0 0 18px 0;font-size:20px;font-weight:800;color:#F1F5F9;">ShipWell <span style="display:block;font-size:9px;letter-spacing:0.2em;text-transform:uppercase;color:#10B981;margin-top:3px;">Track &middot; Deliver &middot; Repeat</span></p>
      <h1 style="margin:0 0 16px 0;font-size:24px;color:#F1F5F9;">${escapeHtml(params.heading)}</h1>
      <div style="font-size:15px;line-height:1.65;color:#E2E8F0;">${params.bodyHtml}</div>
      <div style="margin:24px 0;"><a href="${escapeHtml(params.ctaUrl)}" style="display:inline-block;background:#10B981;color:#04120C;font-weight:700;font-size:15px;text-decoration:none;padding:14px 26px;border-radius:12px;">${escapeHtml(params.ctaLabel)}</a></div>
      <p style="margin:0 0 16px 0;font-size:12px;color:#34D399;word-break:break-all;">${escapeHtml(params.ctaUrl)}</p>
      <p style="margin:0;padding-top:16px;border-top:1px solid #1E293B;font-size:12px;color:#64748B;">${escapeHtml(params.footer)}</p>
    </td></tr>
  </table>
</body></html>`;
}

async function sendResendEmail(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
  template: string;
  code?: string | null;
  replyTo?: string;
  createdBy?: string;
  dedupKey?: string;
}): Promise<{ status: "sent" | "queued_preview" | "failed"; providerId?: string }> {
  const database = db();
  if (params.dedupKey) {
    const dedupRef = database.collection("emailDedup").doc(params.dedupKey);
    const alreadySent = await database.runTransaction(async (tx) => {
      const snap = await tx.get(dedupRef);
      if (snap.exists) return true;
      tx.set(dedupRef, {
        to: params.to,
        template: params.template,
        createdAt: FieldValue.serverTimestamp(),
      });
      return false;
    });
    if (alreadySent) {
      return { status: "sent", providerId: "deduped" };
    }
  }

  const settings = await loadSettings();
  let status: "sent" | "queued_preview" | "failed" = "queued_preview";
  let providerId = `preview_${Date.now().toString(36)}`;

  if (settings.sec.resendApiKey) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${settings.sec.resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: settings.emailFrom,
          to: [params.to],
          reply_to: params.replyTo || settings.emailReplyTo,
          subject: params.subject,
          html: params.html,
          text: params.text,
        }),
      });
      if (res.ok) {
        const json = (await res.json()) as { id?: string };
        status = "sent";
        providerId = json.id || `resend_${Date.now()}`;
      } else {
        status = "failed";
      }
    } catch {
      status = "failed";
    }
  }

  await database
    .collection("emailLogs")
    .add({
      to: params.to.slice(0, 160),
      from: settings.emailFrom.slice(0, 160),
      code: (params.code || "").slice(0, 24),
      template: params.template,
      subject: params.subject.slice(0, 240),
      status,
      providerId,
      htmlPreview: params.html.slice(0, 24000),
      createdBy: params.createdBy || "cloud-function",
      createdAt: FieldValue.serverTimestamp(),
    })
    .catch(() => null);

  return { status, providerId };
}

function getBaseUrl(req: express.Request): string {
  return (process.env.APP_URL || DEFAULT_APP_URL).replace(/\/+$/, "");
}

// ── Express API App for Cloud Functions `api` ──
const app = express();
app.set("trust proxy", true);

app.post(
  "/api/bachs-webhook",
  express.raw({ type: "application/json", limit: "2mb" }),
  async (req, res) => {
    try {
      const database = db();
      const settings = await loadSettings();
      const rawBody =
        (req as express.Request & { rawBody?: Buffer }).rawBody ||
        (Buffer.isBuffer(req.body)
          ? req.body
          : Buffer.from(JSON.stringify(req.body || {})));

      const secrets = [
        settings.environment === "live"
          ? settings.sec.bachsLiveWebhook
          : settings.sec.bachsSandboxWebhook,
        settings.environment === "live"
          ? settings.sec.bachsSandboxWebhook
          : settings.sec.bachsLiveWebhook,
        settings.sec.bachsPreviousWebhook,
      ].filter(Boolean);

      let event: ReturnType<typeof bachsWebhooks.constructEvent> | null = null;
      for (const secret of secrets) {
        try {
          event = bachsWebhooks.constructEvent(rawBody, req.headers, secret);
          break;
        } catch {
          // try next secret
        }
      }

      if (!event) {
        await database.collection("webhookLogs").add({
          provider: "bachs",
          eventType: "signature_error",
          reference: "",
          result: "rejected-signature",
          detail: "Webhook signature verification failed",
          environment: settings.environment,
          ts: Date.now(),
        });
        res.status(401).json({ error: "Invalid Bachs webhook signature" });
        return;
      }

      const dataObj = event.data || {};
      const meta =
        dataObj.metadata && typeof dataObj.metadata === "object"
          ? (dataObj.metadata as Record<string, unknown>)
          : {};
      const code = String(meta.trackingCode || "").trim().toUpperCase();
      const alertId = String(meta.alertId || "").trim();
      const checkoutId = String(dataObj.checkout_id || dataObj.id || "").trim();
      const paymentId = String(dataObj.payment_id || dataObj.charge_id || checkoutId).trim();
      const reference = String(dataObj.reference || meta.reference || checkoutId).trim();

      await database
        .collection("adminSettings")
        .doc("payments")
        .set({ bachs: { lastWebhookAt: Date.now() } }, { merge: true })
        .catch(() => null);

      if (meta.is_test === "true" || meta.is_test === true) {
        await database.collection("webhookLogs").add({
          provider: "bachs",
          eventType: event.type,
          reference: reference || event.id,
          result: "processed",
          detail: "Admin test event verified",
          environment: settings.environment,
          ts: Date.now(),
        });
        res.json({ ok: true, eventId: event.id });
        return;
      }

      const dedupeRef = database.collection("bachsEvents").doc(event.id);
      const duplicate = await database.runTransaction(async (tx) => {
        const snap = await tx.get(dedupeRef);
        if (snap.exists) return true;
        tx.set(dedupeRef, {
          eventId: event.id,
          type: event.type,
          code: code || null,
          alertId: alertId || null,
          processedAt: FieldValue.serverTimestamp(),
        });
        return false;
      });

      if (duplicate) {
        await database.collection("webhookLogs").add({
          provider: "bachs",
          eventType: event.type,
          reference: reference || code,
          result: "duplicate",
          detail: "Duplicate event ignored",
          environment: settings.environment,
          ts: Date.now(),
        });
        res.json({ ok: true, duplicate: true });
        return;
      }

      if (!CODE_RE.test(code) || !alertId) {
        res.json({ ok: true, ignored: true });
        return;
      }

      const shipRef = database.collection("shipments").doc(code);
      const alertRef = shipRef.collection("alerts").doc(alertId);
      const [shipSnap, alertSnap] = await Promise.all([shipRef.get(), alertRef.get()]);
      if (!shipSnap.exists || !alertSnap.exists) {
        res.json({ ok: true, ignored: true });
        return;
      }

      const shipment = shipSnap.data() as Record<string, unknown>;
      const alert = alertSnap.data() as Record<string, unknown>;
      const t = event.type.toLowerCase();

      if (t === "collection.succeeded" || t === "payment.succeeded" || t === "checkout.session.completed") {
        const env =
          ((alert.payment as Record<string, unknown>)?.environment as "sandbox" | "live") ||
          settings.environment;
        const apiKey = env === "live" ? settings.sec.bachsLiveKey : settings.sec.bachsSandboxKey;
        let verifiedAmount = Number(dataObj.amount || alert.amount || 0);
        let verifiedCurrency = String(dataObj.currency || alert.currency || "USD").toUpperCase();
        if (apiKey && checkoutId) {
          const bachs = new Bachs({
            apiKey,
            environment: env === "live" ? "production" : "sandbox",
          });
          const sess = await bachs.checkoutSessions.get(checkoutId);
          if (sess.amount) verifiedAmount = Number(sess.amount);
          if (sess.currency) verifiedCurrency = String(sess.currency).toUpperCase();
        }

        const expectedAmount = Number(alert.amount || 0);
        if (Math.abs(verifiedAmount - expectedAmount) > 0.05) {
          await alertRef.update({
            "payment.status": "underpaid",
            "payment.lastError": `Amount mismatch: ${verifiedCurrency} ${verifiedAmount}`,
          });
          res.json({ ok: true, mismatch: true });
          return;
        }

        const now = Date.now();
        await alertRef.update({
          status: "resolved",
          resolvedAt: FieldValue.serverTimestamp(),
          response: `Paid via Bachs (${paymentId})`,
          payment: {
            ...((alert.payment as Record<string, unknown>) || {}),
            provider: "bachs",
            environment: env,
            checkoutId,
            paymentId,
            reference,
            status: "paid",
            amountPaid: verifiedAmount,
            currency: verifiedCurrency,
            paidAt: now,
            lastError: null,
          },
        });

        await shipRef.collection("events").add({
          stage: shipment.status,
          label: `${String(alert.chargeType || alert.title)} paid ($${verifiedAmount.toFixed(2)})`,
          loc: "Customs Clearance",
          note: `Payment confirmed via Bachs (${paymentId}).`,
          kind: "info",
          ts: now,
          createdBy: "Bachs webhook",
          createdAt: FieldValue.serverTimestamp(),
        });

        const openSnap = await shipRef.collection("alerts").where("status", "==", "open").get();
        const remainingHolds = openSnap.docs.filter((d) => {
          const ad = d.data();
          return ad.holdShipment === true || ad.kind === "duty";
        });

        if (remainingHolds.length === 0 && shipment.hold) {
          await shipRef.update({ hold: null, updatedAt: FieldValue.serverTimestamp() });
          await database.collection("trackingTeasers").doc(code).update({
            holdType: null,
            latestEvent: { label: "Hold released", loc: "Customs Clearance", ts: now },
            updatedAt: FieldValue.serverTimestamp(),
          });
          await shipRef.collection("events").add({
            stage: shipment.status,
            label: "Hold released",
            loc: "Customs Clearance",
            note: "All customs holds resolved.",
            kind: "info",
            ts: now + 1,
            createdBy: "Bachs webhook",
            createdAt: FieldValue.serverTimestamp(),
          });
        }

        await database.collection("webhookLogs").add({
          provider: "bachs",
          eventType: event.type,
          reference: `${code}/${alertId}`,
          result: "processed",
          detail: `Charge marked paid ($${verifiedAmount.toFixed(2)})`,
          environment: env,
          ts: now,
        });
      } else if (t === "collection.failed" || t === "checkout.session.expired" || t === "collection.abandoned") {
        await alertRef.update({
          "payment.status": "failed",
          "payment.lastError": t,
        });
      } else if (t === "collection.underpaid") {
        await alertRef.update({
          "payment.status": "underpaid",
          "payment.lastError": "Underpaid — remaining balance due",
        });
      } else if (t === "refund.succeeded" || t === "collection.refunded") {
        await alertRef.update({
          "payment.status": "refunded",
          "payment.refundedAt": Date.now(),
        });
      }

      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Webhook error" });
    }
  }
);

app.use(express.json({ limit: "2mb" }));

app.post("/api/customs/create-checkout", async (req, res) => {
  try {
    const actor = await verifyActor(req);
    if (!actor) {
      res.status(401).json({ error: "Please log in to pay customs charges." });
      return;
    }
    const { code = "", alertId = "" } = (req.body || {}) as { code?: string; alertId?: string };
    const cleanCode = code.trim().toUpperCase();
    if (!CODE_RE.test(cleanCode) || !alertId) {
      res.status(400).json({ error: "Valid tracking code and charge ID required." });
      return;
    }

    const database = db();
    const shipRef = database.collection("shipments").doc(cleanCode);
    const [shipSnap, alertSnap] = await Promise.all([
      shipRef.get(),
      shipRef.collection("alerts").doc(alertId).get(),
    ]);
    if (!shipSnap.exists || !alertSnap.exists) {
      res.status(404).json({ error: "Shipment or charge not found." });
      return;
    }
    const shipment = shipSnap.data() as Record<string, unknown>;
    const alert = alertSnap.data() as Record<string, unknown>;
    const isParty =
      actor.isAdmin ||
      shipment.senderId === actor.uid ||
      (actor.emailVerified && shipment.receiverEmail === actor.email);
    if (!isParty) {
      res.status(403).json({ error: "Unauthorized." });
      return;
    }
    if (alert.status === "resolved") {
      res.status(400).json({ error: "Charge is already settled." });
      return;
    }

    const settings = await loadSettings();
    const env = settings.environment;
    const apiKey = env === "live" ? settings.sec.bachsLiveKey : settings.sec.bachsSandboxKey;
    if (!apiKey) {
      res.status(400).json({ error: `Bachs ${env} secret key not configured.` });
      return;
    }

    const amount = Number(alert.amount || 0);
    const currency = String(alert.currency || settings.defaultCurrency || "USD").toUpperCase();
    const bachs = new Bachs({
      apiKey,
      environment: env === "live" ? "production" : "sandbox",
    });
    const baseUrl = getBaseUrl(req);
    const reference = `SW-${cleanCode}-${alertId.slice(0, 6).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;

    const created = await bachs.checkoutSessions.create(
      {
        pricing: { currency, amount: amount.toFixed(2) },
        customer: { email: actor.email, name: actor.email.split("@")[0] || "Customer" },
        reference,
        metadata: { trackingCode: cleanCode, alertId, payerUid: actor.uid },
        success_url: `${baseUrl}/dashboard/track/${encodeURIComponent(cleanCode)}?paid=1&alertId=${encodeURIComponent(alertId)}`,
        cancel_url: `${baseUrl}/dashboard/track/${encodeURIComponent(cleanCode)}?cancelled=1`,
        expires_in_minutes: settings.checkoutExpiryMinutes || 60,
      },
      { idempotencyKey: `cust_${cleanCode}_${alertId}_${Math.floor(Date.now() / 60000)}` }
    );

    await alertSnap.ref.update({
      payment: {
        provider: "bachs",
        environment: env,
        checkoutId: created.checkout_id,
        checkoutUrl: created.checkout_url,
        reference: created.reference || reference,
        status: "pending",
        currency,
        expiresAt: Date.parse(created.expires_at) || Date.now() + 3600000,
      },
    });

    res.json({
      checkoutUrl: created.checkout_url,
      checkoutId: created.checkout_id,
      reference: created.reference || reference,
      provider: "bachs",
      environment: env,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Checkout failed." });
  }
});

app.get("/api/admin/settings", async (req, res) => {
  const actor = await verifyActor(req);
  if (!actor?.isAdmin) {
    res.status(actor ? 403 : 401).json({ error: "Admin access required." });
    return;
  }
  const settings = await loadSettings();
  res.json({ settings: settings.pub });
});

app.post("/api/admin/settings", async (req, res) => {
  try {
    const actor = await verifyActor(req);
    if (!actor?.isAdmin) {
      res.status(actor ? 403 : 401).json({ error: "Admin access required." });
      return;
    }
    const patch = (req.body || {}) as Record<string, Record<string, unknown>>;
    const touchesLive =
      Boolean(patch.bachs?.liveSecretKey) ||
      Boolean(patch.bachs?.liveWebhookSecret) ||
      patch.bachs?.environment === "live";
    if (touchesLive && Math.floor(Date.now() / 1000) - actor.authTime > 900) {
      res.status(403).json({
        error: "Please confirm your password before modifying live settings.",
        code: "RECENT_AUTH_REQUIRED",
      });
      return;
    }

    const database = db();
    const { pub } = await loadSettings();
    const nextPub = JSON.parse(JSON.stringify(pub)) as Record<string, Record<string, unknown>>;
    const secWrites: Record<string, unknown> = {};

    const applySecret = (
      raw: unknown,
      encKey: string,
      section: string,
      maskKey: string
    ) => {
      if (typeof raw !== "string" || !raw.trim()) return;
      secWrites[encKey] = encryptSecret(raw.trim());
      const secObj = (nextPub[section].secrets || {}) as Record<string, unknown>;
      secObj[maskKey] = maskSecret(raw.trim(), actor.email);
      nextPub[section].secrets = secObj;
    };

    if (patch.bachs) {
      applySecret(patch.bachs.sandboxSecretKey, "bachsSandboxKey", "bachs", "sandboxSecretKey");
      applySecret(patch.bachs.liveSecretKey, "bachsLiveKey", "bachs", "liveSecretKey");
      applySecret(patch.bachs.sandboxWebhookSecret, "bachsSandboxWebhook", "bachs", "sandboxWebhookSecret");
      applySecret(patch.bachs.liveWebhookSecret, "bachsLiveWebhook", "bachs", "liveWebhookSecret");
      applySecret(patch.bachs.previousWebhookSecret, "bachsPreviousWebhook", "bachs", "previousWebhookSecret");
      if (patch.bachs.environment) nextPub.bachs.environment = patch.bachs.environment;
      if (typeof patch.bachs.organizationId === "string") nextPub.bachs.organizationId = patch.bachs.organizationId;
      if (typeof patch.bachs.defaultCurrency === "string") nextPub.bachs.defaultCurrency = patch.bachs.defaultCurrency;
      if (typeof patch.bachs.checkoutExpiryMinutes === "number") nextPub.bachs.checkoutExpiryMinutes = patch.bachs.checkoutExpiryMinutes;
    }

    if (patch.resend) {
      applySecret(patch.resend.apiKey, "resendApiKey", "resend", "apiKey");
      applySecret(patch.resend.inboundWebhookSecret, "resendInboundSecret", "resend", "inboundWebhookSecret");
      if (typeof patch.resend.from === "string") nextPub.resend.from = patch.resend.from;
      if (typeof patch.resend.replyTo === "string") nextPub.resend.replyTo = patch.resend.replyTo;
      if (typeof patch.resend.supportInbox === "string") nextPub.resend.supportInbox = patch.resend.supportInbox;
    }

    if (patch.stripe) {
      applySecret(patch.stripe.secretKey, "stripeSecretKey", "stripe", "secretKey");
      applySecret(patch.stripe.webhookSecret, "stripeWebhookSecret", "stripe", "webhookSecret");
      if (typeof patch.stripe.enabled === "boolean") nextPub.stripe.enabled = patch.stripe.enabled;
      if (typeof patch.stripe.publicKey === "string") nextPub.stripe.publicKey = patch.stripe.publicKey;
    }

    if (patch.paystack) {
      applySecret(patch.paystack.secretKey, "paystackSecretKey", "paystack", "secretKey");
      applySecret(patch.paystack.webhookSecret, "paystackWebhookSecret", "paystack", "webhookSecret");
      if (typeof patch.paystack.enabled === "boolean") nextPub.paystack.enabled = patch.paystack.enabled;
      if (typeof patch.paystack.publicKey === "string") nextPub.paystack.publicKey = patch.paystack.publicKey;
    }

    if (patch.routing) {
      nextPub.routing = { ...nextPub.routing, ...patch.routing };
    }

    const batch = database.batch();
    batch.set(database.collection("adminSettings").doc("payments"), {
      ...nextPub,
      updatedAt: Date.now(),
      updatedBy: actor.email,
    });
    if (Object.keys(secWrites).length > 0) {
      batch.set(
        database.collection("adminSecrets").doc("payments"),
        { ...secWrites, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.email },
        { merge: true }
      );
    }
    batch.set(database.collection("auditLogs").doc(), {
      actorUid: actor.uid,
      actorEmail: actor.email,
      action: "update_settings",
      code: "",
      detail: "Updated encrypted settings from Admin Portal",
      createdAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();
    bundleCache = null;
    res.json({ settings: nextPub });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Save failed." });
  }
});

app.post("/api/admin/settings/test-bachs", async (req, res) => {
  const actor = await verifyActor(req);
  if (!actor?.isAdmin) {
    res.status(actor ? 403 : 401).json({ error: "Admin required." });
    return;
  }
  const settings = await loadSettings();
  const apiKey =
    settings.environment === "live"
      ? settings.sec.bachsLiveKey
      : settings.sec.bachsSandboxKey;
  if (!apiKey) {
    res.json({ ok: false, environment: settings.environment, error: "No key configured." });
    return;
  }
  try {
    const bachs = new Bachs({
      apiKey,
      environment: settings.environment === "live" ? "production" : "sandbox",
    });
    const bal = await bachs.balances.get();
    res.json({
      ok: true,
      environment: settings.environment,
      accountId: bal.account_id,
      totalBalanceUsd: bal.total_balance_usd,
    });
  } catch (err) {
    res.json({
      ok: false,
      environment: settings.environment,
      error: err instanceof Error ? err.message : "Connection failed",
    });
  }
});

app.post("/api/admin/settings/test-email", async (req, res) => {
  const actor = await verifyActor(req);
  if (!actor?.isAdmin) {
    res.status(actor ? 403 : 401).json({ error: "Admin required." });
    return;
  }
  const to = String((req.body as { to?: string })?.to || actor.email).trim();
  const result = await sendResendEmail({
    to,
    subject: "ShipWell Email Delivery Test (info.shipwell.cc)",
    html: renderSimpleMailHtml({
      baseUrl: getBaseUrl(req),
      heading: "ShipWell Email Test",
      bodyHtml: "<p>Your Resend configuration on <strong>info.shipwell.cc</strong> is operational.</p>",
      ctaLabel: "Open ShipWell",
      ctaUrl: getBaseUrl(req),
      footer: `Triggered by ${actor.email}`,
    }),
    text: "Your Resend configuration on info.shipwell.cc is operational.",
    template: "admin_test_email",
    createdBy: actor.uid,
  });
  res.json(result);
});

app.post("/api/support/contact", async (req, res) => {
  try {
    const actor = await verifyActor(req);
    const body = (req.body || {}) as Record<string, string>;
    if (body._hp) {
      res.json({ ok: true, ticketCode: "TKT-OK" });
      return;
    }
    const name = String(body.name || "").trim();
    const email = String(body.email || actor?.email || "").trim().toLowerCase();
    const code = CODE_RE.test(String(body.code || "").toUpperCase())
      ? String(body.code).toUpperCase()
      : null;
    const subject = String(body.subject || "").trim();
    const message = String(body.message || "").trim();
    if (!name || !email.includes("@") || !subject || !message) {
      res.status(400).json({ error: "All fields are required." });
      return;
    }
    const database = db();
    const ticketCode = `TKT-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    const now = Date.now();
    const threadRef = database.collection("supportThreads").doc();
    const batch = database.batch();
    batch.set(threadRef, {
      ticketCode,
      uid: actor?.uid || null,
      userName: name,
      userEmail: email,
      subject,
      code,
      status: "open",
      source: "web",
      unreadAdmin: true,
      unreadUser: false,
      lastMessageAt: now,
      lastMessagePreview: message.slice(0, 140),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    batch.set(threadRef.collection("messages").doc(), {
      from: "user",
      senderName: name,
      senderEmail: email,
      body: message,
      source: "web",
      ts: now,
      createdAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();

    const settings = await loadSettings();
    await sendResendEmail({
      to: settings.supportInbox,
      subject: `[Support ${ticketCode}] ${subject}`,
      html: renderSimpleMailHtml({
        baseUrl: getBaseUrl(req),
        heading: `New Support Message (${ticketCode})`,
        bodyHtml: `<p><strong>From:</strong> ${escapeHtml(name)} (${escapeHtml(email)})</p><p>${escapeHtml(message)}</p>`,
        ctaLabel: "Open in Admin Inbox",
        ctaUrl: `${getBaseUrl(req)}/admin/thread/${threadRef.id}`,
        footer: "ShipWell Support Notification",
      }),
      text: `${name} (${email}):\n${message}`,
      template: "support_contact",
      code,
      replyTo: email,
    });
    res.json({ ok: true, threadId: threadRef.id, ticketCode });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed" });
  }
});

app.post("/api/support/reply", async (req, res) => {
  try {
    const actor = await verifyActor(req);
    if (!actor) {
      res.status(401).json({ error: "Login required." });
      return;
    }
    const body = (req.body || {}) as { threadId?: string; message?: string; status?: "open" | "closed" };
    const threadId = String(body.threadId || "");
    const message = String(body.message || "").trim();
    const database = db();
    const threadRef = database.collection("supportThreads").doc(threadId);
    const snap = await threadRef.get();
    if (!snap.exists) {
      res.status(404).json({ error: "Thread not found." });
      return;
    }
    const thread = snap.data() as Record<string, unknown>;
    if (!actor.isAdmin && thread.uid !== actor.uid && thread.userEmail !== actor.email) {
      res.status(403).json({ error: "Forbidden." });
      return;
    }
    const now = Date.now();
    if (message) {
      await threadRef.collection("messages").add({
        from: actor.isAdmin ? "admin" : "user",
        senderName: actor.isAdmin ? "ShipWell Support" : String(thread.userName || actor.email),
        senderEmail: actor.email,
        body: message,
        source: "web",
        ts: now,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    await threadRef.update({
      status: actor.isAdmin && body.status ? body.status : "open",
      unreadAdmin: !actor.isAdmin,
      unreadUser: actor.isAdmin,
      ...(message ? { lastMessageAt: now, lastMessagePreview: message.slice(0, 140) } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (message && actor.isAdmin) {
      await sendResendEmail({
        to: String(thread.userEmail),
        subject: `Re: ${String(thread.subject)} [${String(thread.ticketCode)}]`,
        html: renderSimpleMailHtml({
          baseUrl: getBaseUrl(req),
          heading: `Support reply (${String(thread.ticketCode)})`,
          bodyHtml: `<p>${escapeHtml(message)}</p>`,
          ctaLabel: "Open Dashboard Inbox",
          ctaUrl: `${getBaseUrl(req)}/dashboard/support/${threadId}`,
          footer: `Reply directly to support@info.shipwell.cc · ${String(thread.ticketCode)}`,
        }),
        text: message,
        template: "support_reply",
        code: (thread.code as string) || null,
      });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed" });
  }
});

app.post("/api/inbound-email", async (req, res) => {
  try {
    const payload = (req.body || {}) as Record<string, unknown>;
    const inner = (payload.data as Record<string, unknown>) || payload;
    const fromRaw = String(inner.from || payload.from || "");
    const m = fromRaw.match(/<([^>]+)>/);
    const fromEmail = (m ? m[1] : fromRaw).trim().toLowerCase();
    const subject = String(inner.subject || payload.subject || "Email enquiry");
    const bodyText = String(inner.text || inner.html || "(Empty email)").replace(/<[^>]+>/g, " ").trim().slice(0, 4000);
    if (!fromEmail.includes("@")) {
      res.json({ ok: true, ignored: true });
      return;
    }
    const database = db();
    const tkt = subject.match(/\[(TKT-[A-Z0-9]+)\]/i)?.[1]?.toUpperCase();
    let ref: FirebaseFirestore.DocumentReference | null = null;
    if (tkt) {
      const q = await database.collection("supportThreads").where("ticketCode", "==", tkt).limit(1).get();
      if (!q.empty) ref = q.docs[0].ref;
    }
    const now = Date.now();
    const ticketCode = tkt || `TKT-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    if (!ref) {
      ref = database.collection("supportThreads").doc();
      await ref.set({
        ticketCode,
        uid: null,
        userName: fromEmail.split("@")[0],
        userEmail: fromEmail,
        subject,
        code: null,
        status: "open",
        source: "email",
        unreadAdmin: true,
        unreadUser: false,
        lastMessageAt: now,
        lastMessagePreview: bodyText.slice(0, 140),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      await ref.update({
        status: "open",
        unreadAdmin: true,
        lastMessageAt: now,
        lastMessagePreview: bodyText.slice(0, 140),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    await ref.collection("messages").add({
      from: "user",
      senderName: fromEmail.split("@")[0],
      senderEmail: fromEmail,
      body: bodyText,
      source: "email",
      ts: now,
      createdAt: FieldValue.serverTimestamp(),
    });
    res.json({ ok: true, threadId: ref.id, ticketCode });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Inbound failed" });
  }
});

app.post("/api/resend-webhook", async (req, res) => {
  try {
    const payload = (req.body || {}) as { type?: string; data?: { email_id?: string } };
    const emailId = String(payload.data?.email_id || "");
    const nextStatus =
      payload.type === "email.delivered"
        ? "delivered"
        : payload.type === "email.bounced"
          ? "bounced"
          : null;
    if (emailId && nextStatus) {
      const snap = await db().collection("emailLogs").where("providerId", "==", emailId).limit(3).get();
      await Promise.all(snap.docs.map((d) => d.ref.update({ status: nextStatus })));
    }
    res.json({ ok: true });
  } catch {
    res.json({ ok: false });
  }
});

app.post("/api/admin/settings/create-test-checkout", async (req, res) => {
  try {
    const actor = await verifyActor(req);
    if (!actor?.isAdmin) {
      res.status(actor ? 403 : 401).json({ error: "Admin required." });
      return;
    }
    const settings = await loadSettings();
    const apiKey =
      settings.environment === "live"
        ? settings.sec.bachsLiveKey
        : settings.sec.bachsSandboxKey;
    if (!apiKey) {
      res.status(400).json({ error: `No Bachs ${settings.environment} key configured.` });
      return;
    }
    const bachs = new Bachs({
      apiKey,
      environment: settings.environment === "live" ? "production" : "sandbox",
    });
    const baseUrl = getBaseUrl(req);
    const created = await bachs.checkoutSessions.create(
      {
        pricing: { currency: settings.defaultCurrency || "USD", amount: "1.00" },
        customer: { email: actor.email || ADMIN_EMAIL, name: "ShipWell Admin Test" },
        reference: `SW-TEST-${Date.now().toString(36).toUpperCase()}`,
        metadata: { is_test: "true", actorUid: actor.uid },
        success_url: `${baseUrl}/admin/settings?test_paid=1`,
        cancel_url: `${baseUrl}/admin/settings?test_cancelled=1`,
        expires_in_minutes: 15,
      },
      { idempotencyKey: `admin_test_${Date.now()}` }
    );
    res.json({
      checkoutId: created.checkout_id,
      checkoutUrl: created.checkout_url,
      environment: settings.environment,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Test checkout failed." });
  }
});

app.post("/api/admin/refund", async (req, res) => {
  try {
    const actor = await verifyActor(req);
    if (!actor?.isAdmin) {
      res.status(actor ? 403 : 401).json({ error: "Admin required." });
      return;
    }
    if (Math.floor(Date.now() / 1000) - actor.authTime > 900) {
      res.status(403).json({ error: "Recent password verification required.", code: "RECENT_AUTH_REQUIRED" });
      return;
    }
    const body = (req.body || {}) as { code?: string; alertId?: string; reason?: string };
    const code = String(body.code || "").trim().toUpperCase();
    const alertId = String(body.alertId || "").trim();
    const database = db();
    const shipRef = database.collection("shipments").doc(code);
    const alertRef = shipRef.collection("alerts").doc(alertId);
    const alertSnap = await alertRef.get();
    if (!alertSnap.exists) {
      res.status(404).json({ error: "Charge not found." });
      return;
    }
    const alert = alertSnap.data() as Record<string, unknown>;
    const pay = (alert.payment || {}) as Record<string, unknown>;
    if (pay.status !== "paid" || !pay.paymentId) {
      res.status(400).json({ error: "Only paid charges with a paymentId can be refunded." });
      return;
    }
    const settings = await loadSettings();
    const env = (pay.environment as "sandbox" | "live") || settings.environment;
    const apiKey = env === "live" ? settings.sec.bachsLiveKey : settings.sec.bachsSandboxKey;
    const baseApi = env === "live" ? "https://api.bachs.io" : "https://sandbox-api.bachs.io";
    const r = await fetch(`${baseApi}/v1/refunds`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        payment_id: pay.paymentId,
        amount: Number(pay.amountPaid || alert.amount).toFixed(2),
        reason: body.reason || `Admin refund ${code}`,
      }),
    });
    const rJson = (await r.json().catch(() => ({}))) as Record<string, string>;
    if (!r.ok) {
      res.status(400).json({ error: rJson.message || `Refund failed (HTTP ${r.status})` });
      return;
    }
    const refundId = rJson.refund_id || rJson.id || `ref_${Date.now().toString(36)}`;
    await alertRef.update({
      "payment.status": "refunded",
      "payment.refundedAt": Date.now(),
      "payment.refundId": refundId,
    });
    res.json({ ok: true, refundId, status: "refunded" });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Refund failed." });
  }
});

app.post("/api/invites/create", async (req, res) => {
  try {
    const actor = await verifyActor(req);
    if (!actor) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }
    const b = (req.body || {}) as Record<string, unknown>;
    const code = String(b.code || "").trim().toUpperCase();
    const receiverEmail = String(b.receiverEmail || "").trim().toLowerCase();
    if (!CODE_RE.test(code) || !receiverEmail.includes("@")) {
      res.status(400).json({ error: "Valid code and receiverEmail required." });
      return;
    }
    const tokenPayload = Buffer.from(
      JSON.stringify({
        code,
        receiverEmail,
        exp: Date.now() + 14 * 86400000,
      })
    ).toString("base64url");
    const sig = crypto
      .createHmac("sha256", process.env.SETTINGS_ENCRYPTION_KEY || "shipwell-invite")
      .update(tokenPayload)
      .digest("base64url");
    const token = `${tokenPayload}.${sig}`;
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const baseUrl = getBaseUrl(req);
    const inviteUrl = `${baseUrl}/track/${encodeURIComponent(code)}?invite=${encodeURIComponent(token)}`;
    const senderName = String(b.senderFullName || "A ShipWell sender");
    const receiverName = String(b.receiverFullName || "there");
    const hasAccount = Boolean(b.receiverHasAccount);

    const recRes = await sendResendEmail({
      to: receiverEmail,
      subject: hasAccount
        ? `A parcel from ${senderName.split(" ")[0]} is on its way to you`
        : `${senderName.split(" ")[0]} is sending you a parcel — track it on ShipWell`,
      html: renderSimpleMailHtml({
        baseUrl,
        heading: "A parcel is on its way to you",
        bodyHtml: `<p>Hello ${escapeHtml(receiverName.split(" ")[0])}. <strong>${escapeHtml(senderName)}</strong> has shipped <strong>${escapeHtml(String(b.contents || "a parcel"))}</strong> to you (${escapeHtml(code)}).</p><p>Create your free account with <strong>${escapeHtml(receiverEmail)}</strong> and your parcel finds you.</p>`,
        ctaLabel: hasAccount ? "Track my parcel" : "Create my account",
        ctaUrl: hasAccount ? `${baseUrl}/track/${code}` : inviteUrl,
        footer: "Questions? Reply to this email. · ShipWell Logistics Ltd.",
      }),
      text: `A parcel is on its way to you (${code}). Use ${receiverEmail}: ${inviteUrl}`,
      template: hasAccount ? "on_its_way" : "invite",
      code,
      createdBy: actor.uid,
    });

    let senderRes = null;
    if (b.sendSenderReceipt && typeof b.senderEmail === "string" && b.senderEmail.includes("@")) {
      senderRes = await sendResendEmail({
        to: b.senderEmail.toLowerCase(),
        subject: `Booking confirmed — ${code} is on ShipWell`,
        html: renderSimpleMailHtml({
          baseUrl,
          heading: "Your shipment is booked",
          bodyHtml: `<p>Tracking code: <strong>${escapeHtml(code)}</strong></p><p>We emailed ${escapeHtml(receiverEmail)} so they can follow it too.</p>`,
          ctaLabel: "View shipment",
          ctaUrl: `${baseUrl}/track/${code}`,
          footer: "ShipWell Logistics Ltd.",
        }),
        text: `Booking confirmed ${code}`,
        template: "sender_booking",
        code,
        createdBy: actor.uid,
      });
    }

    res.json({
      tokenHash,
      expiresAt: Date.now() + 14 * 86400000,
      template: hasAccount ? "on_its_way" : "invite",
      invitePath: `/track/${code}?invite=${token}`,
      receiverEmailResult: recRes,
      senderEmailResult: senderRes,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Invite failed." });
  }
});

app.post("/api/invites/verify", (req, res) => {
  try {
    const token = String((req.body as { token?: string })?.token || "");
    const [payload] = token.split(".");
    const parsed = JSON.parse(Buffer.from(payload || "", "base64url").toString("utf8")) as {
      code?: string;
      receiverEmail?: string;
      exp?: number;
    };
    const expired = Boolean(parsed.exp && Date.now() > parsed.exp);
    res.json({
      valid: Boolean(parsed.code && !expired),
      expired,
      code: parsed.code,
      receiverEmail: parsed.receiverEmail,
      tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
    });
  } catch {
    res.json({ valid: false, expired: false });
  }
});

app.post("/api/shipments/notify", async (req, res) => {
  try {
    const actor = await verifyActor(req);
    if (!actor) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }
    const b = (req.body || {}) as Record<string, unknown>;
    const code = String(b.code || "").trim().toUpperCase();
    const toEmail = String(b.toEmail || "").trim().toLowerCase();
    const baseUrl = getBaseUrl(req);
    const result = await sendResendEmail({
      to: toEmail,
      subject: `Update on ${code}: ${String(b.headline || "Shipment updated")}`,
      html: renderSimpleMailHtml({
        baseUrl,
        heading: String(b.headline || "Shipment update"),
        bodyHtml: `<p>${escapeHtml(String(b.details || ""))}</p>`,
        ctaLabel: b.updateType === "action_required" ? "Take action now" : "Track shipment",
        ctaUrl: `${baseUrl}/track/${encodeURIComponent(code)}`,
        footer: "ShipWell Live Tracking",
      }),
      text: `${code}: ${String(b.headline || "")} — ${String(b.details || "")}`,
      template: `shipment_${String(b.updateType || "checkpoint")}`,
      code,
      createdBy: actor.uid,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Notify failed." });
  }
});

app.post("/api/leads/notify", async (req, res) => {
  try {
    const b = (req.body || {}) as Record<string, string>;
    const result = await sendResendEmail({
      to: ADMIN_EMAIL,
      subject: `New ShipWell Business Lead (${b.ref || ""}): ${b.company || ""}`,
      html: renderSimpleMailHtml({
        baseUrl: getBaseUrl(req),
        heading: b.company || "Business enquiry",
        bodyHtml: `<p>${escapeHtml(b.name || "")} (${escapeHtml(b.email || "")}) — ${escapeHtml(b.plan || "")} (${escapeHtml(b.volume || "")})</p><p>${escapeHtml(b.message || "")}</p>`,
        ctaLabel: "Open Admin",
        ctaUrl: `${getBaseUrl(req)}/admin`,
        footer: "ShipWell Business Leads",
      }),
      text: `${b.company}: ${b.name} (${b.email}) — ${b.message || ""}`,
      template: "business_lead",
      replyTo: b.email,
      createdBy: "lead_form",
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Lead notify failed." });
  }
});

export const api = onRequest(
  {
    region: "us-central1",
    cors: true,
    secrets: ["SETTINGS_ENCRYPTION_KEY"],
  },
  app
);

export const onShipmentEventCreated = onDocumentCreated(
  {
    document: "shipments/{code}/events/{eventId}",
    region: "us-central1",
    secrets: ["SETTINGS_ENCRYPTION_KEY"],
  },
  async (event) => {
    const ev = event.data?.data();
    if (!ev) return;
    if (ev.kind !== "scan" && ev.kind !== "delay") return;
    const { code, eventId } = event.params;
    const shipSnap = await db().collection("shipments").doc(code).get();
    if (!shipSnap.exists) return;
    const shipment = shipSnap.data() as Record<string, unknown>;
    const recipients = new Set(
      [String(shipment.receiverEmail || ""), String(shipment.senderEmail || "")].filter((e) =>
        e.includes("@")
      )
    );
    for (const email of recipients) {
      await sendResendEmail({
        to: email,
        subject:
          ev.kind === "delay"
            ? `Delay / Hold notice (${code}): ${String(ev.label || "")}`
            : `Shipment update (${code}): ${String(ev.label || "")}`,
        html: renderSimpleMailHtml({
          baseUrl: DEFAULT_APP_URL,
          heading: String(ev.label || "Tracking checkpoint"),
          bodyHtml: `<p>Location: <strong>${escapeHtml(String(ev.loc || ""))}</strong></p><p>${escapeHtml(String(ev.note || ""))}</p>`,
          ctaLabel: "Track shipment",
          ctaUrl: `${DEFAULT_APP_URL}/track/${encodeURIComponent(code)}`,
          footer: "ShipWell Live Tracking",
        }),
        text: `${code}: ${String(ev.label || "")} at ${String(ev.loc || "")}`,
        template: `trigger_${ev.kind}`,
        code,
        dedupKey: `ev_${code}_${eventId}_${email.replace(/[^a-z0-9]/g, "_")}`,
      });
    }
  }
);

// ── Firestore Automatic Email Triggers (v2) ──
export const onShipmentWritten = onDocumentWritten(
  {
    document: "shipments/{code}",
    region: "us-central1",
    secrets: ["SETTINGS_ENCRYPTION_KEY"],
  },
  async (event) => {
    const after = event.data?.after.data();
    if (!after) return;
    const before = event.data?.before.data();
    const code = event.params.code;
    const receiverEmail = String(after.receiverEmail || "");
    const senderEmail = String(after.senderEmail || "");

    // Notify on hold released
    if (before?.hold && !after.hold && receiverEmail) {
      await sendResendEmail({
        to: receiverEmail,
        subject: `Hold released — ${code} is moving again`,
        html: renderSimpleMailHtml({
          baseUrl: DEFAULT_APP_URL,
          heading: "Hold released — moving again",
          bodyHtml: `<p>The hold on shipment <strong>${escapeHtml(code)}</strong> has been cleared and transit has resumed.</p>`,
          ctaLabel: "Track shipment",
          ctaUrl: `${DEFAULT_APP_URL}/track/${encodeURIComponent(code)}`,
          footer: "ShipWell Live Tracking",
        }),
        text: `Hold released for ${code}. Track: ${DEFAULT_APP_URL}/track/${code}`,
        template: "trigger_hold_released",
        code,
        dedupKey: `hold_rel_${code}_${before.hold.at || "0"}_${Date.now().toString(36).slice(0, 5)}`,
      });
    }

    // Notify on Delivered
    if (before && before.status !== "Delivered" && after.status === "Delivered") {
      for (const email of new Set([receiverEmail, senderEmail].filter(Boolean))) {
        await sendResendEmail({
          to: email,
          subject: `Delivered: ${code}`,
          html: renderSimpleMailHtml({
            baseUrl: DEFAULT_APP_URL,
            heading: "Parcel delivered",
            bodyHtml: `<p>Shipment <strong>${escapeHtml(code)}</strong> has been marked delivered.</p>`,
            ctaLabel: "View delivery confirmation",
            ctaUrl: `${DEFAULT_APP_URL}/track/${encodeURIComponent(code)}`,
            footer: "ShipWell Live Tracking",
          }),
          text: `Delivered: ${code}. View at ${DEFAULT_APP_URL}/track/${code}`,
          template: "trigger_delivered",
          code,
          dedupKey: `delivered_${code}_${email.replace(/[^a-z0-9]/g, "_")}`,
        });
      }
    }
  }
);

export const onShipmentAlertCreated = onDocumentCreated(
  {
    document: "shipments/{code}/alerts/{alertId}",
    region: "us-central1",
    secrets: ["SETTINGS_ENCRYPTION_KEY"],
  },
  async (event) => {
    const alert = event.data?.data();
    if (!alert) return;
    const { code, alertId } = event.params;
    const shipSnap = await db().collection("shipments").doc(code).get();
    if (!shipSnap.exists) return;
    const shipment = shipSnap.data() as Record<string, unknown>;
    const toEmail =
      alert.to === "sender"
        ? String(shipment.senderEmail || "")
        : String(shipment.receiverEmail || "");
    if (!toEmail) return;

    const isDuty = alert.kind === "duty" && Number(alert.amount || 0) > 0;
    const chargeLabel = String(alert.chargeType || alert.title || "Action required");
    const amtStr = isDuty ? `$${Number(alert.amount).toFixed(2)}` : "";

    await sendResendEmail({
      to: toEmail,
      subject: isDuty
        ? `Action required (${code}): ${chargeLabel} (${amtStr})`
        : `Action required on ${code}: ${chargeLabel}`,
      html: renderSimpleMailHtml({
        baseUrl: DEFAULT_APP_URL,
        heading: isDuty ? `${chargeLabel} due (${amtStr})` : chargeLabel,
        bodyHtml: `<p>${escapeHtml(String(alert.message || ""))}</p>`,
        ctaLabel: isDuty ? "Pay customs charge" : "Take action now",
        ctaUrl: `${DEFAULT_APP_URL}/dashboard/track/${encodeURIComponent(code)}`,
        footer: "Mandatory clearance update for your active ShipWell parcel.",
      }),
      text: `${chargeLabel} ${amtStr}: ${String(alert.message || "")}`,
      template: isDuty ? "trigger_customs_charge" : "trigger_action_required",
      code,
      dedupKey: `alert_${code}_${alertId}`,
    });
  }
);
