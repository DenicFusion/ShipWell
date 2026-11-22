import { Bachs, webhooks as bachsWebhooks } from "@bachs/sdk";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import {
  formatUsd,
  isValidTrackingCode,
  type CustomsPaymentEvent,
  type CustomsPaymentInfo,
  type GatewayId,
  type ShipmentAlert,
  type ShipmentRecord,
} from "../../types/tracking.ts";
import { dispatchTransactionalEmail } from "../email/sender.ts";
import {
  buildChargePaidEmail,
  buildHoldReleasedEmail,
} from "../email/templates.ts";
import {
  AdminSdkUnavailableError,
  getAdminDb,
  isAdminIamError,
  type VerifiedServerUser,
} from "./firebase-admin.ts";
import { loadSettingsBundle } from "./settings-store.ts";

function getActiveBachsApiKey(
  env: "sandbox" | "live",
  secrets: { bachsSandboxKey: string; bachsLiveKey: string }
): string {
  return env === "live" ? secrets.bachsLiveKey : secrets.bachsSandboxKey;
}

function getBachsClient(apiKey: string, env: "sandbox" | "live"): Bachs {
  return new Bachs({
    apiKey,
    environment: env === "live" ? "production" : "sandbox",
  });
}

function getBachsBaseUrl(env: "sandbox" | "live"): string {
  return env === "live" ? "https://api.bachs.io" : "https://sandbox-api.bachs.io";
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
    return data.holdShipment === true || data.kind === "duty" || !shipment.hold?.alertId || shipment.hold?.alertId === d.id;
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
    shipment.nextStop?.loc ||
    `${shipment.receiver?.city || "Destination"} Hub`;
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
  const etaLabel = new Date(Number(shipment.eta || now)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

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
      { template: "hold_released", code, createdBy: opts.actorLabel }
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
      { template: "hold_released", code, createdBy: opts.actorLabel }
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
      { template: "hold_released_ops", code, createdBy: opts.actorLabel }
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
}): Promise<{
  checkoutUrl: string;
  checkoutId: string;
  reference: string;
  provider: GatewayId;
  environment: "sandbox" | "live";
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
  const successUrl = `${baseOrigin}/dashboard/track/${encodeURIComponent(
    code
  )}?paid=1&alertId=${encodeURIComponent(alertId)}`;
  const cancelUrl = `${baseOrigin}/dashboard/track/${encodeURIComponent(
    code
  )}?cancelled=1&alertId=${encodeURIComponent(alertId)}`;

  const reference = `SW-${code}-${alertId.slice(0, 6).toUpperCase()}-${Date.now()
    .toString(36)
    .toUpperCase()}`;

  const payerEmail =
    params.actor.email ||
    shipment.receiverEmail ||
    shipment.senderEmail ||
    "customer@shipwell.cc";
  const payerName =
    alert.to === "sender"
      ? shipment.sender?.name || "ShipWell Sender"
      : shipment.receiver?.name || "ShipWell Customer";

  if (chosenGateway === "stripe") {
    const bodyParams = new URLSearchParams({
      mode: "payment",
      success_url: successUrl,
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
          reference,
          callback_url: successUrl,
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

  // Primary: Bachs Checkout
  const env = publicSettings.bachs.environment;
  const apiKey = getActiveBachsApiKey(env, secrets);
  if (!apiKey) {
    throw new Error(
      `Bachs ${env} secret key is not configured yet. Save it in Admin → Settings → Bachs payments.`
    );
  }

  const bachs = getBachsClient(apiKey, env);
  const minuteBucket = Math.floor(Date.now() / 60000);
  const idempotencyKey = `cust_${code}_${alertId}_${minuteBucket}`;

  const created = await bachs.checkoutSessions.create(
    {
      pricing: {
        currency,
        amount: amount.toFixed(2),
      },
      customer: {
        email: payerEmail,
        name: payerName,
      },
      reference,
      metadata: {
        trackingCode: code,
        alertId,
        chargeType: String(alert.chargeType || alert.title || "Customs charge"),
        payerUid: params.actor.uid,
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
      expires_in_minutes: publicSettings.bachs.checkoutExpiryMinutes || 60,
    },
    { idempotencyKey }
  );

  const prevEvents: CustomsPaymentEvent[] = Array.isArray(alert.payment?.events)
    ? alert.payment.events
    : [];
  const paymentDoc: CustomsPaymentInfo = {
    provider: "bachs",
    environment: env,
    checkoutId: created.checkout_id,
    checkoutUrl: created.checkout_url,
    reference: created.reference || reference,
    status: "pending",
    currency,
    expiresAt:
      Date.parse(created.expires_at) ||
      Date.now() + (publicSettings.bachs.checkoutExpiryMinutes || 60) * 60000,
    events: [
      ...prevEvents,
      {
        type: "checkout.created",
        at: Date.now(),
        detail: `${env} checkout ${created.checkout_id}`,
      },
    ],
  };

  await alertSnap.ref.update({ payment: paymentDoc });

  return {
    checkoutUrl: created.checkout_url,
    checkoutId: created.checkout_id,
    reference: created.reference || reference,
    provider: "bachs",
    environment: env,
  };
}

export async function handleBachsWebhook(
  rawBody: Buffer | string,
  headers: Record<string, string | string[] | undefined>,
  baseUrl?: string
): Promise<{ ok: boolean; eventId: string; eventType: string; duplicate?: boolean }> {
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
      status: 401,
    });
  }

  let verifiedEvent: ReturnType<typeof bachsWebhooks.constructEvent> | null = null;
  let lastError = "Invalid webhook signature";
  for (const secret of candidateSecrets) {
    try {
      verifiedEvent = bachsWebhooks.constructEvent(rawBody, headers, secret);
      break;
    } catch (err) {
      lastError = err instanceof Error ? err.message : "Invalid signature";
    }
  }

  if (!verifiedEvent) {
    await db
      .collection("webhookLogs")
      .add({
        provider: "bachs",
        eventType: "signature_error",
        reference: "",
        result: "rejected-signature",
        detail: lastError.slice(0, 300),
        environment: env,
        ts: Date.now(),
      })
      .catch(() => null);
    throw Object.assign(new Error("Invalid Bachs webhook signature"), {
      status: 401,
    });
  }

  const dataObj = verifiedEvent.data || {};
  const meta =
    dataObj.metadata && typeof dataObj.metadata === "object"
      ? (dataObj.metadata as Record<string, unknown>)
      : {};
  const code = String(meta.trackingCode || "").trim().toUpperCase();
  const alertId = String(meta.alertId || "").trim();
  const checkoutId = String(dataObj.checkout_id || dataObj.id || "").trim();
  const paymentId = String(dataObj.payment_id || dataObj.charge_id || checkoutId || "").trim();
  const reference = String(dataObj.reference || meta.reference || checkoutId || "").trim();

  // Always bump lastWebhookAt timestamp
  await db
    .collection("adminSettings")
    .doc("payments")
    .set(
      {
        bachs: {
          lastWebhookAt: Date.now(),
        },
      },
      { merge: true }
    )
    .catch(() => null);

  // Admin test webhook short-circuit
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
    return { ok: true, eventId: verifiedEvent.id, eventType: verifiedEvent.type };
  }

  // Deduplicate event ID in transaction
  const dedupeRef = db.collection("bachsEvents").doc(verifiedEvent.id);
  const alreadyProcessed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(dedupeRef);
    if (snap.exists) {
      return true;
    }
    tx.set(dedupeRef, {
      eventId: verifiedEvent.id,
      type: verifiedEvent.type,
      code: code || null,
      alertId: alertId || null,
      processedAt: FieldValue.serverTimestamp(),
    });
    return false;
  });

  if (alreadyProcessed) {
    await db.collection("webhookLogs").add({
      provider: "bachs",
      eventType: verifiedEvent.type,
      reference: reference || code,
      result: "duplicate",
      detail: `Duplicate event ${verifiedEvent.id} ignored`,
      environment: env,
      ts: Date.now(),
    });
    return {
      ok: true,
      eventId: verifiedEvent.id,
      eventType: verifiedEvent.type,
      duplicate: true,
    };
  }

  if (!isValidTrackingCode(code) || !alertId) {
    await db.collection("webhookLogs").add({
      provider: "bachs",
      eventType: verifiedEvent.type,
      reference: reference || verifiedEvent.id,
      result: "ignored",
      detail: "Webhook event did not reference a valid shipment customs alert",
      environment: env,
      ts: Date.now(),
    });
    return { ok: true, eventId: verifiedEvent.id, eventType: verifiedEvent.type };
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
    return { ok: true, eventId: verifiedEvent.id, eventType: verifiedEvent.type };
  }

  const shipment = shipSnap.data() as ShipmentRecord;
  const alert = alertSnap.data() as ShipmentAlert;
  const prevEvents: CustomsPaymentEvent[] = Array.isArray(alert.payment?.events)
    ? alert.payment.events
    : [];
  const t = verifiedEvent.type.toLowerCase();

  if (
    t === "collection.succeeded" ||
    t === "payment.succeeded" ||
    t === "checkout.session.completed"
  ) {
    // Double-check session directly with Bachs API if key available
    const apiKey = getActiveBachsApiKey(
      alert.payment?.environment || env,
      secrets
    );
    let verifiedAmount = Number(dataObj.amount || alert.amount || 0);
    let verifiedCurrency = String(
      dataObj.currency || alert.currency || "USD"
    ).toUpperCase();

    if (apiKey && checkoutId) {
      try {
        const bachs = getBachsClient(
          apiKey,
          alert.payment?.environment || env
        );
        const session = await bachs.checkoutSessions.get(checkoutId);
        if (session.amount) {
          verifiedAmount = Number(session.amount);
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
      return { ok: true, eventId: verifiedEvent.id, eventType: verifiedEvent.type };
    }

    const now = Date.now();
    await alertRef.update({
      status: "resolved",
      resolvedAt: FieldValue.serverTimestamp(),
      response: `Paid via Bachs (${paymentId || reference})`,
      payment: {
        ...(alert.payment || {}),
        provider: "bachs",
        environment: alert.payment?.environment || env,
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

    // Notify receiver & sender
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
        { template: "charge_paid", code, createdBy: "bachs-webhook" }
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
        { template: "charge_paid", code, createdBy: "bachs-webhook" }
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
      "payment.lastError": "Underpaid — remaining balance required",
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
    t === "checkout.session.expired"
  ) {
    await alertRef.update({
      "payment.status": "failed",
      "payment.lastError":
        t === "checkout.session.expired"
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
  } else if (t === "refund.succeeded" || t === "collection.refunded") {
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

  return { ok: true, eventId: verifiedEvent.id, eventType: verifiedEvent.type };
}

export async function testBachsConnection(): Promise<{
  ok: boolean;
  environment: "sandbox" | "live";
  accountId?: string;
  totalBalanceUsd?: string;
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
  try {
    const bachs = getBachsClient(apiKey, env);
    const balances = await bachs.balances.get();
    return {
      ok: true,
      environment: env,
      accountId: balances.account_id,
      totalBalanceUsd: balances.total_balance_usd,
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
  const bachs = getBachsClient(apiKey, env);
  const baseOrigin = origin.replace(/\/+$/, "");
  const created = await bachs.checkoutSessions.create(
    {
      pricing: {
        currency: publicSettings.bachs.defaultCurrency || "USD",
        amount: "1.00",
      },
      customer: {
        email: actor.email || "ops@shipwell.cc",
        name: "ShipWell Admin Test",
      },
      reference: `SW-TEST-${Date.now().toString(36).toUpperCase()}`,
      metadata: {
        is_test: "true",
        actorUid: actor.uid,
      },
      success_url: `${baseOrigin}/admin/settings?test_paid=1`,
      cancel_url: `${baseOrigin}/admin/settings?test_cancelled=1`,
      expires_in_minutes: 15,
    },
    { idempotencyKey: `admin_test_${Date.now()}` }
  );
  return {
    checkoutId: created.checkout_id,
    checkoutUrl: created.checkout_url,
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

  const refundRes = await fetch(`${getBachsBaseUrl(env)}/v1/refunds`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      payment_id: alert.payment.paymentId,
      amount: Number(alert.payment.amountPaid || alert.amount).toFixed(2),
      reason: params.reason || `Admin refund on ${code}`,
    }),
  });

  const refundJson = (await refundRes.json().catch(() => ({}))) as {
    refund_id?: string;
    id?: string;
    status?: string;
    message?: string;
    error?: { message?: string };
  };

  if (!refundRes.ok) {
    throw new Error(
      refundJson.error?.message ||
        refundJson.message ||
        `Bachs refund endpoint returned HTTP ${refundRes.status}`
    );
  }

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
    note: `Refund ${refundId} processed by ${params.actor.email}.`,
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
