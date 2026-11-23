import crypto from "node:crypto";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import {
  ADMIN_EMAIL,
  normalizeEmail,
  type BookingRecord,
  type ManualPaymentRecord,
  type PaymentMethodDetailRow,
  type PaymentMethodRecord,
  type ShipmentAlert,
  type ShipmentRecord,
} from "../../types/tracking.ts";
import { dispatchTransactionalEmail } from "../email/sender.ts";
import {
  buildManualPaymentInstructionsEmail,
  buildPaymentApprovedReceiptEmail,
  buildPaymentExpiredEmail,
  buildPaymentMoreInfoEmail,
  buildPaymentProofAdminAlertEmail,
  buildPaymentProofSubmittedCustomerEmail,
  buildPaymentRejectedEmail,
  buildPaymentRefundedEmail,
} from "../email/templates.ts";
import {
  DEFAULT_PAYMENT_METHODS,
  calculateMethodAmounts,
  filterEligiblePaymentMethods,
  formatMethodInstructions,
} from "../payment-methods.ts";
import {
  AdminSdkUnavailableError,
  getAdminDb,
  isAdminIamError,
  type VerifiedServerUser,
} from "./firebase-admin.ts";
import {
  dispatchBookingConfirmationEmails,
  reconcileShipmentHoldAfterResolution,
} from "./bachs.ts";
import { logServerError } from "./error-log.ts";

function sanitizeMethodId(raw: string): string {
  const clean = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return clean || `pm_${crypto.randomBytes(4).toString("hex")}`;
}

export function generatePaymentReference(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return `SW-PAY-${code}`;
}

function formatAmountLabel(amount: number, currency: string): string {
  const cur = (currency || "USD").toUpperCase();
  const decimals = cur === "JPY" ? 0 : 2;
  return `${Number(amount || 0).toFixed(decimals)} ${cur}`;
}

function normalizeMethodInput(
  raw: Partial<PaymentMethodRecord>,
  fallbackOrder = 10
): PaymentMethodRecord {
  const allowedTypes: PaymentMethodRecord["type"][] = [
    "automatic",
    "bank_transfer",
    "crypto",
    "mobile_money",
    "cash",
    "other",
  ];
  const type = allowedTypes.includes(raw.type as PaymentMethodRecord["type"])
    ? (raw.type as PaymentMethodRecord["type"])
    : "other";
  const gateway =
    type === "automatic"
      ? raw.gateway === "stripe" || raw.gateway === "paystack" || raw.gateway === "bachs"
        ? raw.gateway
        : "bachs"
      : null;

  const details: PaymentMethodDetailRow[] = Array.isArray(raw.details)
    ? raw.details
        .slice(0, 12)
        .map((r) => ({
          label: String(r?.label || "").trim().slice(0, 60),
          value: String(r?.value || "").trim().slice(0, 240),
          copyable: Boolean(r?.copyable),
        }))
        .filter((r) => r.label && r.value)
    : [];

  const appliesTo =
    raw.rules?.appliesTo === "shipping" ||
    raw.rules?.appliesTo === "customs" ||
    raw.rules?.appliesTo === "both"
      ? raw.rules.appliesTo
      : "both";
  const audience = raw.rules?.audience === "business" ? "business" : "everyone";
  const allowedCountries = Array.isArray(raw.rules?.allowedCountries)
    ? raw.rules.allowedCountries
        .map((c) => String(c || "").trim())
        .filter(Boolean)
        .slice(0, 40)
    : [];

  return {
    id: sanitizeMethodId(raw.id || ""),
    name: String(raw.name || "Custom payment method").trim().slice(0, 80),
    subtitle: String(raw.subtitle || "").trim().slice(0, 140),
    type,
    gateway,
    enabled: raw.enabled !== false,
    order: Number.isFinite(Number(raw.order)) ? Number(raw.order) : fallbackOrder,
    currency: (String(raw.currency || "USD").trim().toUpperCase().slice(0, 10) || "USD"),
    exchangeRate: Number(raw.exchangeRate) > 0 ? Number(raw.exchangeRate) : 1,
    details,
    instructions: String(raw.instructions || "").trim().slice(0, 1200),
    ...(raw.iconUrl ? { iconUrl: String(raw.iconUrl).trim().slice(0, 600) } : {}),
    ...(raw.qrUrl ? { qrUrl: String(raw.qrUrl).trim().slice(0, 600) } : {}),
    fee: {
      mode:
        raw.fee?.mode === "fixed" || raw.fee?.mode === "percent"
          ? raw.fee.mode
          : "none",
      kind: raw.fee?.kind === "discount" ? "discount" : "fee",
      amount: Math.max(0, Number(raw.fee?.amount || 0)),
    },
    rules: {
      minAmount: Math.max(0, Number(raw.rules?.minAmount || 0)),
      maxAmount: Math.max(0, Number(raw.rules?.maxAmount || 0)),
      allowedCountries,
      appliesTo,
      audience,
    },
    proof: {
      required:
        type === "cash" || type === "automatic"
          ? false
          : raw.proof?.required !== false,
      fields: {
        screenshot: Boolean(raw.proof?.fields?.screenshot),
        txId: Boolean(raw.proof?.fields?.txId),
        senderName: Boolean(raw.proof?.fields?.senderName),
        paidAt: Boolean(raw.proof?.fields?.paidAt),
      },
      approval: raw.proof?.approval === "auto" ? "auto" : "manual",
    },
    windowMinutes: Math.min(10080, Math.max(15, Math.round(Number(raw.windowMinutes || 1440)))),
  };
}

export async function ensureSeedPaymentMethods(
  db: Firestore
): Promise<PaymentMethodRecord[]> {
  const snap = await db.collection("paymentMethods").orderBy("order", "asc").get();
  if (!snap.empty) {
    return snap.docs.map((d) => ({
      ...(d.data() as PaymentMethodRecord),
      id: d.id,
    }));
  }

  const now = Date.now();
  const batch = db.batch();
  const seeded = DEFAULT_PAYMENT_METHODS.map((m) => ({
    ...m,
    createdAtMs: now,
    updatedAtMs: now,
  }));
  for (const m of seeded) {
    batch.set(db.collection("paymentMethods").doc(m.id), {
      ...m,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
  return seeded;
}

export async function listAllPaymentMethodsServer(): Promise<PaymentMethodRecord[]> {
  try {
    const db = getAdminDb();
    return await ensureSeedPaymentMethods(db);
  } catch (err) {
    if (isAdminIamError(err)) {
      return DEFAULT_PAYMENT_METHODS;
    }
    return DEFAULT_PAYMENT_METHODS;
  }
}

export async function listPublicPaymentMethods(params?: {
  appliesTo?: "shipping" | "customs";
  amountUsd?: number;
  country?: string;
  isBusiness?: boolean;
}): Promise<PaymentMethodRecord[]> {
  const all = await listAllPaymentMethodsServer();
  if (!params?.appliesTo) {
    return all
      .filter((m) => m.enabled)
      .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  }
  return filterEligiblePaymentMethods({
    methods: all,
    appliesTo: params.appliesTo,
    amountUsd: Number(params.amountUsd || 0),
    country: params.country,
    isBusiness: params.isBusiness,
  });
}

export async function savePaymentMethodAdmin(
  actor: VerifiedServerUser,
  input: Partial<PaymentMethodRecord>
): Promise<PaymentMethodRecord> {
  const db = getAdminDb();
  const existingAll = await ensureSeedPaymentMethods(db);
  const existing = existingAll.find((m) => m.id === input.id);
  const normalized = normalizeMethodInput(
    input,
    existing?.order ?? existingAll.length + 1
  );
  if (!normalized.name) {
    throw Object.assign(new Error("Payment method name is required."), { status: 400 });
  }
  const now = Date.now();
  const record: PaymentMethodRecord = {
    ...normalized,
    createdAtMs: existing?.createdAtMs || now,
    updatedAtMs: now,
  };
  await db
    .collection("paymentMethods")
    .doc(record.id)
    .set(
      {
        ...record,
        createdAt: existing ? undefined : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  await db.collection("auditLogs").add({
    actorUid: actor.uid,
    actorEmail: actor.email,
    action: existing ? "update_payment_method" : "create_payment_method",
    code: record.id,
    detail: `${existing ? "Updated" : "Created"} payment method ${record.name} (${record.type}, enabled=${record.enabled})`,
    createdAt: FieldValue.serverTimestamp(),
  });
  return record;
}

export async function duplicatePaymentMethodAdmin(
  actor: VerifiedServerUser,
  sourceId: string
): Promise<PaymentMethodRecord> {
  const db = getAdminDb();
  const all = await ensureSeedPaymentMethods(db);
  const src = all.find((m) => m.id === sourceId);
  if (!src) {
    throw Object.assign(new Error("Source payment method not found."), { status: 404 });
  }
  const now = Date.now();
  const newId = `${sanitizeMethodId(src.id).slice(0, 28)}_${crypto.randomBytes(2).toString("hex")}`;
  const clone: PaymentMethodRecord = {
    ...src,
    id: newId,
    name: `${src.name} (Copy)`.slice(0, 80),
    enabled: false,
    order: all.length + 1,
    createdAtMs: now,
    updatedAtMs: now,
  };
  await db.collection("paymentMethods").doc(newId).set({
    ...clone,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await db.collection("auditLogs").add({
    actorUid: actor.uid,
    actorEmail: actor.email,
    action: "duplicate_payment_method",
    code: newId,
    detail: `Duplicated ${src.id} -> ${newId}`,
    createdAt: FieldValue.serverTimestamp(),
  });
  return clone;
}

export async function reorderPaymentMethodsAdmin(
  actor: VerifiedServerUser,
  orderedIds: string[]
): Promise<PaymentMethodRecord[]> {
  const db = getAdminDb();
  const batch = db.batch();
  const cleanIds = orderedIds.map((x) => sanitizeMethodId(x)).filter(Boolean);
  cleanIds.forEach((id, idx) => {
    batch.set(
      db.collection("paymentMethods").doc(id),
      {
        order: idx + 1,
        updatedAtMs: Date.now(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });
  batch.set(db.collection("auditLogs").doc(), {
    actorUid: actor.uid,
    actorEmail: actor.email,
    action: "reorder_payment_methods",
    code: "",
    detail: `Reordered methods: ${cleanIds.join(", ")}`,
    createdAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
  return listAllPaymentMethodsServer();
}

export async function deleteOrDisablePaymentMethodAdmin(
  actor: VerifiedServerUser,
  methodId: string
): Promise<{ action: "deleted" | "disabled"; id: string }> {
  const db = getAdminDb();
  const id = sanitizeMethodId(methodId);
  const usedSnap = await db
    .collection("payments")
    .where("methodId", "==", id)
    .limit(1)
    .get();
  if (!usedSnap.empty) {
    await db
      .collection("paymentMethods")
      .doc(id)
      .set(
        {
          enabled: false,
          updatedAtMs: Date.now(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    await db.collection("auditLogs").add({
      actorUid: actor.uid,
      actorEmail: actor.email,
      action: "disable_payment_method",
      code: id,
      detail: `Disabled payment method ${id} because existing payments reference it`,
      createdAt: FieldValue.serverTimestamp(),
    });
    return { action: "disabled", id };
  }

  await db.collection("paymentMethods").doc(id).delete();
  await db.collection("auditLogs").add({
    actorUid: actor.uid,
    actorEmail: actor.email,
    action: "delete_payment_method",
    code: id,
    detail: `Deleted unused payment method ${id}`,
    createdAt: FieldValue.serverTimestamp(),
  });
  return { action: "deleted", id };
}

export async function createManualPaymentRecord(params: {
  db: Firestore;
  kind: "booking" | "customs";
  trackingCode: string;
  bookingId?: string | null;
  alertId?: string | null;
  actor: VerifiedServerUser;
  userEmail: string;
  userName: string;
  baseUsd: number;
  method: PaymentMethodRecord;
  baseUrl?: string;
}): Promise<ManualPaymentRecord> {
  const { db, method } = params;
  const now = Date.now();
  const amounts = calculateMethodAmounts(params.baseUsd, method);
  const reference = generatePaymentReference();
  const expiresAt = now + Math.max(15, method.windowMinutes || 1440) * 60_000;
  const paymentId = `pay_${crypto.randomBytes(8).toString("hex")}`;
  const formattedInstructions = formatMethodInstructions(method.instructions || "", {
    amount: amounts.convertedAmount.toFixed(amounts.currency === "JPY" ? 0 : 2),
    currency: amounts.currency,
    reference,
    trackingCode: params.trackingCode,
    name: params.userName || "Customer",
  });

  const record: ManualPaymentRecord = {
    id: paymentId,
    reference,
    kind: params.kind,
    trackingCode: params.trackingCode,
    bookingId: params.bookingId || null,
    alertId: params.alertId || null,
    uid: params.actor.uid,
    userEmail: normalizeEmail(params.userEmail || params.actor.email),
    userName: params.userName || params.actor.email,
    methodId: method.id,
    methodName: method.name,
    methodType: method.type,
    baseAmount: amounts.baseUsd,
    feeAmount: amounts.feeAmountUsd,
    totalUsd: amounts.totalUsd,
    currency: amounts.currency,
    convertedAmount: amounts.convertedAmount,
    exchangeRate: amounts.exchangeRate,
    detailsSnapshot: method.details || [],
    instructionsSnapshot: formattedInstructions,
    ...(method.qrUrl ? { qrUrlSnapshot: method.qrUrl } : {}),
    proofConfig: method.proof,
    status: "awaiting_payment",
    expiresAt,
    proof: null,
    reviewNote: null,
    duplicateWarning: null,
    audit: [
      {
        action: "created",
        actor: params.actor.email || params.actor.uid,
        note: `${method.name} · ${formatAmountLabel(amounts.convertedAmount, amounts.currency)}`,
        at: now,
      },
    ],
    createdAtMs: now,
    updatedAtMs: now,
  };

  await db.collection("payments").doc(paymentId).set({
    ...record,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Fire instruction email safely (never fails the payment/booking flow)
  dispatchTransactionalEmail(
    record.userEmail,
    buildManualPaymentInstructionsEmail({
      baseUrl: params.baseUrl,
      recipientName: record.userName || "Customer",
      trackingCode: record.trackingCode,
      reference: record.reference,
      methodName: record.methodName,
      amountLabel: formatAmountLabel(record.convertedAmount, record.currency),
      details: record.detailsSnapshot,
      instructions: record.instructionsSnapshot,
      expiresLabel: new Date(record.expiresAt).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
    }),
    {
      template: "manual_payment_instructions",
      category: "payments",
      code: record.trackingCode,
      createdBy: params.actor.uid,
    }
  ).catch((err) => {
    logServerError({
      step: "manual_payment_instructions_email",
      code: "EMAIL_ERR",
      message: err instanceof Error ? err.message : "Email failed",
      uid: params.actor.uid,
    });
  });

  return record;
}

async function settleLinkedBookingAndShipment(params: {
  db: Firestore;
  payment: ManualPaymentRecord;
  actorLabel: string;
  baseUrl?: string;
  targetStatus: "paid" | "pending_review" | "rejected" | "info_requested" | "expired" | "refunded";
  note?: string;
}): Promise<void> {
  const { db, payment, targetStatus } = params;
  const now = Date.now();
  const shipRef = db.collection("shipments").doc(payment.trackingCode);
  const teaserRef = db.collection("trackingTeasers").doc(payment.trackingCode);
  const shipSnap = await shipRef.get();
  const shipment = shipSnap.exists ? (shipSnap.data() as ShipmentRecord) : null;

  if (payment.kind === "booking") {
    const bookingRef = payment.bookingId
      ? db.collection("bookings").doc(payment.bookingId)
      : null;

    if (targetStatus === "paid") {
      const batch = db.batch();
      if (bookingRef) {
        const bSnap = await bookingRef.get();
        if (bSnap.exists) {
          batch.update(bookingRef, {
            paymentStatus: "paid",
            bookingStatus: "confirmed",
            paymentId: payment.reference,
            paidAt: now,
            lastError: null,
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      }
      if (shipSnap.exists) {
        batch.update(shipRef, {
          paymentStatus: "paid",
          bookingStatus: "confirmed",
          paymentId: payment.reference,
          "nextStop.label": "Awaiting item review & pickup dispatch",
          updatedAt: FieldValue.serverTimestamp(),
        });
        batch.update(teaserRef, {
          latestEvent: {
            label: "Booking confirmed",
            loc: shipment?.sender?.city || "Origin Hub",
            ts: now,
          },
          updatedAt: FieldValue.serverTimestamp(),
        });
        batch.set(shipRef.collection("events").doc(), {
          stage: "Booked",
          label: "Payment approved & booking confirmed",
          loc: shipment?.sender?.city || "Origin Hub",
          note: `Payment ${payment.reference} approved (${params.actorLabel}).`,
          kind: "info",
          ts: now,
          createdBy: params.actorLabel,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
      if (shipment) {
        await dispatchBookingConfirmationEmails({
          db,
          shipment,
          baseUrl: params.baseUrl,
          actorUid: params.actorLabel,
        }).catch(() => null);
      }
      return;
    }

    const bookingStatusMap: Record<typeof targetStatus, BookingRecord["bookingStatus"]> = {
      paid: "confirmed",
      pending_review: "awaiting_payment",
      rejected: "awaiting_payment",
      info_requested: "awaiting_payment",
      expired: "expired",
      refunded: "cancelled",
    };

    const batch = db.batch();
    if (bookingRef) {
      const bSnap = await bookingRef.get();
      if (bSnap.exists) {
        batch.update(bookingRef, {
          paymentStatus: targetStatus,
          bookingStatus: bookingStatusMap[targetStatus],
          ...(targetStatus === "refunded" ? { refundedAt: now } : {}),
          ...(params.note ? { lastError: params.note } : {}),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    }
    if (shipSnap.exists) {
      batch.update(shipRef, {
        paymentStatus: targetStatus,
        bookingStatus: bookingStatusMap[targetStatus],
        ...(targetStatus === "pending_review"
          ? { "nextStop.label": "Payment proof under review" }
          : targetStatus === "rejected"
            ? { "nextStop.label": "Payment proof declined — upload new proof" }
            : targetStatus === "info_requested"
              ? { "nextStop.label": "More payment details requested" }
              : {}),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
    return;
  }

  // Customs alert payment
  if (payment.kind === "customs" && payment.alertId) {
    const alertRef = shipRef.collection("alerts").doc(payment.alertId);
    const alertSnap = await alertRef.get();
    if (!alertSnap.exists) return;
    const alert = alertSnap.data() as ShipmentAlert;

    if (targetStatus === "paid") {
      const amtStr = formatAmountLabel(payment.convertedAmount, payment.currency);
      await alertRef.update({
        status: "resolved",
        resolvedAt: FieldValue.serverTimestamp(),
        response: `Paid via ${payment.methodName} (${payment.reference})`,
        "payment.provider": "manual",
        "payment.status": "paid",
        "payment.paymentId": payment.reference,
        "payment.reference": payment.reference,
        "payment.amountPaid": payment.totalUsd,
        "payment.currency": payment.currency,
        "payment.paidAt": now,
        "payment.lastError": null,
      });
      await shipRef.collection("events").add({
        stage: shipment?.status || "Customs Hold",
        label: `${alert.chargeType || alert.title} paid (${amtStr})`,
        loc: shipment?.nextStop?.loc || "Customs Clearance",
        note: `Manual payment ${payment.reference} verified (${params.actorLabel}).`,
        kind: "info",
        ts: now,
        createdBy: params.actorLabel,
        createdAt: FieldValue.serverTimestamp(),
      });
      await reconcileShipmentHoldAfterResolution(db, payment.trackingCode, {
        actorLabel: params.actorLabel,
        baseUrl: params.baseUrl,
        resolvedAlertId: payment.alertId,
      }).catch(() => null);
      return;
    }

    await alertRef.update({
      "payment.status": targetStatus === "expired" ? "failed" : targetStatus,
      "payment.lastError": params.note || null,
      ...(targetStatus === "refunded" ? { "payment.refundedAt": now } : {}),
    });
  }
}

export async function submitPaymentProof(params: {
  actor: VerifiedServerUser;
  paymentId: string;
  screenshotUrl?: string;
  screenshotHash?: string;
  screenshotName?: string;
  txId?: string;
  senderName?: string;
  paidAt?: string;
  note?: string;
  baseUrl?: string;
}): Promise<{ payment: ManualPaymentRecord; autoApproved: boolean }> {
  let db: Firestore;
  try {
    db = getAdminDb();
  } catch (err) {
    if (isAdminIamError(err)) {
      throw new AdminSdkUnavailableError(
        "Submitting payment proof requires Firebase Admin SDK access."
      );
    }
    throw err;
  }

  const ref = db.collection("payments").doc(params.paymentId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw Object.assign(new Error("Payment record not found."), { status: 404 });
  }
  const payment = snap.data() as ManualPaymentRecord;
  const isOwner =
    payment.uid === params.actor.uid ||
    normalizeEmail(payment.userEmail) === params.actor.email ||
    params.actor.isAdmin;
  if (!isOwner) {
    throw Object.assign(new Error("You do not have permission to update this payment."), {
      status: 403,
    });
  }

  if (
    payment.status !== "awaiting_payment" &&
    payment.status !== "rejected" &&
    payment.status !== "info_requested"
  ) {
    throw Object.assign(
      new Error(`Proof cannot be submitted while payment is ${payment.status}.`),
      { status: 400 }
    );
  }

  const screenshotUrl = String(params.screenshotUrl || "").trim().slice(0, 1200);
  const screenshotHash = String(params.screenshotHash || "").trim().slice(0, 128);
  const screenshotName = String(params.screenshotName || "").trim().slice(0, 160);
  const txId = String(params.txId || "").trim().slice(0, 128);
  const senderName = String(params.senderName || "").trim().slice(0, 120);
  const paidAt = String(params.paidAt || "").trim().slice(0, 80);
  const note = String(params.note || "").trim().slice(0, 1000);

  const reqFields = payment.proofConfig?.fields;
  if (payment.proofConfig?.required !== false) {
    if (reqFields?.screenshot && !screenshotUrl) {
      throw Object.assign(new Error("Please upload your receipt or screenshot."), { status: 400 });
    }
    if (reqFields?.txId && !txId) {
      throw Object.assign(new Error("Transaction ID / reference hash is required."), { status: 400 });
    }
    if (reqFields?.senderName && !senderName) {
      throw Object.assign(new Error("Sender / account name is required."), { status: 400 });
    }
  }

  // Duplicate TXID / screenshot hash detection
  const duplicateReasons: string[] = [];
  if (txId) {
    const dupTx = await db
      .collection("payments")
      .where("proof.txId", "==", txId)
      .limit(3)
      .get();
    if (dupTx.docs.some((d) => d.id !== payment.id)) {
      duplicateReasons.push(`Transaction ID "${txId}" appears on another payment`);
    }
  }
  if (screenshotHash) {
    const dupHash = await db
      .collection("payments")
      .where("proof.screenshotHash", "==", screenshotHash)
      .limit(3)
      .get();
    if (dupHash.docs.some((d) => d.id !== payment.id)) {
      duplicateReasons.push("Identical receipt file hash already submitted earlier");
    }
  }
  const duplicateWarning = duplicateReasons.join("; ") || null;

  const autoApprove =
    payment.proofConfig?.approval === "auto" && !duplicateWarning;
  const now = Date.now();
  const nextStatus: ManualPaymentRecord["status"] = autoApprove
    ? "paid"
    : "pending_review";

  const nextAudit = [
    ...(Array.isArray(payment.audit) ? payment.audit : []),
    {
      action: autoApprove ? "auto_approved" : "proof_submitted",
      actor: params.actor.email || params.actor.uid,
      note: txId ? `TXID: ${txId}` : "Proof uploaded",
      at: now,
    },
  ];

  const proofObj = {
    ...(screenshotUrl ? { screenshotUrl } : {}),
    ...(screenshotHash ? { screenshotHash } : {}),
    ...(screenshotName ? { screenshotName } : {}),
    ...(txId ? { txId } : {}),
    ...(senderName ? { senderName } : {}),
    ...(paidAt ? { paidAt } : {}),
    ...(note ? { note } : {}),
    submittedAt: now,
  };

  await ref.update({
    status: nextStatus,
    proof: proofObj,
    duplicateWarning,
    reviewNote: null,
    ...(autoApprove ? { paidAtMs: now } : {}),
    audit: nextAudit,
    updatedAtMs: now,
    updatedAt: FieldValue.serverTimestamp(),
  });

  const updatedPayment: ManualPaymentRecord = {
    ...payment,
    status: nextStatus,
    proof: proofObj,
    duplicateWarning,
    reviewNote: null,
    ...(autoApprove ? { paidAtMs: now } : {}),
    audit: nextAudit,
    updatedAtMs: now,
  };

  await settleLinkedBookingAndShipment({
    db,
    payment: updatedPayment,
    actorLabel: autoApprove ? "Auto-approval" : "Customer proof",
    baseUrl: params.baseUrl,
    targetStatus: nextStatus,
  });

  const amountLabel = formatAmountLabel(updatedPayment.convertedAmount, updatedPayment.currency);
  if (autoApprove) {
    dispatchTransactionalEmail(
      updatedPayment.userEmail,
      buildPaymentApprovedReceiptEmail({
        baseUrl: params.baseUrl,
        recipientName: updatedPayment.userName || "Customer",
        trackingCode: updatedPayment.trackingCode,
        reference: updatedPayment.reference,
        methodName: updatedPayment.methodName,
        amountLabel,
        kindLabel: updatedPayment.kind === "customs" ? "customs clearance" : "booking",
      }),
      {
        template: "payment_approved_receipt",
        category: "payments",
        code: updatedPayment.trackingCode,
        createdBy: params.actor.uid,
      }
    ).catch(() => null);
  } else {
    dispatchTransactionalEmail(
      updatedPayment.userEmail,
      buildPaymentProofSubmittedCustomerEmail({
        baseUrl: params.baseUrl,
        recipientName: updatedPayment.userName || "Customer",
        trackingCode: updatedPayment.trackingCode,
        reference: updatedPayment.reference,
        amountLabel,
      }),
      {
        template: "payment_proof_received",
        category: "billing",
        code: updatedPayment.trackingCode,
        createdBy: params.actor.uid,
      }
    ).catch(() => null);

    dispatchTransactionalEmail(
      ADMIN_EMAIL,
      buildPaymentProofAdminAlertEmail({
        baseUrl: params.baseUrl,
        trackingCode: updatedPayment.trackingCode,
        reference: updatedPayment.reference,
        methodName: updatedPayment.methodName,
        amountLabel,
        userEmail: updatedPayment.userEmail,
        txId: txId || undefined,
        duplicateWarning: duplicateWarning || undefined,
      }),
      {
        template: "payment_proof_admin_alert",
        category: "notifications",
        code: updatedPayment.trackingCode,
        createdBy: params.actor.uid,
      }
    ).catch(() => null);
  }

  return { payment: updatedPayment, autoApproved: autoApprove };
}

export async function adminPaymentAction(params: {
  actor: VerifiedServerUser;
  paymentId: string;
  action: "approve" | "reject" | "request_info" | "mark_received" | "refund" | "extend_window";
  reason?: string;
  extraMinutes?: number;
  baseUrl?: string;
}): Promise<ManualPaymentRecord> {
  const db = getAdminDb();
  const ref = db.collection("payments").doc(params.paymentId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw Object.assign(new Error("Payment record not found."), { status: 404 });
  }
  const payment = snap.data() as ManualPaymentRecord;
  const now = Date.now();
  const reason = String(params.reason || "").trim().slice(0, 500);
  const amountLabel = formatAmountLabel(payment.convertedAmount, payment.currency);

  let nextStatus: ManualPaymentRecord["status"] = payment.status;
  let nextExpiresAt = payment.expiresAt;
  let nextReviewNote: string | null = payment.reviewNote || null;

  if (params.action === "approve" || params.action === "mark_received") {
    nextStatus = "paid";
    nextReviewNote = reason || "Payment approved";
  } else if (params.action === "reject") {
    if (!reason) {
      throw Object.assign(new Error("Please enter a rejection reason."), { status: 400 });
    }
    nextStatus = "rejected";
    nextReviewNote = reason;
  } else if (params.action === "request_info") {
    if (!reason) {
      throw Object.assign(new Error("Please specify what extra proof or details are needed."), {
        status: 400,
      });
    }
    nextStatus = "info_requested";
    nextReviewNote = reason;
  } else if (params.action === "refund") {
    if (payment.status !== "paid") {
      throw Object.assign(new Error("Only paid payments can be refunded."), { status: 400 });
    }
    nextStatus = "refunded";
    nextReviewNote = reason || "Refunded by admin";
  } else if (params.action === "extend_window") {
    const mins = Math.min(10080, Math.max(30, Number(params.extraMinutes || 1440)));
    nextExpiresAt = Math.max(now, payment.expiresAt) + mins * 60_000;
    if (payment.status === "expired") {
      nextStatus = "awaiting_payment";
    }
    nextReviewNote = `Payment window extended (+${mins} mins)`;
  }

  const nextAudit = [
    ...(Array.isArray(payment.audit) ? payment.audit : []),
    {
      action: params.action,
      actor: params.actor.email,
      ...(reason ? { note: reason } : {}),
      at: now,
    },
  ];

  await ref.update({
    status: nextStatus,
    expiresAt: nextExpiresAt,
    reviewNote: nextReviewNote,
    ...(nextStatus === "paid" ? { paidAtMs: now } : {}),
    ...(nextStatus === "refunded" ? { refundedAtMs: now } : {}),
    audit: nextAudit,
    updatedAtMs: now,
    updatedAt: FieldValue.serverTimestamp(),
  });

  const updated: ManualPaymentRecord = {
    ...payment,
    status: nextStatus,
    expiresAt: nextExpiresAt,
    reviewNote: nextReviewNote,
    ...(nextStatus === "paid" ? { paidAtMs: now } : {}),
    ...(nextStatus === "refunded" ? { refundedAtMs: now } : {}),
    audit: nextAudit,
    updatedAtMs: now,
  };

  if (params.action === "extend_window" && payment.bookingId) {
    await db
      .collection("bookings")
      .doc(payment.bookingId)
      .set(
        {
          paymentWindowExpiresAt: nextExpiresAt,
          ...(payment.status === "expired"
            ? { paymentStatus: "awaiting_payment", bookingStatus: "awaiting_payment" }
            : {}),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      )
      .catch(() => null);
    await db
      .collection("shipments")
      .doc(payment.trackingCode)
      .set(
        {
          paymentWindowExpiresAt: nextExpiresAt,
          ...(payment.status === "expired"
            ? { paymentStatus: "awaiting_payment", bookingStatus: "awaiting_payment" }
            : {}),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      )
      .catch(() => null);
  } else {
    await settleLinkedBookingAndShipment({
      db,
      payment: updated,
      actorLabel: params.actor.email,
      baseUrl: params.baseUrl,
      targetStatus: nextStatus as "paid" | "pending_review" | "rejected" | "info_requested" | "expired" | "refunded",
      note: nextReviewNote || undefined,
    });
  }

  await db.collection("auditLogs").add({
    actorUid: params.actor.uid,
    actorEmail: params.actor.email,
    action: `payment_${params.action}`,
    code: payment.trackingCode,
    detail: `${params.action} on ${payment.reference} (${amountLabel})${reason ? `: ${reason}` : ""}`,
    createdAt: FieldValue.serverTimestamp(),
  });

  // Notify customer
  if (nextStatus === "paid") {
    dispatchTransactionalEmail(
      payment.userEmail,
      buildPaymentApprovedReceiptEmail({
        baseUrl: params.baseUrl,
        recipientName: payment.userName || "Customer",
        trackingCode: payment.trackingCode,
        reference: payment.reference,
        methodName: payment.methodName,
        amountLabel,
        kindLabel: payment.kind === "customs" ? "customs clearance" : "booking",
      }),
      {
        template: "payment_approved_receipt",
        category: "payments",
        code: payment.trackingCode,
        createdBy: params.actor.uid,
      }
    ).catch(() => null);
  } else if (nextStatus === "rejected") {
    dispatchTransactionalEmail(
      payment.userEmail,
      buildPaymentRejectedEmail({
        baseUrl: params.baseUrl,
        recipientName: payment.userName || "Customer",
        trackingCode: payment.trackingCode,
        reference: payment.reference,
        reason,
      }),
      {
        template: "payment_rejected",
        category: "payments",
        code: payment.trackingCode,
        createdBy: params.actor.uid,
      }
    ).catch(() => null);
  } else if (nextStatus === "info_requested") {
    dispatchTransactionalEmail(
      payment.userEmail,
      buildPaymentMoreInfoEmail({
        baseUrl: params.baseUrl,
        recipientName: payment.userName || "Customer",
        trackingCode: payment.trackingCode,
        reference: payment.reference,
        note: reason,
      }),
      {
        template: "payment_info_requested",
        category: "payments",
        code: payment.trackingCode,
        createdBy: params.actor.uid,
      }
    ).catch(() => null);
  } else if (nextStatus === "refunded") {
    dispatchTransactionalEmail(
      payment.userEmail,
      buildPaymentRefundedEmail({
        baseUrl: params.baseUrl,
        recipientName: payment.userName || "Customer",
        trackingCode: payment.trackingCode,
        reference: payment.reference,
        amountLabel,
        reason,
      }),
      {
        template: "payment_refunded",
        category: "payments",
        code: payment.trackingCode,
        createdBy: params.actor.uid,
      }
    ).catch(() => null);
  }

  return updated;
}

export async function expireOverdueManualPaymentsServer(): Promise<{
  expiredPayments: number;
  expiredBookings: number;
}> {
  const db = getAdminDb();
  const now = Date.now();
  let expiredPayments = 0;
  let expiredBookings = 0;

  const paySnap = await db
    .collection("payments")
    .where("status", "==", "awaiting_payment")
    .limit(100)
    .get();

  for (const docSnap of paySnap.docs) {
    const p = docSnap.data() as ManualPaymentRecord;
    if (!p.expiresAt || p.expiresAt > now) continue;

    await docSnap.ref.update({
      status: "expired",
      audit: [
        ...(Array.isArray(p.audit) ? p.audit : []),
        { action: "expired", actor: "system", note: "Payment window elapsed", at: now },
      ],
      updatedAtMs: now,
      updatedAt: FieldValue.serverTimestamp(),
    });
    await settleLinkedBookingAndShipment({
      db,
      payment: p,
      actorLabel: "System expiry",
      targetStatus: "expired",
      note: "Payment window elapsed before confirmation.",
    });
    dispatchTransactionalEmail(
      p.userEmail,
      buildPaymentExpiredEmail({
        recipientName: p.userName || "Customer",
        trackingCode: p.trackingCode,
        reference: p.reference,
      }),
      {
        template: "payment_expired",
        category: "billing",
        code: p.trackingCode,
        createdBy: "scheduler",
      }
    ).catch(() => null);
    expiredPayments++;
  }

  const bkSnap = await db
    .collection("bookings")
    .where("paymentStatus", "==", "awaiting_payment")
    .limit(100)
    .get();

  for (const docSnap of bkSnap.docs) {
    const bk = docSnap.data() as BookingRecord;
    const exp = bk.paymentWindowExpiresAt || bk.checkoutExpiresAt || 0;
    if (!exp || exp > now) continue;
    await docSnap.ref.update({
      paymentStatus: "expired",
      bookingStatus: "expired",
      lastError: "Payment window expired without confirmation.",
      updatedAt: FieldValue.serverTimestamp(),
    });
    await db
      .collection("shipments")
      .doc(bk.code)
      .set(
        {
          paymentStatus: "expired",
          bookingStatus: "expired",
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      )
      .catch(() => null);
    expiredBookings++;
  }

  return { expiredPayments, expiredBookings };
}
