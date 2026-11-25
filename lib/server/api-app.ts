import crypto from "node:crypto";
import express from "express";
import { FieldValue } from "firebase-admin/firestore";
import firebaseConfig from "../../firebase-applet-config.json" with { type: "json" };
import { createSignedInviteToken, verifySignedInviteToken } from "../invites.ts";
import {
  buildAuthPasswordResetEmail,
  buildAuthVerificationEmail,
  buildReceiverInviteEmail,
  buildReceiverOnItsWayEmail,
  buildSecurityEmailChangedEmail,
  buildSenderBookingEmail,
  buildShipmentUpdateEmail,
  buildSupportInboundAdminEmail,
  buildSupportReplyEmail,
  buildUnmonitoredReplyNoticeEmail,
  escapeHtml,
  sanitizeHeaderText,
} from "../email/templates.ts";
import { checkRateLimit, dispatchTransactionalEmail } from "../email/sender.ts";
import { COUNTRIES, calculateShippingPricing } from "../quote-engine.ts";
import {
  adminBookingAction,
  createBachsTestCheckout,
  createCustomsCheckout,
  createServerBooking,
  getCheckoutOptions,
  handleBachsWebhook,
  issueCustomsRefund,
  testBachsConnection,
  type CreateBookingInput,
} from "./bachs.ts";
import { logServerError } from "./error-log.ts";
import {
  AdminSdkUnavailableError,
  getAdminAuth,
  getAdminDb,
  isAdminIamError,
  requireRecentAuth,
  verifyFirebaseAdminAuth,
} from "./firebase-admin.ts";
import {
  adminPaymentAction,
  deleteOrDisablePaymentMethodAdmin,
  duplicatePaymentMethodAdmin,
  expireOverdueManualPaymentsServer,
  listAllPaymentMethodsServer,
  listPublicPaymentMethods,
  reorderPaymentMethodsAdmin,
  savePaymentMethodAdmin,
  submitPaymentProof,
} from "./payment-methods.ts";
import {
  DEFAULT_FROM_SECURITY,
  loadSettingsBundle,
  saveAdminSettings,
  type SaveSettingsPayload,
} from "./settings-store.ts";
import {
  ADMIN_EMAIL,
  isValidTrackingCode,
  normalizeEmail,
  type GatewayId,
  type PaymentMethodRecord,
  type ServiceTier,
} from "../../types/tracking.ts";

/**
 * Firebase returns action links on its own firebaseapp.com handler. Re-point them to our own
 * https://shipwell.cc/auth/action page so customers never see a firebaseapp.com link.
 */
function toBrandedActionUrl(firebaseLink: string, origin: string): string {
  try {
    const u = new URL(firebaseLink);
    const oobCode = u.searchParams.get("oobCode");
    const mode = u.searchParams.get("mode");
    if (!oobCode || !mode) return firebaseLink;
    return `${origin.replace(/\/+$/, "")}/auth/action?mode=${encodeURIComponent(mode)}&oobCode=${encodeURIComponent(oobCode)}&lang=en`;
  } catch {
    return firebaseLink;
  }
}

function getOrigin(req: express.Request): string {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const proto =
    (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto)
      ?.split(",")[0]
      ?.trim() ||
    req.protocol ||
    "https";
  const host = String(req.headers.host || "localhost:3000").trim();
  const hostNoPort = host.split(":")[0].toLowerCase();
  if (
    hostNoPort === "shipwell.cc" ||
    hostNoPort === "www.shipwell.cc" ||
    hostNoPort === "admin.shipwell.cc"
  ) {
    return (
      process.env.APP_URL ||
      process.env.VITE_APP_URL ||
      "https://shipwell.cc"
    ).replace(/\/+$/, "");
  }
  return (
    process.env.APP_URL ||
    process.env.VITE_APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    `${proto}://${host}`
  ).replace(/\/+$/, "");
}

function getAdminEmailOrigin(req: express.Request): string {
  const origin = getOrigin(req);
  if (origin === "https://shipwell.cc") {
    return "https://admin.shipwell.cc";
  }
  return `${origin}/admin`;
}

function getClientIp(req: express.Request): string {
  const fwd = req.headers["x-forwarded-for"];
  const raw = Array.isArray(fwd) ? fwd[0] : fwd;
  return raw?.split(",")[0]?.trim() || req.ip || "unknown";
}

function makeTicketCode(): string {
  return `TKT-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

function stripHtmlTags(html: string): string {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function handleServerError(
  res: express.Response,
  err: unknown,
  fallback: string,
  step = "api_request"
) {
  if (err instanceof AdminSdkUnavailableError || isAdminIamError(err)) {
    const msg =
      err instanceof Error && err.message
        ? err.message
        : "This action requires Firebase Admin SDK access on your Blaze-plan project.";
    logServerError({ step, code: "ADMIN_SDK_UNAVAILABLE", message: msg });
    res.status(503).json({
      error: msg,
      code: "ADMIN_SDK_UNAVAILABLE",
      step,
    });
    return;
  }
  const msg = err instanceof Error ? err.message : fallback;
  const code =
    err && typeof err === "object" && "errorCode" in err && typeof (err as { errorCode: string }).errorCode === "string"
      ? (err as { errorCode: string }).errorCode
      : err && typeof err === "object" && "code" in err && typeof (err as { code: string }).code === "string"
        ? (err as { code: string }).code
        : "SERVER_ERROR";
  const status =
    err && typeof err === "object" && "status" in err && typeof (err as { status: number }).status === "number"
      ? (err as { status: number }).status
      : 400;
  if (status >= 500) {
    logServerError({ step, code, message: msg || fallback });
  }
  res.status(status >= 400 && status < 600 ? status : 500).json({
    error: msg || fallback,
    code,
    step,
  });
}

async function recordInviteActionInFirestore(
  tokenHash: string,
  code: string,
  action: "unknown_sender" | "unsubscribe"
) {
  try {
    const db = getAdminDb();
    await db
      .collection("inviteActions")
      .doc(`${action}_${tokenHash.slice(0, 24)}_${Date.now()}`)
      .set({
        tokenHash,
        code,
        action,
        createdAt: FieldValue.serverTimestamp(),
      });
    return;
  } catch {
    // Fallback to REST commit if Admin IAM is unavailable in Starter Tier preview
  }

  const docId = `${action}_${tokenHash.slice(0, 24)}_${Date.now()}`;
  const docPath = `projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents/inviteActions/${docId}`;
  const commitUrl = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents:commit`;

  await fetch(commitUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      writes: [
        {
          update: {
            name: docPath,
            fields: {
              tokenHash: { stringValue: tokenHash },
              code: { stringValue: code },
              action: { stringValue: action },
            },
          },
          updateTransforms: [
            {
              fieldPath: "createdAt",
              setToServerValue: "REQUEST_TIME",
            },
          ],
        },
      ],
    }),
  }).catch(() => null);
}

function extractRecipientList(rawTo: unknown): string[] {
  const arr = Array.isArray(rawTo) ? rawTo : rawTo ? [rawTo] : [];
  const out: string[] = [];
  for (const item of arr) {
    const s = String(item || "");
    const m = s.match(/<([^>]+)>/);
    const addr = normalizeEmail(m ? m[1] : s);
    if (addr.includes("@")) out.push(addr);
  }
  return out;
}

export function createApiApp(): express.Express {
  const app = express();
  app.set("trust proxy", true);

  // CRITICAL: Raw body route BEFORE express.json() for Bachs webhook signature verification
  app.post(
    "/api/bachs-webhook",
    express.raw({ type: "application/json", limit: "2mb" }),
    async (req, res) => {
      try {
        const rawBody = Buffer.isBuffer(req.body)
          ? req.body
          : Buffer.from(
              typeof req.body === "string" ? req.body : JSON.stringify(req.body || {})
            );
        const result = await handleBachsWebhook(rawBody, req.headers, getOrigin(req));
        res.status(200).json(result);
      } catch (err) {
        const status =
          err &&
          typeof err === "object" &&
          "status" in err &&
          typeof (err as { status: number }).status === "number"
            ? (err as { status: number }).status
            : 500;
        res.status(status >= 400 && status < 600 ? status : 500).json({
          error: err instanceof Error ? err.message : "Webhook processing error",
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

  // ── AUTHENTICATION BRANDED EMAILS (RESEND) ──
  app.post("/api/auth/send-verification", async (req, res) => {
    try {
      const actor = await verifyFirebaseAdminAuth(req.headers);
      if (!actor || !actor.email) {
        res.status(401).json({ error: "Please log in first.", code: "UNAUTHENTICATED" });
        return;
      }

      if (!checkRateLimit(`verify:${actor.uid}`, 1, 60 * 1000)) {
        res.status(429).json({
          error: "Please wait 60 seconds before requesting another verification email.",
          code: "COOLDOWN_ACTIVE",
        });
        return;
      }

      const body = (req.body || {}) as { name?: string };
      const origin = getOrigin(req);
      let verifyUrl = `${origin}/auth/action?mode=verifyEmail`;
      try {
        verifyUrl = toBrandedActionUrl(
          await getAdminAuth().generateEmailVerificationLink(actor.email, {
            url: `${origin}/auth/action`,
            handleCodeInApp: false,
          }),
          origin
        );
      } catch (err) {
        if (isAdminIamError(err)) {
          throw new AdminSdkUnavailableError(
            "Generating branded verification links requires Firebase Admin SDK access on your Blaze-plan project."
          );
        }
        throw err;
      }

      const payload = buildAuthVerificationEmail({
        baseUrl: origin,
        recipientName: sanitizeHeaderText(body.name || actor.email.split("@")[0]),
        verifyUrl,
      });

      const dispatched = await dispatchTransactionalEmail(actor.email, payload, {
        template: "auth_verification",
        category: "security",
        omitReplyTo: true,
        createdBy: actor.uid,
      });

      res.json({
        ok: true,
        status: dispatched.status,
        providerId: dispatched.providerId,
      });
    } catch (err) {
      handleServerError(res, err, "Unable to send verification email.", "send_verification");
    }
  });

  app.post("/api/auth/send-password-reset", async (req, res) => {
    try {
      const body = (req.body || {}) as { email?: string };
      const cleanEmail = normalizeEmail(body.email || "");
      if (!cleanEmail.includes("@")) {
        res.status(400).json({ error: "Valid email address is required.", code: "INVALID_EMAIL" });
        return;
      }

      const ip = getClientIp(req);
      if (!checkRateLimit(`pwreset:${cleanEmail}:${ip}`, 1, 30 * 1000)) {
        res.status(429).json({
          error: "Please wait a moment before requesting another reset link.",
          code: "RATE_LIMITED",
        });
        return;
      }

      const origin = getOrigin(req);
      let resetUrl = "";
      let displayName = cleanEmail.split("@")[0];
      try {
        const userRecord = await getAdminAuth().getUserByEmail(cleanEmail);
        displayName = userRecord.displayName || displayName;
        resetUrl = toBrandedActionUrl(
          await getAdminAuth().generatePasswordResetLink(cleanEmail, {
            url: `${origin}/auth/action`,
            handleCodeInApp: false,
          }),
          origin
        );
      } catch (err) {
        if (isAdminIamError(err)) {
          throw new AdminSdkUnavailableError(
            "Generating branded password reset links requires Firebase Admin SDK access on your Blaze-plan project."
          );
        }
        // User does not exist — return generic ok without leaking account existence
        res.json({ ok: true, status: "sent" });
        return;
      }

      const payload = buildAuthPasswordResetEmail({
        baseUrl: origin,
        recipientName: displayName,
        resetUrl,
      });

      const dispatched = await dispatchTransactionalEmail(cleanEmail, payload, {
        template: "auth_password_reset",
        category: "security",
        omitReplyTo: true,
        createdBy: "password_reset",
      });

      res.json({
        ok: true,
        status: dispatched.status,
      });
    } catch (err) {
      handleServerError(res, err, "Unable to send password reset email.", "send_password_reset");
    }
  });

  app.post("/api/auth/email-changed-alert", async (req, res) => {
    try {
      const actor = await verifyFirebaseAdminAuth(req.headers);
      if (!actor) {
        res.status(401).json({ error: "Authentication required." });
        return;
      }
      const body = (req.body || {}) as { oldEmail?: string; newEmail?: string; name?: string };
      const oldEmail = normalizeEmail(body.oldEmail || "");
      const newEmail = normalizeEmail(body.newEmail || actor.email);
      const origin = getOrigin(req);

      const recipients = new Set([oldEmail, newEmail].filter((e) => e.includes("@")));
      for (const recipient of recipients) {
        await dispatchTransactionalEmail(
          recipient,
          buildSecurityEmailChangedEmail({
            baseUrl: origin,
            recipientName: sanitizeHeaderText(body.name || recipient.split("@")[0]),
            newEmail,
          }),
          {
            template: "auth_email_changed",
            category: "security",
            omitReplyTo: true,
            createdBy: actor.uid,
          }
        ).catch(() => null);
      }
      res.json({ ok: true });
    } catch (err) {
      handleServerError(res, err, "Unable to dispatch email change notice.", "email_changed_alert");
    }
  });

  app.post("/api/admin/login-attempt", async (req, res) => {
    try {
      const ip = getClientIp(req);
      const body = (req.body || {}) as {
        email?: string;
        outcome?: string;
        reason?: string;
      };
      const cleanEmail = normalizeEmail(body.email || "");
      const allowed = checkRateLimit(`admin_login:${ip}:${cleanEmail}`, 10, 15 * 60 * 1000);
      try {
        const db = getAdminDb();
        await db.collection("adminLoginAttempts").add({
          email: cleanEmail.slice(0, 160),
          ip: ip.slice(0, 80),
          outcome: String(body.outcome || "failed").slice(0, 40),
          reason: String(body.reason || "").slice(0, 200),
          ts: Date.now(),
          createdAt: FieldValue.serverTimestamp(),
        });
      } catch {
        // non-blocking
      }
      if (!allowed) {
        res.status(429).json({
          ok: false,
          error: "Too many failed sign-in attempts. Wait 15 minutes before retrying.",
          code: "ADMIN_RATE_LIMITED",
        });
        return;
      }
      res.json({ ok: true });
    } catch {
      res.json({ ok: true });
    }
  });

  // ── PUBLIC & ADMIN PAYMENT METHODS ──
  app.get("/api/payment-methods", async (req, res) => {
    try {
      const appliesTo =
        req.query.appliesTo === "customs"
          ? "customs"
          : req.query.appliesTo === "shipping"
            ? "shipping"
            : undefined;
      const amountUsd = req.query.amount ? Number(req.query.amount) : undefined;
      const country = req.query.country ? String(req.query.country) : undefined;
      const isBusiness = req.query.isBusiness === "true";
      const [methods, { publicSettings }] = await Promise.all([
        listPublicPaymentMethods({ appliesTo, amountUsd, country, isBusiness }),
        loadSettingsBundle(),
      ]);
      res.json({
        ok: true,
        methods,
        currency: publicSettings.bachs.defaultCurrency || "USD",
      });
    } catch (err) {
      handleServerError(res, err, "Unable to load payment methods.", "list_payment_methods");
    }
  });

  app.get("/api/payments/my", async (req, res) => {
    try {
      const actor = await verifyFirebaseAdminAuth(req.headers);
      if (!actor) {
        res.status(401).json({ error: "Please log in to view your payments." });
        return;
      }
      const db = getAdminDb();
      const trackingCode = String(req.query.code || "").trim().toUpperCase();
      let snap;
      if (trackingCode) {
        snap = await db
          .collection("payments")
          .where("trackingCode", "==", trackingCode)
          .where("uid", "==", actor.uid)
          .limit(10)
          .get();
      } else {
        snap = await db
          .collection("payments")
          .where("uid", "==", actor.uid)
          .limit(30)
          .get();
      }
      const payments = snap.docs
        .map((d) => ({ ...d.data(), id: d.id }))
        .sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
          Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0)
        );
      res.json({ ok: true, payments });
    } catch (err) {
      handleServerError(res, err, "Unable to load payments.", "list_my_payments");
    }
  });

  app.post("/api/payments/:paymentId/submit-proof", async (req, res) => {
    try {
      const actor = await verifyFirebaseAdminAuth(req.headers);
      if (!actor) {
        res.status(401).json({ error: "Please log in before uploading payment proof." });
        return;
      }
      const body = (req.body || {}) as {
        screenshotUrl?: string;
        screenshotHash?: string;
        screenshotName?: string;
        txId?: string;
        senderName?: string;
        paidAt?: string;
        note?: string;
      };
      const result = await submitPaymentProof({
        actor,
        paymentId: String(req.params.paymentId || ""),
        screenshotUrl: body.screenshotUrl,
        screenshotHash: body.screenshotHash,
        screenshotName: body.screenshotName,
        txId: body.txId,
        senderName: body.senderName,
        paidAt: body.paidAt,
        note: body.note,
        baseUrl: getOrigin(req),
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      handleServerError(res, err, "Unable to submit payment proof.", "submit_payment_proof");
    }
  });

  app.get("/api/admin/payment-methods", async (req, res) => {
    try {
      const actor = await verifyFirebaseAdminAuth(req.headers);
      if (!actor?.isAdmin) {
        res.status(actor ? 403 : 401).json({ error: "Admin access required." });
        return;
      }
      const methods = await listAllPaymentMethodsServer();
      res.json({ ok: true, methods });
    } catch (err) {
      handleServerError(res, err, "Unable to load admin payment methods.", "admin_list_methods");
    }
  });

  app.post("/api/admin/payment-methods", async (req, res) => {
    try {
      const actor = await verifyFirebaseAdminAuth(req.headers);
      if (!actor?.isAdmin) {
        res.status(actor ? 403 : 401).json({ error: "Admin access required." });
        return;
      }
      const method = await savePaymentMethodAdmin(
        actor,
        (req.body || {}) as Partial<PaymentMethodRecord>
      );
      res.json({ ok: true, method });
    } catch (err) {
      handleServerError(res, err, "Unable to save payment method.", "admin_save_method");
    }
  });

  app.post("/api/admin/payment-methods/duplicate", async (req, res) => {
    try {
      const actor = await verifyFirebaseAdminAuth(req.headers);
      if (!actor?.isAdmin) {
        res.status(actor ? 403 : 401).json({ error: "Admin access required." });
        return;
      }
      const body = (req.body || {}) as { id?: string };
      const method = await duplicatePaymentMethodAdmin(actor, String(body.id || ""));
      res.json({ ok: true, method });
    } catch (err) {
      handleServerError(res, err, "Unable to duplicate payment method.", "admin_dup_method");
    }
  });

  app.post("/api/admin/payment-methods/reorder", async (req, res) => {
    try {
      const actor = await verifyFirebaseAdminAuth(req.headers);
      if (!actor?.isAdmin) {
        res.status(actor ? 403 : 401).json({ error: "Admin access required." });
        return;
      }
      const body = (req.body || {}) as { orderedIds?: string[] };
      const methods = await reorderPaymentMethodsAdmin(
        actor,
        Array.isArray(body.orderedIds) ? body.orderedIds : []
      );
      res.json({ ok: true, methods });
    } catch (err) {
      handleServerError(res, err, "Unable to reorder payment methods.", "admin_reorder_methods");
    }
  });

  app.delete("/api/admin/payment-methods/:id", async (req, res) => {
    try {
      const actor = await verifyFirebaseAdminAuth(req.headers);
      if (!actor?.isAdmin) {
        res.status(actor ? 403 : 401).json({ error: "Admin access required." });
        return;
      }
      const result = await deleteOrDisablePaymentMethodAdmin(
        actor,
        String(req.params.id || "")
      );
      res.json({ ok: true, ...result });
    } catch (err) {
      handleServerError(res, err, "Unable to delete payment method.", "admin_delete_method");
    }
  });

  app.get("/api/admin/payments", async (req, res) => {
    try {
      const actor = await verifyFirebaseAdminAuth(req.headers);
      if (!actor?.isAdmin) {
        res.status(actor ? 403 : 401).json({ error: "Admin access required." });
        return;
      }
      const db = getAdminDb();
      const snap = await db
        .collection("payments")
        .orderBy("createdAtMs", "desc")
        .limit(200)
        .get();
      const payments = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
      res.json({ ok: true, payments });
    } catch (err) {
      handleServerError(res, err, "Unable to load payments queue.", "admin_list_payments");
    }
  });

  app.post("/api/admin/payments/:paymentId/action", async (req, res) => {
    try {
      const actor = await verifyFirebaseAdminAuth(req.headers);
      if (!actor?.isAdmin) {
        res.status(actor ? 403 : 401).json({ error: "Admin access required." });
        return;
      }
      const body = (req.body || {}) as {
        action?: "approve" | "reject" | "request_info" | "mark_received" | "refund" | "extend_window";
        reason?: string;
        extraMinutes?: number;
      };
      if (body.action === "refund" && !requireRecentAuth(actor, 900)) {
        res.status(403).json({
          error: "Please confirm your password before issuing a refund.",
          code: "RECENT_AUTH_REQUIRED",
        });
        return;
      }
      const payment = await adminPaymentAction({
        actor,
        paymentId: String(req.params.paymentId || ""),
        action: body.action || "approve",
        reason: body.reason,
        extraMinutes: body.extraMinutes,
        baseUrl: getOrigin(req),
      });
      res.json({ ok: true, payment });
    } catch (err) {
      handleServerError(res, err, "Unable to apply payment action.", "admin_payment_action");
    }
  });

  app.post("/api/bookings/expire-stale", async (req, res) => {
    try {
      const actor = await verifyFirebaseAdminAuth(req.headers);
      if (!actor?.isAdmin) {
        res.status(actor ? 403 : 401).json({ error: "Admin access required." });
        return;
      }
      const result = await expireOverdueManualPaymentsServer();
      res.json({ ok: true, ...result });
    } catch (err) {
      handleServerError(res, err, "Unable to expire stale payments.", "expire_stale_payments");
    }
  });

  // ── QUOTE & CHECKOUT OPTIONS API ──
  app.post("/api/quote", (req, res) => {
    try {
      const body = (req.body || {}) as {
        from?: string;
        to?: string;
        weightKg?: number;
        declaredValue?: number;
        service?: ServiceTier;
      };
      const from = body.from && COUNTRIES.includes(body.from) ? body.from : "United States";
      const to = body.to && COUNTRIES.includes(body.to) ? body.to : "United Kingdom";
      const weightKg = Math.min(50000, Math.max(0.1, Number(body.weightKg) || 1));
      const declaredValue = Math.max(0, Number(body.declaredValue) || 0);
      const service: ServiceTier =
        body.service === "economy" ||
        body.service === "express" ||
        body.service === "standard"
          ? body.service
          : "standard";

      const quote = calculateShippingPricing(
        from,
        to,
        weightKg,
        declaredValue,
        service
      );
      res.json({ quote });
    } catch {
      res.status(400).json({ error: "Invalid quote payload." });
    }
  });

  app.get("/api/checkout/options", async (_req, res) => {
    try {
      const options = await getCheckoutOptions();
      res.json(options);
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
      const actor = await verifyFirebaseAdminAuth(req.headers);
      if (!actor) {
        res.status(401).json({
          error: "Please log in or sign up before booking a parcel.",
          code: "UNAUTHENTICATED",
          step: "booking_auth",
        });
        return;
      }
      const result = await createServerBooking({
        actor,
        body: (req.body || {}) as CreateBookingInput,
        origin: getOrigin(req),
      });
      res.json(result);
    } catch (err) {
      handleServerError(res, err, "Unable to complete booking.", "booking_server");
    }
  });

  // ── CUSTOMS CHECKOUT ──
  app.post("/api/customs/create-checkout", async (req, res) => {
    try {
      const actor = await verifyFirebaseAdminAuth(req.headers);
      if (!actor) {
        res.status(401).json({ error: "Please log in to pay customs charges." });
        return;
      }
      const body = (req.body || {}) as {
        code?: string;
        alertId?: string;
        gateway?: GatewayId;
        paymentMethodId?: string;
      };
      const result = await createCustomsCheckout({
        code: String(body.code || ""),
        alertId: String(body.alertId || ""),
        actor,
        origin: getOrigin(req),
        gateway: body.gateway,
        paymentMethodId: body.paymentMethodId,
      });
      res.json(result);
    } catch (err) {
      handleServerError(res, err, "Unable to start customs payment checkout.", "customs_checkout");
    }
  });

  // ── ADMIN SETTINGS & ENCRYPTED SECRETS ──
  app.get("/api/admin/settings", async (req, res) => {
    try {
      const actor = await verifyFirebaseAdminAuth(req.headers);
      if (!actor) {
        res.status(401).json({ error: "Authentication required." });
        return;
      }
      if (!actor.isAdmin) {
        res.status(403).json({ error: "Admin access required." });
        return;
      }
      const { publicSettings } = await loadSettingsBundle();
      res.json({ settings: publicSettings });
    } catch (err) {
      handleServerError(res, err, "Unable to load admin settings.", "admin_settings_get");
    }
  });

  app.post("/api/admin/settings", async (req, res) => {
    try {
      const actor = await verifyFirebaseAdminAuth(req.headers);
      if (!actor) {
        res.status(401).json({ error: "Authentication required." });
        return;
      }
      if (!actor.isAdmin) {
        res.status(403).json({ error: "Admin access required." });
        return;
      }

      const body = (req.body || {}) as SaveSettingsPayload;
      const touchesLiveSecrets =
        Boolean(body.bachs?.liveSecretKey) ||
        Boolean(body.bachs?.liveWebhookSecret) ||
        body.bachs?.environment === "live";

      if (touchesLiveSecrets && !requireRecentAuth(actor, 900)) {
        res.status(403).json({
          error: "Please confirm your password before updating Live mode or live secrets.",
          code: "RECENT_AUTH_REQUIRED",
        });
        return;
      }

      const updated = await saveAdminSettings(actor, body);
      res.json({ settings: updated });
    } catch (err) {
      handleServerError(res, err, "Unable to save admin settings.", "admin_settings_save");
    }
  });

  app.post("/api/admin/settings/test-bachs", async (req, res) => {
    try {
      const actor = await verifyFirebaseAdminAuth(req.headers);
      if (!actor?.isAdmin) {
        res.status(actor ? 403 : 401).json({ error: "Admin authorization required." });
        return;
      }
      const result = await testBachsConnection();
      res.json(result);
    } catch (err) {
      handleServerError(res, err, "Bachs connection test failed.", "test_bachs");
    }
  });

  app.post("/api/admin/settings/create-test-checkout", async (req, res) => {
    try {
      const actor = await verifyFirebaseAdminAuth(req.headers);
      if (!actor?.isAdmin) {
        res.status(actor ? 403 : 401).json({ error: "Admin authorization required." });
        return;
      }
      const result = await createBachsTestCheckout(actor, getOrigin(req));
      res.json(result);
    } catch (err) {
      handleServerError(res, err, "Unable to create test checkout.", "test_bachs_checkout");
    }
  });

  app.post("/api/admin/settings/test-email", async (req, res) => {
    try {
      const actor = await verifyFirebaseAdminAuth(req.headers);
      if (!actor?.isAdmin) {
        res.status(actor ? 403 : 401).json({ error: "Admin authorization required." });
        return;
      }
      const body = (req.body || {}) as { to?: string };
      const targetEmail = sanitizeHeaderText(body.to || actor.email || ADMIN_EMAIL).toLowerCase();
      if (!targetEmail.includes("@")) {
        res.status(400).json({ error: "Valid recipient email required." });
        return;
      }
      const origin = getOrigin(req);
      const result = await dispatchTransactionalEmail(
        targetEmail,
        {
          subject: "ShipWell Email Delivery Test (mail.shipwell.cc)",
          preheader: "Resend outbound & inbound settings verified",
          html: `<!DOCTYPE html><html><body style="background:#07090F;color:#F1F5F9;font-family:sans-serif;padding:24px"><div style="max-width:520px;margin:0 auto;background:#0D1117;border:1px solid #1E293B;border-radius:16px;padding:28px"><h2 style="margin:0 0 12px;color:#10B981">ShipWell Test Email</h2><p style="color:#CBD5E1;font-size:14.5px;line-height:1.6">Your Resend outbound and inbound email configuration on <strong>mail.shipwell.cc</strong> is working properly.</p><p style="color:#94A3B8;font-size:12.5px">Origin: ${escapeHtml(origin)} · Sent by ${escapeHtml(actor.email)}</p></div></body></html>`,
          text: `ShipWell Test Email\nYour Resend email configuration on mail.shipwell.cc is working.\nSent by ${actor.email}`,
        },
        {
          template: "admin_test_email",
          category: "notifications",
          code: null,
          createdBy: actor.uid,
        }
      );
      res.json(result);
    } catch (err) {
      handleServerError(res, err, "Unable to send test email.", "test_email");
    }
  });

  app.post("/api/admin/refund", async (req, res) => {
    try {
      const actor = await verifyFirebaseAdminAuth(req.headers);
      if (!actor?.isAdmin) {
        res.status(actor ? 403 : 401).json({ error: "Admin authorization required." });
        return;
      }
      if (!requireRecentAuth(actor, 900)) {
        res.status(403).json({
          error: "Please confirm your password before issuing a refund.",
          code: "RECENT_AUTH_REQUIRED",
        });
        return;
      }
      const body = (req.body || {}) as {
        code?: string;
        alertId?: string;
        reason?: string;
      };
      const result = await issueCustomsRefund({
        code: String(body.code || ""),
        alertId: String(body.alertId || ""),
        actor,
        reason: body.reason,
      });
      res.json(result);
    } catch (err) {
      handleServerError(res, err, "Refund failed.", "admin_refund");
    }
  });

  app.post("/api/admin/booking-action", async (req, res) => {
    try {
      const actor = await verifyFirebaseAdminAuth(req.headers);
      if (!actor?.isAdmin) {
        res.status(actor ? 403 : 401).json({ error: "Admin authorization required." });
        return;
      }
      const body = (req.body || {}) as {
        code?: string;
        action?: "mark_pickup_paid" | "refund_booking";
        reason?: string;
      };
      if (body.action === "refund_booking" && !requireRecentAuth(actor, 900)) {
        res.status(403).json({
          error: "Please confirm your password before refunding a booking.",
          code: "RECENT_AUTH_REQUIRED",
        });
        return;
      }
      const action =
        body.action === "refund_booking" ? "refund_booking" : "mark_pickup_paid";
      const result = await adminBookingAction({
        actor,
        code: String(body.code || ""),
        action,
        reason: body.reason,
      });
      res.json(result);
    } catch (err) {
      handleServerError(res, err, "Booking update failed.", "admin_booking_action");
    }
  });

  // ── SUPPORT CONTACT & INBOX ROUTES ──
  app.post("/api/support/contact", async (req, res) => {
    try {
      const ip = getClientIp(req);
      if (!checkRateLimit(`support:${ip}`, 10, 60 * 60 * 1000)) {
        res.status(429).json({ error: "Too many messages sent. Please try again later." });
        return;
      }

      const actor = await verifyFirebaseAdminAuth(req.headers);
      const body = (req.body || {}) as {
        name?: string;
        email?: string;
        code?: string;
        subject?: string;
        message?: string;
        _hp?: string;
      };

      if (body._hp && String(body._hp).trim().length > 0) {
        res.json({ ok: true, ticketCode: "TKT-RECEIVED" });
        return;
      }

      const name = sanitizeHeaderText(body.name || "").slice(0, 120);
      const email = normalizeEmail(body.email || actor?.email || "");
      const codeRaw = sanitizeHeaderText(body.code || "").toUpperCase();
      const code = isValidTrackingCode(codeRaw) ? codeRaw : null;
      const subject = sanitizeHeaderText(body.subject || "").slice(0, 160);
      const message = String(body.message || "").trim().slice(0, 4000);

      if (!name || !email.includes("@") || !subject || !message) {
        res
          .status(400)
          .json({ error: "Name, email, subject, and message are required." });
        return;
      }

      const db = getAdminDb();
      const ticketCode = makeTicketCode();
      const now = Date.now();
      const threadRef = db.collection("supportThreads").doc();
      const msgRef = threadRef.collection("messages").doc();

      const batch = db.batch();
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
      batch.set(msgRef, {
        from: "user",
        senderName: name,
        senderEmail: email,
        body: message,
        source: "web",
        ts: now,
        createdAt: FieldValue.serverTimestamp(),
      });
      await batch.commit();

      const { publicSettings } = await loadSettingsBundle();
      const supportInbox = publicSettings.resend.supportInbox || ADMIN_EMAIL;
      await dispatchTransactionalEmail(
        supportInbox,
        buildSupportInboundAdminEmail({
          baseUrl: getAdminEmailOrigin(req),
          ticketCode,
          senderName: name,
          senderEmail: email,
          subject,
          body: message,
          trackingCode: code,
          threadId: threadRef.id,
        }),
        {
          template: "support_contact",
          category: "support",
          code,
          replyToOverride: email,
          createdBy: actor?.uid || "public_contact",
        }
      );

      res.json({
        ok: true,
        threadId: threadRef.id,
        ticketCode,
      });
    } catch (err) {
      handleServerError(res, err, "Unable to submit support message.", "support_contact");
    }
  });

  app.post("/api/support/reply", async (req, res) => {
    try {
      const actor = await verifyFirebaseAdminAuth(req.headers);
      if (!actor) {
        res.status(401).json({ error: "Please log in to reply." });
        return;
      }

      const body = (req.body || {}) as {
        threadId?: string;
        message?: string;
        status?: "open" | "closed";
      };
      const threadId = String(body.threadId || "").trim();
      const message = String(body.message || "").trim().slice(0, 4000);
      if (!threadId) {
        res.status(400).json({ error: "Thread ID is required." });
        return;
      }

      const db = getAdminDb();
      const threadRef = db.collection("supportThreads").doc(threadId);
      const threadSnap = await threadRef.get();
      if (!threadSnap.exists) {
        res.status(404).json({ error: "Support thread not found." });
        return;
      }

      const thread = threadSnap.data() as {
        uid?: string | null;
        userEmail: string;
        userName: string;
        ticketCode: string;
        subject: string;
        code?: string | null;
        status: "open" | "closed";
      };

      const isOwner =
        (thread.uid && thread.uid === actor.uid) ||
        normalizeEmail(thread.userEmail) === actor.email;
      if (!actor.isAdmin && !isOwner) {
        res.status(403).json({ error: "You cannot reply to this support thread." });
        return;
      }

      const now = Date.now();
      const batch = db.batch();
      const nextStatus =
        actor.isAdmin && (body.status === "open" || body.status === "closed")
          ? body.status
          : "open";

      if (message) {
        const msgRef = threadRef.collection("messages").doc();
        batch.set(msgRef, {
          from: actor.isAdmin ? "admin" : "user",
          senderName: actor.isAdmin ? "ShipWell Support" : thread.userName || actor.email,
          senderEmail: actor.email,
          body: message,
          source: "web",
          ts: now,
          createdAt: FieldValue.serverTimestamp(),
        });
        batch.update(threadRef, {
          status: nextStatus,
          unreadAdmin: !actor.isAdmin,
          unreadUser: actor.isAdmin,
          lastMessageAt: now,
          lastMessagePreview: message.slice(0, 140),
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else if (actor.isAdmin && (body.status === "open" || body.status === "closed")) {
        batch.update(threadRef, {
          status: nextStatus,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      await batch.commit();

      if (message) {
        const { publicSettings } = await loadSettingsBundle();
        if (actor.isAdmin) {
          await dispatchTransactionalEmail(
            thread.userEmail,
            buildSupportReplyEmail({
              baseUrl: getOrigin(req),
              ticketCode: thread.ticketCode,
              recipientName: thread.userName || "Customer",
              subject: thread.subject,
              replyBody: message,
              trackingCode: thread.code,
              threadId,
            }),
            {
              template: "support_reply",
              category: "support",
              code: thread.code || null,
              createdBy: actor.uid,
            }
          );
        } else {
          await dispatchTransactionalEmail(
            publicSettings.resend.supportInbox || ADMIN_EMAIL,
            buildSupportInboundAdminEmail({
              baseUrl: getAdminEmailOrigin(req),
              ticketCode: thread.ticketCode,
              senderName: thread.userName || actor.email,
              senderEmail: actor.email,
              subject: thread.subject,
              body: message,
              trackingCode: thread.code,
              threadId,
            }),
            {
              template: "support_customer_reply",
              category: "support",
              code: thread.code || null,
              replyToOverride: actor.email,
              createdBy: actor.uid,
            }
          );
        }
      }

      res.json({ ok: true });
    } catch (err) {
      handleServerError(res, err, "Unable to send reply.", "support_reply");
    }
  });

  // ── RESEND INBOUND & DELIVERY WEBHOOKS ──
  app.post("/api/inbound-email", async (req, res) => {
    try {
      const { publicSettings, secrets } = await loadSettingsBundle();
      const db = getAdminDb();
      const rawBuf = (req as express.Request & { rawBody?: Buffer }).rawBody;
      const rawText = rawBuf ? rawBuf.toString("utf8") : JSON.stringify(req.body || {});
      const svixId = String(req.headers["svix-id"] || "").trim();
      const svixTs = String(req.headers["svix-timestamp"] || "").trim();
      const svixSig = String(req.headers["svix-signature"] || "").trim();

      const inboundSecret = secrets.resendInboundSecret || process.env.RESEND_INBOUND_SECRET || "";
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
              .update(`${svixId}.${svixTs}.${rawText}`, "utf8")
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
          const expected = crypto.createHmac("sha256", inboundSecret).update(rawText, "utf8").digest("hex").toLowerCase();
          const pBuf = Buffer.from(provided, "utf8");
          const eBuf = Buffer.from(expected, "utf8");
          if (pBuf.length === eBuf.length && crypto.timingSafeEqual(pBuf, eBuf)) {
            verified = true;
          }
        }

        if (!verified) {
          await db.collection("webhookLogs").add({
            provider: "resend-inbound",
            eventType: "signature_error",
            reference: svixId || "",
            result: "rejected-signature",
            detail: "Invalid or missing Svix/Resend inbound signature",
            ts: Date.now(),
          }).catch(() => null);
          res.status(401).json({ error: "Inbound webhook signature verification failed." });
          return;
        }
      }

      const payload = (req.body || {}) as {
        id?: string;
        type?: string;
        data?: Record<string, unknown>;
        from?: string;
        to?: unknown;
        subject?: string;
        text?: string;
        html?: string;
      };

      if (payload.type && payload.type !== "email.received") {
        res.status(200).json({ ok: true, ignored: true });
        return;
      }

      const inner = payload.data && typeof payload.data === "object" ? payload.data : payload;
      const emailIdRaw = String((inner as Record<string, unknown>).email_id || "").trim();
      const eventKey = String(
        svixId ||
          payload.id ||
          emailIdRaw ||
          crypto.createHash("sha256").update(rawText).digest("hex").slice(0, 32)
      ).replace(/[^a-zA-Z0-9_-]/g, "_");

      const dedupRef = db.collection("emailDedup").doc(`inbound_${eventKey}`);
      const isDuplicate = await db.runTransaction(async (tx) => {
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
        await db.collection("webhookLogs").add({
          provider: "resend-inbound",
          eventType: payload.type || "email.received",
          reference: eventKey,
          result: "duplicate",
          detail: "Duplicate inbound email webhook ignored",
          ts: Date.now(),
        }).catch(() => null);
        res.status(200).json({ ok: true, duplicate: true });
        return;
      }

      const fromRaw = String(inner.from || payload.from || "");
      const emailMatch = fromRaw.match(/<([^>]+)>/);
      const fromEmail = normalizeEmail(emailMatch ? emailMatch[1] : fromRaw);
      const fromName =
        (emailMatch ? fromRaw.replace(emailMatch[0], "").replace(/["']/g, "").trim() : "") ||
        fromEmail.split("@")[0] ||
        "Customer";

      if (!fromEmail.includes("@") || fromEmail.endsWith("@mail.shipwell.cc")) {
        res.status(200).json({ ok: true, ignored: true });
        return;
      }

      // Enforce per-address routing: ONLY mail addressed to support opens supportThreads.
      // Replies to unmonitored addresses (noreply@, tracking@, billing@, payments@, notifications@) are ignored cleanly
      // with at most 1 auto-redirect notice per sender per 24 hours.
      const recipients = extractRecipientList(inner.to ?? payload.to);
      const supportAddr = normalizeEmail(
        publicSettings.resend.supportInbox || "support@mail.shipwell.cc"
      );
      const allowedSupportAddresses = new Set([
        supportAddr,
        "support@mail.shipwell.cc",
        "support@shipwell.cc",
      ]);
      const isAllowedSupportRecipient =
        recipients.length === 0 ||
        recipients.some(
          (addr) => allowedSupportAddresses.has(addr) || addr.endsWith(".resend.app")
        );
      if (!isAllowedSupportRecipient) {
        const attemptedAddress = recipients[0];
        await db.collection("webhookLogs").add({
          provider: "resend-inbound",
          eventType: "unmonitored_recipient",
          reference: attemptedAddress,
          result: "ignored",
          detail: `Ignored inbound mail from ${fromEmail} addressed to ${attemptedAddress}`,
          ts: Date.now(),
        }).catch(() => null);

        if (checkRateLimit(`unmonitored:${fromEmail}`, 1, 24 * 60 * 60 * 1000)) {
          await dispatchTransactionalEmail(
            fromEmail,
            buildUnmonitoredReplyNoticeEmail({
              baseUrl: getOrigin(req),
              attemptedAddress,
            }),
            {
              template: "unmonitored_redirect",
              category: "security",
              fromOverride: DEFAULT_FROM_SECURITY,
              omitReplyTo: true,
              createdBy: "resend-inbound",
            }
          ).catch(() => null);
        }

        res.status(200).json({ ok: true, ignored: true, reason: "unmonitored_address" });
        return;
      }

      const subject = sanitizeHeaderText(
        String(inner.subject || payload.subject || "(No subject)")
      );
      let rawTextBody = String(inner.text || payload.text || "").trim();
      let rawHtml = String(inner.html || payload.html || "").trim();

      // Resend's email.received webhook omits text/html and provides email_id; fetch full body from Resend Receiving API.
      const resendKey = secrets.resendApiKey || process.env.RESEND_API_KEY || "";
      if (!rawTextBody && !rawHtml && resendKey && /^[a-zA-Z0-9_-]{4,128}$/.test(emailIdRaw)) {
        try {
          const emailRes = await fetch(
            `https://api.resend.com/emails/receiving/${encodeURIComponent(emailIdRaw)}`,
            {
              headers: { Authorization: `Bearer ${resendKey}` },
              signal: AbortSignal.timeout(6000),
            }
          );
          if (emailRes.ok) {
            const fullEmail = (await emailRes.json()) as { text?: unknown; html?: unknown };
            rawTextBody = String(fullEmail.text || "").trim();
            rawHtml = String(fullEmail.html || "").trim();
          }
        } catch {
          // Non-fatal: fall back to metadata preview
        }
      }

      const cleanBody = (rawTextBody || stripHtmlTags(rawHtml) || "(Empty message)").slice(
        0,
        4000
      );

      const tktMatch = subject.match(/\[(TKT-[A-Z0-9]+)\]/i);
      const codeMatch = `${subject} ${cleanBody}`.match(/\b(SW-\d{8}-[A-F0-9]{8})\b/i);
      const matchedCode = codeMatch ? codeMatch[1].toUpperCase() : null;

      let targetThreadRef: FirebaseFirestore.DocumentReference | null = null;
      let ticketCode = tktMatch ? tktMatch[1].toUpperCase() : makeTicketCode();

      if (tktMatch) {
        const snap = await db
          .collection("supportThreads")
          .where("ticketCode", "==", ticketCode)
          .limit(1)
          .get();
        if (!snap.empty) {
          targetThreadRef = snap.docs[0].ref;
        }
      }

      if (!targetThreadRef) {
        const byEmailSnap = await db
          .collection("supportThreads")
          .where("userEmail", "==", fromEmail)
          .where("status", "==", "open")
          .limit(1)
          .get();
        if (!byEmailSnap.empty) {
          targetThreadRef = byEmailSnap.docs[0].ref;
          ticketCode = String(byEmailSnap.docs[0].data().ticketCode || ticketCode);
        }
      }

      const now = Date.now();
      if (!targetThreadRef) {
        targetThreadRef = db.collection("supportThreads").doc();
        await targetThreadRef.set({
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
          lastMessagePreview: cleanBody.slice(0, 140),
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else {
        await targetThreadRef.update({
          status: "open",
          unreadAdmin: true,
          lastMessageAt: now,
          lastMessagePreview: cleanBody.slice(0, 140),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      await targetThreadRef.collection("messages").add({
        from: "user",
        senderName: fromName,
        senderEmail: fromEmail,
        body: cleanBody,
        source: "email",
        ts: now,
        createdAt: FieldValue.serverTimestamp(),
      });

      await db.collection("webhookLogs").add({
        provider: "resend-inbound",
        eventType: "email.received",
        reference: ticketCode,
        result: "processed",
        detail: `Inbound support email from ${fromEmail}`,
        ts: now,
      });

      await dispatchTransactionalEmail(
        ADMIN_EMAIL,
        buildSupportInboundAdminEmail({
          baseUrl: getAdminEmailOrigin(req),
          ticketCode,
          senderName: fromName,
          senderEmail: fromEmail,
          subject,
          body: cleanBody,
          trackingCode: matchedCode,
          threadId: targetThreadRef.id,
        }),
        {
          template: "inbound_email_alert",
          category: "support",
          code: matchedCode,
          replyToOverride: fromEmail,
          createdBy: "resend-inbound",
        }
      );

      res.status(200).json({ ok: true, threadId: targetThreadRef.id, ticketCode });
    } catch (err) {
      handleServerError(res, err, "Inbound email webhook failed.", "inbound_email");
    }
  });

  app.post("/api/resend-webhook", async (req, res) => {
    try {
      const payload = (req.body || {}) as {
        type?: string;
        data?: { email_id?: string };
      };
      const eventType = String(payload.type || "");
      const emailId = String(payload.data?.email_id || "").trim();
      if (!emailId) {
        res.status(200).json({ ok: true, ignored: true });
        return;
      }

      const db = getAdminDb();
      const nextStatus =
        eventType === "email.delivered"
          ? "delivered"
          : eventType === "email.bounced" || eventType === "email.delivery_delayed"
            ? "bounced"
            : null;

      if (nextStatus) {
        const snap = await db
          .collection("emailLogs")
          .where("providerId", "==", emailId)
          .limit(3)
          .get();
        await Promise.all(snap.docs.map((d) => d.ref.update({ status: nextStatus })));
      }

      await db.collection("webhookLogs").add({
        provider: "resend",
        eventType,
        reference: emailId,
        result: "processed",
        detail: `Updated delivery state (${nextStatus || "ignored"})`,
        ts: Date.now(),
      });

      res.status(200).json({ ok: true });
    } catch (err) {
      handleServerError(res, err, "Resend webhook error.", "resend_webhook");
    }
  });

  // ── INVITE VERIFICATION & EMAIL ROUTES ──
  app.post("/api/invites/verify", (req, res) => {
    try {
      const body = (req.body || {}) as { token?: string; code?: string };
      const result = verifySignedInviteToken(
        String(body.token || ""),
        body.code ? String(body.code) : undefined
      );
      res.json(result);
    } catch {
      res.status(400).json({
        valid: false,
        expired: false,
        reason: "Verification failed.",
      });
    }
  });

  app.get("/api/invites/action", async (req, res) => {
    const token = String(req.query.token || "");
    const action = String(req.query.action || "");
    const verified = verifySignedInviteToken(token);

    if (!verified.valid && !verified.expired) {
      res
        .status(400)
        .setHeader("Content-Type", "text/html; charset=utf-8")
        .send(
          `<!DOCTYPE html><html><body style="background:#07090F;color:#F1F5F9;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px"><div style="max-width:440px;background:#0D1117;border:1px solid #1E293B;border-radius:16px;padding:28px;text-align:center"><h2 style="margin:0 0 12px">Invalid link</h2><p style="color:#94A3B8;font-size:14px">This invitation link is not valid.</p></div></body></html>`
        );
      return;
    }

    const normalizedAction =
      action === "unknown_sender" ? "unknown_sender" : "unsubscribe";
    if (verified.code) {
      await recordInviteActionInFirestore(
        verified.tokenHash,
        verified.code,
        normalizedAction
      );
    }

    const title =
      normalizedAction === "unknown_sender"
        ? "Shipment flagged for review"
        : "Reminders paused";
    const bodyText =
      normalizedAction === "unknown_sender"
        ? "Thank you for letting us know. We have stopped all reminder emails for this parcel and flagged the shipment for ShipWell operations review."
        : "You will no longer receive reminder emails about creating an account for this shipment.";

    res
      .status(200)
      .setHeader("Content-Type", "text/html; charset=utf-8")
      .send(
        `<!DOCTYPE html><html><body style="background:#07090F;color:#F1F5F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px"><div style="max-width:460px;background:#0D1117;border:1px solid #1E293B;border-radius:18px;padding:32px;text-align:center"><div style="display:inline-block;padding:6px 14px;border-radius:100px;background:rgba(16,185,129,0.12);color:#10B981;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:16px">ShipWell Trust &amp; Safety</div><h1 style="margin:0 0 12px;font-size:24px">${title}</h1><p style="color:#94A3B8;font-size:14.5px;line-height:1.65;margin:0 0 24px">${bodyText}</p><a href="/" style="display:inline-block;background:#10B981;color:#04120C;font-weight:700;font-size:14px;text-decoration:none;padding:12px 22px;border-radius:10px">Return to ShipWell</a></div></body></html>`
      );
  });

  app.post("/api/invites/create", async (req, res) => {
    try {
      const authUser = await verifyFirebaseAdminAuth(req.headers);
      if (!authUser) {
        res.status(401).json({ error: "Authentication required." });
        return;
      }

      const ip = getClientIp(req);
      if (!checkRateLimit(`ip:${ip}`, 30, 60 * 60 * 1000)) {
        res
          .status(429)
          .json({ error: "Rate limit exceeded. Please try again later." });
        return;
      }

      const body = (req.body || {}) as {
        code?: string;
        senderFullName?: string;
        senderEmail?: string;
        receiverFullName?: string;
        receiverEmail?: string;
        contents?: string;
        originCity?: string;
        originCountry?: string;
        destinationCity?: string;
        destinationCountry?: string;
        etaLabel?: string;
        totalFormatted?: string;
        receiverHasAccount?: boolean;
        isReminder?: boolean;
        sendSenderReceipt?: boolean;
      };

      const code = String(body.code || "").trim().toUpperCase();
      const receiverEmail = String(body.receiverEmail || "").trim().toLowerCase();
      const senderEmail = String(body.senderEmail || "").trim().toLowerCase();

      if (!isValidTrackingCode(code) || !receiverEmail.includes("@")) {
        res
          .status(400)
          .json({ error: "Valid tracking code and receiver email are required." });
        return;
      }

      if (
        !checkRateLimit(
          `invite:${senderEmail || "op"}->${receiverEmail}`,
          5,
          24 * 60 * 60 * 1000
        )
      ) {
        res
          .status(429)
          .json({ error: "Daily invite limit reached for this recipient." });
        return;
      }

      const baseUrl = getOrigin(req);
      const receiverFullName = String(body.receiverFullName || "Recipient").trim();
      const senderFullName = String(body.senderFullName || "A ShipWell sender").trim();
      const receiverFirst = receiverFullName.split(/\s+/)[0] || "there";

      const { token, tokenHash, expiresAt } = createSignedInviteToken({
        code,
        receiverEmail,
        receiverFirstName: receiverFirst,
        senderFullName,
      });

      const receiverHasAccount = Boolean(body.receiverHasAccount);
      const templateName = receiverHasAccount
        ? "on_its_way"
        : body.isReminder
          ? "reminder"
          : "invite";

      const receiverPayload = receiverHasAccount
        ? buildReceiverOnItsWayEmail({
            baseUrl,
            trackingCode: code,
            senderFullName,
            receiverFullName,
            receiverEmail,
            contents: String(body.contents || "Parcel"),
            originCity: String(body.originCity || "Origin"),
            originCountry: String(body.originCountry || ""),
            etaLabel: String(body.etaLabel || "scheduled"),
            inviteToken: token,
          })
        : buildReceiverInviteEmail({
            baseUrl,
            trackingCode: code,
            senderFullName,
            receiverFullName,
            receiverEmail,
            contents: String(body.contents || "Parcel"),
            originCity: String(body.originCity || "Origin"),
            originCountry: String(body.originCountry || ""),
            etaLabel: String(body.etaLabel || "scheduled"),
            inviteToken: token,
            isReminder: Boolean(body.isReminder),
          });

      const receiverDispatch = await dispatchTransactionalEmail(
        receiverEmail,
        receiverPayload,
        {
          template: templateName,
          category: "tracking",
          prefKey: "onway",
          code,
          createdBy: authUser.uid,
        }
      );

      let senderDispatch = null;
      let senderSubject = "";
      if (body.sendSenderReceipt && senderEmail.includes("@")) {
        const routeLabel = `${body.originCity || "Origin"} → ${body.destinationCity || "Destination"}`;
        const senderPayload = buildSenderBookingEmail({
          baseUrl,
          trackingCode: code,
          senderFullName,
          receiverFullName,
          receiverEmail,
          routeLabel,
          etaLabel: String(body.etaLabel || "scheduled"),
          totalFormatted: String(body.totalFormatted || "$0.00"),
        });
        senderSubject = senderPayload.subject;
        senderDispatch = await dispatchTransactionalEmail(senderEmail, senderPayload, {
          template: "sender_booking",
          category: "billing",
          code,
          createdBy: authUser.uid,
        });
      }

      res.json({
        tokenHash,
        expiresAt,
        template: templateName,
        invitePath: `/track/${code}?invite=${token}`,
        receiverEmailResult: {
          status: receiverDispatch.status,
          providerId: receiverDispatch.providerId,
          subject: receiverPayload.subject,
          html: receiverPayload.html,
          text: receiverPayload.text,
        },
        senderEmailResult: senderDispatch
          ? {
              status: senderDispatch.status,
              providerId: senderDispatch.providerId,
              subject: senderSubject,
            }
          : null,
      });
    } catch {
      res.status(500).json({ error: "Unable to create invite." });
    }
  });

  app.post("/api/shipments/notify", async (req, res) => {
    try {
      const authUser = await verifyFirebaseAdminAuth(req.headers);
      if (!authUser) {
        res.status(401).json({ error: "Authentication required." });
        return;
      }

      const body = (req.body || {}) as {
        code?: string;
        toEmail?: string;
        recipientName?: string;
        senderFullName?: string;
        updateType?: "checkpoint" | "delay" | "action_required" | "delivered";
        headline?: string;
        details?: string;
        hasAccount?: boolean;
      };

      const updateType = body.updateType || "checkpoint";
      if ((updateType === "delay" || updateType === "delivered") && !authUser.isAdmin) {
        res.status(403).json({ error: "Operations authorization required." });
        return;
      }

      const code = String(body.code || "").trim().toUpperCase();
      const toEmail = String(body.toEmail || "").trim().toLowerCase();
      if (!isValidTrackingCode(code) || !toEmail.includes("@")) {
        res
          .status(400)
          .json({ error: "Valid tracking code and email required." });
        return;
      }

      const baseUrl = getOrigin(req);
      const recipientName = String(body.recipientName || "Customer").trim();

      let inviteToken: string | undefined;
      if (!body.hasAccount) {
        inviteToken = createSignedInviteToken({
          code,
          receiverEmail: toEmail,
          receiverFirstName: recipientName.split(/\s+/)[0] || "there",
          senderFullName: String(body.senderFullName || "ShipWell sender"),
        }).token;
      }

      const payload = buildShipmentUpdateEmail({
        baseUrl,
        trackingCode: code,
        recipientName,
        updateType,
        headline: String(body.headline || "Shipment status updated"),
        details: String(body.details || ""),
        hasAccount: Boolean(body.hasAccount),
        inviteToken,
      });

      const result = await dispatchTransactionalEmail(toEmail, payload, {
        template: `shipment_${updateType}`,
        category: "tracking",
        prefKey: updateType === "action_required" ? "action" : "scan",
        code,
        createdBy: authUser.uid,
      });
      res.json({
        status: result.status,
        providerId: result.providerId,
        subject: payload.subject,
      });
    } catch {
      res
        .status(500)
        .json({ error: "Unable to dispatch shipment notification." });
    }
  });

  app.post("/api/leads/notify", async (req, res) => {
    try {
      const ip = getClientIp(req);
      if (!checkRateLimit(`lead:${ip}`, 10, 60 * 60 * 1000)) {
        res
          .status(429)
          .json({ error: "Too many enquiries. Please try again later." });
        return;
      }

      const body = (req.body || {}) as {
        ref?: string;
        company?: string;
        name?: string;
        email?: string;
        plan?: string;
        volume?: string;
        message?: string;
      };

      const ref = sanitizeHeaderText(body.ref || "").toUpperCase();
      const company = sanitizeHeaderText(body.company || "");
      const name = sanitizeHeaderText(body.name || "");
      const email = sanitizeHeaderText(body.email || "").toLowerCase();
      const plan = sanitizeHeaderText(body.plan || "Growth");
      const volume = sanitizeHeaderText(body.volume || "");
      const message = String(body.message || "").trim();

      if (!ref || !company || !name || !email.includes("@")) {
        res
          .status(400)
          .json({ error: "Reference, company, name, and email are required." });
        return;
      }

      const subject = sanitizeHeaderText(
        `New ShipWell Business Lead (${ref}): ${company} — ${plan}`
      );

      const html = `<!DOCTYPE html>
<html lang="en">
<body style="margin:0;padding:24px;background:#07090F;color:#F1F5F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#0D1117;border:1px solid #1E293B;border-radius:16px;padding:28px;">
    <p style="margin:0 0 8px 0;font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#3B82F6;">ShipWell Business Enquiry</p>
    <h1 style="margin:0 0 18px 0;font-size:22px;color:#F1F5F9;">${escapeHtml(company)}</h1>
    <p style="margin:0 0 8px 0;font-size:14px;color:#E2E8F0;"><strong>Reference:</strong> ${escapeHtml(ref)}</p>
    <p style="margin:0 0 8px 0;font-size:14px;color:#E2E8F0;"><strong>Contact:</strong> ${escapeHtml(name)} (${escapeHtml(email)})</p>
    <p style="margin:0 0 8px 0;font-size:14px;color:#E2E8F0;"><strong>Plan:</strong> ${escapeHtml(plan)}</p>
    <p style="margin:0 0 14px 0;font-size:14px;color:#E2E8F0;"><strong>Monthly volume:</strong> ${escapeHtml(volume)}</p>
    ${message ? `<div style="padding:14px;border-radius:10px;background:#111827;border:1px solid #1E293B;font-size:13.5px;color:#CBD5E1;line-height:1.6;">${escapeHtml(message)}</div>` : ""}
  </div>
</body>
</html>`;

      const text = `New ShipWell Business Enquiry (${ref})\nCompany: ${company}\nContact: ${name} (${email})\nPlan: ${plan}\nMonthly volume: ${volume}\n\n${message}`;

      const result = await dispatchTransactionalEmail(
        ADMIN_EMAIL,
        {
          subject,
          preheader: `${company} (${plan})`,
          html,
          text,
        },
        {
          template: "business_lead",
          category: "notifications",
          code: null,
          replyToOverride: email,
          createdBy: "lead_form",
        }
      );

      res.json({
        status: result.status,
        providerId: result.providerId,
      });
    } catch {
      res
        .status(500)
        .json({ error: "Unable to dispatch lead notification." });
    }
  });

  // Always return JSON for unmatched /api/* endpoints instead of SPA HTML
  app.all("/api/{*rest}", (req, res) => {
    res.status(404).json({
      error: `API route not found: ${req.method} ${req.originalUrl}`,
      code: "API_NOT_FOUND",
    });
  });

  return app;
}
