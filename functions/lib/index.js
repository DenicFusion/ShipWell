"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.onShipmentAlertCreated = exports.onShipmentWritten = exports.onShipmentEventCreated = exports.api = void 0;
const node_crypto_1 = __importDefault(require("node:crypto"));
const express_1 = __importDefault(require("express"));
const app_1 = require("firebase-admin/app");
const auth_1 = require("firebase-admin/auth");
const firestore_1 = require("firebase-admin/firestore");
const https_1 = require("firebase-functions/v2/https");
const firestore_2 = require("firebase-functions/v2/firestore");
const libphonenumber_js_1 = require("libphonenumber-js");
if ((0, app_1.getApps)().length === 0) {
    (0, app_1.initializeApp)();
}
function db() {
    const dbId = process.env.SHIPWELL_FIRESTORE_DB;
    if (dbId && dbId !== "(default)") {
        return (0, firestore_1.getFirestore)(dbId);
    }
    return (0, firestore_1.getFirestore)();
}
const ADMIN_EMAIL = "denic9426@gmail.com";
const DEFAULT_APP_URL = "https://shipwell.cc";
const DEFAULT_EMAIL_FROM = "ShipWell <notifications@info.shipwell.cc>";
const DEFAULT_EMAIL_REPLY_TO = "support@info.shipwell.cc";
const DEFAULT_SUPPORT_INBOX = "support@info.shipwell.cc";
const CODE_RE = /^SW-\d{8}-[A-F0-9]{8}$/;
// ── Shared Shipping Rate Calculator (must match client lib/quote-engine.ts) ──
const PLACES = {
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
const SERVICE_MULT = { economy: 0.55, standard: 1, express: 1.85 };
function r2(n) {
    return Math.round(n * 100) / 100;
}
function calcServerQuote(from, to, kg, declaredValue, svc) {
    const A = PLACES[from] ?? PLACES["United States"];
    const B = PLACES[to] ?? PLACES["United Kingdom"];
    const intl = from !== to;
    const R = 6371;
    const d = Math.PI / 180;
    const dLat = (B.lat - A.lat) * d;
    const dLon = (B.lon - A.lon) * d;
    const h = Math.sin(dLat / 2) ** 2 +
        Math.cos(A.lat * d) * Math.cos(B.lat * d) * Math.sin(dLon / 2) ** 2;
    const dist = intl ? 2 * R * Math.asin(Math.sqrt(h)) : 120;
    const perKg = 1.9 + dist / 3800;
    const base = r2((8 + Math.max(kg, 0.1) * perKg) * SERVICE_MULT[svc]);
    const fuel = r2(base * 0.12);
    const cover = r2(Math.max(2.5, (declaredValue || 0) * 0.008));
    const duty = intl ? r2(base * 0.08) : 0;
    const total = r2(base + fuel + cover + duty);
    let days;
    if (!intl) {
        days = { express: [1, 1], standard: [1, 2], economy: [3, 4] }[svc];
    }
    else if (svc === "express") {
        const dt = Math.max(1, Math.ceil(1 + dist / 9000));
        days = [dt, dt + 1];
    }
    else if (svc === "standard") {
        const dt = Math.ceil(2 + dist / 3500);
        days = [dt, dt + 2];
    }
    else {
        const dt = Math.ceil(5 + dist / 1800);
        days = [dt, dt + 3];
    }
    return { total, days };
}
function addBusinessDays(ts, count) {
    const dt = new Date(ts);
    let left = count;
    while (left > 0) {
        dt.setDate(dt.getDate() + 1);
        if (dt.getDay() % 6 !== 0)
            left--;
    }
    return dt.getTime();
}
function generateTrackingCode() {
    const now = new Date();
    const pad = (x) => String(x).padStart(2, "0");
    const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    const suffix = node_crypto_1.default.randomBytes(4).toString("hex").toUpperCase();
    return `SW-${dateStr}-${suffix}`;
}
// ── AES-256-GCM Secret Crypto ──
function deriveKey() {
    const raw = process.env.SETTINGS_ENCRYPTION_KEY || "";
    if (!raw.trim()) {
        throw new Error("SETTINGS_ENCRYPTION_KEY secret is missing.");
    }
    return node_crypto_1.default.createHash("sha256").update(raw.trim(), "utf8").digest();
}
function encryptSecret(plaintext) {
    const key = deriveKey();
    const iv = node_crypto_1.default.randomBytes(12);
    const cipher = node_crypto_1.default.createCipheriv("aes-256-gcm", key, iv);
    const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}
function decryptSecret(payload) {
    if (!payload || !payload.startsWith("v1:"))
        return "";
    const parts = payload.split(":");
    if (parts.length !== 4)
        return "";
    const key = deriveKey();
    const iv = Buffer.from(parts[1], "base64");
    const tag = Buffer.from(parts[2], "base64");
    const data = Buffer.from(parts[3], "base64");
    const decipher = node_crypto_1.default.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
function maskSecret(val, updatedBy = "admin") {
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
let bundleCache = null;
async function loadSettings() {
    if (bundleCache && bundleCache.expiresAt > Date.now()) {
        return bundleCache.data;
    }
    const database = db();
    const [pubSnap, secSnap] = await Promise.all([
        database.collection("adminSettings").doc("payments").get(),
        database.collection("adminSecrets").doc("payments").get(),
    ]);
    const pubData = (pubSnap.exists ? pubSnap.data() : {});
    const secData = (secSnap.exists ? secSnap.data() : {});
    const dec = (k) => {
        try {
            return secData[k] ? decryptSecret(secData[k]) : "";
        }
        catch {
            return "";
        }
    };
    const bachsObj = (pubData.bachs || {});
    const resendObj = (pubData.resend || {});
    const routingObj = (pubData.routing || {});
    const env = bachsObj.environment === "live" ? "live" : "sandbox";
    const sandboxProductId = String(bachsObj.sandboxProductId || "").trim();
    const liveProductId = String(bachsObj.liveProductId || "").trim();
    const enableBachsBooking = routingObj.enableBachsBooking !== false;
    const enablePayOnPickup = routingObj.enablePayOnPickup !== false;
    const bundle = {
        pub: {
            bachs: {
                environment: env,
                sandboxProductId,
                liveProductId,
                organizationId: bachsObj.organizationId || "",
                defaultCurrency: bachsObj.defaultCurrency || "USD",
                checkoutExpiryMinutes: bachsObj.checkoutExpiryMinutes || 60,
                lastWebhookAt: bachsObj.lastWebhookAt || null,
                secrets: bachsObj.secrets || {
                    sandboxSecretKey: { configured: false },
                    liveSecretKey: { configured: false },
                    sandboxWebhookSecret: { configured: false },
                    liveWebhookSecret: { configured: false },
                    previousWebhookSecret: { configured: false },
                },
            },
            resend: {
                from: resendObj.from || process.env.EMAIL_FROM || DEFAULT_EMAIL_FROM,
                replyTo: resendObj.replyTo || process.env.EMAIL_REPLY_TO || DEFAULT_EMAIL_REPLY_TO,
                supportInbox: resendObj.supportInbox || process.env.SUPPORT_INBOX || DEFAULT_SUPPORT_INBOX,
                secrets: resendObj.secrets || {
                    apiKey: { configured: Boolean(process.env.RESEND_API_KEY) },
                    inboundWebhookSecret: { configured: false },
                },
            },
            stripe: pubData.stripe || {
                enabled: false,
                publicKey: "",
                secrets: { secretKey: { configured: false }, webhookSecret: { configured: false } },
            },
            paystack: pubData.paystack || {
                enabled: false,
                publicKey: "",
                secrets: { secretKey: { configured: false }, webhookSecret: { configured: false } },
            },
            routing: {
                primaryGateway: routingObj.primaryGateway || "bachs",
                fallbackOrder: routingObj.fallbackOrder || ["bachs"],
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
            resendInboundSecret: dec("resendInboundSecret"),
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
        emailFrom: String(resendObj.from || process.env.EMAIL_FROM || DEFAULT_EMAIL_FROM),
        emailReplyTo: String(resendObj.replyTo || process.env.EMAIL_REPLY_TO || DEFAULT_EMAIL_REPLY_TO),
        supportInbox: String(resendObj.supportInbox || process.env.SUPPORT_INBOX || DEFAULT_SUPPORT_INBOX),
    };
    bundleCache = { data: bundle, expiresAt: Date.now() + 180_000 };
    return bundle;
}
// ── Plain-fetch Bachs Client & Webhook HMAC Verification ──
function getBachsBaseUrl(env) {
    return env === "live" ? "https://api.bachs.io" : "https://sandbox-api.bachs.io";
}
async function bachsFetch(apiKey, env, apiPath, init = {}) {
    const headers = {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
    };
    if (init.idempotencyKey)
        headers["Idempotency-Key"] = init.idempotencyKey;
    const res = await fetch(`${getBachsBaseUrl(env)}${apiPath}`, {
        method: init.method || "GET",
        headers,
        ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    });
    const text = await res.text();
    let json = {};
    try {
        if (text)
            json = JSON.parse(text);
    }
    catch {
        // non-json
    }
    if (!res.ok) {
        const detail = typeof json.detail === "string"
            ? json.detail
            : json.detail
                ? JSON.stringify(json.detail)
                : String(json.message || json.error?.message || `HTTP ${res.status}`);
        console.error("[Bachs Error]", { path: apiPath, status: res.status, error_code: json.error_code, detail });
        throw Object.assign(new Error(detail), { status: res.status >= 400 && res.status < 500 ? 400 : 502 });
    }
    return json;
}
async function createBachsCheckoutSession(params) {
    if (!params.productId) {
        throw Object.assign(new Error(`No Bachs ${params.env} product ID configured. Save it in Admin → Settings → Bachs.`), { status: 400 });
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
    let created;
    try {
        created = await bachsFetch(params.apiKey, params.env, "/v1/checkout-sessions", {
            method: "POST",
            body: { ...baseBody, return_url: params.returnUrl },
            idempotencyKey: params.idempotencyKey,
        });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : "";
        if (/return_url/i.test(msg)) {
            created = await bachsFetch(params.apiKey, params.env, "/v1/checkout-sessions", {
                method: "POST",
                body: { ...baseBody, success_url: params.returnUrl },
                idempotencyKey: `${params.idempotencyKey}_s`,
            });
        }
        else {
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
        expiresAt: Date.parse(String(created.expires_at || "")) ||
            Date.now() + (params.expiresInMinutes || 60) * 60000,
    };
}
function headerStr(headers, name) {
    const t = name.toLowerCase();
    for (const [k, v] of Object.entries(headers)) {
        if (k.toLowerCase() !== t)
            continue;
        if (Array.isArray(v)) {
            if (v.length !== 1)
                return null;
            return String(v[0] || "").trim() || null;
        }
        return typeof v === "string" && v.trim() ? v.trim() : null;
    }
    return null;
}
function extractDigests(sig) {
    const out = [];
    for (const p of sig.split(",")) {
        const s = p.trim();
        const eq = s.indexOf("=");
        const hex = (eq >= 0 ? s.slice(eq + 1) : s).trim().toLowerCase();
        if (/^[a-f0-9]{64}$/.test(hex))
            out.push(hex);
    }
    return out;
}
function verifyBachsWebhook(rawBody, headers, secrets) {
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
        if (!s.trim())
            continue;
        const expected = Buffer.from(node_crypto_1.default.createHmac("sha256", s.trim()).update(payload, "utf8").digest("hex"), "hex");
        for (const d of digests) {
            const provided = Buffer.from(d, "hex");
            if (provided.length === expected.length && node_crypto_1.default.timingSafeEqual(provided, expected)) {
                ok = true;
                break;
            }
        }
        if (ok)
            break;
    }
    if (!ok) {
        throw Object.assign(new Error("Invalid Bachs webhook signature"), { status: 400 });
    }
    const parsed = JSON.parse(rawStr);
    return {
        id: String(parsed.id || node_crypto_1.default.createHash("sha256").update(rawStr).digest("hex").slice(0, 24)),
        type: String(parsed.type || ""),
        data: parsed.data || {},
    };
}
async function verifyActor(req) {
    const raw = req.headers.authorization || "";
    const match = raw.match(/^Bearer\s+(.+)$/i);
    if (!match?.[1])
        return null;
    try {
        const decoded = await (0, auth_1.getAuth)().verifyIdToken(match[1].trim(), false);
        const email = String(decoded.email || "").trim().toLowerCase();
        const emailVerified = Boolean(decoded.email_verified);
        return {
            uid: decoded.uid,
            email,
            emailVerified,
            isAdmin: decoded.admin === true || (email === ADMIN_EMAIL && emailVerified),
            authTime: Number(decoded.auth_time || Math.floor(Date.now() / 1000)),
        };
    }
    catch {
        return null;
    }
}
function escapeHtml(str) {
    return String(str || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
function renderSimpleMailHtml(params) {
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
async function sendResendEmail(params) {
    const database = db();
    if (params.dedupKey) {
        const dedupRef = database.collection("emailDedup").doc(params.dedupKey);
        const alreadySent = await database.runTransaction(async (tx) => {
            const snap = await tx.get(dedupRef);
            if (snap.exists)
                return true;
            tx.set(dedupRef, {
                to: params.to,
                template: params.template,
                createdAt: firestore_1.FieldValue.serverTimestamp(),
            });
            return false;
        });
        if (alreadySent) {
            return { status: "sent", providerId: "deduped" };
        }
    }
    const settings = await loadSettings();
    let status = "queued_preview";
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
                const json = (await res.json());
                status = "sent";
                providerId = json.id || `resend_${Date.now()}`;
            }
            else {
                status = "failed";
            }
        }
        catch {
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
        createdAt: firestore_1.FieldValue.serverTimestamp(),
    })
        .catch(() => null);
    return { status, providerId };
}
function getBaseUrl(_req) {
    return (process.env.APP_URL || DEFAULT_APP_URL).replace(/\/+$/, "");
}
async function sendBookingEmails(database, baseUrl, shipment, actorUid) {
    const code = String(shipment.code || "");
    const receiverEmail = String(shipment.receiverEmail || "").trim().toLowerCase();
    const senderEmail = String(shipment.senderEmail || "").trim().toLowerCase();
    const senderObj = (shipment.sender || {});
    const receiverObj = (shipment.receiver || {});
    const senderName = senderObj.name || "A ShipWell sender";
    const receiverName = receiverObj.name || "there";
    if (receiverEmail.includes("@")) {
        let hasAccount = false;
        try {
            const h = node_crypto_1.default.createHash("sha256").update(receiverEmail).digest("hex");
            const snap = await database.collection("accountStatus").doc(h).get();
            if (snap.exists)
                hasAccount = true;
        }
        catch {
            // ignore
        }
        if (!hasAccount) {
            try {
                await (0, auth_1.getAuth)().getUserByEmail(receiverEmail);
                hasAccount = true;
            }
            catch {
                hasAccount = false;
            }
        }
        const tokenPayload = Buffer.from(JSON.stringify({ code, receiverEmail, exp: Date.now() + 14 * 86400000 })).toString("base64url");
        const sig = node_crypto_1.default
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
                footer: "Questions? Reply to this email. · ShipWell Logistics Ltd.",
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
                footer: "ShipWell Logistics Ltd.",
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
const app = (0, express_1.default)();
app.set("trust proxy", true);
app.post("/api/bachs-webhook", express_1.default.raw({ type: "application/json", limit: "2mb" }), async (req, res) => {
    try {
        const database = db();
        const settings = await loadSettings();
        const rawBody = req.rawBody ||
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
        }
        catch (err) {
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
        const meta = dataObj.metadata && typeof dataObj.metadata === "object"
            ? dataObj.metadata
            : {};
        const code = String(meta.trackingCode || meta.shipment || "").trim().toUpperCase();
        const alertId = String(meta.alertId || "").trim();
        const checkoutId = String(dataObj.checkout_id || dataObj.id || "").trim();
        const paymentId = String(dataObj.payment_id || dataObj.charge_id || checkoutId).trim();
        const reference = String(dataObj.reference || meta.reference || checkoutId).trim();
        const bookingId = String(meta.bookingId || (reference.startsWith("booking_") ? reference.slice(8) : "")).trim();
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
            if (snap.exists)
                return true;
            tx.set(dedupeRef, {
                eventId: event.id,
                type: event.type,
                code: code || null,
                alertId: alertId || null,
                bookingId: bookingId || null,
                processedAt: firestore_1.FieldValue.serverTimestamp(),
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
            const booking = bookingSnap.data();
            const shipCode = String(booking.code || code);
            const shipRef = database.collection("shipments").doc(shipCode);
            const shipSnap = await shipRef.get();
            const shipment = shipSnap.exists ? shipSnap.data() : null;
            if (t === "collection.succeeded" || t === "payment.succeeded" || t === "checkout.session.completed") {
                const env = booking.environment || settings.environment;
                const apiKey = env === "live" ? settings.sec.bachsLiveKey : settings.sec.bachsSandboxKey;
                let verifiedAmount = Number(dataObj.amount || booking.total || 0);
                let verifiedCurrency = String(dataObj.currency || booking.currency || "USD").toUpperCase();
                if (apiKey && checkoutId) {
                    const sess = await bachsFetch(apiKey, env, `/v1/checkout-sessions/${encodeURIComponent(checkoutId)}`);
                    if (sess.amount != null)
                        verifiedAmount = Number(sess.amount);
                    else if (sess.amount_total != null)
                        verifiedAmount = Number(sess.amount_total);
                    if (sess.currency)
                        verifiedCurrency = String(sess.currency).toUpperCase();
                }
                if (Math.abs(verifiedAmount - Number(booking.total || 0)) > 0.05 ||
                    verifiedCurrency !== String(booking.currency || "USD").toUpperCase()) {
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
                    updatedAt: firestore_1.FieldValue.serverTimestamp(),
                });
                if (shipSnap.exists) {
                    await shipRef.update({
                        paymentStatus: "paid",
                        bookingStatus: "confirmed",
                        paymentId,
                        paymentReference: reference,
                        "nextStop.label": "Awaiting item review & pickup dispatch",
                        updatedAt: firestore_1.FieldValue.serverTimestamp(),
                    });
                    await database.collection("trackingTeasers").doc(shipCode).update({
                        latestEvent: { label: "Booking confirmed", loc: "Origin Hub", ts: now },
                        updatedAt: firestore_1.FieldValue.serverTimestamp(),
                    });
                    await shipRef.collection("events").add({
                        stage: "Booked",
                        label: "Booking confirmed",
                        loc: "Origin Hub",
                        note: `Payment confirmed ($${verifiedAmount.toFixed(2)} via Bachs · ${paymentId}).`,
                        kind: "info",
                        ts: now,
                        createdBy: "Bachs webhook",
                        createdAt: firestore_1.FieldValue.serverTimestamp(),
                    });
                }
                if (shipment) {
                    await sendBookingEmails(database, getBaseUrl(req), shipment, String(booking.uid || "webhook"));
                }
            }
            else if (t === "collection.failed" || t === "checkout.expired" || t === "checkout.session.expired" || t === "collection.abandoned") {
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
            }
            else if (t === "refund.succeeded" || t === "refund.paid" || t === "collection.refunded") {
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
        const shipment = shipSnap.data();
        const alert = alertSnap.data();
        if (t === "collection.succeeded" || t === "payment.succeeded" || t === "checkout.session.completed") {
            const env = alert.payment?.environment ||
                settings.environment;
            const apiKey = env === "live" ? settings.sec.bachsLiveKey : settings.sec.bachsSandboxKey;
            let verifiedAmount = Number(dataObj.amount || alert.amount || 0);
            let verifiedCurrency = String(dataObj.currency || alert.currency || "USD").toUpperCase();
            if (apiKey && checkoutId) {
                const sess = await bachsFetch(apiKey, env, `/v1/checkout-sessions/${encodeURIComponent(checkoutId)}`);
                if (sess.amount != null)
                    verifiedAmount = Number(sess.amount);
                else if (sess.amount_total != null)
                    verifiedAmount = Number(sess.amount_total);
                if (sess.currency)
                    verifiedCurrency = String(sess.currency).toUpperCase();
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
                resolvedAt: firestore_1.FieldValue.serverTimestamp(),
                response: `Paid via Bachs (${paymentId})`,
                payment: {
                    ...(alert.payment || {}),
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
                createdAt: firestore_1.FieldValue.serverTimestamp(),
            });
            const openSnap = await shipRef.collection("alerts").where("status", "==", "open").get();
            const remainingHolds = openSnap.docs.filter((d) => {
                const ad = d.data();
                return ad.holdShipment === true || ad.kind === "duty";
            });
            if (remainingHolds.length === 0 && shipment.hold) {
                await shipRef.update({ hold: null, updatedAt: firestore_1.FieldValue.serverTimestamp() });
                await database.collection("trackingTeasers").doc(code).update({
                    holdType: null,
                    latestEvent: { label: "Hold released", loc: "Customs Clearance", ts: now },
                    updatedAt: firestore_1.FieldValue.serverTimestamp(),
                });
                await shipRef.collection("events").add({
                    stage: shipment.status,
                    label: "Hold released",
                    loc: "Customs Clearance",
                    note: "All customs holds resolved.",
                    kind: "info",
                    ts: now + 1,
                    createdBy: "Bachs webhook",
                    createdAt: firestore_1.FieldValue.serverTimestamp(),
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
        }
        else if (t === "collection.failed" || t === "checkout.expired" || t === "checkout.session.expired" || t === "collection.abandoned") {
            await alertRef.update({
                "payment.status": "failed",
                "payment.lastError": t,
            });
        }
        else if (t === "collection.underpaid") {
            await alertRef.update({
                "payment.status": "underpaid",
                "payment.lastError": "Underpaid — remaining balance due",
            });
        }
        else if (t === "refund.succeeded" || t === "refund.paid" || t === "collection.refunded") {
            await alertRef.update({
                "payment.status": "refunded",
                "payment.refundedAt": Date.now(),
            });
        }
        res.status(200).json({ received: true });
    }
    catch (err) {
        const status = err && typeof err === "object" && "status" in err && typeof err.status === "number"
            ? err.status
            : 500;
        res.status(status >= 400 && status < 600 ? status : 500).json({
            error: err instanceof Error ? err.message : "Webhook error",
        });
    }
});
app.use(express_1.default.json({ limit: "2mb" }));
app.get("/api/checkout/options", async (_req, res) => {
    const settings = await loadSettings();
    const apiKey = settings.environment === "live" ? settings.sec.bachsLiveKey : settings.sec.bachsSandboxKey;
    const productId = settings.environment === "live" ? settings.liveProductId : settings.sandboxProductId;
    res.json({
        bachsEnabled: settings.enableBachsBooking,
        bachsConfigured: Boolean(apiKey && productId),
        payOnPickupEnabled: settings.enablePayOnPickup,
        environment: settings.environment,
        currency: settings.defaultCurrency,
    });
});
app.post("/api/bookings", async (req, res) => {
    try {
        const actor = await verifyActor(req);
        if (!actor) {
            res.status(401).json({ error: "Please log in or sign up before booking a parcel." });
            return;
        }
        const database = db();
        const b = (req.body || {});
        const rawIdem = String(b.idempotencyKey || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
        const bookingId = rawIdem.length >= 8 ? rawIdem : `bk_${node_crypto_1.default.randomBytes(8).toString("hex")}`;
        const bookingRef = database.collection("bookings").doc(bookingId);
        const existing = await bookingRef.get();
        if (existing.exists) {
            const ex = existing.data();
            res.json({
                ok: true,
                code: ex.code,
                bookingId: ex.id,
                total: ex.total,
                currency: ex.currency,
                paymentMethod: ex.paymentMethod,
                paymentStatus: ex.paymentStatus,
                checkoutUrl: ex.checkoutUrl || null,
                checkoutId: ex.checkoutId || null,
            });
            return;
        }
        const senderCountry = String(b.senderCountry || "");
        const receiverCountry = String(b.receiverCountry || "");
        if (!PLACES[senderCountry] || !PLACES[receiverCountry]) {
            res.status(400).json({ error: "Select valid origin and destination countries." });
            return;
        }
        const pSender = (0, libphonenumber_js_1.parsePhoneNumberFromString)(String(b.senderPhone || ""));
        const pReceiver = (0, libphonenumber_js_1.parsePhoneNumberFromString)(String(b.receiverPhone || ""));
        if (!pSender?.isValid() || !pReceiver?.isValid()) {
            res.status(400).json({ error: "Enter valid international phone numbers." });
            return;
        }
        const weightKg = Number(b.weightKg);
        const declaredValue = Math.max(0, Number(b.declaredValue) || 0);
        const service = b.service === "economy" || b.service === "express" ? b.service : "standard";
        const photos = Array.isArray(b.photos)
            ? b.photos.filter((u) => typeof u === "string" && /^https?:\/\//i.test(u)).slice(0, 4)
            : [];
        if (!weightKg || weightKg < 0.1 || photos.length === 0) {
            res.status(400).json({ error: "Valid weight and at least 1 photo required." });
            return;
        }
        const settings = await loadSettings();
        const channel = b.paymentChannel === "pay_on_pickup"
            ? "pay_on_pickup"
            : b.paymentChannel === "bank_transfer"
                ? "bank_transfer"
                : "card";
        const isPayOnPickup = channel === "pay_on_pickup";
        if (!isPayOnPickup && !settings.enableBachsBooking) {
            res.status(400).json({ error: "Online checkout is currently disabled." });
            return;
        }
        if (isPayOnPickup && !settings.enablePayOnPickup) {
            res.status(400).json({ error: "Pay on pickup is currently disabled." });
            return;
        }
        const quote = calcServerQuote(senderCountry, receiverCountry, weightKg, declaredValue, service);
        const code = generateTrackingCode();
        const now = Date.now();
        const eta = addBusinessDays(now, quote.days[1]);
        const baseUrl = getBaseUrl(req);
        const reference = `booking_${bookingId}`;
        const senderEmail = String(b.senderEmail || actor.email).trim().toLowerCase();
        const receiverEmail = String(b.receiverEmail || "").trim().toLowerCase();
        let checkoutId = null;
        let checkoutUrl = null;
        let checkoutExpiresAt = null;
        if (!isPayOnPickup) {
            const apiKey = settings.environment === "live"
                ? settings.sec.bachsLiveKey
                : settings.sec.bachsSandboxKey;
            const productId = settings.environment === "live" ? settings.liveProductId : settings.sandboxProductId;
            const session = await createBachsCheckoutSession({
                apiKey,
                env: settings.environment,
                productId,
                amount: quote.total,
                customerEmail: senderEmail,
                customerName: String(b.senderName || "Customer"),
                returnUrl: `${baseUrl}/dashboard/track/${encodeURIComponent(code)}?paid=1&booking=1`,
                cancelUrl: `${baseUrl}/dashboard/ship?cancelled=1`,
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
                name: String(b.senderName || ""),
                email: senderEmail,
                phone: pSender.formatInternational(),
                address: String(b.senderAddress || ""),
                city: String(b.senderCity || ""),
                postal: String(b.senderPostal || ""),
                country: senderCountry,
            },
            receiver: {
                name: String(b.receiverName || ""),
                email: receiverEmail,
                phone: pReceiver.formatInternational(),
                address: String(b.receiverAddress || ""),
                city: String(b.receiverCity || ""),
                postal: String(b.receiverPostal || ""),
                country: receiverCountry,
            },
            service,
            weightKg,
            packageType: String(b.packageType || "Parcel"),
            contents: String(b.contents || ""),
            declaredValue,
            priceTotal: quote.total,
            paymentMethod: isPayOnPickup ? "Pay on pickup" : channel === "bank_transfer" ? "Bank transfer (Bachs)" : "Card (Bachs)",
            bookingId,
            paymentStatus: isPayOnPickup ? "pay_on_pickup" : "awaiting_payment",
            paymentReference: reference,
            checkoutExpiresAt,
            bookingStatus: isPayOnPickup ? "confirmed" : "awaiting_payment",
            status: "Booked",
            eta,
            photos,
            hold: null,
            nextStop: {
                label: isPayOnPickup ? "Awaiting item review & pickup dispatch" : "Awaiting booking payment confirmation",
                loc: `${String(b.senderCity || "Origin")} Origin`,
                eta: now + 86400000,
            },
            review: { state: "pending", note: "" },
        };
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
            paymentMethod: isPayOnPickup ? "pay_on_pickup" : "bachs",
            paymentChannel: channel,
            paymentStatus: isPayOnPickup ? "pay_on_pickup" : "awaiting_payment",
            bookingStatus: isPayOnPickup ? "confirmed" : "awaiting_payment",
            environment: settings.environment,
            checkoutId,
            checkoutUrl,
            paymentReference: reference,
            checkoutExpiresAt,
            createdAtMs: now,
            createdAt: firestore_1.FieldValue.serverTimestamp(),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        });
        batch.set(database.collection("shipments").doc(code), {
            ...shipDoc,
            createdAt: firestore_1.FieldValue.serverTimestamp(),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        });
        batch.set(database.collection("trackingTeasers").doc(code), {
            code,
            senderId: actor.uid,
            status: "Booked",
            holdType: null,
            originCity: String(b.senderCity || ""),
            originCountry: senderCountry,
            destinationCity: String(b.receiverCity || ""),
            destinationCountry: receiverCountry,
            service,
            weightKg,
            contents: String(b.contents || ""),
            eta,
            latestEvent: {
                label: isPayOnPickup ? "Booked (pay on pickup)" : "Awaiting booking payment",
                loc: `${String(b.senderCity || "")}, ${senderCountry}`,
                ts: now,
            },
            createdAt: firestore_1.FieldValue.serverTimestamp(),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        });
        await batch.commit();
        if (isPayOnPickup) {
            await sendBookingEmails(database, baseUrl, shipDoc, actor.uid);
        }
        res.json({
            ok: true,
            code,
            bookingId,
            total: quote.total,
            currency: settings.defaultCurrency,
            paymentMethod: isPayOnPickup ? "pay_on_pickup" : "bachs",
            paymentStatus: isPayOnPickup ? "pay_on_pickup" : "awaiting_payment",
            checkoutUrl,
            checkoutId,
        });
    }
    catch (err) {
        const status = err && typeof err === "object" && "status" in err && typeof err.status === "number"
            ? err.status
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
        const body = (req.body || {});
        const code = String(body.code || "").trim().toUpperCase();
        const database = db();
        const shipRef = database.collection("shipments").doc(code);
        const shipSnap = await shipRef.get();
        if (!shipSnap.exists) {
            res.status(404).json({ error: "Shipment not found." });
            return;
        }
        const shipment = shipSnap.data();
        if (body.action === "mark_pickup_paid") {
            await shipRef.update({ paymentStatus: "paid", bookingStatus: "confirmed", updatedAt: firestore_1.FieldValue.serverTimestamp() });
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
            const rJson = await bachsFetch(apiKey, settings.environment, "/v1/refunds", {
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
        await shipRef.update({ paymentStatus: "refunded", bookingStatus: "cancelled", updatedAt: firestore_1.FieldValue.serverTimestamp() });
        if (shipment.bookingId) {
            await database.collection("bookings").doc(String(shipment.bookingId)).update({
                paymentStatus: "refunded",
                bookingStatus: "cancelled",
                refundId,
                refundedAt: Date.now(),
            }).catch(() => null);
        }
        res.json({ ok: true, status: "refunded", refundId });
    }
    catch (err) {
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
        const { code = "", alertId = "" } = (req.body || {});
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
        const shipment = shipSnap.data();
        const alert = alertSnap.data();
        const isParty = actor.isAdmin ||
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
    }
    catch (err) {
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
        const patch = (req.body || {});
        const touchesLive = Boolean(patch.bachs?.liveSecretKey) ||
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
        const nextPub = JSON.parse(JSON.stringify(pub));
        const secWrites = {};
        const applySecret = (raw, encKey, section, maskKey) => {
            if (typeof raw !== "string" || !raw.trim())
                return;
            secWrites[encKey] = encryptSecret(raw.trim());
            const secObj = (nextPub[section].secrets || {});
            secObj[maskKey] = maskSecret(raw.trim(), actor.email);
            nextPub[section].secrets = secObj;
        };
        if (patch.bachs) {
            applySecret(patch.bachs.sandboxSecretKey, "bachsSandboxKey", "bachs", "sandboxSecretKey");
            applySecret(patch.bachs.liveSecretKey, "bachsLiveKey", "bachs", "liveSecretKey");
            applySecret(patch.bachs.sandboxWebhookSecret, "bachsSandboxWebhook", "bachs", "sandboxWebhookSecret");
            applySecret(patch.bachs.liveWebhookSecret, "bachsLiveWebhook", "bachs", "liveWebhookSecret");
            applySecret(patch.bachs.previousWebhookSecret, "bachsPreviousWebhook", "bachs", "previousWebhookSecret");
            if (patch.bachs.environment)
                nextPub.bachs.environment = patch.bachs.environment;
            if (typeof patch.bachs.sandboxProductId === "string")
                nextPub.bachs.sandboxProductId = patch.bachs.sandboxProductId.trim();
            if (typeof patch.bachs.liveProductId === "string")
                nextPub.bachs.liveProductId = patch.bachs.liveProductId.trim();
            if (typeof patch.bachs.organizationId === "string")
                nextPub.bachs.organizationId = patch.bachs.organizationId;
            if (typeof patch.bachs.defaultCurrency === "string")
                nextPub.bachs.defaultCurrency = patch.bachs.defaultCurrency;
            if (typeof patch.bachs.checkoutExpiryMinutes === "number")
                nextPub.bachs.checkoutExpiryMinutes = patch.bachs.checkoutExpiryMinutes;
        }
        if (patch.resend) {
            applySecret(patch.resend.apiKey, "resendApiKey", "resend", "apiKey");
            applySecret(patch.resend.inboundWebhookSecret, "resendInboundSecret", "resend", "inboundWebhookSecret");
            if (typeof patch.resend.from === "string")
                nextPub.resend.from = patch.resend.from;
            if (typeof patch.resend.replyTo === "string")
                nextPub.resend.replyTo = patch.resend.replyTo;
            if (typeof patch.resend.supportInbox === "string")
                nextPub.resend.supportInbox = patch.resend.supportInbox;
        }
        if (patch.stripe) {
            applySecret(patch.stripe.secretKey, "stripeSecretKey", "stripe", "secretKey");
            applySecret(patch.stripe.webhookSecret, "stripeWebhookSecret", "stripe", "webhookSecret");
            if (typeof patch.stripe.enabled === "boolean")
                nextPub.stripe.enabled = patch.stripe.enabled;
            if (typeof patch.stripe.publicKey === "string")
                nextPub.stripe.publicKey = patch.stripe.publicKey;
        }
        if (patch.paystack) {
            applySecret(patch.paystack.secretKey, "paystackSecretKey", "paystack", "secretKey");
            applySecret(patch.paystack.webhookSecret, "paystackWebhookSecret", "paystack", "webhookSecret");
            if (typeof patch.paystack.enabled === "boolean")
                nextPub.paystack.enabled = patch.paystack.enabled;
            if (typeof patch.paystack.publicKey === "string")
                nextPub.paystack.publicKey = patch.paystack.publicKey;
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
            batch.set(database.collection("adminSecrets").doc("payments"), { ...secWrites, updatedAt: firestore_1.FieldValue.serverTimestamp(), updatedBy: actor.email }, { merge: true });
        }
        batch.set(database.collection("auditLogs").doc(), {
            actorUid: actor.uid,
            actorEmail: actor.email,
            action: "update_settings",
            code: "",
            detail: "Updated encrypted settings from Admin Portal",
            createdAt: firestore_1.FieldValue.serverTimestamp(),
        });
        await batch.commit();
        bundleCache = null;
        res.json({ settings: nextPub });
    }
    catch (err) {
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
    const apiKey = settings.environment === "live"
        ? settings.sec.bachsLiveKey
        : settings.sec.bachsSandboxKey;
    if (!apiKey) {
        res.json({ ok: false, environment: settings.environment, error: "No key configured." });
        return;
    }
    const productId = settings.environment === "live" ? settings.liveProductId : settings.sandboxProductId;
    try {
        if (productId) {
            const prod = await bachsFetch(apiKey, settings.environment, `/v1/products/${encodeURIComponent(productId)}`);
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
    }
    catch (err) {
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
        const apiKey = settings.environment === "live"
            ? settings.sec.bachsLiveKey
            : settings.sec.bachsSandboxKey;
        const productId = settings.environment === "live" ? settings.liveProductId : settings.sandboxProductId;
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
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : "Test checkout failed." });
    }
});
app.post("/api/admin/settings/test-email", async (req, res) => {
    const actor = await verifyActor(req);
    if (!actor?.isAdmin) {
        res.status(actor ? 403 : 401).json({ error: "Admin required." });
        return;
    }
    const to = String(req.body?.to || actor.email).trim();
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
        const body = (req.body || {});
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
        const ticketCode = `TKT-${node_crypto_1.default.randomBytes(3).toString("hex").toUpperCase()}`;
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
            createdAt: firestore_1.FieldValue.serverTimestamp(),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        });
        batch.set(threadRef.collection("messages").doc(), {
            from: "user",
            senderName: name,
            senderEmail: email,
            body: message,
            source: "web",
            ts: now,
            createdAt: firestore_1.FieldValue.serverTimestamp(),
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
    }
    catch (err) {
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
        const body = (req.body || {});
        const threadId = String(body.threadId || "");
        const message = String(body.message || "").trim();
        const database = db();
        const threadRef = database.collection("supportThreads").doc(threadId);
        const snap = await threadRef.get();
        if (!snap.exists) {
            res.status(404).json({ error: "Thread not found." });
            return;
        }
        const thread = snap.data();
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
                createdAt: firestore_1.FieldValue.serverTimestamp(),
            });
        }
        await threadRef.update({
            status: actor.isAdmin && body.status ? body.status : "open",
            unreadAdmin: !actor.isAdmin,
            unreadUser: actor.isAdmin,
            ...(message ? { lastMessageAt: now, lastMessagePreview: message.slice(0, 140) } : {}),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
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
                code: thread.code || null,
            });
        }
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : "Failed" });
    }
});
app.post("/api/inbound-email", async (req, res) => {
    try {
        const payload = (req.body || {});
        const inner = payload.data || payload;
        const fromRaw = String(inner.from || payload.from || "");
        const m = fromRaw.match(/<([^>]+)>/);
        const fromEmail = (m ? m[1] : fromRaw).trim().toLowerCase();
        const subject = String(inner.subject || payload.subject || "Email enquiry");
        const bodyText = String(inner.text || inner.html || "(Empty email)")
            .replace(/<[^>]+>/g, " ")
            .trim()
            .slice(0, 4000);
        if (!fromEmail.includes("@")) {
            res.json({ ok: true, ignored: true });
            return;
        }
        const database = db();
        const tkt = subject.match(/\[(TKT-[A-Z0-9]+)\]/i)?.[1]?.toUpperCase();
        let ref = null;
        if (tkt) {
            const q = await database
                .collection("supportThreads")
                .where("ticketCode", "==", tkt)
                .limit(1)
                .get();
            if (!q.empty)
                ref = q.docs[0].ref;
        }
        const now = Date.now();
        const ticketCode = tkt || `TKT-${node_crypto_1.default.randomBytes(3).toString("hex").toUpperCase()}`;
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
                createdAt: firestore_1.FieldValue.serverTimestamp(),
                updatedAt: firestore_1.FieldValue.serverTimestamp(),
            });
        }
        else {
            await ref.update({
                status: "open",
                unreadAdmin: true,
                lastMessageAt: now,
                lastMessagePreview: bodyText.slice(0, 140),
                updatedAt: firestore_1.FieldValue.serverTimestamp(),
            });
        }
        await ref.collection("messages").add({
            from: "user",
            senderName: fromEmail.split("@")[0],
            senderEmail: fromEmail,
            body: bodyText,
            source: "email",
            ts: now,
            createdAt: firestore_1.FieldValue.serverTimestamp(),
        });
        res.json({ ok: true, threadId: ref.id, ticketCode });
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : "Inbound failed" });
    }
});
app.post("/api/resend-webhook", async (req, res) => {
    try {
        const payload = (req.body || {});
        const emailId = String(payload.data?.email_id || "");
        const nextStatus = payload.type === "email.delivered"
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
    }
    catch {
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
        const body = (req.body || {});
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
        const alert = alertSnap.data();
        const pay = (alert.payment || {});
        if (pay.status !== "paid" || !pay.paymentId) {
            res.status(400).json({ error: "Only paid charges with a paymentId can be refunded." });
            return;
        }
        const settings = await loadSettings();
        const env = pay.environment || settings.environment;
        const apiKey = env === "live" ? settings.sec.bachsLiveKey : settings.sec.bachsSandboxKey;
        const rJson = await bachsFetch(apiKey, env, "/v1/refunds", {
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
    }
    catch (err) {
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
        const b = (req.body || {});
        const code = String(b.code || "").trim().toUpperCase();
        const receiverEmail = String(b.receiverEmail || "").trim().toLowerCase();
        if (!CODE_RE.test(code) || !receiverEmail.includes("@")) {
            res.status(400).json({ error: "Valid code and receiverEmail required." });
            return;
        }
        const tokenPayload = Buffer.from(JSON.stringify({ code, receiverEmail, exp: Date.now() + 14 * 86400000 })).toString("base64url");
        const sig = node_crypto_1.default
            .createHmac("sha256", process.env.SETTINGS_ENCRYPTION_KEY || "shipwell-invite")
            .update(tokenPayload)
            .digest("base64url");
        const token = `${tokenPayload}.${sig}`;
        const tokenHash = node_crypto_1.default.createHash("sha256").update(token).digest("hex");
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
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : "Invite failed." });
    }
});
app.post("/api/invites/verify", (req, res) => {
    try {
        const token = String(req.body?.token || "");
        const [payload] = token.split(".");
        const parsed = JSON.parse(Buffer.from(payload || "", "base64url").toString("utf8"));
        const expired = Boolean(parsed.exp && Date.now() > parsed.exp);
        res.json({
            valid: Boolean(parsed.code && !expired),
            expired,
            code: parsed.code,
            receiverEmail: parsed.receiverEmail,
            tokenHash: node_crypto_1.default.createHash("sha256").update(token).digest("hex"),
        });
    }
    catch {
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
        const b = (req.body || {});
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
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : "Notify failed." });
    }
});
app.post("/api/leads/notify", async (req, res) => {
    try {
        const b = (req.body || {});
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
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : "Lead notify failed." });
    }
});
exports.api = (0, https_1.onRequest)({
    region: "us-central1",
    cors: true,
    secrets: ["SETTINGS_ENCRYPTION_KEY"],
}, app);
exports.onShipmentEventCreated = (0, firestore_2.onDocumentCreated)({
    document: "shipments/{code}/events/{eventId}",
    region: "us-central1",
    secrets: ["SETTINGS_ENCRYPTION_KEY"],
}, async (event) => {
    const ev = event.data?.data();
    if (!ev)
        return;
    if (ev.kind !== "scan" && ev.kind !== "delay")
        return;
    const { code, eventId } = event.params;
    const shipSnap = await db().collection("shipments").doc(code).get();
    if (!shipSnap.exists)
        return;
    const shipment = shipSnap.data();
    if (shipment.bookingStatus === "awaiting_payment" || shipment.paymentStatus === "awaiting_payment") {
        return;
    }
    const recipients = new Set([String(shipment.receiverEmail || ""), String(shipment.senderEmail || "")].filter((e) => e.includes("@")));
    for (const email of recipients) {
        await sendResendEmail({
            to: email,
            subject: ev.kind === "delay"
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
});
exports.onShipmentWritten = (0, firestore_2.onDocumentWritten)({
    document: "shipments/{code}",
    region: "us-central1",
    secrets: ["SETTINGS_ENCRYPTION_KEY"],
}, async (event) => {
    const after = event.data?.after.data();
    if (!after)
        return;
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
});
exports.onShipmentAlertCreated = (0, firestore_2.onDocumentCreated)({
    document: "shipments/{code}/alerts/{alertId}",
    region: "us-central1",
    secrets: ["SETTINGS_ENCRYPTION_KEY"],
}, async (event) => {
    const alert = event.data?.data();
    if (!alert)
        return;
    const { code, alertId } = event.params;
    const shipSnap = await db().collection("shipments").doc(code).get();
    if (!shipSnap.exists)
        return;
    const shipment = shipSnap.data();
    const toEmail = alert.to === "sender"
        ? String(shipment.senderEmail || "")
        : String(shipment.receiverEmail || "");
    if (!toEmail)
        return;
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
});
//# sourceMappingURL=index.js.map