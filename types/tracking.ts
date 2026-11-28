export type ThemePreference = "system" | "dark" | "light";
export type ResolvedTheme = "dark" | "light";

export type ShipmentStage =
  | "Booked"
  | "Picked Up"
  | "In Transit"
  | "At Hub"
  | "Customs"
  | "Out for Delivery"
  | "Delivered";

export type ServiceTier = "economy" | "standard" | "express";

export type EventKind = "scan" | "delay" | "action" | "review" | "info";

export type AlertTarget = "receiver" | "sender";

export type AlertKind =
  | "duty"
  | "address"
  | "id"
  | "reschedule"
  | "custom"
  | "item";

export type ChargeType =
  | "Import duty"
  | "VAT / GST"
  | "Customs handling fee"
  | "Inspection fee"
  | "Storage fee"
  | "Other charge";

export const CHARGE_TYPES: ChargeType[] = [
  "Import duty",
  "VAT / GST",
  "Customs handling fee",
  "Inspection fee",
  "Storage fee",
  "Other charge",
];

export type GatewayId = "bachs" | "stripe" | "paystack" | "manual";

export interface CustomsPaymentEvent {
  type: string;
  at: number;
  detail?: string;
}

export interface CustomsPaymentInfo {
  provider: GatewayId;
  environment: "sandbox" | "live";
  checkoutId?: string | null;
  checkoutUrl?: string | null;
  paymentId?: string | null;
  reference?: string | null;
  status: "unpaid" | "pending" | "paid" | "failed" | "underpaid" | "refunded";
  amountPaid?: number | null;
  currency?: string;
  expiresAt?: number | null;
  paidAt?: number | null;
  refundedAt?: number | null;
  refundId?: string | null;
  lastError?: string | null;
  events?: CustomsPaymentEvent[];
}

export type AlertStatus = "open" | "resolved";

export type ReviewState = "pending" | "approved" | "flagged";

export interface PartyInfo {
  name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  postal?: string;
  country: string;
}

export interface ShipmentHold {
  type: "Delayed" | "On Hold";
  reason: string;
  at: number;
  alertId?: string | null;
}

export interface ShipmentNextStop {
  label: string;
  loc: string;
  eta?: number | null;
}

export interface ShipmentReview {
  state: ReviewState;
  note: string;
  at?: number | null;
  by?: string | null;
}

export interface Parcel {
  id: string;
  contents: string;
  packageType: string;
  weightKg: number;
  actualKg: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  declaredValue: number;
  photos: string[];
  review: ShipmentReview;
}

export interface DraftParcel {
  id: string;
  weight: string;
  pkgType: string;
  lengthCm?: string;
  widthCm?: string;
  heightCm?: string;
  val: string;
  contents: string;
  photos?: Array<{
    url: string;
    storagePath?: string;
    name?: string;
  }>;
}

export interface TrackingEvent {
  id: string;
  stage: ShipmentStage;
  label: string;
  loc: string;
  note: string;
  kind: EventKind;
  ts: number;
  createdBy: string;
  createdAt?: unknown;
}

export interface ShipmentAlert {
  id: string;
  to: AlertTarget;
  kind: AlertKind;
  chargeType?: ChargeType | string | null;
  currency?: string;
  holdShipment?: boolean;
  title: string;
  message: string;
  amount: number;
  status: AlertStatus;
  response?: string;
  attachmentName?: string;
  attachmentUrl?: string;
  payment?: CustomsPaymentInfo | null;
  createdAt?: unknown;
  resolvedAt?: unknown;
  createdAtMs?: number;
  resolvedAtMs?: number;
}

export interface ShipmentInviteRecord {
  id: string;
  tokenHash: string;
  receiverEmail: string;
  template: "invite" | "on_its_way" | "reminder";
  status:
    | "sent"
    | "queued_preview"
    | "opened"
    | "completed"
    | "flagged_unknown"
    | "unsubscribed";
  emailCount: number;
  sentAt: number;
  openedAt?: number | null;
  completedAt?: number | null;
  createdBy: string;
}

export interface LatestTrackingUpdate {
  label: string;
  loc: string;
  ts: number;
}

export interface TrackingTeaser {
  code: string;
  senderId: string;
  status: ShipmentStage;
  holdType?: string | null;
  originCity: string;
  originCountry: string;
  destinationCity: string;
  destinationCountry: string;
  service: ServiceTier;
  weightKg: number;
  contents: string;
  eta: number;
  deliveredAt?: number | null;
  latestEvent?: LatestTrackingUpdate | null;
}

export type BookingPaymentStatus =
  | "awaiting_payment"
  | "pending_review"
  | "paid"
  | "pay_on_pickup"
  | "rejected"
  | "info_requested"
  | "failed"
  | "expired"
  | "refunded";

export type BookingStatus =
  | "awaiting_payment"
  | "confirmed"
  | "expired"
  | "cancelled";

export type BookingPaymentChannel =
  | "pay_now"
  | "pay_on_delivery"
  | "card"
  | "bank_transfer"
  | "crypto"
  | "mobile_money"
  | "cash"
  | "other"
  | "pay_on_pickup"
  | "manual";

export type PaymentMethodType =
  | "automatic"
  | "bank_transfer"
  | "crypto"
  | "mobile_money"
  | "cash"
  | "other";

export interface PaymentMethodDetailRow {
  label: string;
  value: string;
  copyable?: boolean;
}

export interface PaymentMethodFee {
  mode: "none" | "fixed" | "percent";
  kind: "fee" | "discount";
  amount: number;
}

export interface PaymentMethodRules {
  minAmount: number;
  maxAmount: number;
  allowedCountries: string[];
  appliesTo: "shipping" | "customs" | "both";
  audience: "everyone" | "business";
}

export interface PaymentMethodProofSettings {
  required: boolean;
  fields: {
    screenshot: boolean;
    txId: boolean;
    senderName: boolean;
    paidAt: boolean;
  };
  approval: "manual" | "auto";
}

export interface PaymentMethodRecord {
  id: string;
  name: string;
  subtitle: string;
  type: PaymentMethodType;
  gateway?: GatewayId | null;
  enabled: boolean;
  order: number;
  currency: string;
  exchangeRate: number;
  details: PaymentMethodDetailRow[];
  instructions: string;
  iconUrl?: string;
  qrUrl?: string;
  fee: PaymentMethodFee;
  rules: PaymentMethodRules;
  proof: PaymentMethodProofSettings;
  windowMinutes: number;
  createdAtMs?: number;
  updatedAtMs?: number;
}

export type ManualPaymentStatus =
  | "awaiting_payment"
  | "pending_review"
  | "paid"
  | "rejected"
  | "info_requested"
  | "expired"
  | "refunded";

export interface ManualPaymentProof {
  screenshotUrl?: string;
  screenshotHash?: string;
  screenshotName?: string;
  txId?: string;
  senderName?: string;
  paidAt?: string;
  note?: string;
  submittedAt: number;
}

export interface ManualPaymentAuditEntry {
  action: string;
  actor: string;
  note?: string;
  at: number;
}

export interface ManualPaymentRecord {
  id: string;
  reference: string;
  kind: "booking" | "customs";
  trackingCode: string;
  bookingId?: string | null;
  alertId?: string | null;
  uid: string;
  userEmail: string;
  userName?: string;
  methodId: string;
  methodName: string;
  methodType: PaymentMethodType;
  baseAmount: number;
  feeAmount: number;
  totalUsd: number;
  currency: string;
  convertedAmount: number;
  exchangeRate: number;
  detailsSnapshot: PaymentMethodDetailRow[];
  instructionsSnapshot: string;
  qrUrlSnapshot?: string;
  proofConfig?: PaymentMethodProofSettings;
  status: ManualPaymentStatus;
  expiresAt: number;
  proof?: ManualPaymentProof | null;
  reviewNote?: string | null;
  duplicateWarning?: string | null;
  audit: ManualPaymentAuditEntry[];
  createdAtMs: number;
  updatedAtMs: number;
  paidAtMs?: number | null;
  refundedAtMs?: number | null;
}

export interface BookingRecord {
  id: string;
  code: string;
  uid: string;
  senderEmail: string;
  receiverEmail: string;
  service: ServiceTier;
  weightKg: number;
  declaredValue: number;
  parcels?: Parcel[];
  total: number;
  feeAmount?: number;
  currency: string;
  convertedAmount?: number;
  convertedCurrency?: string;
  paymentMethod: string;
  paymentMethodId?: string;
  paymentChannel: BookingPaymentChannel;
  paymentStatus: BookingPaymentStatus;
  bookingStatus: BookingStatus;
  environment?: "sandbox" | "live";
  checkoutId?: string | null;
  checkoutUrl?: string | null;
  paymentId?: string | null;
  paymentReference?: string | null;
  checkoutExpiresAt?: number | null;
  paymentWindowExpiresAt?: number | null;
  paidAt?: number | null;
  refundedAt?: number | null;
  refundId?: string | null;
  lastError?: string | null;
  idempotencyKey?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  createdAtMs?: number;
}

export interface ShipmentRecord {
  code: string;
  senderId: string;
  senderEmail: string;
  receiverEmail: string;
  sender: PartyInfo;
  receiver: PartyInfo;
  service: ServiceTier;
  weightKg: number;
  packageType: string;
  contents: string;
  declaredValue: number;
  parcels?: Parcel[];
  priceTotal: number;
  paymentMethod: string;
  paymentMethodId?: string | null;
  paymentMethodName?: string | null;
  paymentChannel?: string | null;
  feeAmount?: number | null;
  convertedAmount?: number | null;
  convertedCurrency?: string | null;
  paymentWindowExpiresAt?: number | null;
  bookingId?: string;
  paymentStatus?: BookingPaymentStatus;
  paymentReference?: string | null;
  paymentId?: string | null;
  checkoutExpiresAt?: number | null;
  bookingStatus?: BookingStatus;
  status: ShipmentStage;
  eta: number;
  deliveredAt?: number | null;
  photos: string[];
  hold?: ShipmentHold | null;
  nextStop?: ShipmentNextStop | null;
  review: ShipmentReview;
  createdAt?: unknown;
  updatedAt?: unknown;
  createdAtMs?: number;
  events?: TrackingEvent[];
  alerts?: ShipmentAlert[];
  invites?: ShipmentInviteRecord[];
}

export interface DraftWizardData {
  sName: string;
  sEmail: string;
  sPhone: string;
  sAddr: string;
  sCity: string;
  sPost: string;
  sCountry: string;
  rName: string;
  rEmail: string;
  rPhone: string;
  rAddr: string;
  rCity: string;
  rPost: string;
  rCountry: string;
  weight: string;
  pkgType: string;
  val: string;
  contents: string;
  service: ServiceTier;
  paymentMethodId?: string;
  photos?: Array<{
    url: string;
    storagePath?: string;
    name?: string;
  }>;
  parcels?: DraftParcel[];
}

export interface DraftShipmentRecord {
  id: string;
  uid: string;
  step: number;
  data: DraftWizardData;
  reminderSent?: boolean;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface DraftSummaryRecord {
  draftId: string;
  uid: string;
  email?: string;
  step: number;
  originCountry?: string;
  destCountry?: string;
  reminderSent?: boolean;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface ErrorLogRecord {
  id: string;
  uid?: string | null;
  step: string;
  code: string;
  message: string;
  route?: string;
  ts: number;
}

export interface NotificationPrefs {
  onway: boolean;
  scan: boolean;
  action: boolean;
}

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  phone?: string;
  company?: string;
  theme?: ThemePreference;
  prefs?: NotificationPrefs;
  createdAt?: unknown;
  updatedAt?: unknown;
  createdAtMs?: number;
}

export interface BusinessLead {
  id?: string;
  ref: string;
  company: string;
  name: string;
  email: string;
  plan: "Starter" | "Growth" | "Enterprise";
  volume: string;
  message: string;
  status: "new" | "contacted";
  createdAt?: unknown;
}

export interface SupportMessage {
  id: string;
  from: "user" | "admin";
  senderName: string;
  senderEmail: string;
  body: string;
  source: "web" | "email";
  ts: number;
  attachments?: Array<{ id: string; name: string; type: string; size: number }>;
  createdAt?: unknown;
}

export interface SupportThread {
  id: string;
  ticketCode: string;
  uid?: string | null;
  userName: string;
  userEmail: string;
  subject: string;
  code?: string | null;
  status: "open" | "closed";
  source: "web" | "email";
  unreadAdmin: boolean;
  unreadUser: boolean;
  lastMessageAt: number;
  lastMessagePreview?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  messages?: SupportMessage[];
}

export interface SecretMask {
  configured: boolean;
  last4?: string;
  prefix?: string;
  masked?: string;
  updatedAt?: number;
  updatedBy?: string;
}

export interface AdminPaymentSettingsPublic {
  bachs: {
    environment: "sandbox" | "live";
    sandboxProductId: string;
    liveProductId: string;
    organizationId: string;
    defaultCurrency: string;
    checkoutExpiryMinutes: number;
    lastWebhookAt?: number | null;
    secrets: {
      sandboxSecretKey: SecretMask;
      liveSecretKey: SecretMask;
      sandboxWebhookSecret: SecretMask;
      liveWebhookSecret: SecretMask;
      previousWebhookSecret: SecretMask;
    };
  };
  resend: {
    from: string;
    replyTo: string;
    supportInbox: string;
    fromSecurity?: string;
    fromTracking?: string;
    fromBilling?: string;
    fromPayments?: string;
    fromNotifications?: string;
    fromSupport?: string;
    secrets: {
      apiKey: SecretMask;
      inboundWebhookSecret: SecretMask;
    };
  };
  stripe: {
    enabled: boolean;
    publicKey: string;
    secrets: {
      secretKey: SecretMask;
      webhookSecret: SecretMask;
    };
  };
  paystack: {
    enabled: boolean;
    publicKey: string;
    secrets: {
      secretKey: SecretMask;
      webhookSecret: SecretMask;
    };
  };
  routing: {
    primaryGateway: GatewayId;
    fallbackOrder: GatewayId[];
    offerChoice: boolean;
    enableBachsBooking: boolean;
    enablePayOnPickup: boolean;
  };
  updatedAt?: number | null;
  updatedBy?: string | null;
  encryptionReady?: boolean;
}

export interface WebhookEventLog {
  id: string;
  provider: string;
  eventType: string;
  reference: string;
  result: "processed" | "duplicate" | "rejected-signature" | "ignored" | "error";
  detail?: string;
  environment?: string;
  ts: number;
}

export interface EmailLogRecord {
  id: string;
  to: string;
  from?: string;
  code?: string | null;
  template: string;
  subject: string;
  status: "sent" | "queued_preview" | "failed" | "delivered" | "bounced";
  providerId?: string | null;
  htmlPreview?: string | null;
  createdBy: string;
  createdAt?: unknown;
  createdAtMs?: number;
}

export const STAGES: ShipmentStage[] = [
  "Booked",
  "Picked Up",
  "In Transit",
  "At Hub",
  "Customs",
  "Out for Delivery",
  "Delivered",
];

export const STAGE_SHORT: Record<ShipmentStage, string> = {
  Booked: "Booked",
  "Picked Up": "Picked up",
  "In Transit": "In transit",
  "At Hub": "At hub",
  Customs: "Customs",
  "Out for Delivery": "Out for delivery",
  Delivered: "Delivered",
};

export const STAGE_HEAD: Record<ShipmentStage, string> = {
  Booked: "Booking confirmed",
  "Picked Up": "Picked up",
  "In Transit": "In transit",
  "At Hub": "At sorting hub",
  Customs: "In customs",
  "Out for Delivery": "Out for delivery",
  Delivered: "Delivered",
};

export const STAGE_PCT = [6, 16, 42, 60, 74, 90, 100] as const;

export const CODE_RE = /^SW-\d{8}-[A-F0-9]{8}$/;

export const ADMIN_EMAIL = "denic9426@gmail.com";

export function normalizeEmail(email: string): string {
  return String(email || "").trim().toLowerCase();
}

export function formatTrackingCode(value: string): string {
  let raw = String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (raw && /^\d/.test(raw)) {
    raw = "SW" + raw;
  }
  raw = raw.slice(0, 18);
  let out = raw.slice(0, 2);
  if (raw.length > 2) out += "-" + raw.slice(2, 10);
  if (raw.length > 10) out += "-" + raw.slice(10, 18);
  return out;
}

export function isValidTrackingCode(code: string): boolean {
  return CODE_RE.test(code);
}

export function generateTrackingCode(): string {
  const now = new Date();
  const pad = (x: number) => String(x).padStart(2, "0");
  const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const bytes = new Uint8Array(4);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 4; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  const suffix = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  return `SW-${dateStr}-${suffix}`;
}

export function getStagePercent(status: ShipmentStage): number {
  if (status === "Delivered") return 100;
  const idx = STAGES.indexOf(status);
  return STAGE_PCT[Math.max(0, idx)];
}

export function getShipmentChip(s: {
  status: ShipmentStage;
  hold?: { type?: string } | null;
  holdType?: string | null;
  review?: { state?: ReviewState };
}): { tone: "g" | "a" | "r" | "b"; label: string } {
  if (s.status === "Delivered") return { tone: "g", label: "Delivered" };
  const hType = s.hold?.type || s.holdType;
  if (hType) {
    return {
      tone: hType === "Delayed" ? "a" : "r",
      label: hType,
    };
  }
  if (s.status === "Booked") {
    return s.review?.state === "pending"
      ? { tone: "a", label: "Awaiting review" }
      : { tone: "a", label: "Booked" };
  }
  if (s.status === "Out for Delivery") {
    return { tone: "g", label: "Out for delivery" };
  }
  return { tone: "b", label: s.status };
}

export function getInitials(name?: string | null): string {
  return (
    String(name || "?")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((x) => x[0])
      .join("")
      .toUpperCase() || "?"
  );
}

export function formatTimeAgo(ts: number): string {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

export function firestoreTimeToMs(val: unknown): number {
  if (typeof val === "number") return val;
  if (val && typeof val === "object" && "toMillis" in val && typeof (val as { toMillis: () => number }).toMillis === "function") {
    return (val as { toMillis: () => number }).toMillis();
  }
  if (val && typeof val === "object" && "seconds" in val) {
    return Number((val as { seconds: number }).seconds) * 1000;
  }
  return Date.now();
}

export function formatUsd(amount: number, currency = "USD"): string {
  const num = Number(amount || 0);
  if (currency.toUpperCase() === "USD") {
    return `$${num.toFixed(2)}`;
  }
  return `${currency.toUpperCase()} ${num.toFixed(2)}`;
}

export function getParcels(
  shipment:
    | Partial<
        Pick<
          ShipmentRecord,
          | "parcels"
          | "contents"
          | "packageType"
          | "weightKg"
          | "declaredValue"
          | "photos"
          | "review"
        >
      >
    | null
    | undefined
): Parcel[] {
  if (!shipment) return [];
  if (Array.isArray(shipment.parcels) && shipment.parcels.length > 0) {
    return shipment.parcels.map((p, idx) => {
      const billable = Number(p.weightKg || p.actualKg || 0.1);
      const actual = Number(p.actualKg || p.weightKg || billable);
      return {
        id: p.id || `parcel_${idx + 1}`,
        contents: String(p.contents || "Parcel"),
        packageType: String(p.packageType || "Parcel"),
        weightKg: Number.isFinite(billable) && billable > 0 ? billable : 0.1,
        actualKg: Number.isFinite(actual) && actual > 0 ? actual : 0.1,
        ...(typeof p.lengthCm === "number" && p.lengthCm > 0
          ? { lengthCm: p.lengthCm }
          : {}),
        ...(typeof p.widthCm === "number" && p.widthCm > 0
          ? { widthCm: p.widthCm }
          : {}),
        ...(typeof p.heightCm === "number" && p.heightCm > 0
          ? { heightCm: p.heightCm }
          : {}),
        declaredValue: Math.max(0, Number(p.declaredValue) || 0),
        photos: Array.isArray(p.photos) ? p.photos.filter(Boolean) : [],
        review: p.review || { state: "pending", note: "" },
      };
    });
  }
  const w = Math.max(0.1, Number(shipment.weightKg) || 0.1);
  return [
    {
      id: "parcel_1",
      contents: String(shipment.contents || "Parcel"),
      packageType: String(shipment.packageType || "Parcel"),
      weightKg: w,
      actualKg: w,
      declaredValue: Math.max(0, Number(shipment.declaredValue) || 0),
      photos: Array.isArray(shipment.photos)
        ? shipment.photos.filter(Boolean)
        : [],
      review: shipment.review || { state: "pending", note: "" },
    },
  ];
}

export function formatParcelContentsSummary(
  parcels: Array<{ contents: string }>
): string {
  const names = parcels
    .map((p) => String(p.contents || "").trim())
    .filter(Boolean);
  if (names.length === 0) return "Parcel";
  if (names.length === 1) return names[0].slice(0, 240);
  if (names.length === 2) {
    const joined = `${names[0]}, ${names[1]}`;
    return joined.length <= 240
      ? joined
      : `${names[0].slice(0, 220)} +1 more`;
  }
  const suffix = ` +${names.length - 2} more`;
  const head = `${names[0]}, ${names[1]}`;
  if (head.length + suffix.length <= 240) return `${head}${suffix}`;
  return `${head.slice(0, 240 - suffix.length)}${suffix}`;
}

export function computeAggregateReview(
  parcels: Array<{ review?: ShipmentReview }>,
  existingNote = ""
): ShipmentReview {
  if (!parcels.length) {
    return { state: "pending", note: existingNote };
  }
  const flagged = parcels.find((p) => p.review?.state === "flagged");
  if (flagged) {
    return {
      state: "flagged",
      note: flagged.review?.note || existingNote,
      at: flagged.review?.at ?? Date.now(),
      by: flagged.review?.by || "ShipWell Operations",
    };
  }
  const allApproved = parcels.every((p) => p.review?.state === "approved");
  if (allApproved) {
    const latestAt = parcels.reduce(
      (max, p) => Math.max(max, Number(p.review?.at || 0)),
      0
    );
    return {
      state: "approved",
      note: "",
      at: latestAt || Date.now(),
      by: "ShipWell Operations",
    };
  }
  return {
    state: "pending",
    note: "",
  };
}

export function summarizeParcels(parcels: Parcel[]): {
  weightKg: number;
  declaredValue: number;
  contents: string;
  packageType: string;
  photos: string[];
  review: ShipmentReview;
} {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const weightKg = r2(
    parcels.reduce((sum, p) => sum + Math.max(0.1, Number(p.weightKg) || 0.1), 0)
  );
  const declaredValue = r2(
    parcels.reduce(
      (sum, p) => sum + Math.max(0, Number(p.declaredValue) || 0),
      0
    )
  );
  const contents = formatParcelContentsSummary(parcels);
  const packageType =
    parcels.length > 1
      ? "Multiple parcels"
      : String(parcels[0]?.packageType || "Parcel").slice(0, 60);

  const seen = new Set<string>();
  const photos: string[] = [];
  for (const p of parcels) {
    const first = p.photos?.[0];
    if (first && !seen.has(first)) {
      seen.add(first);
      photos.push(first);
      if (photos.length >= 4) break;
    }
  }
  if (photos.length < 4 && parcels.length === 1) {
    for (const url of parcels[0]?.photos || []) {
      if (url && !seen.has(url)) {
        seen.add(url);
        photos.push(url);
        if (photos.length >= 4) break;
      }
    }
  }

  return {
    weightKg,
    declaredValue,
    contents,
    packageType,
    photos,
    review: computeAggregateReview(parcels),
  };
}