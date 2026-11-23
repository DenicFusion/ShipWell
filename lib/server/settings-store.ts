import { FieldValue } from "firebase-admin/firestore";
import type {
  AdminPaymentSettingsPublic,
  GatewayId,
  SecretMask,
} from "../../types/tracking.ts";
import {
  buildSecretMask,
  decryptSecret,
  encryptSecret,
  isEncryptionKeyConfigured,
  validateSecretPrefix,
} from "./crypto.ts";
import {
  AdminSdkUnavailableError,
  getAdminDb,
  isAdminIamError,
  type VerifiedServerUser,
} from "./firebase-admin.ts";

export const DEFAULT_EMAIL_FROM = "ShipWell <notifications@mail.shipwell.cc>";
export const DEFAULT_EMAIL_REPLY_TO = "support@mail.shipwell.cc";
export const DEFAULT_SUPPORT_INBOX = "support@mail.shipwell.cc";
export const DEFAULT_FROM_SECURITY = "ShipWell Security <noreply@mail.shipwell.cc>";
export const DEFAULT_FROM_TRACKING = "ShipWell Tracking <tracking@mail.shipwell.cc>";
export const DEFAULT_FROM_BILLING = "ShipWell Billing <billing@mail.shipwell.cc>";
export const DEFAULT_FROM_PAYMENTS = "ShipWell Payments <payments@mail.shipwell.cc>";
export const DEFAULT_FROM_NOTIFICATIONS = "ShipWell <notifications@mail.shipwell.cc>";
export const DEFAULT_FROM_SUPPORT = "ShipWell Support <support@mail.shipwell.cc>";

export type EmailSenderCategory =
  | "security"
  | "tracking"
  | "billing"
  | "payments"
  | "notifications"
  | "support";

function upgradeLegacyEmailDomain(val: unknown): string {
  return String(val || "").replace(/@info\.shipwell\.cc\b/gi, "@mail.shipwell.cc");
}

export function resolveEmailSender(
  publicSettings: AdminPaymentSettingsPublic | undefined,
  category: EmailSenderCategory
): { from: string; replyTo?: string } {
  const r = publicSettings?.resend;
  const supportInbox = upgradeLegacyEmailDomain(
    r?.supportInbox || process.env.SUPPORT_INBOX || DEFAULT_SUPPORT_INBOX
  );
  if (category === "security") {
    return {
      from: upgradeLegacyEmailDomain(
        r?.fromSecurity || process.env.FROM_SECURITY || DEFAULT_FROM_SECURITY
      ),
      replyTo: undefined,
    };
  }
  if (category === "tracking") {
    return {
      from: upgradeLegacyEmailDomain(
        r?.fromTracking || process.env.FROM_TRACKING || DEFAULT_FROM_TRACKING
      ),
      replyTo: supportInbox,
    };
  }
  if (category === "billing") {
    return {
      from: upgradeLegacyEmailDomain(
        r?.fromBilling || process.env.FROM_BILLING || DEFAULT_FROM_BILLING
      ),
      replyTo: supportInbox,
    };
  }
  if (category === "payments") {
    return {
      from: upgradeLegacyEmailDomain(
        r?.fromPayments || process.env.FROM_PAYMENTS || DEFAULT_FROM_PAYMENTS
      ),
      replyTo: supportInbox,
    };
  }
  if (category === "support") {
    return {
      from: upgradeLegacyEmailDomain(
        r?.fromSupport || process.env.FROM_SUPPORT || DEFAULT_FROM_SUPPORT
      ),
      replyTo: supportInbox,
    };
  }
  return {
    from: upgradeLegacyEmailDomain(
      r?.fromNotifications ||
        r?.from ||
        process.env.FROM_NOTIFICATIONS ||
        process.env.EMAIL_FROM ||
        DEFAULT_FROM_NOTIFICATIONS
    ),
    replyTo: upgradeLegacyEmailDomain(
      r?.replyTo || process.env.EMAIL_REPLY_TO || supportInbox
    ),
  };
}

export interface ResolvedSecrets {
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
}

interface EncryptedSecretsDoc {
  bachsSandboxKey?: string;
  bachsLiveKey?: string;
  bachsSandboxWebhook?: string;
  bachsLiveWebhook?: string;
  bachsPreviousWebhook?: string;
  resendApiKey?: string;
  resendInboundSecret?: string;
  stripeSecretKey?: string;
  stripeWebhookSecret?: string;
  paystackSecretKey?: string;
  paystackWebhookSecret?: string;
  updatedAt?: unknown;
  updatedBy?: string;
}

interface CachedBundle {
  publicSettings: AdminPaymentSettingsPublic;
  secrets: ResolvedSecrets;
  expiresAt: number;
}

const CACHE_TTL_MS = 180_000;
let cachedBundle: CachedBundle | null = null;

export function clearSettingsCache(): void {
  cachedBundle = null;
}

function emptyMask(): SecretMask {
  return { configured: false };
}

export function defaultPublicSettings(): AdminPaymentSettingsPublic {
  return {
    bachs: {
      environment: "sandbox",
      sandboxProductId: "",
      liveProductId: "",
      organizationId: "",
      defaultCurrency: "USD",
      checkoutExpiryMinutes: 60,
      lastWebhookAt: null,
      secrets: {
        sandboxSecretKey: emptyMask(),
        liveSecretKey: emptyMask(),
        sandboxWebhookSecret: emptyMask(),
        liveWebhookSecret: emptyMask(),
        previousWebhookSecret: emptyMask(),
      },
    },
    resend: {
      from: upgradeLegacyEmailDomain(process.env.EMAIL_FROM || DEFAULT_EMAIL_FROM),
      replyTo: upgradeLegacyEmailDomain(process.env.EMAIL_REPLY_TO || DEFAULT_EMAIL_REPLY_TO),
      supportInbox: upgradeLegacyEmailDomain(process.env.SUPPORT_INBOX || DEFAULT_SUPPORT_INBOX),
      fromSecurity: upgradeLegacyEmailDomain(process.env.FROM_SECURITY || DEFAULT_FROM_SECURITY),
      fromTracking: upgradeLegacyEmailDomain(process.env.FROM_TRACKING || DEFAULT_FROM_TRACKING),
      fromBilling: upgradeLegacyEmailDomain(process.env.FROM_BILLING || DEFAULT_FROM_BILLING),
      fromPayments: upgradeLegacyEmailDomain(process.env.FROM_PAYMENTS || DEFAULT_FROM_PAYMENTS),
      fromNotifications: upgradeLegacyEmailDomain(
        process.env.FROM_NOTIFICATIONS || process.env.EMAIL_FROM || DEFAULT_FROM_NOTIFICATIONS
      ),
      fromSupport: upgradeLegacyEmailDomain(process.env.FROM_SUPPORT || DEFAULT_FROM_SUPPORT),
      secrets: {
        apiKey: process.env.RESEND_API_KEY
          ? buildSecretMask(process.env.RESEND_API_KEY, "env")
          : emptyMask(),
        inboundWebhookSecret: process.env.RESEND_INBOUND_SECRET
          ? buildSecretMask(process.env.RESEND_INBOUND_SECRET, "env")
          : emptyMask(),
      },
    },
    stripe: {
      enabled: false,
      publicKey: "",
      secrets: {
        secretKey: emptyMask(),
        webhookSecret: emptyMask(),
      },
    },
    paystack: {
      enabled: false,
      publicKey: "",
      secrets: {
        secretKey: emptyMask(),
        webhookSecret: emptyMask(),
      },
    },
    routing: {
      primaryGateway: "bachs",
      fallbackOrder: ["bachs"],
      offerChoice: false,
      enableBachsBooking: true,
      enablePayOnPickup: true,
    },
    updatedAt: null,
    updatedBy: null,
    encryptionReady: isEncryptionKeyConfigured(),
  };
}

function defaultSecrets(): ResolvedSecrets {
  return {
    bachsSandboxKey: "",
    bachsLiveKey: "",
    bachsSandboxWebhook: "",
    bachsLiveWebhook: "",
    bachsPreviousWebhook: "",
    resendApiKey: process.env.RESEND_API_KEY || "",
    resendInboundSecret: process.env.RESEND_INBOUND_SECRET || "",
    stripeSecretKey: "",
    stripeWebhookSecret: "",
    paystackSecretKey: "",
    paystackWebhookSecret: "",
  };
}

export async function loadSettingsBundle(): Promise<{
  publicSettings: AdminPaymentSettingsPublic;
  secrets: ResolvedSecrets;
}> {
  if (cachedBundle && cachedBundle.expiresAt > Date.now()) {
    return {
      publicSettings: cachedBundle.publicSettings,
      secrets: cachedBundle.secrets,
    };
  }

  const basePublic = defaultPublicSettings();
  const baseSecrets = defaultSecrets();

  try {
    const db = getAdminDb();
    const [pubSnap, secSnap] = await Promise.all([
      db.collection("adminSettings").doc("payments").get(),
      db.collection("adminSecrets").doc("payments").get(),
    ]);

    if (pubSnap.exists) {
      const data = pubSnap.data() as Partial<AdminPaymentSettingsPublic>;
      if (data.bachs) {
        basePublic.bachs = {
          ...basePublic.bachs,
          ...data.bachs,
          secrets: {
            ...basePublic.bachs.secrets,
            ...(data.bachs.secrets || {}),
          },
        };
      }
      if (data.resend) {
        basePublic.resend = {
          ...basePublic.resend,
          ...data.resend,
          from: upgradeLegacyEmailDomain(data.resend.from || basePublic.resend.from),
          replyTo: upgradeLegacyEmailDomain(data.resend.replyTo || basePublic.resend.replyTo),
          supportInbox: upgradeLegacyEmailDomain(
            data.resend.supportInbox || basePublic.resend.supportInbox
          ),
          fromSecurity: upgradeLegacyEmailDomain(
            data.resend.fromSecurity || basePublic.resend.fromSecurity
          ),
          fromTracking: upgradeLegacyEmailDomain(
            data.resend.fromTracking || basePublic.resend.fromTracking
          ),
          fromBilling: upgradeLegacyEmailDomain(
            data.resend.fromBilling || basePublic.resend.fromBilling
          ),
          fromPayments: upgradeLegacyEmailDomain(
            data.resend.fromPayments || basePublic.resend.fromPayments
          ),
          fromNotifications: upgradeLegacyEmailDomain(
            data.resend.fromNotifications ||
              data.resend.from ||
              basePublic.resend.fromNotifications
          ),
          fromSupport: upgradeLegacyEmailDomain(
            data.resend.fromSupport || basePublic.resend.fromSupport
          ),
          secrets: {
            ...basePublic.resend.secrets,
            ...(data.resend.secrets || {}),
          },
        };
      }
      if (data.stripe) {
        basePublic.stripe = {
          ...basePublic.stripe,
          ...data.stripe,
          secrets: {
            ...basePublic.stripe.secrets,
            ...(data.stripe.secrets || {}),
          },
        };
      }
      if (data.paystack) {
        basePublic.paystack = {
          ...basePublic.paystack,
          ...data.paystack,
          secrets: {
            ...basePublic.paystack.secrets,
            ...(data.paystack.secrets || {}),
          },
        };
      }
      if (data.routing) {
        basePublic.routing = {
          ...basePublic.routing,
          ...data.routing,
        };
      }
      basePublic.updatedAt = data.updatedAt ?? null;
      basePublic.updatedBy = data.updatedBy ?? null;
    }

    if (secSnap.exists && isEncryptionKeyConfigured()) {
      const enc = secSnap.data() as EncryptedSecretsDoc;
      const decryptOrEmpty = (cipher?: string) => {
        if (!cipher) return "";
        try {
          return decryptSecret(cipher);
        } catch {
          return "";
        }
      };

      const maybe = (val: string, fallback: string) => val || fallback;
      baseSecrets.bachsSandboxKey = decryptOrEmpty(enc.bachsSandboxKey);
      baseSecrets.bachsLiveKey = decryptOrEmpty(enc.bachsLiveKey);
      baseSecrets.bachsSandboxWebhook = decryptOrEmpty(enc.bachsSandboxWebhook);
      baseSecrets.bachsLiveWebhook = decryptOrEmpty(enc.bachsLiveWebhook);
      baseSecrets.bachsPreviousWebhook = decryptOrEmpty(enc.bachsPreviousWebhook);
      baseSecrets.resendApiKey = maybe(
        decryptOrEmpty(enc.resendApiKey),
        baseSecrets.resendApiKey
      );
      baseSecrets.resendInboundSecret = maybe(
        decryptOrEmpty(enc.resendInboundSecret),
        baseSecrets.resendInboundSecret
      );
      baseSecrets.stripeSecretKey = decryptOrEmpty(enc.stripeSecretKey);
      baseSecrets.stripeWebhookSecret = decryptOrEmpty(enc.stripeWebhookSecret);
      baseSecrets.paystackSecretKey = decryptOrEmpty(enc.paystackSecretKey);
      baseSecrets.paystackWebhookSecret = decryptOrEmpty(enc.paystackWebhookSecret);
    }

    basePublic.encryptionReady = isEncryptionKeyConfigured();
    cachedBundle = {
      publicSettings: basePublic,
      secrets: baseSecrets,
      expiresAt: Date.now() + CACHE_TTL_MS,
    };
    return { publicSettings: basePublic, secrets: baseSecrets };
  } catch (err) {
    if (isAdminIamError(err)) {
      return { publicSettings: basePublic, secrets: baseSecrets };
    }
    return { publicSettings: basePublic, secrets: baseSecrets };
  }
}

export interface SaveSettingsPayload {
  bachs?: {
    environment?: "sandbox" | "live";
    sandboxProductId?: string;
    liveProductId?: string;
    organizationId?: string;
    defaultCurrency?: string;
    checkoutExpiryMinutes?: number;
    sandboxSecretKey?: string;
    liveSecretKey?: string;
    sandboxWebhookSecret?: string;
    liveWebhookSecret?: string;
    previousWebhookSecret?: string;
  };
  resend?: {
    from?: string;
    replyTo?: string;
    supportInbox?: string;
    fromSecurity?: string;
    fromTracking?: string;
    fromBilling?: string;
    fromPayments?: string;
    fromNotifications?: string;
    fromSupport?: string;
    apiKey?: string;
    inboundWebhookSecret?: string;
  };
  stripe?: {
    enabled?: boolean;
    publicKey?: string;
    secretKey?: string;
    webhookSecret?: string;
  };
  paystack?: {
    enabled?: boolean;
    publicKey?: string;
    secretKey?: string;
    webhookSecret?: string;
  };
  routing?: {
    primaryGateway?: GatewayId;
    fallbackOrder?: GatewayId[];
    offerChoice?: boolean;
    enableBachsBooking?: boolean;
    enablePayOnPickup?: boolean;
  };
}

export async function saveAdminSettings(
  actor: VerifiedServerUser,
  patch: SaveSettingsPayload
): Promise<AdminPaymentSettingsPublic> {
  const { publicSettings: current } = await loadSettingsBundle();
  const changedFields: string[] = [];

  const secretWrites: Partial<EncryptedSecretsDoc> = {};
  const secretChecks: Array<{
    field: Parameters<typeof validateSecretPrefix>[0];
    raw?: string;
    label: string;
    applyMask: (m: SecretMask) => void;
    encKey: keyof EncryptedSecretsDoc;
  }> = [
    {
      field: "bachsSandboxKey",
      raw: patch.bachs?.sandboxSecretKey,
      label: "bachs.sandboxSecretKey",
      encKey: "bachsSandboxKey",
      applyMask: (m) => {
        current.bachs.secrets.sandboxSecretKey = m;
      },
    },
    {
      field: "bachsLiveKey",
      raw: patch.bachs?.liveSecretKey,
      label: "bachs.liveSecretKey",
      encKey: "bachsLiveKey",
      applyMask: (m) => {
        current.bachs.secrets.liveSecretKey = m;
      },
    },
    {
      field: "bachsSandboxWebhook",
      raw: patch.bachs?.sandboxWebhookSecret,
      label: "bachs.sandboxWebhookSecret",
      encKey: "bachsSandboxWebhook",
      applyMask: (m) => {
        current.bachs.secrets.sandboxWebhookSecret = m;
      },
    },
    {
      field: "bachsLiveWebhook",
      raw: patch.bachs?.liveWebhookSecret,
      label: "bachs.liveWebhookSecret",
      encKey: "bachsLiveWebhook",
      applyMask: (m) => {
        current.bachs.secrets.liveWebhookSecret = m;
      },
    },
    {
      field: "bachsPreviousWebhook",
      raw: patch.bachs?.previousWebhookSecret,
      label: "bachs.previousWebhookSecret",
      encKey: "bachsPreviousWebhook",
      applyMask: (m) => {
        current.bachs.secrets.previousWebhookSecret = m;
      },
    },
    {
      field: "resendApiKey",
      raw: patch.resend?.apiKey,
      label: "resend.apiKey",
      encKey: "resendApiKey",
      applyMask: (m) => {
        current.resend.secrets.apiKey = m;
      },
    },
    {
      field: "resendInboundSecret",
      raw: patch.resend?.inboundWebhookSecret,
      label: "resend.inboundWebhookSecret",
      encKey: "resendInboundSecret",
      applyMask: (m) => {
        current.resend.secrets.inboundWebhookSecret = m;
      },
    },
    {
      field: "stripeSecretKey",
      raw: patch.stripe?.secretKey,
      label: "stripe.secretKey",
      encKey: "stripeSecretKey",
      applyMask: (m) => {
        current.stripe.secrets.secretKey = m;
      },
    },
    {
      field: "stripeWebhookSecret",
      raw: patch.stripe?.webhookSecret,
      label: "stripe.webhookSecret",
      encKey: "stripeWebhookSecret",
      applyMask: (m) => {
        current.stripe.secrets.webhookSecret = m;
      },
    },
    {
      field: "paystackSecretKey",
      raw: patch.paystack?.secretKey,
      label: "paystack.secretKey",
      encKey: "paystackSecretKey",
      applyMask: (m) => {
        current.paystack.secrets.secretKey = m;
      },
    },
    {
      field: "paystackWebhookSecret",
      raw: patch.paystack?.webhookSecret,
      label: "paystack.webhookSecret",
      encKey: "paystackWebhookSecret",
      applyMask: (m) => {
        current.paystack.secrets.webhookSecret = m;
      },
    },
  ];

  let hasNewSecret = false;
  for (const item of secretChecks) {
    const rawVal = typeof item.raw === "string" ? item.raw.trim() : "";
    if (!rawVal) continue;
    hasNewSecret = true;
    const prefixError = validateSecretPrefix(item.field, rawVal);
    if (prefixError) {
      throw new Error(prefixError);
    }
    if (!isEncryptionKeyConfigured()) {
      throw new Error(
        "SETTINGS_ENCRYPTION_KEY is not set on this server. Deploy to your Blaze project with SETTINGS_ENCRYPTION_KEY configured first."
      );
    }
    secretWrites[item.encKey] = encryptSecret(rawVal) as never;
    item.applyMask(buildSecretMask(rawVal, actor.email));
    changedFields.push(item.label);
  }

  if (patch.bachs) {
    if (
      patch.bachs.environment &&
      patch.bachs.environment !== current.bachs.environment
    ) {
      if (patch.bachs.environment === "live") {
        if (
          !current.bachs.secrets.liveSecretKey.configured ||
          !current.bachs.secrets.liveWebhookSecret.configured
        ) {
          throw new Error(
            "Save both your Bachs Live secret key (sk_live_...) and Live webhook signing secret before switching to Live mode."
          );
        }
      }
      current.bachs.environment = patch.bachs.environment;
      changedFields.push(`bachs.environment=${patch.bachs.environment}`);
    }
    if (typeof patch.bachs.sandboxProductId === "string") {
      current.bachs.sandboxProductId = patch.bachs.sandboxProductId.trim();
      changedFields.push("bachs.sandboxProductId");
    }
    if (typeof patch.bachs.liveProductId === "string") {
      current.bachs.liveProductId = patch.bachs.liveProductId.trim();
      changedFields.push("bachs.liveProductId");
    }
    if (typeof patch.bachs.organizationId === "string") {
      current.bachs.organizationId = patch.bachs.organizationId.trim();
      changedFields.push("bachs.organizationId");
    }
    if (typeof patch.bachs.defaultCurrency === "string") {
      current.bachs.defaultCurrency =
        patch.bachs.defaultCurrency.trim().toUpperCase().slice(0, 6) || "USD";
      changedFields.push("bachs.defaultCurrency");
    }
    if (typeof patch.bachs.checkoutExpiryMinutes === "number") {
      current.bachs.checkoutExpiryMinutes = Math.min(
        1440,
        Math.max(5, Math.round(patch.bachs.checkoutExpiryMinutes))
      );
      changedFields.push("bachs.checkoutExpiryMinutes");
    }
  }

  if (patch.resend) {
    if (typeof patch.resend.from === "string" && patch.resend.from.trim()) {
      current.resend.from = patch.resend.from.trim();
      changedFields.push("resend.from");
    }
    if (typeof patch.resend.replyTo === "string" && patch.resend.replyTo.trim()) {
      current.resend.replyTo = patch.resend.replyTo.trim();
      changedFields.push("resend.replyTo");
    }
    if (
      typeof patch.resend.supportInbox === "string" &&
      patch.resend.supportInbox.trim()
    ) {
      current.resend.supportInbox = patch.resend.supportInbox.trim();
      changedFields.push("resend.supportInbox");
    }
    if (typeof patch.resend.fromSecurity === "string" && patch.resend.fromSecurity.trim()) {
      current.resend.fromSecurity = patch.resend.fromSecurity.trim();
      changedFields.push("resend.fromSecurity");
    }
    if (typeof patch.resend.fromTracking === "string" && patch.resend.fromTracking.trim()) {
      current.resend.fromTracking = patch.resend.fromTracking.trim();
      changedFields.push("resend.fromTracking");
    }
    if (typeof patch.resend.fromBilling === "string" && patch.resend.fromBilling.trim()) {
      current.resend.fromBilling = patch.resend.fromBilling.trim();
      changedFields.push("resend.fromBilling");
    }
    if (typeof patch.resend.fromPayments === "string" && patch.resend.fromPayments.trim()) {
      current.resend.fromPayments = patch.resend.fromPayments.trim();
      changedFields.push("resend.fromPayments");
    }
    if (
      typeof patch.resend.fromNotifications === "string" &&
      patch.resend.fromNotifications.trim()
    ) {
      current.resend.fromNotifications = patch.resend.fromNotifications.trim();
      current.resend.from = patch.resend.fromNotifications.trim();
      changedFields.push("resend.fromNotifications");
    }
    if (typeof patch.resend.fromSupport === "string" && patch.resend.fromSupport.trim()) {
      current.resend.fromSupport = patch.resend.fromSupport.trim();
      changedFields.push("resend.fromSupport");
    }
  }

  if (patch.stripe) {
    if (typeof patch.stripe.enabled === "boolean") {
      current.stripe.enabled = patch.stripe.enabled;
      changedFields.push("stripe.enabled");
    }
    if (typeof patch.stripe.publicKey === "string") {
      current.stripe.publicKey = patch.stripe.publicKey.trim();
      changedFields.push("stripe.publicKey");
    }
  }

  if (patch.paystack) {
    if (typeof patch.paystack.enabled === "boolean") {
      current.paystack.enabled = patch.paystack.enabled;
      changedFields.push("paystack.enabled");
    }
    if (typeof patch.paystack.publicKey === "string") {
      current.paystack.publicKey = patch.paystack.publicKey.trim();
      changedFields.push("paystack.publicKey");
    }
  }

  if (patch.routing) {
    if (patch.routing.primaryGateway) {
      current.routing.primaryGateway = patch.routing.primaryGateway;
      changedFields.push("routing.primaryGateway");
    }
    if (Array.isArray(patch.routing.fallbackOrder)) {
      current.routing.fallbackOrder = patch.routing.fallbackOrder;
      changedFields.push("routing.fallbackOrder");
    }
    if (typeof patch.routing.offerChoice === "boolean") {
      current.routing.offerChoice = patch.routing.offerChoice;
      changedFields.push("routing.offerChoice");
    }
    if (typeof patch.routing.enableBachsBooking === "boolean") {
      current.routing.enableBachsBooking = patch.routing.enableBachsBooking;
      changedFields.push("routing.enableBachsBooking");
    }
    if (typeof patch.routing.enablePayOnPickup === "boolean") {
      current.routing.enablePayOnPickup = patch.routing.enablePayOnPickup;
      changedFields.push("routing.enablePayOnPickup");
    }
  }

  const now = Date.now();
  current.updatedAt = now;
  current.updatedBy = actor.email;
  current.encryptionReady = isEncryptionKeyConfigured();

  try {
    const db = getAdminDb();
    const batch = db.batch();
    batch.set(
      db.collection("adminSettings").doc("payments"),
      JSON.parse(JSON.stringify(current)),
      { merge: true }
    );
    if (hasNewSecret) {
      batch.set(
        db.collection("adminSecrets").doc("payments"),
        {
          ...secretWrites,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: actor.email,
        },
        { merge: true }
      );
    }
    batch.set(db.collection("auditLogs").doc(), {
      actorUid: actor.uid,
      actorEmail: actor.email,
      action: "update_settings",
      code: "",
      detail: `Updated settings: ${changedFields.join(", ") || "metadata"}`,
      createdAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();
    clearSettingsCache();
    return current;
  } catch (err) {
    if (isAdminIamError(err)) {
      throw new AdminSdkUnavailableError(
        "Saving encrypted settings requires the Firebase Admin SDK on your Blaze-plan project."
      );
    }
    throw err;
  }
}
