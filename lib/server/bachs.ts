import crypto from "node:crypto";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import {
  ADMIN_EMAIL,
  formatUsd,
  generateTrackingCode,
  isValidTrackingCode,
  normalizeEmail,
  type BookingPaymentChannel,
  type BookingRecord,
  type CustomsPaymentEvent,
  type CustomsPaymentInfo,
  type GatewayId,
  type ManualPaymentRecord,
  type PaymentMethodRecord,
  type ServiceTier,
  type ShipmentAlert,
  type ShipmentRecord,
} from "../../types/tracking.ts";
import { createSignedInviteToken } from "../invites.ts";
import { calculateMethodAmounts, DEFAULT_PAYMENT_METHODS } from "../payment-methods.ts";
import {
  COUNTRIES,
  addBusinessDays,
  calculateShippingPricing,
  formatMoney,
} from "../quote-engine.ts";
import { dispatchTransactionalEmail } from "../email/sender.ts";
import {
  buildChargePaidEmail,
  buildHoldReleasedEmail,
  buildReceiverInviteEmail,
  buildReceiverOnItsWayEmail,
  buildSenderBookingEmail,
} from "../email/templates.ts";
import { logServerError } from "./error-log.ts";
import {
  AdminSdkUnavailableError,
  getAdminAuth,
  getAdminDb,
  isAdminIamError,
  type VerifiedServerUser,
} from "./firebase-admin.ts";
import {
  createManualPaymentRecord,
  listAllPaymentMethodsServer,
} from "./payment-methods.ts";
import { loadSettingsBundle } from "./settings-store.ts";

function getActiveBachsApiKey(
  env: "sandbox" | "live",
  secrets: { bachsSandboxKey: string; bachsLiveKey: string }
): string {
  return env === "live" ? secrets.bachsLiveKey : secrets.bachsSandboxKey;
}

function getBachsBaseUrl(env: "sandbox" | "live"): string {
  return env === "live" ? "https://api.bachs.io" : "https://sandbox-api.bachs.io";
}

function getActiveBachsProductId(
  env: "sandbox" | "live",
  bachsSettings: { sandboxProductId?: string; liveProductId?: string }
): string {
  return String(
    env === "live" ? bachsSettings.liveProductId || "" : bachsSettings.sandboxProductId || ""
  ).trim();
}

interface BachsErrorBody {
  detail?: unknown;
  error_code?: string;
  errors?: unknown;
  message?: string;
  error?: { message?: string };
}

async function bachsFetch<T>(
  apiKey: string,
  env: "sandbox" | "live",
  apiPath: string,
  init: {
    method?: string;
    body?: Record<string, unknown>;
    idempotencyKey?: string;
  } = {}
): Promise<T> {
  const url = `${getBachsBaseUrl(env)}${apiPath}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (init.idempotencyKey) {
    headers["Idempotency-Key"] = init.idempotencyKey;
  }

  const res = await fetch(url, {
    method: init.method || "GET",
    headers,
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });

  const text = await res.text();
  let json: BachsErrorBody & T = {} as BachsErrorBody & T;
  try {
    if (text) json = JSON.parse(text) as BachsErrorBody & T;
  } catch {
    // non-JSON response
  }

  if (!res.ok) {
    const detail =
      typeof json.detail === "string"
        ? json.detail
        : json.detail
          ? JSON.stringify(json.detail)
          : json.message || json.error?.message || `Bachs API HTTP ${res.status}`;
    console.error("[Bachs API Error]", {
      path: apiPath,
      status: res.status,
      error_code: json.error_code,
      detail,
    });
    const err = new Error(detail) as Error & {
      status?: number;
      errorCode?: string;
      errors?: unknown;
    };
    err.status = res.status >= 400 && res.status < 500 ? 400 : 502;
    err.errorCode = json.error_code;
    err.errors = json.errors;
    throw err;
  }

  return json;
}

interface BachsSessionResponse {
  checkout_id?: string;
  id?: string;
  checkout_url?: string;
  url?: string;
  reference?: string;
  expires_at?: string;
  amount?: string | number;
  amount_total?: string | number;
  currency?: string;
  status?: string;
}

export async function createBachsCheckoutSession(params: {
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
}): Promise<{
  checkoutId: string;
  checkoutUrl: string;
  reference: string;
  expiresAt: number;
}> {
  if (!params.productId) {
    throw new Error(
      `No Bachs ${params.env} product ID saved. Create a pay-what-you-want product in your Bachs dashboard and paste its product_id in Admin → Settings → Bachs.`
    );
  }

  const basePayload = {
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

  let created: BachsSessionResponse;
  try {
    created = await bachsFetch<BachsSessionResponse>(
      params.apiKey,
      params.env,
      "/v1/checkout-sessions",
      {
        method: "POST",
        body: { ...basePayload, return_url: params.returnUrl },
        idempotencyKey: params.idempotencyKey,
      }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (/return_url/i.test(msg)) {
      created = await bachsFetch<BachsSessionResponse>(
        params.apiKey,
        params.env,
        "/v1/checkout-sessions",
        {
          method: "POST",
          body: { ...basePayload, success_url: params.returnUrl },
          idempotencyKey: `${params.idempotencyKey}_s`,
        }
      );
    } else {
      throw err;
    }
  }

  const checkoutId = String(created.checkout_id || created.id || "").trim();
  const checkoutUrl = String(created.checkout_url || created.url || "").trim();
  if (!checkoutUrl) {
    throw new Error("Bachs did not return a checkout URL.");
  }

  return {
    checkoutId: checkoutId || params.reference,
    checkoutUrl,
    reference: String(created.reference || params.reference),
    expiresAt:
      Date.parse(String(created.expires_at || "")) ||
      Date.now() + (params.expiresInMinutes || 60) * 60000,
  };
}

function headerString(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string | null {
  const target = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() !== target) continue;
    if (Array.isArray(v)) {
      if (v.length !== 1) return null;
      return String(v[0] || "").trim() || null;
    }
    return typeof v === "string" && v.trim() ? v.trim() : null;
  }
  return null;
}

function extractHexCandidates(sigHeader: string): string[] {
  const out: string[] = [];
  for (const part of sigHeader.split(",")) {
    const cleaned = part.trim();
    if (!cleaned) continue;
    const eqIdx = cleaned.indexOf("=");
    const hex = (eqIdx >= 0 ? cleaned.slice(eqIdx + 1) : cleaned).trim().toLowerCase();
    if (/^[a-f0-9]{64}$/.test(hex)) {
      out.push(hex);
    }
  }
  return out;
}

export interface VerifiedBachsWebhookEvent {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

export function verifyBachsWebhookSignature(
  rawBody: Buffer | string,
  headers: Record<string, string | string[] | undefined>,
  candidateSecrets: string[]
): VerifiedBachsWebhookEvent {
  const tsHeader = headerString(headers, "x-bachs-timestamp");
  const sigV1 = headerString(headers, "x-bachs-signature");
  const sigV2 = headerString(headers, "x-bachs-signature-v2");

  if (!tsHeader || (!sigV1 && !sigV2)) {
    throw Object.assign(new Error("Missing Bachs webhook timestamp or signature header"), {
      status: 400,
    });
  }

  const tsNum = Number(tsHeader);
  if (!Number.isFinite(tsNum) || tsNum <= 0) {
    throw Object.assign(new Error("Invalid Bachs webhook timestamp header"), {
      status: 400,
    });
  }
  const tsSec = tsNum > 1e12 ? Math.floor(tsNum / 1000) : Math.floor(tsNum);
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - tsSec) > 300) {
    throw Object.assign(new Error("Bachs webhook timestamp expired (> 300s)"), {
      status: 400,
    });
  }

  const rawText = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody || "");
  const signedPayload = `${tsHeader}.${rawText}`;
  const providedDigests = [
    ...(sigV1 ? extractHexCandidates(sigV1) : []),
    ...(sigV2 ? extractHexCandidates(sigV2) : []),
  ];

  if (providedDigests.length === 0) {
    throw Object.assign(new Error("Malformed Bachs webhook signature"), {
      status: 400,
    });
  }

  let matched = false;
  for (const secret of candidateSecrets) {
    const cleanSecret = secret.trim();
    if (!cleanSecret) continue;
    const expectedHex = crypto
      .createHmac("sha256", cleanSecret)
      .update(signedPayload, "utf8")
      .digest("hex")
      .toLowerCase();
    const expectedBuf = Buffer.from(expectedHex, "hex");
    for (const digest of providedDigests) {
      const providedBuf = Buffer.from(digest, "hex");
      if (
        providedBuf.length === expectedBuf.length &&
        crypto.timingSafeEqual(providedBuf, expectedBuf)
      ) {
        matched = true;
        break;
      }
    }
    if (matched) break;
  }

  if (!matched) {
    throw Object.assign(new Error("Invalid Bachs webhook signature"), {
      status: 400,
    });
  }

  let parsed: { id?: string; type?: string; data?: Record<string, unknown> };
  try {
    parsed = JSON.parse(rawText) as {
      id?: string;
      type?: string;
      data?: Record<string, unknown>;
    };
  } catch {
    throw Object.assign(new Error("Invalid JSON webhook body"), { status: 400 });
  }

  const eventId = String(parsed.id || `evt_${crypto.createHash("sha256").update(rawText).digest("hex").slice(0, 24)}`);
  const eventType = String(parsed.type || "");
  if (!eventType) {
    throw Object.assign(new Error("Missing webhook event type"), { status: 400 });
  }

  return {
    id: eventId,
    type: eventType,
    data: parsed.data && typeof parsed.data === "object" ? parsed.data : {},
  };
}

async function resolveReceiverHasAccount(
  db: Firestore,
  receiverEmail: string
): Promise<boolean> {
  const cleanEmail = normalizeEmail(receiverEmail);
  if (!cleanEmail) return false;
  try {
    const emailHash = crypto.createHash("sha256").update(cleanEmail).digest("hex");
    const snap = await db.collection("accountStatus").doc(emailHash).get();
    if (snap.exists) return true;
  } catch {
    // ignore
  }
  try {
    await getAdminAuth().getUserByEmail(cleanEmail);
    return true;
  } catch {
    return false;
  }
}

export async function dispatchBookingConfirmationEmails(params: {
  db: Firestore;
  shipment: ShipmentRecord;
  baseUrl?: string;
  actorUid: string;
}): Promise<void> {
  const { db, shipment, baseUrl, actorUid } = params;
  const code = shipment.code;
  const receiverEmail = normalizeEmail(shipment.receiverEmail);
  const senderEmail = normalizeEmail(shipment.senderEmail);
  const etaLabel = addBusinessDaysLabel(shipment.eta);
  const totalFormatted = formatMoney(shipment.priceTotal || 0);
  const senderFullName = shipment.sender?.name || "A ShipWell sender";
  const receiverFullName = shipment.receiver?.name || "Recipient";
  const originCity = shipment.sender?.city || "Origin";
  const originCountry = shipment.sender?.country || "";
  const destCity = shipment.receiver?.city || "Destination";

  const hasAccount = await resolveReceiverHasAccount(db, receiverEmail);
  const receiverFirst = receiverFullName.split(/\s+/)[0] || "there";
  const { token, tokenHash } = createSignedInviteToken({
    code,
    receiverEmail,
    receiverFirstName: receiverFirst,
    senderFullName,
  });

  // 1. Receiver invite / on-its-way email (deduped)
  if (receiverEmail.includes("@")) {
    const dedupRef = db.collection("emailDedup").doc(`booking_rx_${code}`);
    const alreadySent = await db
      .runTransaction(async (tx) => {
        const snap = await tx.get(dedupRef);
        if (snap.exists) return true;
        tx.set(dedupRef, {
          to: receiverEmail,
          code,
          createdAt: FieldValue.serverTimestamp(),
        });
        return false;
      })
      .catch(() => false);

    if (!alreadySent) {
      const payload = hasAccount
        ? buildReceiverOnItsWayEmail({
            baseUrl,
            trackingCode: code,
            senderFullName,
            receiverFullName,
            receiverEmail,
            contents: shipment.contents || "Parcel",
            originCity,
            originCountry,
            etaLabel,
            inviteToken: token,
          })
        : buildReceiverInviteEmail({
            baseUrl,
            trackingCode: code,
            senderFullName,
            receiverFullName,
            receiverEmail,
            contents: shipment.contents || "Parcel",
            originCity,
            originCountry,
            etaLabel,
            inviteToken: token,
          });

      const res = await dispatchTransactionalEmail(receiverEmail, payload, {
        template: hasAccount ? "on_its_way" : "invite",
        category: "tracking",
        prefKey: "onway",
        code,
        createdBy: actorUid,
      });

      await db
        .collection("shipments")
        .doc(code)
        .collection("invites")
        .add({
          tokenHash,
          receiverEmail,
          template: hasAccount ? "on_its_way" : "invite",
          status: res.status === "queued_preview" ? "queued_preview" : "sent",
          emailCount: 1,
          sentAt: Date.now(),
          openedAt: null,
          completedAt: null,
          createdBy: actorUid,
          createdAt: FieldValue.serverTimestamp(),
        })
        .catch(() => null);
    }
  }

  // 2. Sender booking receipt (deduped)
  if (senderEmail.includes("@")) {
    const dedupRef = db.collection("emailDedup").doc(`booking_tx_${code}`);
    const alreadySent = await db
      .runTransaction(async (tx) => {
        const snap = await tx.get(dedupRef);
        if (snap.exists) return true;
        tx.set(dedupRef, {
          to: senderEmail,
          code,
          createdAt: FieldValue.serverTimestamp(),
        });
        return false;
      })
      .catch(() => false);

    if (!alreadySent) {
      const payload = buildSenderBookingEmail({
        baseUrl,
        trackingCode: code,
        senderFullName,
        receiverFullName,
        receiverEmail,
        routeLabel: `${originCity} → ${destCity}`,
        etaLabel,
        totalFormatted,
      });
      await dispatchTransactionalEmail(senderEmail, payload, {
        template: "sender_booking",
        category: "billing",
        code,
        createdBy: actorUid,
      });
    }
  }
}

function addBusinessDaysLabel(etaMs: number): string {
  return new Date(Number(etaMs || Date.now())).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export async function reconcileShipmentHoldAfterResolution(
  db: Firestore,
  code: string,
  opts: {
    actorLabel: string;
    baseUrl?: string;
    resolvedAlertId?: string;
  }
): Promise<{ holdReleased: boolean; remainingCount: number }> {
  const shipRef = db.collection("shipments").doc(code);
  const teaserRef = db.collection("trackingTeasers").doc(code);
  const shipSnap = await shipRef.get();
  if (!shipSnap.exists) {
    return { holdReleased: false, remainingCount: 0 };
  }
  const shipment = shipSnap.data() as ShipmentRecord;
  const alertsSnap = await shipRef
    .collection("alerts")
    .where("status", "==", "open")
    .get();

  const remainingHoldAlerts = alertsSnap.docs.filter((d) => {
    if (opts.resolvedAlertId && d.id === opts.resolvedAlertId) return false;
    const data = d.data() as Partial<ShipmentAlert>;
    return (
      data.holdShipment === true ||
      data.kind === "duty" ||
      !shipment.hold?.alertId ||
      shipment.hold?.alertId === d.id
    );
  });

  const remainingCount = alertsSnap.docs.filter(
    (d) => !opts.resolvedAlertId || d.id !== opts.resolvedAlertId
  ).length;

  if (remainingHoldAlerts.length > 0) {
    const now = Date.now();
    const first = remainingHoldAlerts[0].data() as Partial<ShipmentAlert>;
    const note = `Payment or response recorded; ${remainingHoldAlerts.length} pending item(s) still require action (${first.title || "clearance hold"}).`;
    const evRef = shipRef.collection("events").doc();
    const batch = db.batch();
    batch.set(evRef, {
      stage: shipment.status,
      label: "Still on hold",
      loc: shipment.nextStop?.loc || `${shipment.receiver?.city || "Destination"} Customs`,
      note,
      kind: "info",
      ts: now,
      createdBy: opts.actorLabel,
      createdAt: FieldValue.serverTimestamp(),
    });
    batch.update(teaserRef, {
      latestEvent: {
        label: "Still on hold",
        loc: shipment.nextStop?.loc || shipment.receiver?.city || "Customs",
        ts: now,
      },
      updatedAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();
    return { holdReleased: false, remainingCount };
  }

  if (!shipment.hold) {
    return { holdReleased: false, remainingCount: 0 };
  }

  const now = Date.now();
  const evRef = shipRef.collection("events").doc();
  const loc =
    shipment.nextStop?.loc || `${shipment.receiver?.city || "Destination"} Hub`;
  const batch = db.batch();
  batch.update(shipRef, {
    hold: null,
    updatedAt: FieldValue.serverTimestamp(),
  });
  batch.update(teaserRef, {
    holdType: null,
    latestEvent: {
      label: "Hold released",
      loc,
      ts: now,
    },
    updatedAt: FieldValue.serverTimestamp(),
  });
  batch.set(evRef, {
    stage: shipment.status,
    label: "Hold released",
    loc,
    note: `All required holds and charges settled (${opts.actorLabel}).`,
    kind: "info",
    ts: now,
    createdBy: opts.actorLabel,
    createdAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();

  const { publicSettings } = await loadSettingsBundle();
  const etaLabel = addBusinessDaysLabel(shipment.eta);

  const recipients = new Set<string>();
  if (shipment.receiverEmail) {
    recipients.add(shipment.receiverEmail.toLowerCase());
    await dispatchTransactionalEmail(
      shipment.receiverEmail,
      buildHoldReleasedEmail({
        baseUrl: opts.baseUrl,
        trackingCode: code,
        recipientName: shipment.receiver?.name || "Recipient",
        etaLabel,
      }),
      {
        template: "hold_released",
        category: "tracking",
        prefKey: "action",
        code,
        createdBy: opts.actorLabel,
      }
    );
  }
  if (
    shipment.senderEmail &&
    !recipients.has(shipment.senderEmail.toLowerCase())
  ) {
    recipients.add(shipment.senderEmail.toLowerCase());
    await dispatchTransactionalEmail(
      shipment.senderEmail,
      buildHoldReleasedEmail({
        baseUrl: opts.baseUrl,
        trackingCode: code,
        recipientName: shipment.sender?.name || "Sender",
        etaLabel,
      }),
      {
        template: "hold_released",
        category: "tracking",
        prefKey: "action",
        code,
        createdBy: opts.actorLabel,
      }
    );
  }
  if (
    publicSettings.resend.supportInbox &&
    !recipients.has(publicSettings.resend.supportInbox.toLowerCase())
  ) {
    await dispatchTransactionalEmail(
      publicSettings.resend.supportInbox,
      buildHoldReleasedEmail({
        baseUrl: opts.baseUrl,
        trackingCode: code,
        recipientName: "ShipWell Support",
        etaLabel,
      }),
      {
        template: "hold_released_ops",
        category: "notifications",
        code,
        createdBy: opts.actorLabel,
      }
    );
  }

  return { holdReleased: true, remainingCount: 0 };
}

export async function createCustomsCheckout(params: {
  code: string;
  alertId: string;
  actor: VerifiedServerUser;
  origin: string;
  gateway?: GatewayId;
  paymentMethodId?: string;
}): Promise<{
  checkoutUrl: string;
  checkoutId: string;
  reference: string;
  provider: GatewayId | "manual";
  environment: "sandbox" | "live";
  manualPayment?: ManualPaymentRecord;
}> {
  const code = String(params.code || "").trim().toUpperCase();
  const alertId = String(params.alertId || "").trim();
  if (!isValidTrackingCode(code) || !alertId) {
    throw new Error("Valid tracking code and charge ID are required.");
  }

  let db: Firestore;
  try {
    db = getAdminDb();
  } catch (err) {
    if (isAdminIamError(err)) {
      throw new AdminSdkUnavailableError(
        "Customs checkout creation requires Firebase Admin SDK credentials on your Blaze project."
      );
    }
    throw err;
  }

  let shipSnap;
  let alertSnap;
  try {
    const shipRef = db.collection("shipments").doc(code);
    [shipSnap, alertSnap] = await Promise.all([
      shipRef.get(),
      shipRef.collection("alerts").doc(alertId).get(),
    ]);
  } catch (err) {
    if (isAdminIamError(err)) {
      throw new AdminSdkUnavailableError(
        "Customs checkout requires Firebase Admin SDK access on your Blaze project."
      );
    }
    throw err;
  }

  if (!shipSnap.exists || !alertSnap.exists) {
    throw new Error("Shipment or customs charge record not found.");
  }

  const shipment = shipSnap.data() as ShipmentRecord;
  const alert = alertSnap.data() as ShipmentAlert;

  const isParty =
    params.actor.isAdmin ||
    shipment.senderId === params.actor.uid ||
    (params.actor.emailVerified &&
      shipment.receiverEmail === params.actor.email.toLowerCase());

  if (!isParty) {
    throw new Error("You are not authorized to pay charges on this shipment.");
  }
  if (alert.status === "resolved" || alert.payment?.status === "paid") {
    throw new Error("This charge has already been paid.");
  }

  const amount = Number(alert.amount || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Charge amount must be greater than zero.");
  }

  const { publicSettings, secrets } = await loadSettingsBundle();
  const currency = (
    alert.currency ||
    publicSettings.bachs.defaultCurrency ||
    "USD"
  ).toUpperCase();

  const chosenGateway: GatewayId =
    params.gateway === "stripe" &&
    publicSettings.stripe.enabled &&
    Boolean(secrets.stripeSecretKey)
      ? "stripe"
      : params.gateway === "paystack" &&
          publicSettings.paystack.enabled &&
          Boolean(secrets.paystackSecretKey)
        ? "paystack"
        : publicSettings.routing.primaryGateway === "stripe" &&
            publicSettings.stripe.enabled &&
            Boolean(secrets.stripeSecretKey) &&
            !params.gateway
          ? "stripe"
          : publicSettings.routing.primaryGateway === "paystack" &&
              publicSettings.paystack.enabled &&
              Boolean(secrets.paystackSecretKey) &&
              !params.gateway
            ? "paystack"
            : "bachs";

  const baseOrigin = params.origin.replace(/\/+$/, "");
  const returnUrl = `${baseOrigin}/dashboard/track/${encodeURIComponent(
    code
  )}?paid=1&alertId=${encodeURIComponent(alertId)}`;
  const cancelUrl = `${baseOrigin}/dashboard/track/${encodeURIComponent(
    code
  )}?cancelled=1&alertId=${encodeURIComponent(alertId)}`;

  const reference = `chg_${code}_${alertId}`.slice(0, 128);

  const payerEmail =
    params.actor.email ||
    shipment.receiverEmail ||
    shipment.senderEmail ||
    "customer@shipwell.cc";
  const payerName =
    alert.to === "sender"
      ? shipment.sender?.name || "ShipWell Sender"
      : shipment.receiver?.name || "ShipWell Customer";

  // Check if customer selected a manual payment method configured by Admin
  if (params.paymentMethodId) {
    const allMethods = await listAllPaymentMethodsServer();
    const chosenMethod = allMethods.find((m) => m.id === params.paymentMethodId);
    if (!chosenMethod || !chosenMethod.enabled) {
      throw Object.assign(new Error("Selected payment method is not available."), {
        status: 400,
      });
    }
    if (chosenMethod.type === "cash") {
      throw Object.assign(
        new Error("Pay on delivery cannot be used for customs clearance holds."),
        { status: 400 }
      );
    }
    if (chosenMethod.type !== "automatic") {
      const manualPayment = await createManualPaymentRecord({
        db,
        kind: "customs",
        trackingCode: code,
        alertId,
        actor: params.actor,
        userEmail: payerEmail,
        userName: payerName,
        baseUsd: amount,
        method: chosenMethod,
        baseUrl: baseOrigin,
      });

      const paymentDoc: CustomsPaymentInfo = {
        provider: "manual",
        environment: publicSettings.bachs.environment,
        checkoutId: manualPayment.id,
        checkoutUrl: "",
        paymentId: manualPayment.id,
        reference: manualPayment.reference,
        status: "pending",
        currency: manualPayment.currency,
        expiresAt: manualPayment.expiresAt,
        events: [
          ...(Array.isArray(alert.payment?.events) ? alert.payment.events : []),
          {
            type: "manual.payment.created",
            at: Date.now(),
            detail: `${chosenMethod.name} · ${manualPayment.reference}`,
          },
        ],
      };
      await alertSnap.ref.update({ payment: paymentDoc });
      return {
        checkoutUrl: "",
        checkoutId: manualPayment.id,
        reference: manualPayment.reference,
        provider: "manual",
        environment: publicSettings.bachs.environment,
        manualPayment,
      };
    }
  }

  if (chosenGateway === "stripe") {
    const bodyParams = new URLSearchParams({
      mode: "payment",
      success_url: returnUrl,
      cancel_url: cancelUrl,
      customer_email: payerEmail,
      "line_items[0][price_data][currency]": currency.toLowerCase(),
      "line_items[0][price_data][product_data][name]": `${
        alert.chargeType || alert.title
      } · ${code}`,
      "line_items[0][price_data][unit_amount]": String(Math.round(amount * 100)),
      "line_items[0][quantity]": "1",
      "metadata[trackingCode]": code,
      "metadata[alertId]": alertId,
      "metadata[reference]": reference,
    });
    const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secrets.stripeSecretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: bodyParams.toString(),
    });
    const stripeJson = (await stripeRes.json()) as {
      id?: string;
      url?: string;
      error?: { message?: string };
    };
    if (!stripeRes.ok || !stripeJson.url || !stripeJson.id) {
      throw new Error(
        stripeJson.error?.message || "Stripe checkout creation failed."
      );
    }
    const paymentDoc: CustomsPaymentInfo = {
      provider: "stripe",
      environment: publicSettings.stripe.publicKey.startsWith("pk_live_")
        ? "live"
        : "sandbox",
      checkoutId: stripeJson.id,
      checkoutUrl: stripeJson.url,
      reference,
      status: "pending",
      currency,
      expiresAt: Date.now() + 60 * 60 * 1000,
      events: [
        ...(alert.payment?.events || []),
        { type: "stripe.checkout.created", at: Date.now(), detail: reference },
      ],
    };
    await alertSnap.ref.update({ payment: paymentDoc });
    return {
      checkoutUrl: stripeJson.url,
      checkoutId: stripeJson.id,
      reference,
      provider: "stripe",
      environment: paymentDoc.environment,
    };
  }

  if (chosenGateway === "paystack") {
    const paystackRes = await fetch(
      "https://api.paystack.co/transaction/initialize",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secrets.paystackSecretKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: payerEmail,
          amount: Math.round(amount * 100),
          currency,
          reference: `${reference}_${Date.now().toString(36)}`,
          callback_url: returnUrl,
          metadata: {
            trackingCode: code,
            alertId,
            chargeType: alert.chargeType || alert.title,
          },
        }),
      }
    );
    const paystackJson = (await paystackRes.json()) as {
      status?: boolean;
      message?: string;
      data?: { authorization_url?: string; reference?: string };
    };
    if (
      !paystackRes.ok ||
      !paystackJson.status ||
      !paystackJson.data?.authorization_url
    ) {
      throw new Error(
        paystackJson.message || "Paystack checkout initialization failed."
      );
    }
    const paymentDoc: CustomsPaymentInfo = {
      provider: "paystack",
      environment: secrets.paystackSecretKey.startsWith("sk_live_")
        ? "live"
        : "sandbox",
      checkoutId: paystackJson.data.reference || reference,
      checkoutUrl: paystackJson.data.authorization_url,
      reference: paystackJson.data.reference || reference,
      status: "pending",
      currency,
      expiresAt: Date.now() + 60 * 60 * 1000,
      events: [
        ...(alert.payment?.events || []),
        { type: "paystack.checkout.created", at: Date.now(), detail: reference },
      ],
    };
    await alertSnap.ref.update({ payment: paymentDoc });
    return {
      checkoutUrl: paystackJson.data.authorization_url,
      checkoutId: paymentDoc.checkoutId || reference,
      reference: paymentDoc.reference || reference,
      provider: "paystack",
      environment: paymentDoc.environment,
    };
  }

  const env = publicSettings.bachs.environment;
  const apiKey = getActiveBachsApiKey(env, secrets);
  if (!apiKey) {
    throw new Error(
      `Bachs ${env} secret key is not configured yet. Save it in Admin → Settings → Bachs.`
    );
  }
  const productId = getActiveBachsProductId(env, publicSettings.bachs);
  const idempotencyKey = `cust_${code}_${alertId}_${Date.now()}`;

  const created = await createBachsCheckoutSession({
    apiKey,
    env,
    productId,
    amount,
    customerEmail: payerEmail,
    customerName: payerName,
    returnUrl,
    cancelUrl,
    reference,
    metadata: {
      kind: "customs",
      trackingCode: code,
      alertId,
      chargeType: String(alert.chargeType || alert.title || "Customs charge"),
      uid: params.actor.uid,
    },
    expiresInMinutes: publicSettings.bachs.checkoutExpiryMinutes || 60,
    idempotencyKey,
  });

  const prevEvents: CustomsPaymentEvent[] = Array.isArray(alert.payment?.events)
    ? alert.payment.events
    : [];
  const paymentDoc: CustomsPaymentInfo = {
    provider: "bachs",
    environment: env,
    checkoutId: created.checkoutId,
    checkoutUrl: created.checkoutUrl,
    reference: created.reference,
    status: "pending",
    currency,
    expiresAt: created.expiresAt,
    events: [
      ...prevEvents,
      {
        type: "checkout.created",
        at: Date.now(),
        detail: `${env} checkout ${created.checkoutId}`,
      },
    ],
  };

  await alertSnap.ref.update({ payment: paymentDoc });

  return {
    checkoutUrl: created.checkoutUrl,
    checkoutId: created.checkoutId,
    reference: created.reference,
    provider: "bachs",
    environment: env,
  };
}

export async function getCheckoutOptions() {
  const { publicSettings, secrets } = await loadSettingsBundle();
  const env = publicSettings.bachs.environment;
  const apiKey = getActiveBachsApiKey(env, secrets);
  const productId = getActiveBachsProductId(env, publicSettings.bachs);
  return {
    ok: true,
    bachsEnabled: publicSettings.routing.enableBachsBooking !== false,
    bachsConfigured: Boolean(apiKey && productId),
    bachsProductConfigured: Boolean(productId),
    payOnPickupEnabled: publicSettings.routing.enablePayOnPickup !== false,
    environment: env,
    currency: publicSettings.bachs.defaultCurrency || "USD",
  };
}

export interface CreateBookingPartyInput {
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  postal?: string;
  country?: string;
}

export interface CreateBookingInput {
  code?: string;
  idempotencyKey?: string;
  embedded?: boolean;
  sender?: CreateBookingPartyInput;
  receiver?: CreateBookingPartyInput;
  senderName?: string;
  senderEmail?: string;
  senderPhone?: string;
  senderAddress?: string;
  senderCity?: string;
  senderPostal?: string;
  senderCountry?: string;
  receiverName?: string;
  receiverEmail?: string;
  receiverPhone?: string;
  receiverAddress?: string;
  receiverCity?: string;
  receiverPostal?: string;
  receiverCountry?: string;
  service?: ServiceTier;
  weightKg?: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  packageType?: string;
  contents?: string;
  declaredValue?: number;
  photos?: string[];
  paymentMethodId?: string;
  paymentMethod?: string;
  paymentChannel?: BookingPaymentChannel;
}

function isAcceptedPhotoUrl(val: unknown): val is string {
  if (typeof val !== "string") return false;
  const s = val.trim();
  if (!s) return false;
  if (/^https?:\/\//i.test(s)) return s.length <= 2048;
  if (/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(s)) {
    return s.length <= 345000;
  }
  return false;
}

export async function createServerBooking(params: {
  actor: VerifiedServerUser;
  body: CreateBookingInput;
  origin: string;
}): Promise<{
  ok: boolean;
  awaitingPayment: boolean;
  code: string;
  trackingCode: string;
  bookingId: string;
  status: string;
  total: number;
  totalUsd: number;
  feeAmount?: number;
  currency: string;
  convertedAmount?: number;
  paymentMethod: string;
  paymentMethodId?: string;
  paymentChannel: BookingPaymentChannel;
  paymentStatus: BookingRecord["paymentStatus"];
  checkoutUrl?: string | null;
  checkoutId?: string | null;
  shipment: ShipmentRecord;
  payment?: ManualPaymentRecord | null;
}> {
  const { actor, body, origin } = params;
  let db: Firestore;
  try {
    db = getAdminDb();
  } catch (err) {
    if (isAdminIamError(err)) {
      throw new AdminSdkUnavailableError(
        "Creating bookings requires Firebase Admin SDK access on your Blaze-plan project."
      );
    }
    throw err;
  }

  const rawIdem = String(body.idempotencyKey || "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 64);
  const bookingId =
    rawIdem.length >= 8 ? rawIdem : `bk_${crypto.randomBytes(8).toString("hex")}`;
  const bookingRef = db.collection("bookings").doc(bookingId);

  let existingBookingSnap;
  try {
    existingBookingSnap = await bookingRef.get();
  } catch (err) {
    if (isAdminIamError(err)) {
      throw new AdminSdkUnavailableError(
        "Creating bookings requires Firebase Admin SDK access on your Blaze-plan project."
      );
    }
    throw err;
  }

  // Return existing booking cleanly on duplicate request / double-click
  if (existingBookingSnap.exists) {
    const existing = existingBookingSnap.data() as BookingRecord;
    if (existing.uid !== actor.uid && !actor.isAdmin) {
      throw Object.assign(new Error("Booking reference mismatch."), { status: 403 });
    }
    const [existingShipSnap, existingPaySnap] = await Promise.all([
      db.collection("shipments").doc(existing.code).get().catch(() => null),
      existing.paymentId
        ? db.collection("payments").doc(existing.paymentId).get().catch(() => null)
        : Promise.resolve(null),
    ]);
    const existingShipment =
      existingShipSnap && existingShipSnap.exists
        ? (existingShipSnap.data() as ShipmentRecord)
        : ({
            code: existing.code,
            senderId: existing.uid,
            senderEmail: existing.senderEmail,
            receiverEmail: existing.receiverEmail,
            sender: {
              name: "Sender",
              email: existing.senderEmail,
              phone: "",
              address: "",
              city: "",
              postal: "",
              country: "",
            },
            receiver: {
              name: "Recipient",
              email: existing.receiverEmail,
              phone: "",
              address: "",
              city: "",
              postal: "",
              country: "",
            },
            service: existing.service,
            weightKg: existing.weightKg,
            packageType: "Parcel",
            contents: "Shipment",
            declaredValue: existing.declaredValue,
            priceTotal: existing.total,
            paymentMethod: existing.paymentMethod,
            bookingId: existing.id,
            paymentStatus: existing.paymentStatus,
            bookingStatus: existing.bookingStatus,
            status: "Booked",
            eta: Date.now() + 5 * 86400000,
            photos: [],
            hold: null,
            nextStop: null,
            review: { state: "pending", note: "" },
          } as ShipmentRecord);
    const existingPayment =
      existingPaySnap && existingPaySnap.exists
        ? (existingPaySnap.data() as ManualPaymentRecord)
        : null;
    const isPayLater = existing.paymentStatus === "pay_on_pickup";
    return {
      ok: true,
      awaitingPayment: !isPayLater && existing.paymentStatus === "awaiting_payment",
      code: existing.code,
      trackingCode: existing.code,
      bookingId: existing.id,
      status: existing.bookingStatus,
      total: existing.total,
      totalUsd: existing.total,
      feeAmount: existing.feeAmount || 0,
      currency: existing.currency,
      convertedAmount: existing.convertedAmount || existing.total,
      paymentMethod: existing.paymentMethod,
      paymentMethodId: existing.paymentMethodId,
      paymentChannel: existing.paymentChannel,
      paymentStatus: existing.paymentStatus,
      checkoutUrl: existing.checkoutUrl || null,
      checkoutId: existing.checkoutId || null,
      shipment: existingShipment,
      ...(existingPayment ? { payment: existingPayment } : {}),
    };
  }

  const sIn = body.sender || {};
  const rIn = body.receiver || {};

  const senderName = String(sIn.name ?? body.senderName ?? "").trim();
  const senderEmail = normalizeEmail(sIn.email ?? body.senderEmail ?? actor.email);
  const senderPhoneRaw = String(sIn.phone ?? body.senderPhone ?? "").trim();
  const senderAddress = String(sIn.address ?? body.senderAddress ?? "").trim();
  const senderCity = String(sIn.city ?? body.senderCity ?? "").trim();
  const senderPostal = String(sIn.postal ?? body.senderPostal ?? "").trim();
  const senderCountry = String(sIn.country ?? body.senderCountry ?? "").trim();

  const receiverName = String(rIn.name ?? body.receiverName ?? "").trim();
  const receiverEmail = normalizeEmail(rIn.email ?? body.receiverEmail ?? "");
  const receiverPhoneRaw = String(rIn.phone ?? body.receiverPhone ?? "").trim();
  const receiverAddress = String(rIn.address ?? body.receiverAddress ?? "").trim();
  const receiverCity = String(rIn.city ?? body.receiverCity ?? "").trim();
  const receiverPostal = String(rIn.postal ?? body.receiverPostal ?? "").trim();
  const receiverCountry = String(rIn.country ?? body.receiverCountry ?? "").trim();

  if (
    !senderName ||
    !senderEmail.includes("@") ||
    !senderAddress ||
    !senderCity ||
    !COUNTRIES.includes(senderCountry)
  ) {
    throw Object.assign(new Error("Please complete all required sender details."), {
      status: 400,
    });
  }
  if (
    !receiverName ||
    !receiverEmail.includes("@") ||
    !receiverAddress ||
    !receiverCity ||
    !COUNTRIES.includes(receiverCountry)
  ) {
    throw Object.assign(new Error("Please complete all required receiver details."), {
      status: 400,
    });
  }

  const parsedSenderPhone = parsePhoneNumberFromString(senderPhoneRaw);
  if (!parsedSenderPhone || !parsedSenderPhone.isValid()) {
    throw Object.assign(
      new Error("Enter a valid sender phone number with country code."),
      { status: 400 }
    );
  }
  const parsedReceiverPhone = parsePhoneNumberFromString(receiverPhoneRaw);
  if (!parsedReceiverPhone || !parsedReceiverPhone.isValid()) {
    throw Object.assign(
      new Error("Enter a valid receiver phone number with country code."),
      { status: 400 }
    );
  }

  const contents = String(body.contents || "").trim().slice(0, 240);
  const packageType = String(body.packageType || "Parcel").trim().slice(0, 60);
  const actualKg = Number(body.weightKg);
  const volKg =
    ((Number(body.lengthCm) || 0) *
      (Number(body.widthCm) || 0) *
      (Number(body.heightCm) || 0)) /
    5000;
  const weightKg = Math.max(actualKg || 0, volKg || 0);
  const declaredValue = Math.max(0, Number(body.declaredValue) || 0);
  const service: ServiceTier =
    body.service === "economy" ||
    body.service === "express" ||
    body.service === "standard"
      ? body.service
      : "standard";

  if (!contents || !Number.isFinite(actualKg) || actualKg < 0.1 || weightKg > 50000) {
    throw Object.assign(
      new Error("Enter valid parcel contents and weight (0.1–50,000 kg)."),
      { status: 400 }
    );
  }

  const photos = Array.isArray(body.photos)
    ? body.photos.filter(isAcceptedPhotoUrl).slice(0, 4)
    : [];
  if (photos.length === 0) {
    throw Object.assign(new Error("At least 1 uploaded item photo is required."), {
      status: 400,
    });
  }

  const [{ publicSettings, secrets }, allMethods] = await Promise.all([
    loadSettingsBundle(),
    listAllPaymentMethodsServer(),
  ]);

  const rawMethodId = String(body.paymentMethodId || "").trim();
  const rawMethod = String(body.paymentMethod || body.paymentChannel || "")
    .trim()
    .toLowerCase();

  let chosenMethod: PaymentMethodRecord | undefined = rawMethodId
    ? allMethods.find((m) => m.id === rawMethodId)
    : undefined;

  if (!chosenMethod) {
    const wantsPickup =
      rawMethod.includes("delivery") ||
      rawMethod.includes("pickup") ||
      rawMethod.includes("later") ||
      rawMethod === "cash";
    chosenMethod =
      allMethods.find((m) => (wantsPickup ? m.type === "cash" : m.type === "automatic")) ||
      DEFAULT_PAYMENT_METHODS.find((m) =>
        wantsPickup ? m.type === "cash" : m.type === "automatic"
      );
  }

  if (!chosenMethod || !chosenMethod.enabled) {
    throw Object.assign(
      new Error("The selected payment method is not currently available."),
      { status: 400 }
    );
  }

  if (chosenMethod.rules?.appliesTo === "customs") {
    throw Object.assign(
      new Error("This payment method is restricted to customs charges."),
      { status: 400 }
    );
  }

  const isCash = chosenMethod.type === "cash";
  const isAutomatic = chosenMethod.type === "automatic";
  const isManual = !isCash && !isAutomatic;

  if (isCash && publicSettings.routing.enablePayOnPickup === false) {
    throw Object.assign(
      new Error("Pay on delivery is currently disabled in store settings."),
      { status: 400 }
    );
  }
  if (isAutomatic && publicSettings.routing.enableBachsBooking === false) {
    throw Object.assign(
      new Error("Pay now via Bachs is currently disabled. Please choose another method."),
      { status: 400 }
    );
  }

  // Strictly calculate quote and method fee/discount + conversion on the server
  const quote = calculateShippingPricing(
    senderCountry,
    receiverCountry,
    weightKg,
    declaredValue,
    service
  );

  const minAmt = Number(chosenMethod.rules?.minAmount || 0);
  const maxAmt = Number(chosenMethod.rules?.maxAmount || 0);
  if (minAmt > 0 && quote.total < minAmt) {
    throw Object.assign(
      new Error(`${chosenMethod.name} requires a minimum amount of ${formatMoney(minAmt)}.`),
      { status: 400 }
    );
  }
  if (maxAmt > 0 && quote.total > maxAmt) {
    throw Object.assign(
      new Error(`${chosenMethod.name} is capped at ${formatMoney(maxAmt)}.`),
      { status: 400 }
    );
  }
  const allowedCountries = Array.isArray(chosenMethod.rules?.allowedCountries)
    ? chosenMethod.rules.allowedCountries.map((c) => c.trim().toLowerCase()).filter(Boolean)
    : [];
  if (
    allowedCountries.length > 0 &&
    !allowedCountries.includes(senderCountry.toLowerCase()) &&
    !allowedCountries.includes(receiverCountry.toLowerCase())
  ) {
    throw Object.assign(
      new Error(`${chosenMethod.name} is not enabled for this corridor.`),
      { status: 400 }
    );
  }

  const amounts = calculateMethodAmounts(quote.total, chosenMethod);
  const currency = amounts.currency || (publicSettings.bachs.defaultCurrency || "USD").toUpperCase();
  const env = publicSettings.bachs.environment;
  const now = Date.now();
  const eta = addBusinessDays(now, quote.days[1]).getTime();

  let code = generateTrackingCode();
  const candidateCode = String(body.code || "").trim().toUpperCase();
  if (isValidTrackingCode(candidateCode)) {
    try {
      const existingShip = await db.collection("shipments").doc(candidateCode).get();
      if (!existingShip.exists) {
        code = candidateCode;
      }
    } catch {
      // fall back to fresh generated code
    }
  }

  const reference = `booking_${bookingId}`;
  const baseOrigin = origin.replace(/\/+$/, "");

  const channel: BookingPaymentChannel = isCash
    ? "pay_on_pickup"
    : isManual
      ? "manual"
      : "pay_now";

  let checkoutId: string | null = null;
  let checkoutUrl: string | null = null;
  let checkoutExpiresAt: number | null = null;
  let manualPayment: ManualPaymentRecord | null = null;
  let paymentReference = reference;

  if (isAutomatic) {
    const apiKey = getActiveBachsApiKey(env, secrets);
    const productId = getActiveBachsProductId(env, publicSettings.bachs);
    if (!apiKey || !productId) {
      throw Object.assign(
        new Error(
          actor.isAdmin
            ? `Bachs is not configured: save your ${env} secret key and custom-amount product ID in Admin → Settings → Bachs.`
            : "Online checkout is temporarily unavailable. Please choose Pay on delivery or another enabled method."
        ),
        { status: 400 }
      );
    }

    const cancelPath = body.embedded ? "/dashboard/ship?cancelled=1" : "/ship?cancelled=1";
    const session = await createBachsCheckoutSession({
      apiKey,
      env,
      productId,
      amount: amounts.totalUsd,
      customerEmail: senderEmail,
      customerName: senderName,
      returnUrl: `${baseOrigin}/dashboard/track/${encodeURIComponent(code)}?paid=1&booking=1`,
      cancelUrl: `${baseOrigin}${cancelPath}`,
      reference,
      metadata: {
        kind: "booking",
        bookingId,
        trackingCode: code,
        uid: actor.uid,
        channel,
      },
      expiresInMinutes: chosenMethod.windowMinutes || publicSettings.bachs.checkoutExpiryMinutes || 60,
      idempotencyKey: `bk_${bookingId}`,
    });
    checkoutId = session.checkoutId;
    checkoutUrl = session.checkoutUrl;
    checkoutExpiresAt = session.expiresAt;
  } else if (isManual) {
    manualPayment = await createManualPaymentRecord({
      db,
      kind: "booking",
      trackingCode: code,
      bookingId,
      actor,
      userEmail: senderEmail,
      userName: senderName,
      baseUsd: quote.total,
      method: chosenMethod,
      baseUrl: baseOrigin,
    });
    checkoutExpiresAt = manualPayment.expiresAt;
    paymentReference = manualPayment.reference;
  }

  const bookingDoc: BookingRecord = {
    id: bookingId,
    code,
    uid: actor.uid,
    senderEmail,
    receiverEmail,
    service,
    weightKg,
    declaredValue,
    total: amounts.totalUsd,
    feeAmount: amounts.feeAmountUsd,
    currency: "USD",
    convertedAmount: amounts.convertedAmount,
    convertedCurrency: currency,
    paymentMethod: chosenMethod.name,
    paymentMethodId: chosenMethod.id,
    paymentChannel: channel,
    paymentStatus: isCash ? "pay_on_pickup" : "awaiting_payment",
    bookingStatus: isCash ? "confirmed" : "awaiting_payment",
    environment: env,
    checkoutId,
    checkoutUrl,
    paymentId: manualPayment?.id || null,
    paymentReference,
    checkoutExpiresAt,
    paymentWindowExpiresAt: checkoutExpiresAt,
    idempotencyKey: bookingId,
    createdAtMs: now,
  };

  const shipmentDoc: ShipmentRecord = {
    code,
    senderId: actor.uid,
    senderEmail,
    receiverEmail,
    sender: {
      name: senderName,
      email: senderEmail,
      phone: parsedSenderPhone.formatInternational(),
      address: senderAddress,
      city: senderCity,
      postal: senderPostal,
      country: senderCountry,
    },
    receiver: {
      name: receiverName,
      email: receiverEmail,
      phone: parsedReceiverPhone.formatInternational(),
      address: receiverAddress,
      city: receiverCity,
      postal: receiverPostal,
      country: receiverCountry,
    },
    service,
    weightKg,
    packageType,
    contents,
    declaredValue,
    priceTotal: amounts.totalUsd,
    paymentMethod: isCash ? "Booked, payment due at pickup" : chosenMethod.name,
    paymentMethodId: chosenMethod.id,
    paymentMethodName: chosenMethod.name,
    paymentChannel: channel,
    feeAmount: amounts.feeAmountUsd,
    convertedAmount: amounts.convertedAmount,
    convertedCurrency: currency,
    paymentWindowExpiresAt: checkoutExpiresAt,
    bookingId,
    paymentId: manualPayment?.id || null,
    paymentStatus: isCash ? "pay_on_pickup" : "awaiting_payment",
    paymentReference,
    checkoutExpiresAt,
    bookingStatus: isCash ? "confirmed" : "awaiting_payment",
    status: "Booked",
    eta,
    photos,
    hold: null,
    nextStop: {
      label: isCash
        ? "Courier pickup from sender (pay on pickup)"
        : isManual
          ? `Awaiting ${chosenMethod.name} payment`
          : "Awaiting booking payment confirmation",
      loc: `${senderCity} Origin`,
      eta: now + 86400000,
    },
    review: {
      state: "pending",
      note: "",
    },
  };

  const eventLabel = isCash
    ? "Booked, payment due at pickup"
    : "Booking started — awaiting payment";
  const eventNote = isCash
    ? `Parcel ${code} booked with payment due at pickup (${formatMoney(amounts.totalUsd)}).`
    : isManual
      ? `Manual payment ${paymentReference} started via ${chosenMethod.name} (${amounts.convertedAmount.toFixed(2)} ${currency}).`
      : `Booking checkout created for ${formatMoney(amounts.totalUsd)} via ${chosenMethod.name}.`;

  const batch = db.batch();
  batch.set(bookingRef, {
    ...bookingDoc,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  batch.set(db.collection("shipments").doc(code), {
    ...shipmentDoc,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  batch.set(db.collection("trackingTeasers").doc(code), {
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
    contents,
    eta,
    latestEvent: {
      label: eventLabel,
      loc: `${senderCity}, ${senderCountry}`,
      ts: now,
    },
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  batch.set(db.collection("shipments").doc(code).collection("events").doc(), {
    stage: "Booked",
    label: eventLabel,
    loc: `${senderCity}, ${senderCountry}`,
    note: eventNote,
    kind: "info",
    ts: now,
    createdBy: senderName || actor.email,
    createdAt: FieldValue.serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    if (isAdminIamError(err)) {
      throw new AdminSdkUnavailableError(
        "Creating bookings requires Firebase Admin SDK access on your Blaze-plan project."
      );
    }
    await logServerError({
      step: "booking_firestore_commit",
      code: "FIRESTORE_COMMIT_ERR",
      message: err instanceof Error ? err.message : "Batch commit failed",
      uid: actor.uid,
    });
    throw err;
  }

  if (isCash) {
    try {
      // Emails must never hold up the booking response: wait at most 6 seconds for them.
      await Promise.race([
        dispatchBookingConfirmationEmails({
          db,
          shipment: shipmentDoc,
          baseUrl: baseOrigin,
          actorUid: actor.uid,
        }),
        new Promise<void>((resolve) => setTimeout(resolve, 6000)),
      ]);
    } catch (emailErr) {
      console.warn("[Booking] Confirmation email dispatch error (non-blocking):", emailErr);
      logServerError({
        step: "booking_confirmation_email",
        code: "EMAIL_WARN",
        message: emailErr instanceof Error ? emailErr.message : "Email failed",
        uid: actor.uid,
      });
    }
  }

  return {
    ok: true,
    awaitingPayment: !isCash,
    code,
    trackingCode: code,
    bookingId,
    status: bookingDoc.bookingStatus,
    total: amounts.totalUsd,
    totalUsd: amounts.totalUsd,
    feeAmount: amounts.feeAmountUsd,
    currency,
    convertedAmount: amounts.convertedAmount,
    paymentMethod: chosenMethod.name,
    paymentMethodId: chosenMethod.id,
    paymentChannel: channel,
    paymentStatus: bookingDoc.paymentStatus,
    checkoutUrl,
    checkoutId,
    shipment: shipmentDoc,
    payment: manualPayment,
  };
}

export async function handleBachsWebhook(
  rawBody: Buffer | string,
  headers: Record<string, string | string[] | undefined>,
  baseUrl?: string
): Promise<{
  received: true;
  ok: boolean;
  eventId: string;
  eventType: string;
  duplicate?: boolean;
}> {
  const { publicSettings, secrets } = await loadSettingsBundle();
  const env = publicSettings.bachs.environment;
  const candidateSecrets = [
    env === "live" ? secrets.bachsLiveWebhook : secrets.bachsSandboxWebhook,
    env === "live" ? secrets.bachsSandboxWebhook : secrets.bachsLiveWebhook,
    secrets.bachsPreviousWebhook,
  ].filter((s): s is string => Boolean(s && s.trim()));

  let db: Firestore;
  try {
    db = getAdminDb();
  } catch (err) {
    if (isAdminIamError(err)) {
      throw new AdminSdkUnavailableError();
    }
    throw err;
  }

  if (candidateSecrets.length === 0) {
    await db
      .collection("webhookLogs")
      .add({
        provider: "bachs",
        eventType: "unknown",
        reference: "",
        result: "rejected-signature",
        detail: "No Bachs webhook signing secret configured",
        environment: env,
        ts: Date.now(),
      })
      .catch(() => null);
    throw Object.assign(new Error("Webhook secret not configured"), {
      status: 400,
    });
  }

  let verifiedEvent: VerifiedBachsWebhookEvent;
  try {
    verifiedEvent = verifyBachsWebhookSignature(rawBody, headers, candidateSecrets);
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Invalid signature";
    await db
      .collection("webhookLogs")
      .add({
        provider: "bachs",
        eventType: "signature_error",
        reference: "",
        result: "rejected-signature",
        detail: detail.slice(0, 300),
        environment: env,
        ts: Date.now(),
      })
      .catch(() => null);
    throw err;
  }

  const dataObj = verifiedEvent.data || {};
  const meta =
    dataObj.metadata && typeof dataObj.metadata === "object"
      ? (dataObj.metadata as Record<string, unknown>)
      : {};
  const code = String(meta.trackingCode || meta.shipment || "").trim().toUpperCase();
  const alertId = String(meta.alertId || "").trim();
  const checkoutId = String(dataObj.checkout_id || dataObj.id || "").trim();
  const paymentId = String(
    dataObj.payment_id || dataObj.charge_id || checkoutId || ""
  ).trim();
  const reference = String(
    dataObj.reference || meta.reference || checkoutId || ""
  ).trim();

  const bookingId = String(
    meta.bookingId ||
      (reference.startsWith("booking_") ? reference.slice("booking_".length) : "")
  ).trim();
  const isBookingWebhook = meta.kind === "booking" || Boolean(bookingId);

  await db
    .collection("adminSettings")
    .doc("payments")
    .set({ bachs: { lastWebhookAt: Date.now() } }, { merge: true })
    .catch(() => null);

  if (meta.is_test === true || meta.is_test === "true") {
    await db.collection("webhookLogs").add({
      provider: "bachs",
      eventType: verifiedEvent.type,
      reference: reference || verifiedEvent.id,
      result: "processed",
      detail: "Admin test checkout event verified cleanly",
      environment: env,
      ts: Date.now(),
    });
    return {
      received: true,
      ok: true,
      eventId: verifiedEvent.id,
      eventType: verifiedEvent.type,
    };
  }

  // Deduplicate event ID in transaction
  const dedupeRef = db.collection("bachsEvents").doc(verifiedEvent.id);
  const alreadyProcessed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(dedupeRef);
    if (snap.exists) return true;
    tx.set(dedupeRef, {
      eventId: verifiedEvent.id,
      type: verifiedEvent.type,
      code: code || null,
      alertId: alertId || null,
      bookingId: bookingId || null,
      processedAt: FieldValue.serverTimestamp(),
    });
    return false;
  });

  if (alreadyProcessed) {
    await db.collection("webhookLogs").add({
      provider: "bachs",
      eventType: verifiedEvent.type,
      reference: reference || code || bookingId,
      result: "duplicate",
      detail: `Duplicate event ${verifiedEvent.id} ignored`,
      environment: env,
      ts: Date.now(),
    });
    return {
      received: true,
      ok: true,
      eventId: verifiedEvent.id,
      eventType: verifiedEvent.type,
      duplicate: true,
    };
  }

  const t = verifiedEvent.type.toLowerCase();

  // ── 1. PARCEL BOOKING CHECKOUT WEBHOOK ──
  if (isBookingWebhook && bookingId) {
    const bookingRef = db.collection("bookings").doc(bookingId);
    const bookingSnap = await bookingRef.get();
    if (!bookingSnap.exists) {
      await db.collection("webhookLogs").add({
        provider: "bachs",
        eventType: verifiedEvent.type,
        reference: reference || bookingId,
        result: "ignored",
        detail: "Target booking record not found",
        environment: env,
        ts: Date.now(),
      });
      return {
        received: true,
        ok: true,
        eventId: verifiedEvent.id,
        eventType: verifiedEvent.type,
      };
    }

    const booking = bookingSnap.data() as BookingRecord;
    const shipCode = booking.code || code;
    const shipRef = db.collection("shipments").doc(shipCode);
    const teaserRef = db.collection("trackingTeasers").doc(shipCode);
    const shipSnap = await shipRef.get();
    const shipment = shipSnap.exists ? (shipSnap.data() as ShipmentRecord) : null;

    if (
      t === "collection.succeeded" ||
      t === "payment.succeeded" ||
      t === "checkout.session.completed"
    ) {
      const targetEnv = booking.environment || env;
      const apiKey = getActiveBachsApiKey(targetEnv, secrets);
      let verifiedAmount = Number(dataObj.amount || booking.total || 0);
      let verifiedCurrency = String(
        dataObj.currency || booking.currency || "USD"
      ).toUpperCase();

      if (apiKey && checkoutId) {
        const sess = await bachsFetch<BachsSessionResponse>(
          apiKey,
          targetEnv,
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
        await bookingRef.update({
          paymentStatus: "failed",
          lastError: `Amount mismatch: received ${verifiedCurrency} ${verifiedAmount}, expected ${booking.currency} ${booking.total}`,
          updatedAt: FieldValue.serverTimestamp(),
        });
        await db.collection("webhookLogs").add({
          provider: "bachs",
          eventType: verifiedEvent.type,
          reference: `${shipCode}/${bookingId}`,
          result: "error",
          detail: "Booking amount/currency mismatch",
          environment: targetEnv,
          ts: Date.now(),
        });
        return {
          received: true,
          ok: true,
          eventId: verifiedEvent.id,
          eventType: verifiedEvent.type,
        };
      }

      const now = Date.now();
      const batch = db.batch();
      batch.update(bookingRef, {
        paymentStatus: "paid",
        bookingStatus: "confirmed",
        paymentId: paymentId || reference,
        paymentReference: reference || booking.paymentReference || null,
        paidAt: now,
        lastError: null,
        updatedAt: FieldValue.serverTimestamp(),
      });
      if (shipSnap.exists) {
        batch.update(shipRef, {
          paymentStatus: "paid",
          bookingStatus: "confirmed",
          paymentId: paymentId || reference,
          paymentReference: reference || booking.paymentReference || null,
          "nextStop.label": "Courier pickup from sender",
          updatedAt: FieldValue.serverTimestamp(),
        });
        batch.update(teaserRef, {
          latestEvent: {
            label: "Booking confirmed",
            loc: `${shipment?.sender?.city || "Origin Hub"}`,
            ts: now,
          },
          updatedAt: FieldValue.serverTimestamp(),
        });
        batch.set(shipRef.collection("events").doc(), {
          stage: "Booked",
          label: "Booking confirmed",
          loc: `${shipment?.sender?.city || "Origin Hub"}`,
          note: `Payment confirmed (${formatUsd(verifiedAmount, verifiedCurrency)} via Bachs · ${paymentId || reference}).`,
          kind: "info",
          ts: now,
          createdBy: "Bachs webhook",
          createdAt: FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();

      if (shipment) {
        await dispatchBookingConfirmationEmails({
          db,
          shipment,
          baseUrl,
          actorUid: booking.uid || "bachs-webhook",
        });
      }

      await db.collection("webhookLogs").add({
        provider: "bachs",
        eventType: verifiedEvent.type,
        reference: `${shipCode}/${bookingId}`,
        result: "processed",
        detail: `Booking ${shipCode} paid (${formatUsd(verifiedAmount, verifiedCurrency)})`,
        environment: targetEnv,
        ts: now,
      });
    } else if (
      t === "collection.failed" ||
      t === "collection.abandoned" ||
      t === "checkout.expired" ||
      t === "checkout.session.expired"
    ) {
      const isExp = t.includes("expired");
      await bookingRef.update({
        paymentStatus: isExp ? "expired" : "failed",
        bookingStatus: isExp ? "expired" : "awaiting_payment",
        lastError: isExp
          ? "Checkout expired after 60 minutes without payment."
          : "Payment attempt did not complete.",
        updatedAt: FieldValue.serverTimestamp(),
      });
      if (shipSnap.exists) {
        await shipRef.update({
          paymentStatus: isExp ? "expired" : "failed",
          bookingStatus: isExp ? "expired" : "awaiting_payment",
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      await db.collection("webhookLogs").add({
        provider: "bachs",
        eventType: verifiedEvent.type,
        reference: `${shipCode}/${bookingId}`,
        result: "processed",
        detail: `Booking payment ${t}`,
        environment: env,
        ts: Date.now(),
      });
    } else if (
      t === "refund.succeeded" ||
      t === "refund.paid" ||
      t === "collection.refunded"
    ) {
      const now = Date.now();
      await bookingRef.update({
        paymentStatus: "refunded",
        bookingStatus: "cancelled",
        refundedAt: now,
        updatedAt: FieldValue.serverTimestamp(),
      });
      if (shipSnap.exists) {
        await shipRef.update({
          paymentStatus: "refunded",
          bookingStatus: "cancelled",
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      await db.collection("webhookLogs").add({
        provider: "bachs",
        eventType: verifiedEvent.type,
        reference: `${shipCode}/${bookingId}`,
        result: "processed",
        detail: `Booking refunded`,
        environment: env,
        ts: now,
      });
    }

    return {
      received: true,
      ok: true,
      eventId: verifiedEvent.id,
      eventType: verifiedEvent.type,
    };
  }

  // ── 2. CUSTOMS / DUTY ALERT WEBHOOK ──
  if (!isValidTrackingCode(code) || !alertId) {
    await db.collection("webhookLogs").add({
      provider: "bachs",
      eventType: verifiedEvent.type,
      reference: reference || verifiedEvent.id,
      result: "ignored",
      detail: "Webhook event did not match a shipment booking or customs charge",
      environment: env,
      ts: Date.now(),
    });
    return {
      received: true,
      ok: true,
      eventId: verifiedEvent.id,
      eventType: verifiedEvent.type,
    };
  }

  const shipRef = db.collection("shipments").doc(code);
  const alertRef = shipRef.collection("alerts").doc(alertId);
  const [shipSnap, alertSnap] = await Promise.all([shipRef.get(), alertRef.get()]);

  if (!shipSnap.exists || !alertSnap.exists) {
    await db.collection("webhookLogs").add({
      provider: "bachs",
      eventType: verifiedEvent.type,
      reference: `${code}/${alertId}`,
      result: "ignored",
      detail: "Target shipment or alert not found",
      environment: env,
      ts: Date.now(),
    });
    return {
      received: true,
      ok: true,
      eventId: verifiedEvent.id,
      eventType: verifiedEvent.type,
    };
  }

  const shipment = shipSnap.data() as ShipmentRecord;
  const alert = alertSnap.data() as ShipmentAlert;
  const prevEvents: CustomsPaymentEvent[] = Array.isArray(alert.payment?.events)
    ? alert.payment.events
    : [];

  if (
    t === "collection.succeeded" ||
    t === "payment.succeeded" ||
    t === "checkout.session.completed"
  ) {
    const targetEnv = alert.payment?.environment || env;
    const apiKey = getActiveBachsApiKey(targetEnv, secrets);
    let verifiedAmount = Number(dataObj.amount || alert.amount || 0);
    let verifiedCurrency = String(
      dataObj.currency || alert.currency || "USD"
    ).toUpperCase();

    if (apiKey && checkoutId) {
      try {
        const session = await bachsFetch<BachsSessionResponse>(
          apiKey,
          targetEnv,
          `/v1/checkout-sessions/${encodeURIComponent(checkoutId)}`
        );
        if (session.amount != null) {
          verifiedAmount = Number(session.amount);
        } else if (session.amount_total != null) {
          verifiedAmount = Number(session.amount_total);
        }
        if (session.currency) {
          verifiedCurrency = String(session.currency).toUpperCase();
        }
      } catch (verifyErr) {
        await db.collection("webhookLogs").add({
          provider: "bachs",
          eventType: verifiedEvent.type,
          reference: `${code}/${alertId}`,
          result: "error",
          detail:
            verifyErr instanceof Error
              ? `Checkout lookup failed: ${verifyErr.message}`
              : "Checkout verification error",
          environment: env,
          ts: Date.now(),
        });
        throw verifyErr;
      }
    }

    const expectedAmount = Number(alert.amount || 0);
    if (
      Math.abs(verifiedAmount - expectedAmount) > 0.05 ||
      verifiedCurrency !== (alert.currency || "USD").toUpperCase()
    ) {
      await alertRef.update({
        "payment.status": "underpaid",
        "payment.lastError": `Amount/currency mismatch: received ${verifiedCurrency} ${verifiedAmount}, expected ${expectedAmount}`,
        "payment.events": [
          ...prevEvents,
          {
            type: verifiedEvent.type,
            at: Date.now(),
            detail: `Mismatch ${verifiedCurrency} ${verifiedAmount}`,
          },
        ],
      });
      await db.collection("webhookLogs").add({
        provider: "bachs",
        eventType: verifiedEvent.type,
        reference: `${code}/${alertId}`,
        result: "error",
        detail: "Amount or currency mismatch against Firestore charge",
        environment: env,
        ts: Date.now(),
      });
      return {
        received: true,
        ok: true,
        eventId: verifiedEvent.id,
        eventType: verifiedEvent.type,
      };
    }

    const now = Date.now();
    await alertRef.update({
      status: "resolved",
      resolvedAt: FieldValue.serverTimestamp(),
      response: `Paid via Bachs (${paymentId || reference})`,
      payment: {
        ...(alert.payment || {}),
        provider: "bachs",
        environment: targetEnv,
        checkoutId: checkoutId || alert.payment?.checkoutId || null,
        paymentId: paymentId || reference,
        reference: reference || alert.payment?.reference || null,
        status: "paid",
        amountPaid: verifiedAmount,
        currency: verifiedCurrency,
        paidAt: now,
        lastError: null,
        events: [
          ...prevEvents,
          {
            type: verifiedEvent.type,
            at: now,
            detail: `Paid ${verifiedCurrency} ${verifiedAmount.toFixed(2)}`,
          },
        ],
      },
    });

    const chargeName = String(alert.chargeType || alert.title || "Customs charge");
    const amtFormatted = formatUsd(verifiedAmount, verifiedCurrency);
    await shipRef.collection("events").add({
      stage: shipment.status,
      label: `${chargeName} paid (${amtFormatted})`,
      loc:
        shipment.nextStop?.loc ||
        `${shipment.receiver?.city || "Destination"} Customs`,
      note: `Payment confirmed via Bachs (${paymentId || reference}).`,
      kind: "info",
      ts: now,
      createdBy: "Bachs webhook",
      createdAt: FieldValue.serverTimestamp(),
    });

    const { holdReleased, remainingCount } =
      await reconcileShipmentHoldAfterResolution(db, code, {
        actorLabel: "Bachs webhook",
        baseUrl,
        resolvedAlertId: alertId,
      });

    if (shipment.receiverEmail) {
      await dispatchTransactionalEmail(
        shipment.receiverEmail,
        buildChargePaidEmail({
          baseUrl,
          trackingCode: code,
          recipientName: shipment.receiver?.name || "Recipient",
          chargeType: chargeName,
          amountFormatted: amtFormatted,
          paymentId: paymentId || reference || code,
          holdReleased,
          remainingCount,
        }),
        {
          template: "charge_paid",
          category: "payments",
          code,
          createdBy: "bachs-webhook",
        }
      );
    }
    if (
      shipment.senderEmail &&
      shipment.senderEmail.toLowerCase() !== shipment.receiverEmail?.toLowerCase()
    ) {
      await dispatchTransactionalEmail(
        shipment.senderEmail,
        buildChargePaidEmail({
          baseUrl,
          trackingCode: code,
          recipientName: shipment.sender?.name || "Sender",
          chargeType: chargeName,
          amountFormatted: amtFormatted,
          paymentId: paymentId || reference || code,
          holdReleased,
          remainingCount,
        }),
        {
          template: "charge_paid",
          category: "payments",
          code,
          createdBy: "bachs-webhook",
        }
      );
    }
    if (
      publicSettings.resend.supportInbox &&
      publicSettings.resend.supportInbox.toLowerCase() !== shipment.receiverEmail?.toLowerCase()
    ) {
      await dispatchTransactionalEmail(
        publicSettings.resend.supportInbox,
        buildChargePaidEmail({
          baseUrl,
          trackingCode: code,
          recipientName: "ShipWell Support",
          chargeType: chargeName,
          amountFormatted: amtFormatted,
          paymentId: paymentId || reference || code,
          holdReleased,
          remainingCount,
        }),
        {
          template: "charge_paid_ops",
          category: "notifications",
          code,
          createdBy: "bachs-webhook",
        }
      );
    }

    await db.collection("webhookLogs").add({
      provider: "bachs",
      eventType: verifiedEvent.type,
      reference: `${code}/${alertId}`,
      result: "processed",
      detail: `${chargeName} marked paid (${amtFormatted}); holdReleased=${holdReleased}`,
      environment: env,
      ts: now,
    });
  } else if (t === "collection.underpaid") {
    await alertRef.update({
      "payment.status": "underpaid",
      "payment.lastError": "Underpaid — remaining balance due",
      "payment.events": [
        ...prevEvents,
        { type: verifiedEvent.type, at: Date.now(), detail: "Underpaid" },
      ],
    });
    await db.collection("webhookLogs").add({
      provider: "bachs",
      eventType: verifiedEvent.type,
      reference: `${code}/${alertId}`,
      result: "processed",
      detail: "Marked underpaid",
      environment: env,
      ts: Date.now(),
    });
  } else if (
    t === "collection.failed" ||
    t === "collection.abandoned" ||
    t === "checkout.expired" ||
    t === "checkout.session.expired"
  ) {
    await alertRef.update({
      "payment.status": "failed",
      "payment.lastError": t.includes("expired")
        ? "Checkout link expired — click Pay with Bachs to generate a fresh session."
        : "Payment attempt did not complete.",
      "payment.events": [
        ...prevEvents,
        { type: verifiedEvent.type, at: Date.now(), detail: t },
      ],
    });
    await db.collection("webhookLogs").add({
      provider: "bachs",
      eventType: verifiedEvent.type,
      reference: `${code}/${alertId}`,
      result: "processed",
      detail: `Marked ${t}`,
      environment: env,
      ts: Date.now(),
    });
  } else if (
    t === "refund.succeeded" ||
    t === "refund.paid" ||
    t === "collection.refunded"
  ) {
    const now = Date.now();
    await alertRef.update({
      "payment.status": "refunded",
      "payment.refundedAt": now,
      "payment.events": [
        ...prevEvents,
        { type: verifiedEvent.type, at: now, detail: "Refunded" },
      ],
    });
    await db.collection("webhookLogs").add({
      provider: "bachs",
      eventType: verifiedEvent.type,
      reference: `${code}/${alertId}`,
      result: "processed",
      detail: "Marked refunded",
      environment: env,
      ts: now,
    });
  } else {
    await db.collection("webhookLogs").add({
      provider: "bachs",
      eventType: verifiedEvent.type,
      reference: `${code}/${alertId}`,
      result: "ignored",
      detail: `Unhandled Bachs event ${verifiedEvent.type}`,
      environment: env,
      ts: Date.now(),
    });
  }

  return {
    received: true,
    ok: true,
    eventId: verifiedEvent.id,
    eventType: verifiedEvent.type,
  };
}

export async function testBachsConnection(): Promise<{
  ok: boolean;
  environment: "sandbox" | "live";
  accountId?: string;
  productReady?: boolean;
  error?: string;
}> {
  const { publicSettings, secrets } = await loadSettingsBundle();
  const env = publicSettings.bachs.environment;
  const apiKey = getActiveBachsApiKey(env, secrets);
  if (!apiKey) {
    return {
      ok: false,
      environment: env,
      error: `No Bachs ${env} secret key saved yet.`,
    };
  }
  const productId = getActiveBachsProductId(env, publicSettings.bachs);
  try {
    if (productId) {
      const prod = await bachsFetch<{
        id?: string;
        product_id?: string;
        custom_amount_enabled?: boolean;
        price_type?: string;
      }>(apiKey, env, `/v1/products/${encodeURIComponent(productId)}`);
      return {
        ok: true,
        environment: env,
        accountId: String(prod.product_id || prod.id || productId),
        productReady: prod.custom_amount_enabled !== false,
      };
    }
    const list = await bachsFetch<{ items?: unknown[]; data?: unknown[] }>(
      apiKey,
      env,
      "/v1/products?limit=1"
    );
    return {
      ok: true,
      environment: env,
      accountId: `API connected (${Array.isArray(list.items || list.data) ? "products accessible" : "ok"})`,
      productReady: false,
    };
  } catch (err) {
    return {
      ok: false,
      environment: env,
      error: err instanceof Error ? err.message : "Bachs connection failed.",
    };
  }
}

export async function createBachsTestCheckout(
  actor: VerifiedServerUser,
  origin: string
): Promise<{
  checkoutId: string;
  checkoutUrl: string;
  environment: "sandbox" | "live";
}> {
  const { publicSettings, secrets } = await loadSettingsBundle();
  const env = publicSettings.bachs.environment;
  const apiKey = getActiveBachsApiKey(env, secrets);
  if (!apiKey) {
    throw new Error(`No Bachs ${env} secret key saved yet.`);
  }
  const productId = getActiveBachsProductId(env, publicSettings.bachs);
  const baseOrigin = origin.replace(/\/+$/, "");
  const created = await createBachsCheckoutSession({
    apiKey,
    env,
    productId,
    amount: 1.0,
    customerEmail: actor.email || ADMIN_EMAIL,
    customerName: "ShipWell Admin Test",
    returnUrl: `${baseOrigin}/admin/settings?test_paid=1`,
    cancelUrl: `${baseOrigin}/admin/settings?test_cancelled=1`,
    reference: `SW-TEST-${Date.now().toString(36).toUpperCase()}`,
    metadata: {
      is_test: "true",
      actorUid: actor.uid,
    },
    expiresInMinutes: 15,
    idempotencyKey: `admin_test_${Date.now()}`,
  });
  return {
    checkoutId: created.checkoutId,
    checkoutUrl: created.checkoutUrl,
    environment: env,
  };
}

export async function issueCustomsRefund(params: {
  code: string;
  alertId: string;
  actor: VerifiedServerUser;
  reason?: string;
}): Promise<{ ok: boolean; refundId: string; status: string }> {
  const code = String(params.code || "").trim().toUpperCase();
  const alertId = String(params.alertId || "").trim();
  const db = getAdminDb();

  const shipRef = db.collection("shipments").doc(code);
  const alertRef = shipRef.collection("alerts").doc(alertId);
  const [shipSnap, alertSnap] = await Promise.all([shipRef.get(), alertRef.get()]);
  if (!shipSnap.exists || !alertSnap.exists) {
    throw new Error("Shipment or alert not found.");
  }

  const shipment = shipSnap.data() as ShipmentRecord;
  const alert = alertSnap.data() as ShipmentAlert;
  if (alert.payment?.status !== "paid" || !alert.payment?.paymentId) {
    throw new Error("Only settled payments with a payment ID can be refunded.");
  }

  const { publicSettings, secrets } = await loadSettingsBundle();
  const env = alert.payment.environment || publicSettings.bachs.environment;
  const apiKey = getActiveBachsApiKey(env, secrets);
  if (!apiKey) {
    throw new Error(`No Bachs ${env} secret key configured for refund.`);
  }

  const refundJson = await bachsFetch<{
    refund_id?: string;
    id?: string;
    status?: string;
  }>(apiKey, env, "/v1/refunds", {
    method: "POST",
    body: {
      payment_id: alert.payment.paymentId,
      amount: Number(alert.payment.amountPaid || alert.amount).toFixed(2),
      reason: params.reason || `Admin refund on ${code}`,
    },
    idempotencyKey: `ref_${code}_${alertId}_${Date.now()}`,
  });

  const refundId =
    refundJson.refund_id || refundJson.id || `ref_${Date.now().toString(36)}`;
  const now = Date.now();
  const prevEvents: CustomsPaymentEvent[] = Array.isArray(alert.payment.events)
    ? alert.payment.events
    : [];

  await alertRef.update({
    "payment.status": "refunded",
    "payment.refundedAt": now,
    "payment.refundId": refundId,
    "payment.events": [
      ...prevEvents,
      {
        type: "refund.issued",
        at: now,
        detail: `${refundId} by ${params.actor.email}`,
      },
    ],
  });

  await shipRef.collection("events").add({
    stage: shipment.status,
    label: `Refund issued (${alert.chargeType || alert.title})`,
    loc: shipment.nextStop?.loc || "ShipWell Billing",
    note: `Refund ${refundId} processed.`,
    kind: "info",
    ts: now,
    createdBy: params.actor.email,
    createdAt: FieldValue.serverTimestamp(),
  });

  await db.collection("auditLogs").add({
    actorUid: params.actor.uid,
    actorEmail: params.actor.email,
    action: "refund_customs_charge",
    code,
    detail: `Refunded ${alert.chargeType || alert.title} (${formatUsd(
      alert.amount,
      alert.currency
    )}) — ${refundId}`,
    createdAt: FieldValue.serverTimestamp(),
  });

  return {
    ok: true,
    refundId,
    status: refundJson.status || "refunded",
  };
}

export async function adminBookingAction(params: {
  actor: VerifiedServerUser;
  code: string;
  action: "mark_pickup_paid" | "refund_booking" | "approve_item";
  reason?: string;
}): Promise<{ ok: boolean; status: string; refundId?: string }> {
  const code = String(params.code || "").trim().toUpperCase();
  if (!isValidTrackingCode(code)) {
    throw new Error("Valid tracking code is required.");
  }

  const db = getAdminDb();
  const shipRef = db.collection("shipments").doc(code);
  const shipSnap = await shipRef.get();
  if (!shipSnap.exists) {
    throw new Error("Shipment not found.");
  }
  const shipment = shipSnap.data() as ShipmentRecord;
  const now = Date.now();
  const bookingRef = shipment.bookingId
    ? db.collection("bookings").doc(shipment.bookingId)
    : null;

  if (params.action === "approve_item") {
    const batch = db.batch();
    batch.update(shipRef, {
      review: { state: "approved", note: "", at: now, by: "ShipWell Operations" },
      updatedAt: FieldValue.serverTimestamp(),
    });
    batch.set(shipRef.collection("events").doc(), {
      stage: shipment.status,
      label: "Item reviewed and approved",
      loc: "",
      note: "Contents match the booking",
      kind: "review",
      ts: now,
      createdBy: params.actor.uid,
      createdAt: FieldValue.serverTimestamp(),
    });
    batch.set(db.collection("auditLogs").doc(), {
      actorUid: params.actor.uid,
      actorEmail: params.actor.email,
      action: "approve_item",
      code,
      detail: "Approved shipment contents and photos",
      createdAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();
    return { ok: true, status: "approved" };
  }

  if (params.action === "mark_pickup_paid") {
    const batch = db.batch();
    batch.update(shipRef, {
      paymentStatus: "paid",
      bookingStatus: "confirmed",
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (bookingRef) {
      const bSnap = await bookingRef.get();
      if (bSnap.exists) {
        batch.update(bookingRef, {
          paymentStatus: "paid",
          bookingStatus: "confirmed",
          paidAt: now,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    }
    batch.set(shipRef.collection("events").doc(), {
      stage: shipment.status,
      label: `Pickup payment received (${formatMoney(shipment.priceTotal || 0)})`,
      loc: shipment.nextStop?.loc || shipment.sender?.city || "Collection Point",
      note: "Cash/pickup payment confirmed.",
      kind: "info",
      ts: now,
      createdBy: params.actor.email,
      createdAt: FieldValue.serverTimestamp(),
    });
    batch.set(db.collection("auditLogs").doc(), {
      actorUid: params.actor.uid,
      actorEmail: params.actor.email,
      action: "mark_pickup_paid",
      code,
      detail: `Marked pay-on-pickup settled (${formatMoney(shipment.priceTotal || 0)})`,
      createdAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();
    return { ok: true, status: "paid" };
  }

  // Refund booking
  if (shipment.paymentStatus !== "paid") {
    throw new Error("Only paid bookings can be refunded.");
  }

  let refundId = `ref_${Date.now().toString(36)}`;
  if (shipment.paymentId) {
    const bData = bookingRef ? ((await bookingRef.get()).data() as BookingRecord | undefined) : undefined;
    const { publicSettings, secrets } = await loadSettingsBundle();
    const env = bData?.environment || publicSettings.bachs.environment;
    const apiKey = getActiveBachsApiKey(env, secrets);
    if (!apiKey) {
      throw new Error(`No Bachs ${env} secret key configured to process refund.`);
    }
    const rJson = await bachsFetch<{ refund_id?: string; id?: string }>(
      apiKey,
      env,
      "/v1/refunds",
      {
        method: "POST",
        body: {
          payment_id: shipment.paymentId,
          amount: Number(shipment.priceTotal || 0).toFixed(2),
          reason: params.reason || `Booking refund on ${code}`,
        },
        idempotencyKey: `ref_bk_${code}_${now}`,
      }
    );
    refundId = rJson.refund_id || rJson.id || refundId;
  }

  const batch = db.batch();
  batch.update(shipRef, {
    paymentStatus: "refunded",
    bookingStatus: "cancelled",
    updatedAt: FieldValue.serverTimestamp(),
  });
  if (bookingRef) {
    const bSnap = await bookingRef.get();
    if (bSnap.exists) {
      batch.update(bookingRef, {
        paymentStatus: "refunded",
        bookingStatus: "cancelled",
        refundId,
        refundedAt: now,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  }
  batch.set(shipRef.collection("events").doc(), {
    stage: shipment.status,
    label: "Booking refunded",
    loc: "ShipWell Billing",
    note: `Booking refund ${refundId} issued by ${params.actor.email}.`,
    kind: "info",
    ts: now,
    createdBy: params.actor.email,
    createdAt: FieldValue.serverTimestamp(),
  });
  batch.set(db.collection("auditLogs").doc(), {
    actorUid: params.actor.uid,
    actorEmail: params.actor.email,
    action: "refund_booking",
    code,
    detail: `Refunded booking ${code} (${refundId})`,
    createdAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
  return { ok: true, status: "refunded", refundId };
}

// ── Admin shipment movement (server-side, not blocked by Firestore rules) ──
const MOVE_STAGES = [
  "Booked",
  "Picked Up",
  "In Transit",
  "At Hub",
  "Customs",
  "Out for Delivery",
  "Delivered",
] as const;

async function shipmentHasCustoms(
  db: ReturnType<typeof getAdminDb>,
  code: string,
  status: string
): Promise<boolean> {
  if (status === "Customs") return true;
  const shipRef = db.collection("shipments").doc(code);
  const [alerts, events] = await Promise.all([
    shipRef.collection("alerts").get(),
    shipRef.collection("events").where("stage", "==", "Customs").limit(1).get(),
  ]);
  return (
    !events.empty ||
    alerts.docs.some((d) => {
      const a = d.data();
      return a.kind === "duty" || a.kind === "customs" || Boolean(a.chargeType);
    })
  );
}

export async function adminShipmentUpdate(params: {
  actor: VerifiedServerUser;
  code: string;
  action: "add_checkpoint" | "add_customs_charge" | "save_next_stop";
  data: Record<string, any>;
}): Promise<{ ok: boolean; alertId?: string; allowedStages?: string[] }> {
  const code = String(params.code || "").trim().toUpperCase();
  if (!isValidTrackingCode(code)) throw new Error("Valid tracking code is required.");
  const db = getAdminDb();
  const shipRef = db.collection("shipments").doc(code);
  const teaserRef = db.collection("trackingTeasers").doc(code);
  const snap = await shipRef.get();
  if (!snap.exists) throw new Error("Shipment not found.");
  const shipment = snap.data() as ShipmentRecord;
  const status = String(shipment.status);
  const d = params.data || {};
  const now = Date.now();
  const actor = params.actor;

  const audit = (action: string, detail: string) =>
    db.collection("auditLogs").doc().set({
      actorUid: actor.uid,
      actorEmail: actor.email,
      action,
      code,
      detail: detail.slice(0, 400),
      createdAt: FieldValue.serverTimestamp(),
    });

  if (params.action === "save_next_stop") {
    const label = String(d.label || "").trim().slice(0, 160);
    const loc = String(d.loc || "").trim().slice(0, 160);
    const nextEta = Number.isFinite(Number(d.nextEta)) && d.nextEta ? Number(d.nextEta) : null;
    const deliveryEta = Number(d.deliveryEta) || shipment.eta;
    await shipRef.update({
      nextStop: label ? { label, loc, eta: nextEta } : null,
      eta: deliveryEta,
      updatedAt: FieldValue.serverTimestamp(),
    });
    await teaserRef.set({ eta: deliveryEta, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    await audit("update_next_stop", label ? `Next: ${label}` : "Updated delivery ETA");
    return { ok: true };
  }

  if (params.action === "add_checkpoint") {
    const stage = String(d.stage || "");
    const label = String(d.label || "").trim().slice(0, 160);
    const loc = String(d.loc || "").trim().slice(0, 160);
    const note = String(d.note || "").trim().slice(0, 500);
    const ts = Number(d.ts) || now;
    if (!label) throw new Error("Enter a checkpoint headline.");
    if (status === "Delivered") throw new Error("This parcel is already delivered.");
    // Strict one-way movement: current stage or the very next one. Customs only exists if a customs charge was pushed.
    const withCustoms = await shipmentHasCustoms(db, code, status);
    const seq = MOVE_STAGES.filter((s) => s !== "Customs" || withCustoms);
    const idx = seq.indexOf(status as (typeof MOVE_STAGES)[number]);
    const allowed = [seq[idx], seq[idx + 1]].filter(
      (s): s is (typeof MOVE_STAGES)[number] => Boolean(s) && s !== "Booked"
    );
    if (!allowed.includes(stage as (typeof MOVE_STAGES)[number])) {
      throw new Error(
        `From "${status}" you can only record: ${allowed.join(" or ") || "nothing"}. Stages cannot go back or be skipped.`
      );
    }
    const batch = db.batch();
    batch.set(shipRef.collection("events").doc(), {
      stage, label, loc, note, kind: "scan", ts,
      createdBy: actor.uid,
      createdAt: FieldValue.serverTimestamp(),
    });
    batch.update(shipRef, {
      status: stage,
      nextStop: null,
      ...(stage === "Delivered" ? { deliveredAt: ts, hold: null } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    });
    batch.set(teaserRef, {
      status: stage,
      ...(stage === "Delivered" ? { deliveredAt: ts, holdType: null } : {}),
      latestEvent: { label, loc, ts },
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    await batch.commit();
    await audit("add_checkpoint", `${stage}: ${label} (${loc})`);
    return { ok: true };
  }

  // add_customs_charge
  const amount = Number(Number(d.amount).toFixed(2));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter an amount greater than 0.");
  if (!["In Transit", "At Hub", "Customs", "Out for Delivery"].includes(status)) {
    throw new Error("Customs charges can only be added once the parcel is In Transit or later.");
  }
  const chargeType = String(d.chargeType || "Import duty").slice(0, 80);
  const currency = String(d.currency || "USD").trim().toUpperCase().slice(0, 8) || "USD";
  const to = d.to === "sender" ? "sender" : "receiver";
  const hold = Boolean(d.holdShipment);
  const note = String(d.note || "").trim().slice(0, 400) || `${chargeType} assessed by customs clearance`;
  const alertId = `chg_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const nextStage = status === "In Transit" || status === "At Hub" ? "Customs" : status;
  const evLabel = `${chargeType} added ($${amount.toFixed(2)})`;
  const evLoc = `${shipment.receiver?.city || ""}, ${shipment.receiver?.country || ""}`;
  const batch = db.batch();
  batch.set(shipRef.collection("alerts").doc(alertId), {
    to, kind: "duty", chargeType, currency, holdShipment: hold,
    title: `${chargeType} ($${amount.toFixed(2)})`,
    message: note, amount, status: "open",
    payment: { provider: "bachs", environment: "sandbox", status: "unpaid", currency, events: [] },
    createdAt: FieldValue.serverTimestamp(),
  });
  batch.set(shipRef.collection("events").doc(), {
    stage: nextStage, label: evLabel, loc: evLoc, note, kind: "action", ts: now,
    createdBy: actor.uid, createdAt: FieldValue.serverTimestamp(),
  });
  batch.update(shipRef, {
    status: nextStage,
    ...(hold ? { hold: { type: "On Hold", reason: `${chargeType} due ($${amount.toFixed(2)} ${currency})`, at: now, alertId } } : {}),
    updatedAt: FieldValue.serverTimestamp(),
  });
  batch.set(teaserRef, {
    status: nextStage,
    ...(hold ? { holdType: "On Hold" } : {}),
    latestEvent: { label: evLabel, loc: evLoc, ts: now },
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await batch.commit();
  await audit("add_customs_charge", `${chargeType} $${amount.toFixed(2)} ${currency}${hold ? " (held)" : ""}`);
  return { ok: true, alertId };
}
