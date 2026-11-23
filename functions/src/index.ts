import crypto from "node:crypto";
import express from "express";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore, type Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { onRequest } from "firebase-functions/v2/https";
import {
  onDocumentCreated,
  onDocumentWritten,
} from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { parsePhoneNumberFromString } from "libphonenumber-js";

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
const DEFAULT_EMAIL_FROM = "ShipWell <notifications@mail.shipwell.cc>";
const DEFAULT_EMAIL_REPLY_TO = "support@mail.shipwell.cc";
const DEFAULT_SUPPORT_INBOX = "support@mail.shipwell.cc";
const DEFAULT_FROM_SECURITY = "ShipWell Security <noreply@mail.shipwell.cc>";
const DEFAULT_FROM_TRACKING = "ShipWell Tracking <tracking@mail.shipwell.cc>";
const DEFAULT_FROM_BILLING = "ShipWell Billing <billing@mail.shipwell.cc>";
const DEFAULT_FROM_PAYMENTS = "ShipWell Payments <payments@mail.shipwell.cc>";
const DEFAULT_FROM_NOTIFICATIONS = "ShipWell <notifications@mail.shipwell.cc>";
const DEFAULT_FROM_SUPPORT = "ShipWell Support <support@mail.shipwell.cc>";
const CODE_RE = /^SW-\d{8}-[A-F0-9]{8}$/;
const fnRateMap = new Map<string, number[]>();
function checkFnRateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const prev = (fnRateMap.get(key) || []).filter((t) => now - t < windowMs);
  if (prev.length >= max) return false;
  prev.push(now);
  fnRateMap.set(key, prev);
  return true;
}

function upgradeLegacyDomain(val: unknown, fallback: string): string {
  const s = String(val || "").trim();
  if (!s) return fallback;
  return s.replace(/@info\.shipwell\.cc\b/gi, "@mail.shipwell.cc");
}

// ── Shared Shipping Rate Calculator (must match client lib/quote-engine.ts) ──
const PLACES: Record<string, { city: string; lat: number; lon: number }> = {
  Nigeria: { city: "Lagos", lat: 6.52, lon: 3.38 },
  Ghana: { city: "Accra", lat: 5.6, lon: -0.19 },
  "South Africa": { city: "Johannesburg", lat: -26.2, lon: 28.04 },
  Kenya: { city: "Nairobi", lat: -1.29, lon: 36.82 },
  "United Kingdom": { city: "London", lat: 51.51, lon: -0.13 },
  Germany: { city: "Berlin", lat: 52.52, lon: 13.4 },
  France: { city: "Paris", lat: 48.86, lon: 2.35 },
  "United Arab Emirates": { city: "Dubai", lat: 25.2, lon: 55.27 },
  India: { city: "Mumbai", lat: 19.08, lon: 72.88 },
  China: { city: "Shanghai", lat: 31.23, lon: 121.47 },
  Japan: { city: "Tokyo", lat: 35.68, lon: 139.69 },
  Australia: { city: "Sydney", lat: -33.87, lon: 151.21 },
  "United States": { city: "New York", lat: 40.71, lon: -74.01 },
  Canada: { city: "Toronto", lat: 43.65, lon: -79.38 },
};

const SERVICE_MULT = { economy: 0.55, standard: 1, express: 1.85 } as const;

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

function calcServerQuote(
  from: string,
  to: string,
  kg: number,
  declaredValue: number,
  svc: "economy" | "standard" | "express"
) {
  const A = PLACES[from] ?? PLACES["United States"];
  const B = PLACES[to] ?? PLACES["United Kingdom"];
  const intl = from !== to;
  const R = 6371;
  const d = Math.PI / 180;
  const dLat = (B.lat - A.lat) * d;
  const dLon = (B.lon - A.lon) * d;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(A.lat * d) * Math.cos(B.lat * d) * Math.sin(dLon / 2) ** 2;
  const dist = intl ? 2 * R * Math.asin(Math.sqrt(h)) : 120;
  const perKg = 1.9 + dist / 3800;
  const base = r2((8 + Math.max(kg, 0.1) * perKg) * SERVICE_MULT[svc]);
  const fuel = r2(base * 0.12);
  const cover = r2(Math.max(2.5, (declaredValue || 0) * 0.008));
  const duty = intl ? r2(base * 0.08) : 0;
  const total = r2(base + fuel + cover + duty);
  let days: [number, number];
  if (!intl) {
    days = { express: [1, 1], standard: [1, 2], economy: [3, 4] }[svc] as [number, number];
  } else if (svc === "express") {
    const dt = Math.max(1, Math.ceil(1 + dist / 9000));
    days = [dt, dt + 1];
  } else if (svc === "standard") {
    const dt = Math.ceil(2 + dist / 3500);
    days = [dt, dt + 2];
  } else {
    const dt = Math.ceil(5 + dist / 1800);
    days = [dt, dt + 3];
  }
  return { total, days };
}

function addBusinessDays(ts: number, count: number): number {
  const dt = new Date(ts);
  let left = count;
  while (left > 0) {
    dt.setDate(dt.getDate() + 1);
    if (dt.getDay() % 6 !== 0) left--;
  }
  return dt.getTime();
}

function generateTrackingCode(): string {
  const now = new Date();
  const pad = (x: number) => String(x).padStart(2, "0");
  const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const suffix = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `SW-${dateStr}-${suffix}`;
}

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
  sandboxProductId: string;
  liveProductId: string;
  defaultCurrency: string;
  checkoutExpiryMinutes: number;
  enableBachsBooking: boolean;
  enablePayOnPickup: boolean;
  emailFrom: string;
  emailReplyTo: string;
  supportInbox: string;
  fromSecurity: string;
  fromTracking: string;
  fromBilling: string;
  fromPayments: string;
  fromNotifications: string;
  fromSupport: string;
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
  const routingObj = (pubData.routing || {}) as Record<string, unknown>;

  const env: "sandbox" | "live" = bachsObj.environment === "live" ? "live" : "sandbox";
  const sandboxProductId = String(bachsObj.sandboxProductId || "").trim();
  const liveProductId = String(bachsObj.liveProductId || "").trim();
  const enableBachsBooking = routingObj.enableBachsBooking !== false;
  const enablePayOnPickup = routingObj.enablePayOnPickup !== false;

  const emailFrom = upgradeLegacyDomain(
    resendObj.from || process.env.EMAIL_FROM,
    DEFAULT_EMAIL_FROM
  );
  const emailReplyTo = upgradeLegacyDomain(
    resendObj.replyTo || process.env.EMAIL_REPLY_TO,
    DEFAULT_EMAIL_REPLY_TO
  );
  const supportInbox = upgradeLegacyDomain(
    resendObj.supportInbox || process.env.SUPPORT_INBOX,
    DEFAULT_SUPPORT_INBOX
  );
  const fromSecurity = upgradeLegacyDomain(resendObj.fromSecurity || process.env.FROM_SECURITY, DEFAULT_FROM_SECURITY);
  const fromTracking = upgradeLegacyDomain(resendObj.fromTracking || process.env.FROM_TRACKING, DEFAULT_FROM_TRACKING);
  const fromBilling = upgradeLegacyDomain(resendObj.fromBilling || process.env.FROM_BILLING, DEFAULT_FROM_BILLING);
  const fromPayments = upgradeLegacyDomain(resendObj.fromPayments || process.env.FROM_PAYMENTS, DEFAULT_FROM_PAYMENTS);
  const fromNotifications = upgradeLegacyDomain(
    resendObj.fromNotifications || resendObj.from || process.env.FROM_NOTIFICATIONS || process.env.EMAIL_FROM,
    DEFAULT_FROM_NOTIFICATIONS
  );
  const fromSupport = upgradeLegacyDomain(resendObj.fromSupport || process.env.FROM_SUPPORT, DEFAULT_FROM_SUPPORT);

  const bundle: SettingsBundle = {
    pub: {
      bachs: {
        environment: env,
        sandboxProductId,
        liveProductId,
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
        from: emailFrom,
        replyTo: emailReplyTo,
        supportInbox,
        fromSecurity,
        fromTracking,
        fromBilling,
        fromPayments,
        fromNotifications,
        fromSupport,
        secrets: (resendObj.secrets as Record<string, unknown>) || {
          apiKey: { configured: Boolean(process.env.RESEND_API_KEY) },
          inboundWebhookSecret: { configured: Boolean(process.env.RESEND_INBOUND_SECRET) },
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
      routing: {
        primaryGateway: (routingObj.primaryGateway as string) || "bachs",
        fallbackOrder: (routingObj.fallbackOrder as string[]) || ["bachs"],
        offerChoice: Boolean(routingObj.offerChoice),
        enableBachsBooking,
        enablePayOnPickup,
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
      resendInboundSecret:
        dec("resendInboundSecret") || process.env.RESEND_INBOUND_SECRET || "",
      stripeSecretKey: dec("stripeSecretKey"),
      stripeWebhookSecret: dec("stripeWebhookSecret"),
      paystackSecretKey: dec("paystackSecretKey"),
      paystackWebhookSecret: dec("paystackWebhookSecret"),
    },
    environment: env,
    sandboxProductId,
    liveProductId,
    defaultCurrency: String(bachsObj.defaultCurrency || "USD").toUpperCase(),
    checkoutExpiryMinutes: Number(bachsObj.checkoutExpiryMinutes || 60),
    enableBachsBooking,
    enablePayOnPickup,
    emailFrom,
    emailReplyTo,
    supportInbox,
    fromSecurity,
    fromTracking,
    fromBilling,
    fromPayments,
    fromNotifications,
    fromSupport,
  };

  bundleCache = { data: bundle, expiresAt: Date.now() + 180_000 };
  return bundle;
}

// ── Plain-fetch Bachs Client & Webhook HMAC Verification ──
function getBachsBaseUrl(env: "sandbox" | "live"): string {
  return env === "live" ? "https://api.bachs.io" : "https://sandbox-api.bachs.io";
}

async function bachsFetch<T>(
  apiKey: string,
  env: "sandbox" | "live",
  apiPath: string,
  init: { method?: string; body?: Record<string, unknown>; idempotencyKey?: string } = {}
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (init.idempotencyKey) headers["Idempotency-Key"] = init.idempotencyKey;

  const res = await fetch(`${getBachsBaseUrl(env)}${apiPath}`, {
    method: init.method || "GET",
    headers,
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });

  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    if (text) json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // non-json
  }

  if (!res.ok) {
    const detail =
      typeof json.detail === "string"
        ? json.detail
        : json.detail
          ? JSON.stringify(json.detail)
          : String(json.message || (json.error as { message?: string })?.message || `HTTP ${res.status}`);
    console.error("[Bachs Error]", { path: apiPath, status: res.status, error_code: json.error_code, detail });
    throw Object.assign(new Error(detail), { status: res.status >= 400 && res.status < 500 ? 400 : 502 });
  }
  return json as T;
}

async function createBachsCheckoutSession(params: {
  apiKey: string;
  env: "sandbox" | "live";
  productId: string;
  amount: number;
  customerEmail: string;
  customerName?: string;
  returnUrl: string;
  cancelUrl: string;
  reference: string;
  metadata: Record<string, string>;
  expiresInMinutes: number;
  idempotencyKey: string;
}) {
  if (!params.productId) {
    throw Object.assign(
      new Error(`No Bachs ${params.env} product ID configured. Save it in Admin → Settings → Bachs.`),
      { status: 400 }
    );
  }
  const baseBody = {
    product_cart: [
      {
        product_id: params.productId,
        quantity: 1,
        amount: Number(params.amount).toFixed(2),
      },
    ],
    customer: {
      email: params.customerEmail,
      ...(params.customerName ? { name: params.customerName } : {}),
    },
    cancel_url: params.cancelUrl,
    reference: params.reference.slice(0, 128),
    metadata: params.metadata,
    expires_in_minutes: Math.min(1440, Math.max(5, Math.round(params.expiresInMinutes || 60))),
  };

  let created: Record<string, unknown>;
  try {
    created = await bachsFetch(params.apiKey, params.env, "/v1/checkout-sessions", {
      method: "POST",
      body: { ...baseBody, return_url: params.returnUrl },
      idempotencyKey: params.idempotencyKey,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (/return_url/i.test(msg)) {
      created = await bachsFetch(params.apiKey, params.env, "/v1/checkout-sessions", {
        method: "POST",
        body: { ...baseBody, success_url: params.returnUrl },
        idempotencyKey: `${params.idempotencyKey}_s`,
      });
    } else {
      throw err;
    }
  }

  const checkoutId = String(created.checkout_id || created.id || params.reference);
  const checkoutUrl = String(created.checkout_url || created.url || "");
  if (!checkoutUrl) {
    throw new Error("Bachs did not return a checkout URL.");
  }
  return {
    checkoutId,
    checkoutUrl,
    reference: String(created.reference || params.reference),
    expiresAt:
      Date.parse(String(created.expires_at || "")) ||
      Date.now() + (params.expiresInMinutes || 60) * 60000,
  };
}

function headerStr(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string | null {
  const t = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() !== t) continue;
    if (Array.isArray(v)) {
      if (v.length !== 1) return null;
      return String(v[0] || "").trim() || null;
    }
    return typeof v === "string" && v.trim() ? v.trim() : null;
  }
  return null;
}

function extractDigests(sig: string): string[] {
  const out: string[] = [];
  for (const p of sig.split(",")) {
    const s = p.trim();
    const eq = s.indexOf("=");
    const hex = (eq >= 0 ? s.slice(eq + 1) : s).trim().toLowerCase();
    if (/^[a-f0-9]{64}$/.test(hex)) out.push(hex);
  }
  return out;
}

function verifyBachsWebhook(
  rawBody: Buffer | string,
  headers: Record<string, string | string[] | undefined>,
  secrets: string[]
) {
  const ts = headerStr(headers, "x-bachs-timestamp");
  const sig1 = headerStr(headers, "x-bachs-signature");
  const sig2 = headerStr(headers, "x-bachs-signature-v2");
  if (!ts || (!sig1 && !sig2)) {
    throw Object.assign(new Error("Missing webhook signature or timestamp"), { status: 400 });
  }
  const num = Number(ts);
  if (!Number.isFinite(num) || num <= 0) {
    throw Object.assign(new Error("Invalid webhook timestamp"), { status: 400 });
  }
  const tsSec = num > 1e12 ? Math.floor(num / 1000) : Math.floor(num);
  if (Math.abs(Math.floor(Date.now() / 1000) - tsSec) > 300) {
    throw Object.assign(new Error("Webhook timestamp older than 300s"), { status: 400 });
  }
  const rawStr = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody || "");
  const payload = `${ts}.${rawStr}`;
  const digests = [...(sig1 ? extractDigests(sig1) : []), ...(sig2 ? extractDigests(sig2) : [])];
  if (digests.length === 0) {
    throw Object.assign(new Error("Malformed webhook signature"), { status: 400 });
  }
  let ok = false;
  for (const s of secrets) {
    if (!s.trim()) continue;
    const expected = Buffer.from(
      crypto.createHmac("sha256", s.trim()).update(payload, "utf8").digest("hex"),
      "hex"
    );
    for (const d of digests) {
      const provided = Buffer.from(d, "hex");
      if (provided.length === expected.length && crypto.timingSafeEqual(provided, expected)) {
        ok = true;
        break;
      }
    }
    if (ok) break;
  }
  if (!ok) {
    throw Object.assign(new Error("Invalid Bachs webhook signature"), { status: 400 });
  }
  const parsed = JSON.parse(rawStr) as {
    id?: string;
    type?: string;
    data?: Record<string, unknown>;
  };
  return {
    id: String(parsed.id || crypto.createHash("sha256").update(rawStr).digest("hex").slice(0, 24)),
    type: String(parsed.type || ""),
    data: parsed.data || {},
  };
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
  category?: "security" | "tracking" | "billing" | "payments" | "notifications" | "support";
  prefKey?: "onway" | "scan" | "action";
  code?: string | null;
  from?: string;
  replyTo?: string;
  omitReplyTo?: boolean;
  createdBy?: string;
  dedupKey?: string;
}): Promise<{ status: "sent" | "queued_preview" | "failed" | "skipped_prefs"; providerId?: string }> {
  const database = db();
  const cleanTo = params.to.trim().toLowerCase();

  if (params.category !== "security" && params.prefKey) {
    try {
      const uSnap = await database.collection("users").where("email", "==", cleanTo).limit(1).get();
      if (!uSnap.empty) {
        const prefs = uSnap.docs[0].data()?.prefs as Record<string, boolean> | undefined;
        if (prefs && prefs[params.prefKey] === false) {
          return { status: "skipped_prefs" };
        }
      }
    } catch {
      // ignore
    }
  }

  if (params.dedupKey) {
    const dedupRef = database.collection("emailDedup").doc(params.dedupKey);
    const alreadySent = await database.runTransaction(async (tx) => {
      const snap = await tx.get(dedupRef);
      if (snap.exists) return true;
      tx.set(dedupRef, {
        to: cleanTo,
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
  const categoryFromMap = {
    security: settings.fromSecurity,
    tracking: settings.fromTracking,
    billing: settings.fromBilling,
    payments: settings.fromPayments,
    notifications: settings.fromNotifications,
    support: settings.fromSupport,
  };
  const effectiveFrom =
    params.from || (params.category ? categoryFromMap[params.category] : settings.emailFrom);
  const effectiveReplyTo =
    params.omitReplyTo || params.category === "security"
      ? undefined
      : params.replyTo || settings.supportInbox || settings.emailReplyTo;
  let status: "sent" | "queued_preview" | "failed" = "queued_preview";
  let providerId = `preview_${Date.now().toString(36)}`;

  if (settings.sec.resendApiKey) {
    try {
      const bodyPayload: Record<string, unknown> = {
        from: effectiveFrom,
        to: [cleanTo],
        subject: params.subject,
        html: params.html,
        text: params.text,
      };
      if (effectiveReplyTo) bodyPayload.reply_to = effectiveReplyTo;
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${settings.sec.resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(bodyPayload),
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
      to: cleanTo.slice(0, 160),
      from: effectiveFrom.slice(0, 160),
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
  await database
    .collection("mail")
    .add({
      to: cleanTo.slice(0, 160),
      from: effectiveFrom.slice(0, 160),
      template: params.template,
      subject: params.subject.slice(0, 240),
      status,
      createdAt: FieldValue.serverTimestamp(),
    })
    .catch(() => null);

  return { status, providerId };
}

function getBaseUrl(_req: express.Request): string {
  return (process.env.APP_URL || DEFAULT_APP_URL).replace(/\/+$/, "");
}

async function sendBookingEmails(
  database: FirebaseFirestore.Firestore,
  baseUrl: string,
  shipment: Record<string, unknown>,
  actorUid: string
) {
  const code = String(shipment.code || "");
  const receiverEmail = String(shipment.receiverEmail || "").trim().toLowerCase();
  const senderEmail = String(shipment.senderEmail || "").trim().toLowerCase();
  const senderObj = (shipment.sender || {}) as Record<string, string>;
  const receiverObj = (shipment.receiver || {}) as Record<string, string>;
  const senderName = senderObj.name || "A ShipWell sender";
  const receiverName = receiverObj.name || "there";

  if (receiverEmail.includes("@")) {
    let hasAccount = false;
    try {
      const h = crypto.createHash("sha256").update(receiverEmail).digest("hex");
      const snap = await database.collection("accountStatus").doc(h).get();
      if (snap.exists) hasAccount = true;
    } catch {
      // ignore
    }
    if (!hasAccount) {
      try {
        await getAuth().getUserByEmail(receiverEmail);
        hasAccount = true;
      } catch {
        hasAccount = false;
      }
    }

    const tokenPayload = Buffer.from(
      JSON.stringify({ code, receiverEmail, exp: Date.now() + 14 * 86400000 })
    ).toString("base64url");
    const sig = crypto
      .createHmac("sha256", process.env.SETTINGS_ENCRYPTION_KEY || "shipwell-invite")
      .update(tokenPayload)
      .digest("base64url");
    const token = `${tokenPayload}.${sig}`;
    const inviteUrl = `${baseUrl}/track/${encodeURIComponent(code)}?invite=${encodeURIComponent(token)}`;

    await sendResendEmail({
      to: receiverEmail,
      subject: hasAccount
        ? `A parcel from ${senderName.split(" ")[0]} is on its way to you`
        : `${senderName.split(" ")[0]} is sending you a parcel — track it on ShipWell`,
      html: renderSimpleMailHtml({
        baseUrl,
        heading: "A parcel is on its way to you",
        bodyHtml: `<p>Hello ${escapeHtml(receiverName.split(" ")[0])}. <strong>${escapeHtml(senderName)}</strong> has shipped <strong>${escapeHtml(String(shipment.contents || "a parcel"))}</strong> to you (${escapeHtml(code)}).</p><p>Use <strong>${escapeHtml(receiverEmail)}</strong> and your parcel finds you.</p>`,
        ctaLabel: hasAccount ? "Track my parcel" : "Create my account",
        ctaUrl: hasAccount ? `${baseUrl}/track/${code}` : inviteUrl,
        footer: "Questions? Email support@mail.shipwell.cc · ShipWell Logistics Ltd.",
      }),
      text: `A parcel is on its way to you (${code}). Open ${hasAccount ? `${baseUrl}/track/${code}` : inviteUrl}`,
      template: hasAccount ? "on_its_way" : "invite",
      code,
      createdBy: actorUid,
      dedupKey: `booking_rx_${code}`,
    });
  }

  if (senderEmail.includes("@")) {
    await sendResendEmail({
      to: senderEmail,
      subject: `Booking confirmed — ${code} is on ShipWell`,
      html: renderSimpleMailHtml({
        baseUrl,
        heading: "Your shipment is booked",
        bodyHtml: `<p>Tracking code: <strong>${escapeHtml(code)}</strong></p><p>We emailed ${escapeHtml(receiverEmail)} so they can follow it too.</p>`,
        ctaLabel: "View shipment",
        ctaUrl: `${baseUrl}/track/${code}`,
        footer: "Need help? support@mail.shipwell.cc · ShipWell Logistics Ltd.",
      }),
      text: `Booking confirmed ${code}`,
      template: "sender_booking",
      code,
      createdBy: actorUid,
      dedupKey: `booking_tx_${code}`,
    });
  }
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

      let event;
      try {
        event = verifyBachsWebhook(rawBody, req.headers, secrets);
      } catch (err) {
        await database.collection("webhookLogs").add({
          provider: "bachs",
          eventType: "signature_error",
          reference: "",
          result: "rejected-signature",
          detail: err instanceof Error ? err.message : "Invalid signature",
          environment: settings.environment,
          ts: Date.now(),
        });
        res.status(400).json({ error: "Invalid Bachs webhook signature" });
        return;
      }

      const dataObj = event.data || {};
      const meta =
        dataObj.metadata && typeof dataObj.metadata === "object"
          ? (dataObj.metadata as Record<string, unknown>)
          : {};
      const code = String(meta.trackingCode || meta.shipment || "").trim().toUpperCase();
      const alertId = String(meta.alertId || "").trim();
      const checkoutId = String(dataObj.checkout_id || dataObj.id || "").trim();
      const paymentId = String(dataObj.payment_id || dataObj.charge_id || checkoutId).trim();
      const reference = String(dataObj.reference || meta.reference || checkoutId).trim();
      const bookingId = String(
        meta.bookingId || (reference.startsWith("booking_") ? reference.slice(8) : "")
      ).trim();

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
        res.status(200).json({ received: true, ok: true, eventId: event.id });
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
          bookingId: bookingId || null,
          processedAt: FieldValue.serverTimestamp(),
        });
        return false;
      });

      if (duplicate) {
        await database.collection("webhookLogs").add({
          provider: "bachs",
          eventType: event.type,
          reference: reference || code || bookingId,
          result: "duplicate",
          detail: "Duplicate event ignored",
          environment: settings.environment,
          ts: Date.now(),
        });
        res.status(200).json({ received: true, duplicate: true });
        return;
      }

      const t = event.type.toLowerCase();

      // 1. Booking payment webhook
      if (meta.kind === "booking" || bookingId) {
        const bookingRef = database.collection("bookings").doc(bookingId);
        const bookingSnap = await bookingRef.get();
        if (!bookingSnap.exists) {
          res.status(200).json({ received: true, ignored: true });
          return;
        }
        const booking = bookingSnap.data() as Record<string, unknown>;
        const shipCode = String(booking.code || code);
        const shipRef = database.collection("shipments").doc(shipCode);
        const shipSnap = await shipRef.get();
        const shipment = shipSnap.exists ? (shipSnap.data() as Record<string, unknown>) : null;

        if (t === "collection.succeeded" || t === "payment.succeeded" || t === "checkout.session.completed") {
          const env = (booking.environment as "sandbox" | "live") || settings.environment;
          const apiKey = env === "live" ? settings.sec.bachsLiveKey : settings.sec.bachsSandboxKey;
          let verifiedAmount = Number(dataObj.amount || booking.total || 0);
          let verifiedCurrency = String(dataObj.currency || booking.currency || "USD").toUpperCase();
          if (apiKey && checkoutId) {
            const sess = await bachsFetch<Record<string, unknown>>(
              apiKey,
              env,
              `/v1/checkout-sessions/${encodeURIComponent(checkoutId)}`
            );
            if (sess.amount != null) verifiedAmount = Number(sess.amount);
            else if (sess.amount_total != null) verifiedAmount = Number(sess.amount_total);
            if (sess.currency) verifiedCurrency = String(sess.currency).toUpperCase();
          }
          if (
            Math.abs(verifiedAmount - Number(booking.total || 0)) > 0.05 ||
            verifiedCurrency !== String(booking.currency || "USD").toUpperCase()
          ) {
            await bookingRef.update({ paymentStatus: "failed", lastError: "Amount mismatch" });
            res.status(200).json({ received: true, mismatch: true });
            return;
          }
          const now = Date.now();
          await bookingRef.update({
            paymentStatus: "paid",
            bookingStatus: "confirmed",
            paymentId,
            paymentReference: reference,
            paidAt: now,
            updatedAt: FieldValue.serverTimestamp(),
          });
          if (shipSnap.exists) {
            await shipRef.update({
              paymentStatus: "paid",
              bookingStatus: "confirmed",
              paymentId,
              paymentReference: reference,
              "nextStop.label": "Awaiting item review & pickup dispatch",
              updatedAt: FieldValue.serverTimestamp(),
            });
            await database.collection("trackingTeasers").doc(shipCode).update({
              latestEvent: { label: "Booking confirmed", loc: "Origin Hub", ts: now },
              updatedAt: FieldValue.serverTimestamp(),
            });
            await shipRef.collection("events").add({
              stage: "Booked",
              label: "Booking confirmed",
              loc: "Origin Hub",
              note: `Payment confirmed ($${verifiedAmount.toFixed(2)} via Bachs · ${paymentId}).`,
              kind: "info",
              ts: now,
              createdBy: "Bachs webhook",
              createdAt: FieldValue.serverTimestamp(),
            });
          }
          if (shipment) {
            await sendBookingEmails(database, getBaseUrl(req), shipment, String(booking.uid || "webhook"));
          }
        } else if (t === "collection.failed" || t === "checkout.expired" || t === "checkout.session.expired" || t === "collection.abandoned") {
          const isExp = t.includes("expired");
          await bookingRef.update({
            paymentStatus: isExp ? "expired" : "failed",
            bookingStatus: isExp ? "expired" : "awaiting_payment",
            lastError: t,
          });
          if (shipSnap.exists) {
            await shipRef.update({
              paymentStatus: isExp ? "expired" : "failed",
              bookingStatus: isExp ? "expired" : "awaiting_payment",
            });
          }
        } else if (t === "refund.succeeded" || t === "refund.paid" || t === "collection.refunded") {
          await bookingRef.update({
            paymentStatus: "refunded",
            bookingStatus: "cancelled",
            refundedAt: Date.now(),
          });
          if (shipSnap.exists) {
            await shipRef.update({ paymentStatus: "refunded", bookingStatus: "cancelled" });
          }
        }
        res.status(200).json({ received: true });
        return;
      }

      // 2. Customs charge webhook
      if (!CODE_RE.test(code) || !alertId) {
        res.status(200).json({ received: true, ignored: true });
        return;
      }

      const shipRef = database.collection("shipments").doc(code);
      const alertRef = shipRef.collection("alerts").doc(alertId);
      const [shipSnap, alertSnap] = await Promise.all([shipRef.get(), alertRef.get()]);
      if (!shipSnap.exists || !alertSnap.exists) {
        res.status(200).json({ received: true, ignored: true });
        return;
      }

      const shipment = shipSnap.data() as Record<string, unknown>;
      const alert = alertSnap.data() as Record<string, unknown>;

      if (t === "collection.succeeded" || t === "payment.succeeded" || t === "checkout.session.completed") {
        const env =
          ((alert.payment as Record<string, unknown>)?.environment as "sandbox" | "live") ||
          settings.environment;
        const apiKey = env === "live" ? settings.sec.bachsLiveKey : settings.sec.bachsSandboxKey;
        let verifiedAmount = Number(dataObj.amount || alert.amount || 0);
        let verifiedCurrency = String(dataObj.currency || alert.currency || "USD").toUpperCase();
        if (apiKey && checkoutId) {
          const sess = await bachsFetch<Record<string, unknown>>(
            apiKey,
            env,
            `/v1/checkout-sessions/${encodeURIComponent(checkoutId)}`
          );
          if (sess.amount != null) verifiedAmount = Number(sess.amount);
          else if (sess.amount_total != null) verifiedAmount = Number(sess.amount_total);
          if (sess.currency) verifiedCurrency = String(sess.currency).toUpperCase();
        }

        const expectedAmount = Number(alert.amount || 0);
        if (Math.abs(verifiedAmount - expectedAmount) > 0.05) {
          await alertRef.update({
            "payment.status": "underpaid",
            "payment.lastError": `Amount mismatch: ${verifiedCurrency} ${verifiedAmount}`,
          });
          res.status(200).json({ received: true, mismatch: true });
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
      } else if (t === "collection.failed" || t === "checkout.expired" || t === "checkout.session.expired" || t === "collection.abandoned") {
        await alertRef.update({
          "payment.status": "failed",
          "payment.lastError": t,
        });
      } else if (t === "collection.underpaid") {
        await alertRef.update({
          "payment.status": "underpaid",
          "payment.lastError": "Underpaid — remaining balance due",
        });
      } else if (t === "refund.succeeded" || t === "refund.paid" || t === "collection.refunded") {
        await alertRef.update({
          "payment.status": "refunded",
          "payment.refundedAt": Date.now(),
        });
      }

      res.status(200).json({ received: true });
    } catch (err) {
      const status =
        err && typeof err === "object" && "status" in err && typeof (err as { status: number }).status === "number"
          ? (err as { status: number }).status
          : 500;
      res.status(status >= 400 && status < 600 ? status : 500).json({
        error: err instanceof Error ? err.message : "Webhook error",
      });
    }
  }
);

app.use(
  express.json({
    limit: "2mb",
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
    },
  })
);

app.get("/api/checkout/options", async (_req, res) => {
  try {
    const settings = await loadSettings();
    const apiKey =
      settings.environment === "live" ? settings.sec.bachsLiveKey : settings.sec.bachsSandboxKey;
    const productId =
      settings.environment === "live" ? settings.liveProductId : settings.sandboxProductId;
    res.json({
      ok: true,
      bachsEnabled: settings.enableBachsBooking,
      bachsConfigured: Boolean(apiKey && productId),
      bachsProductConfigured: Boolean(productId),
      payOnPickupEnabled: settings.enablePayOnPickup,
      environment: settings.environment,
      currency: settings.defaultCurrency,
    });
  } catch {
    res.json({
      ok: true,
      bachsEnabled: true,
      bachsConfigured: false,
      bachsProductConfigured: false,
      payOnPickupEnabled: true,
      environment: "sandbox",
      currency: "USD",
    });
  }
});

app.post("/api/bookings", async (req, res) => {
  try {
    const actor = await verifyActor(req);
    if (!actor) {
      res.status(401).json({ error: "Please log in or sign up before booking a parcel." });
      return;
    }
    const database = db();
    const b = (req.body || {}) as Record<string, unknown>;
    const rawIdem = String(b.idempotencyKey || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
    const bookingId = rawIdem.length >= 8 ? rawIdem : `bk_${crypto.randomBytes(8).toString("hex")}`;
    const bookingRef = database.collection("bookings").doc(bookingId);
    const existing = await bookingRef.get();
    if (existing.exists) {
      const ex = existing.data() as Record<string, unknown>;
      const exShipSnap = ex.code
        ? await database.collection("shipments").doc(String(ex.code)).get().catch(() => null)
        : null;
      const isPayLater = ex.paymentStatus === "pay_on_pickup";
      res.json({
        ok: true,
        awaitingPayment: !isPayLater && ex.paymentStatus === "awaiting_payment",
        code: ex.code,
        trackingCode: ex.code,
        bookingId: ex.id,
        total: ex.total,
        totalUsd: ex.total,
        currency: ex.currency,
        paymentMethod: ex.paymentMethod,
        paymentChannel: ex.paymentChannel,
        paymentStatus: ex.paymentStatus,
        checkoutUrl: ex.checkoutUrl || null,
        checkoutId: ex.checkoutId || null,
        ...(isPayLater && exShipSnap?.exists ? { shipment: exShipSnap.data() } : {}),
      });
      return;
    }

    const sIn = (b.sender && typeof b.sender === "object" ? b.sender : {}) as Record<string, unknown>;
    const rIn = (b.receiver && typeof b.receiver === "object" ? b.receiver : {}) as Record<string, unknown>;

    const senderName = String(sIn.name ?? b.senderName ?? "").trim();
    const senderEmail = String(sIn.email ?? b.senderEmail ?? actor.email).trim().toLowerCase();
    const senderPhoneRaw = String(sIn.phone ?? b.senderPhone ?? "").trim();
    const senderAddress = String(sIn.address ?? b.senderAddress ?? "").trim();
    const senderCity = String(sIn.city ?? b.senderCity ?? "").trim();
    const senderPostal = String(sIn.postal ?? b.senderPostal ?? "").trim();
    const senderCountry = String(sIn.country ?? b.senderCountry ?? "").trim();

    const receiverName = String(rIn.name ?? b.receiverName ?? "").trim();
    const receiverEmail = String(rIn.email ?? b.receiverEmail ?? "").trim().toLowerCase();
    const receiverPhoneRaw = String(rIn.phone ?? b.receiverPhone ?? "").trim();
    const receiverAddress = String(rIn.address ?? b.receiverAddress ?? "").trim();
    const receiverCity = String(rIn.city ?? b.receiverCity ?? "").trim();
    const receiverPostal = String(rIn.postal ?? b.receiverPostal ?? "").trim();
    const receiverCountry = String(rIn.country ?? b.receiverCountry ?? "").trim();

    if (!senderName || !senderEmail.includes("@") || !senderAddress || !senderCity || !PLACES[senderCountry]) {
      res.status(400).json({ error: "Please complete all required sender details." });
      return;
    }
    if (!receiverName || !receiverEmail.includes("@") || !receiverAddress || !receiverCity || !PLACES[receiverCountry]) {
      res.status(400).json({ error: "Please complete all required receiver details." });
      return;
    }

    const pSender = parsePhoneNumberFromString(senderPhoneRaw);
    const pReceiver = parsePhoneNumberFromString(receiverPhoneRaw);
    if (!pSender?.isValid() || !pReceiver?.isValid()) {
      res.status(400).json({ error: "Enter valid international phone numbers." });
      return;
    }

    const actualKg = Number(b.weightKg);
    const volKg =
      ((Number(b.lengthCm) || 0) * (Number(b.widthCm) || 0) * (Number(b.heightCm) || 0)) / 5000;
    const weightKg = Math.max(actualKg || 0, volKg || 0);
    const declaredValue = Math.max(0, Number(b.declaredValue) || 0);
    const service =
      b.service === "economy" || b.service === "express" ? b.service : ("standard" as const);
    const photos = Array.isArray(b.photos)
      ? b.photos
          .filter(
            (u): u is string =>
              typeof u === "string" &&
              ((/^https?:\/\//i.test(u) && u.length <= 2048) ||
                (/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(u) && u.length <= 345000))
          )
          .slice(0, 4)
      : [];
    if (!actualKg || actualKg < 0.1 || weightKg > 50000 || photos.length === 0) {
      res.status(400).json({ error: "Valid weight and at least 1 photo required." });
      return;
    }

    const settings = await loadSettings();
    const rawMethod = String(b.paymentMethod || b.paymentChannel || "").trim().toLowerCase();
    const isPayOnDelivery =
      rawMethod.includes("delivery") ||
      rawMethod.includes("pickup") ||
      rawMethod.includes("later");
    const channel = isPayOnDelivery ? "pay_on_pickup" : "pay_now";

    if (!isPayOnDelivery && !settings.enableBachsBooking) {
      res.status(400).json({ error: "Online checkout is currently disabled." });
      return;
    }
    if (isPayOnDelivery && !settings.enablePayOnPickup) {
      res.status(400).json({ error: "Pay on delivery is currently disabled." });
      return;
    }

    const quote = calcServerQuote(senderCountry, receiverCountry, weightKg, declaredValue, service);
    let code = generateTrackingCode();
    const candidateCode = String(b.code || "").trim().toUpperCase();
    if (CODE_RE.test(candidateCode)) {
      const existShip = await database.collection("shipments").doc(candidateCode).get().catch(() => null);
      if (existShip && !existShip.exists) {
        code = candidateCode;
      }
    }

    const now = Date.now();
    const eta = addBusinessDays(now, quote.days[1]);
    const baseUrl = getBaseUrl(req);
    const reference = `booking_${bookingId}`;

    let checkoutId: string | null = null;
    let checkoutUrl: string | null = null;
    let checkoutExpiresAt: number | null = null;

    if (!isPayOnDelivery) {
      const apiKey =
        settings.environment === "live"
          ? settings.sec.bachsLiveKey
          : settings.sec.bachsSandboxKey;
      const productId =
        settings.environment === "live" ? settings.liveProductId : settings.sandboxProductId;
      if (!apiKey || !productId) {
        res.status(400).json({
          error: actor.isAdmin
            ? `Bachs is not configured: save your ${settings.environment} secret key and custom-amount product ID in Admin → Settings → Bachs.`
            : "Online checkout is temporarily unavailable (Bachs is not configured). Please choose Pay on delivery.",
        });
        return;
      }
      const cancelPath = b.embedded ? "/dashboard/ship?cancelled=1" : "/ship?cancelled=1";
      const session = await createBachsCheckoutSession({
        apiKey,
        env: settings.environment,
        productId,
        amount: quote.total,
        customerEmail: senderEmail,
        customerName: senderName || "Customer",
        returnUrl: `${baseUrl}/dashboard/track/${encodeURIComponent(code)}?paid=1&booking=1`,
        cancelUrl: `${baseUrl}${cancelPath}`,
        reference,
        metadata: { kind: "booking", bookingId, trackingCode: code, uid: actor.uid, channel },
        expiresInMinutes: settings.checkoutExpiryMinutes || 60,
        idempotencyKey: `bk_${bookingId}`,
      });
      checkoutId = session.checkoutId;
      checkoutUrl = session.checkoutUrl;
      checkoutExpiresAt = session.expiresAt;
    }

    const shipDoc = {
      code,
      senderId: actor.uid,
      senderEmail,
      receiverEmail,
      sender: {
        name: senderName,
        email: senderEmail,
        phone: pSender.formatInternational(),
        address: senderAddress,
        city: senderCity,
        postal: senderPostal,
        country: senderCountry,
      },
      receiver: {
        name: receiverName,
        email: receiverEmail,
        phone: pReceiver.formatInternational(),
        address: receiverAddress,
        city: receiverCity,
        postal: receiverPostal,
        country: receiverCountry,
      },
      service,
      weightKg,
      packageType: String(b.packageType || "Parcel"),
      contents: String(b.contents || "").trim().slice(0, 240),
      declaredValue,
      priceTotal: quote.total,
      paymentMethod: isPayOnDelivery ? "Booked, payment due at pickup" : "Pay now (Bachs)",
      bookingId,
      paymentStatus: isPayOnDelivery ? "pay_on_pickup" : "awaiting_payment",
      paymentReference: reference,
      checkoutExpiresAt,
      bookingStatus: isPayOnDelivery ? "confirmed" : "awaiting_payment",
      status: "Booked",
      eta,
      photos,
      hold: null,
      nextStop: {
        label: isPayOnDelivery ? "Booked, payment due at pickup" : "Awaiting booking payment confirmation",
        loc: `${senderCity || "Origin"} Origin`,
        eta: now + 86400000,
      },
      review: { state: "pending", note: "" },
    };

    const eventLabel = isPayOnDelivery
      ? "Booked, payment due at pickup"
      : "Booking started — awaiting payment";

    const batch = database.batch();
    batch.set(bookingRef, {
      id: bookingId,
      code,
      uid: actor.uid,
      senderEmail,
      receiverEmail,
      service,
      weightKg,
      declaredValue,
      total: quote.total,
      currency: settings.defaultCurrency,
      paymentMethod: isPayOnDelivery ? "Pay on delivery" : "Pay now",
      paymentChannel: channel,
      paymentStatus: isPayOnDelivery ? "pay_on_pickup" : "awaiting_payment",
      bookingStatus: isPayOnDelivery ? "confirmed" : "awaiting_payment",
      environment: settings.environment,
      checkoutId,
      checkoutUrl,
      paymentReference: reference,
      checkoutExpiresAt,
      createdAtMs: now,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    batch.set(database.collection("shipments").doc(code), {
      ...shipDoc,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    batch.set(database.collection("trackingTeasers").doc(code), {
      code,
      senderId: actor.uid,
      status: "Booked",
      holdType: null,
      originCity: senderCity,
      originCountry: senderCountry,
      destinationCity: receiverCity,
      destinationCountry: receiverCountry,
      service,
      weightKg,
      contents: String(b.contents || "").trim().slice(0, 240),
      eta,
      latestEvent: {
        label: eventLabel,
        loc: `${senderCity}, ${senderCountry}`,
        ts: now,
      },
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    batch.set(database.collection("shipments").doc(code).collection("events").doc(), {
      stage: "Booked",
      label: eventLabel,
      loc: `${senderCity}, ${senderCountry}`,
      note: isPayOnDelivery
        ? `Parcel ${code} booked with payment due at pickup ($${quote.total.toFixed(2)}).`
        : `Booking checkout created for $${quote.total.toFixed(2)} via Bachs.`,
      kind: "info",
      ts: now,
      createdBy: senderName || actor.email,
      createdAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();

    if (isPayOnDelivery) {
      await sendBookingEmails(database, baseUrl, shipDoc, actor.uid).catch(() => null);
    }

    res.json({
      ok: true,
      awaitingPayment: !isPayOnDelivery,
      code,
      trackingCode: code,
      bookingId,
      total: quote.total,
      totalUsd: quote.total,
      currency: settings.defaultCurrency,
      paymentMethod: isPayOnDelivery ? "Pay on delivery" : "Pay now",
      paymentChannel: channel,
      paymentStatus: isPayOnDelivery ? "pay_on_pickup" : "awaiting_payment",
      checkoutUrl,
      checkoutId,
      ...(isPayOnDelivery ? { shipment: shipDoc } : {}),
    });
  } catch (err) {
    const status =
      err && typeof err === "object" && "status" in err && typeof (err as { status: number }).status === "number"
        ? (err as { status: number }).status
        : 500;
    res.status(status).json({ error: err instanceof Error ? err.message : "Booking failed." });
  }
});

app.post("/api/admin/booking-action", async (req, res) => {
  try {
    const actor = await verifyActor(req);
    if (!actor?.isAdmin) {
      res.status(actor ? 403 : 401).json({ error: "Admin required." });
      return;
    }
    const body = (req.body || {}) as { code?: string; action?: string; reason?: string };
    const code = String(body.code || "").trim().toUpperCase();
    const database = db();
    const shipRef = database.collection("shipments").doc(code);
    const shipSnap = await shipRef.get();
    if (!shipSnap.exists) {
      res.status(404).json({ error: "Shipment not found." });
      return;
    }
    const shipment = shipSnap.data() as Record<string, unknown>;
    if (body.action === "mark_pickup_paid") {
      await shipRef.update({ paymentStatus: "paid", bookingStatus: "confirmed", updatedAt: FieldValue.serverTimestamp() });
      if (shipment.bookingId) {
        await database.collection("bookings").doc(String(shipment.bookingId)).update({
          paymentStatus: "paid",
          bookingStatus: "confirmed",
          paidAt: Date.now(),
        }).catch(() => null);
      }
      res.json({ ok: true, status: "paid" });
      return;
    }
    if (Math.floor(Date.now() / 1000) - actor.authTime > 900) {
      res.status(403).json({ error: "Recent password confirmation required.", code: "RECENT_AUTH_REQUIRED" });
      return;
    }
    const settings = await loadSettings();
    let refundId = `ref_${Date.now().toString(36)}`;
    if (shipment.paymentId) {
      const apiKey = settings.environment === "live" ? settings.sec.bachsLiveKey : settings.sec.bachsSandboxKey;
      const rJson = await bachsFetch<Record<string, string>>(apiKey, settings.environment, "/v1/refunds", {
        method: "POST",
        body: {
          payment_id: String(shipment.paymentId),
          amount: Number(shipment.priceTotal || 0).toFixed(2),
          reason: body.reason || `Booking refund ${code}`,
        },
        idempotencyKey: `ref_bk_${code}_${Date.now()}`,
      });
      refundId = rJson.refund_id || rJson.id || refundId;
    }
    await shipRef.update({ paymentStatus: "refunded", bookingStatus: "cancelled", updatedAt: FieldValue.serverTimestamp() });
    if (shipment.bookingId) {
      await database.collection("bookings").doc(String(shipment.bookingId)).update({
        paymentStatus: "refunded",
        bookingStatus: "cancelled",
        refundId,
        refundedAt: Date.now(),
      }).catch(() => null);
    }
    res.json({ ok: true, status: "refunded", refundId });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Booking action failed." });
  }
});

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
    const productId = env === "live" ? settings.liveProductId : settings.sandboxProductId;
    if (!apiKey) {
      res.status(400).json({ error: `Bachs ${env} secret key not configured.` });
      return;
    }

    const amount = Number(alert.amount || 0);
    const currency = String(alert.currency || settings.defaultCurrency || "USD").toUpperCase();
    const baseUrl = getBaseUrl(req);
    const reference = `chg_${cleanCode}_${alertId}`.slice(0, 128);

    const created = await createBachsCheckoutSession({
      apiKey,
      env,
      productId,
      amount,
      customerEmail: actor.email,
      customerName: actor.email.split("@")[0] || "Customer",
      returnUrl: `${baseUrl}/dashboard/track/${encodeURIComponent(cleanCode)}?paid=1&alertId=${encodeURIComponent(alertId)}`,
      cancelUrl: `${baseUrl}/dashboard/track/${encodeURIComponent(cleanCode)}?cancelled=1`,
      reference,
      metadata: { kind: "customs", trackingCode: cleanCode, alertId, uid: actor.uid },
      expiresInMinutes: settings.checkoutExpiryMinutes || 60,
      idempotencyKey: `cust_${cleanCode}_${alertId}_${Date.now()}`,
    });

    await alertSnap.ref.update({
      payment: {
        provider: "bachs",
        environment: env,
        checkoutId: created.checkoutId,
        checkoutUrl: created.checkoutUrl,
        reference: created.reference,
        status: "pending",
        currency,
        expiresAt: created.expiresAt,
      },
    });

    res.json({
      checkoutUrl: created.checkoutUrl,
      checkoutId: created.checkoutId,
      reference: created.reference,
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
      if (typeof patch.bachs.sandboxProductId === "string") nextPub.bachs.sandboxProductId = patch.bachs.sandboxProductId.trim();
      if (typeof patch.bachs.liveProductId === "string") nextPub.bachs.liveProductId = patch.bachs.liveProductId.trim();
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
      if (typeof patch.resend.fromSecurity === "string") nextPub.resend.fromSecurity = patch.resend.fromSecurity;
      if (typeof patch.resend.fromTracking === "string") nextPub.resend.fromTracking = patch.resend.fromTracking;
      if (typeof patch.resend.fromBilling === "string") nextPub.resend.fromBilling = patch.resend.fromBilling;
      if (typeof patch.resend.fromPayments === "string") nextPub.resend.fromPayments = patch.resend.fromPayments;
      if (typeof patch.resend.fromNotifications === "string") {
        nextPub.resend.fromNotifications = patch.resend.fromNotifications;
        nextPub.resend.from = patch.resend.fromNotifications;
      }
      if (typeof patch.resend.fromSupport === "string") nextPub.resend.fromSupport = patch.resend.fromSupport;
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
  const productId =
    settings.environment === "live" ? settings.liveProductId : settings.sandboxProductId;
  try {
    if (productId) {
      const prod = await bachsFetch<Record<string, unknown>>(
        apiKey,
        settings.environment,
        `/v1/products/${encodeURIComponent(productId)}`
      );
      res.json({
        ok: true,
        environment: settings.environment,
        accountId: String(prod.product_id || prod.id || productId),
        productReady: prod.custom_amount_enabled !== false,
      });
      return;
    }
    await bachsFetch(apiKey, settings.environment, "/v1/products?limit=1");
    res.json({
      ok: true,
      environment: settings.environment,
      accountId: "API connected",
      productReady: false,
    });
  } catch (err) {
    res.json({
      ok: false,
      environment: settings.environment,
      error: err instanceof Error ? err.message : "Connection failed",
    });
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
    const productId =
      settings.environment === "live" ? settings.liveProductId : settings.sandboxProductId;
    if (!apiKey) {
      res.status(400).json({ error: `No Bachs ${settings.environment} key configured.` });
      return;
    }
    const baseUrl = getBaseUrl(req);
    const created = await createBachsCheckoutSession({
      apiKey,
      env: settings.environment,
      productId,
      amount: 1.0,
      customerEmail: actor.email || ADMIN_EMAIL,
      customerName: "ShipWell Admin Test",
      returnUrl: `${baseUrl}/admin/settings?test_paid=1`,
      cancelUrl: `${baseUrl}/admin/settings?test_cancelled=1`,
      reference: `SW-TEST-${Date.now().toString(36).toUpperCase()}`,
      metadata: { is_test: "true", actorUid: actor.uid },
      expiresInMinutes: 15,
      idempotencyKey: `admin_test_${Date.now()}`,
    });
    res.json({
      checkoutId: created.checkoutId,
      checkoutUrl: created.checkoutUrl,
      environment: settings.environment,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Test checkout failed." });
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
    subject: "ShipWell Email Delivery Test (mail.shipwell.cc)",
    html: renderSimpleMailHtml({
      baseUrl: getBaseUrl(req),
      heading: "ShipWell Email Test",
      bodyHtml:
        "<p>Your Resend configuration on <strong>mail.shipwell.cc</strong> is operational.</p>",
      ctaLabel: "Open ShipWell",
      ctaUrl: getBaseUrl(req),
      footer: `Triggered by ${actor.email} · Support: support@mail.shipwell.cc`,
    }),
    text: "Your Resend configuration on mail.shipwell.cc is operational.",
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
    const body = (req.body || {}) as {
      threadId?: string;
      message?: string;
      status?: "open" | "closed";
    };
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
      const settings = await loadSettings();
      const supportAddr = settings.supportInbox || DEFAULT_SUPPORT_INBOX;
      await sendResendEmail({
        to: String(thread.userEmail),
        subject: `Re: ${String(thread.subject)} [${String(thread.ticketCode)}]`,
        html: renderSimpleMailHtml({
          baseUrl: getBaseUrl(req),
          heading: `Support reply (${String(thread.ticketCode)})`,
          bodyHtml: `<p>${escapeHtml(message)}</p>`,
          ctaLabel: "Open Dashboard Inbox",
          ctaUrl: `${getBaseUrl(req)}/dashboard/support/${threadId}`,
          footer: `Reply directly to ${supportAddr} · ${String(thread.ticketCode)}`,
        }),
        text: message,
        template: "support_reply",
        code: (thread.code as string) || null,
        from: `ShipWell Support <${supportAddr}>`,
        replyTo: supportAddr,
      });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed" });
  }
});

async function handleInboundEmailRequest(req: express.Request, res: express.Response) {
  try {
    const settings = await loadSettings();
    const database = db();
    const rawBuf = (req as express.Request & { rawBody?: Buffer }).rawBody;
    const rawStr = rawBuf ? rawBuf.toString("utf8") : JSON.stringify(req.body || {});
    const svixId = headerStr(req.headers, "svix-id") || "";
    const svixTs = headerStr(req.headers, "svix-timestamp") || "";
    const svixSig = headerStr(req.headers, "svix-signature") || "";

    const inboundSecret = settings.sec.resendInboundSecret || "";
    if (inboundSecret) {
      let verified = false;
      if (svixId && svixTs && svixSig) {
        const tsNum = Number(svixTs);
        const nowSec = Math.floor(Date.now() / 1000);
        if (Number.isFinite(tsNum) && Math.abs(nowSec - tsNum) <= 300) {
          const keyBytes = inboundSecret.startsWith("whsec_")
            ? Buffer.from(inboundSecret.slice(6), "base64")
            : Buffer.from(inboundSecret, "utf8");
          const expectedB64 = crypto
            .createHmac("sha256", keyBytes)
            .update(`${svixId}.${svixTs}.${rawStr}`, "utf8")
            .digest("base64");
          const expectedBuf = Buffer.from(expectedB64, "utf8");
          for (const part of svixSig.split(/\s+/)) {
            const idx = part.indexOf(",");
            const sigVal = idx >= 0 ? part.slice(idx + 1).trim() : part.trim();
            const sigBuf = Buffer.from(sigVal, "utf8");
            if (sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf)) {
              verified = true;
              break;
            }
          }
        }
      } else if (req.headers["x-resend-signature"]) {
        const provided = String(req.headers["x-resend-signature"]).trim().toLowerCase();
        const expected = crypto
          .createHmac("sha256", inboundSecret)
          .update(rawStr, "utf8")
          .digest("hex")
          .toLowerCase();
        const pBuf = Buffer.from(provided, "utf8");
        const eBuf = Buffer.from(expected, "utf8");
        if (pBuf.length === eBuf.length && crypto.timingSafeEqual(pBuf, eBuf)) {
          verified = true;
        }
      }

      if (!verified) {
        await database
          .collection("webhookLogs")
          .add({
            provider: "resend-inbound",
            eventType: "signature_error",
            reference: svixId,
            result: "rejected-signature",
            detail: "Invalid or missing Svix/Resend inbound signature",
            ts: Date.now(),
          })
          .catch(() => null);
        res.status(401).json({ error: "Inbound webhook signature verification failed." });
        return;
      }
    }

    const payload = (typeof req.body === "object" && req.body && !Buffer.isBuffer(req.body)
      ? req.body
      : JSON.parse(rawStr || "{}")) as Record<string, unknown>;
    const inner = (payload.data as Record<string, unknown>) || payload;

    const eventKey = String(
      svixId ||
        payload.id ||
        inner.email_id ||
        crypto.createHash("sha256").update(rawStr).digest("hex").slice(0, 32)
    ).replace(/[^a-zA-Z0-9_-]/g, "_");

    const dedupRef = database.collection("emailDedup").doc(`inbound_${eventKey}`);
    const isDuplicate = await database.runTransaction(async (tx) => {
      const snap = await tx.get(dedupRef);
      if (snap.exists) return true;
      tx.set(dedupRef, {
        provider: "resend-inbound",
        eventId: eventKey,
        createdAt: FieldValue.serverTimestamp(),
      });
      return false;
    });

    if (isDuplicate) {
      await database
        .collection("webhookLogs")
        .add({
          provider: "resend-inbound",
          eventType: String(payload.type || "email.received"),
          reference: eventKey,
          result: "duplicate",
          detail: "Duplicate inbound email ignored",
          ts: Date.now(),
        })
        .catch(() => null);
      res.status(200).json({ ok: true, duplicate: true });
      return;
    }

    const fromRaw = String(inner.from || payload.from || "");
    const m = fromRaw.match(/<([^>]+)>/);
    const fromEmail = (m ? m[1] : fromRaw).trim().toLowerCase();
    const fromName =
      (m ? fromRaw.replace(m[0], "").replace(/["']/g, "").trim() : "") ||
      fromEmail.split("@")[0] ||
      "Customer";
    const subject = String(inner.subject || payload.subject || "Email enquiry");
    const bodyText = String(inner.text || inner.html || "(Empty email)")
      .replace(/<[^>]+>/g, " ")
      .trim()
      .slice(0, 4000);

    if (!fromEmail.includes("@") || fromEmail.endsWith("@mail.shipwell.cc")) {
      res.json({ ok: true, ignored: true });
      return;
    }

    const rawTo = inner.to ?? payload.to;
    const rawToArr: unknown[] = Array.isArray(rawTo) ? rawTo : rawTo ? [rawTo] : [];
    const toList = rawToArr
      .map((item: unknown) => {
        const s = String(item || "");
        const mm = s.match(/<([^>]+)>/);
        return (mm ? mm[1] : s).trim().toLowerCase();
      })
      .filter((x: string) => x.includes("@"));
    const supportAddr = String(settings.supportInbox || DEFAULT_SUPPORT_INBOX).trim().toLowerCase();
    if (toList.length > 0 && !toList.includes(supportAddr)) {
      const attemptedAddress = toList[0];
      if (checkFnRateLimit(`unmonitored:${fromEmail}`, 1, 24 * 60 * 60 * 1000)) {
        await sendResendEmail({
          to: fromEmail,
          subject: "This ShipWell email address is not monitored",
          html: renderSimpleMailHtml({
            baseUrl: DEFAULT_APP_URL,
            heading: "Please message support@mail.shipwell.cc",
            bodyHtml: `<p>Your message to <code>${escapeHtml(attemptedAddress)}</code> reached an unmonitored automated address. Please write to <a href="mailto:support@mail.shipwell.cc" style="color:#34D399;">support@mail.shipwell.cc</a> instead.</p>`,
            ctaLabel: "Open Support",
            ctaUrl: `${DEFAULT_APP_URL}/dashboard/support`,
            footer: "Automated notice · max 1 notice per 24 hours",
          }),
          text: `Your message to ${attemptedAddress} was sent to an unmonitored address. Please contact support@mail.shipwell.cc instead.`,
          template: "unmonitored_redirect",
          category: "security",
          omitReplyTo: true,
          createdBy: "resend-inbound",
        }).catch(() => null);
      }
      res.json({ ok: true, ignored: true, reason: "unmonitored_address" });
      return;
    }

    const tkt = subject.match(/\[(TKT-[A-Z0-9]+)\]/i)?.[1]?.toUpperCase();
    const codeMatch = `${subject} ${bodyText}`.match(/\b(SW-\d{8}-[A-F0-9]{8})\b/i);
    const matchedCode = codeMatch ? codeMatch[1].toUpperCase() : null;

    let ref: FirebaseFirestore.DocumentReference | null = null;
    let ticketCode = tkt || `TKT-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;

    if (tkt) {
      const q = await database
        .collection("supportThreads")
        .where("ticketCode", "==", tkt)
        .limit(1)
        .get();
      if (!q.empty) ref = q.docs[0].ref;
    }

    if (!ref) {
      const byEmail = await database
        .collection("supportThreads")
        .where("userEmail", "==", fromEmail)
        .where("status", "==", "open")
        .limit(1)
        .get();
      if (!byEmail.empty) {
        ref = byEmail.docs[0].ref;
        ticketCode = String(byEmail.docs[0].data().ticketCode || ticketCode);
      }
    }

    const now = Date.now();
    if (!ref) {
      ref = database.collection("supportThreads").doc();
      await ref.set({
        ticketCode,
        uid: null,
        userName: fromName,
        userEmail: fromEmail,
        subject: subject.replace(/\[TKT-[A-Z0-9]+\]/gi, "").trim() || "Email enquiry",
        code: matchedCode,
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
      senderName: fromName,
      senderEmail: fromEmail,
      body: bodyText,
      source: "email",
      ts: now,
      createdAt: FieldValue.serverTimestamp(),
    });
    await database.collection("webhookLogs").add({
      provider: "resend-inbound",
      eventType: "email.received",
      reference: ticketCode,
      result: "processed",
      detail: `Inbound email from ${fromEmail}`,
      ts: now,
    }).catch(() => null);

    res.json({ ok: true, threadId: ref.id, ticketCode });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Inbound failed" });
  }
}

app.post("/api/inbound-email", handleInboundEmailRequest);

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
      const snap = await db()
        .collection("emailLogs")
        .where("providerId", "==", emailId)
        .limit(3)
        .get();
      await Promise.all(snap.docs.map((d) => d.ref.update({ status: nextStatus })));
    }
    res.json({ ok: true });
  } catch {
    res.json({ ok: false });
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
      res.status(403).json({
        error: "Recent password verification required.",
        code: "RECENT_AUTH_REQUIRED",
      });
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
    const rJson = await bachsFetch<Record<string, string>>(apiKey, env, "/v1/refunds", {
      method: "POST",
      body: {
        payment_id: pay.paymentId,
        amount: Number(pay.amountPaid || alert.amount).toFixed(2),
        reason: body.reason || `Admin refund ${code}`,
      },
      idempotencyKey: `ref_${code}_${alertId}_${Date.now()}`,
    });
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
      JSON.stringify({ code, receiverEmail, exp: Date.now() + 14 * 86400000 })
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

export const inboundEmail = onRequest(
  {
    region: "us-central1",
    cors: true,
    secrets: ["SETTINGS_ENCRYPTION_KEY"],
  },
  handleInboundEmailRequest
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
    if (shipment.bookingStatus === "awaiting_payment" || shipment.paymentStatus === "awaiting_payment") {
      return;
    }
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

export const onShipmentWritten = onDocumentWritten(
  {
    document: "shipments/{code}",
    region: "us-central1",
    secrets: ["SETTINGS_ENCRYPTION_KEY"],
  },
  async (event) => {
    const after = event.data?.after.data();
    if (!after) return;
    if (after.bookingStatus === "awaiting_payment" || after.paymentStatus === "awaiting_payment") {
      return;
    }
    const before = event.data?.before.data();
    const code = event.params.code;
    const receiverEmail = String(after.receiverEmail || "");
    const senderEmail = String(after.senderEmail || "");

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
      category: isDuty ? "billing" : "tracking",
      prefKey: "action",
      code,
      dedupKey: `alert_${code}_${alertId}`,
    });
  }
);

app.post("/api/auth/send-verification", async (req, res) => {
  try {
    const actor = await verifyActor(req);
    if (!actor || !actor.email) {
      res.status(401).json({ error: "Please log in first." });
      return;
    }
    if (!checkFnRateLimit(`verify:${actor.uid}`, 1, 60_000)) {
      res.status(429).json({ error: "Please wait 60 seconds before requesting another verification email." });
      return;
    }
    const baseUrl = getBaseUrl(req);
    const verifyUrl = await getAuth().generateEmailVerificationLink(actor.email, {
      url: `${baseUrl}/auth/action`,
      handleCodeInApp: false,
    });
    const name = String((req.body as { name?: string })?.name || actor.email.split("@")[0]);
    const result = await sendResendEmail({
      to: actor.email,
      subject: "Verify your email address for ShipWell",
      html: renderSimpleMailHtml({
        baseUrl,
        heading: "Verify your email address",
        bodyHtml: `<p>Hello ${escapeHtml(name.split(/\s+/)[0])},</p><p>Confirm your email address to unlock your ShipWell dashboard and live shipment tracking.</p>`,
        ctaLabel: "Verify email",
        ctaUrl: verifyUrl,
        footer: "Sent from an unmonitored security address. Need help? Email support@mail.shipwell.cc.",
      }),
      text: `Verify your ShipWell email: ${verifyUrl}`,
      template: "auth_verification",
      category: "security",
      omitReplyTo: true,
      createdBy: actor.uid,
    });
    res.json({ ok: true, status: result.status });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to send verification email." });
  }
});

app.post("/api/auth/send-password-reset", async (req, res) => {
  try {
    const email = String((req.body as { email?: string })?.email || "").trim().toLowerCase();
    if (!email.includes("@")) {
      res.status(400).json({ error: "Valid email required." });
      return;
    }
    if (!checkFnRateLimit(`pwreset:${email}`, 1, 30_000)) {
      res.status(429).json({ error: "Please wait before requesting another reset link." });
      return;
    }
    const baseUrl = getBaseUrl(req);
    try {
      const user = await getAuth().getUserByEmail(email);
      const resetUrl = await getAuth().generatePasswordResetLink(email, {
        url: `${baseUrl}/auth/action`,
        handleCodeInApp: false,
      });
      await sendResendEmail({
        to: email,
        subject: "Reset your ShipWell password",
        html: renderSimpleMailHtml({
          baseUrl,
          heading: "Reset your password",
          bodyHtml: `<p>Hello ${escapeHtml((user.displayName || "there").split(/\s+/)[0])},</p><p>Use the button below to choose a new password for your ShipWell account.</p>`,
          ctaLabel: "Reset password",
          ctaUrl: resetUrl,
          footer: "Sent from an unmonitored security address. Need help? Email support@mail.shipwell.cc.",
        }),
        text: `Reset your ShipWell password: ${resetUrl}`,
        template: "auth_password_reset",
        category: "security",
        omitReplyTo: true,
        createdBy: "password_reset",
      });
    } catch {
      // Do not reveal account existence
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed" });
  }
});

export const draftReminder24h = onSchedule(
  {
    schedule: "every 1 hours",
    region: "us-central1",
    secrets: ["SETTINGS_ENCRYPTION_KEY"],
  },
  async () => {
    const database = db();
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const snap = await database
      .collection("draftSummaries")
      .where("updatedAtMs", "<=", cutoff)
      .limit(100)
      .get();

    for (const d of snap.docs) {
      const data = d.data() as {
        uid: string;
        draftId: string;
        email?: string;
        originCountry?: string;
        destCountry?: string;
        reminderSent?: boolean;
      };
      if (data.reminderSent || !data.email) continue;
      const route =
        data.originCountry && data.destCountry
          ? `${data.originCountry} → ${data.destCountry}`
          : "your saved shipment";
      const draftUrl = `${DEFAULT_APP_URL}/dashboard?view=ship&draft=${encodeURIComponent(data.draftId)}`;
      const res = await sendResendEmail({
        to: data.email,
        subject: "You left a shipment draft on ShipWell",
        html: renderSimpleMailHtml({
          baseUrl: DEFAULT_APP_URL,
          heading: "Continue your shipment draft",
          bodyHtml: `<p>You left an unfinished shipment (${escapeHtml(route)}) on ShipWell. Your details are still saved.</p>`,
          ctaLabel: "Continue draft",
          ctaUrl: draftUrl,
          footer: "Manage notification preferences in Account settings.",
        }),
        text: `You left a shipment draft (${route}) on ShipWell. Continue here: ${draftUrl}`,
        template: "draft_reminder_24h",
        category: "notifications",
        prefKey: "action",
        dedupKey: `draft_rem_${d.id}`,
      });
      if (res.status !== "failed") {
        await d.ref.update({ reminderSent: true }).catch(() => null);
        await database
          .collection("drafts")
          .doc(data.uid)
          .collection("items")
          .doc(data.draftId)
          .update({ reminderSent: true })
          .catch(() => null);
      }
    }
  }
);

export const draftCleanup30d = onSchedule(
  {
    schedule: "every 24 hours",
    region: "us-central1",
  },
  async () => {
    const database = db();
    const bucket = getStorage().bucket();
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const snap = await database
      .collection("draftSummaries")
      .where("updatedAtMs", "<=", cutoff)
      .limit(100)
      .get();

    for (const d of snap.docs) {
      const data = d.data() as { uid: string; draftId: string };
      await bucket
        .deleteFiles({ prefix: `drafts/${data.uid}/${data.draftId}/` })
        .catch(() => null);
      await database
        .collection("drafts")
        .doc(data.uid)
        .collection("items")
        .doc(data.draftId)
        .delete()
        .catch(() => null);
      await d.ref.delete().catch(() => null);
    }
  }
);

export const expireOverduePayments = onSchedule(
  {
    schedule: "every 30 minutes",
    region: "us-central1",
    secrets: ["SETTINGS_ENCRYPTION_KEY"],
  },
  async () => {
    const database = db();
    const now = Date.now();
    const paySnap = await database
      .collection("payments")
      .where("status", "==", "awaiting_payment")
      .limit(100)
      .get();

    for (const docSnap of paySnap.docs) {
      const p = docSnap.data() as Record<string, unknown>;
      const exp = Number(p.expiresAt || 0);
      if (!exp || exp > now) continue;
      const code = String(p.trackingCode || "");
      const ref = String(p.reference || "");
      const userEmail = String(p.userEmail || "");
      await docSnap.ref.update({
        status: "expired",
        updatedAtMs: now,
        updatedAt: FieldValue.serverTimestamp(),
      });
      if (p.bookingId) {
        await database
          .collection("bookings")
          .doc(String(p.bookingId))
          .update({
            paymentStatus: "expired",
            bookingStatus: "expired",
            lastError: "Payment window elapsed.",
          })
          .catch(() => null);
      }
      if (code) {
        await database
          .collection("shipments")
          .doc(code)
          .update({
            paymentStatus: "expired",
            bookingStatus: "expired",
            updatedAt: FieldValue.serverTimestamp(),
          })
          .catch(() => null);
      }
      if (userEmail.includes("@")) {
        await sendResendEmail({
          to: userEmail,
          subject: `Payment window expired (${ref}) — ${code}`,
          html: renderSimpleMailHtml({
            baseUrl: DEFAULT_APP_URL,
            heading: "Payment window expired",
            bodyHtml: `<p>The payment window for ${escapeHtml(ref)} (${escapeHtml(code)}) expired before payment was completed, so dispatch did not start.</p>`,
            ctaLabel: "Start a new booking",
            ctaUrl: `${DEFAULT_APP_URL}/dashboard/ship`,
            footer: "Need help? Email support@mail.shipwell.cc",
          }),
          text: `Payment window expired for ${ref} (${code}).`,
          template: "payment_expired",
          category: "billing",
          code,
          dedupKey: `pay_exp_${docSnap.id}`,
        }).catch(() => null);
      }
    }
  }
);

