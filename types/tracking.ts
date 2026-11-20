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
  title: string;
  message: string;
  amount: number;
  status: AlertStatus;
  response?: string;
  attachmentName?: string;
  attachmentUrl?: string;
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
  priceTotal: number;
  paymentMethod: string;
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

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  phone?: string;
  company?: string;
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

export const STAGES: ShipmentStage[] = [
  "Booked",
  "Picked Up",
  "In Transit",
  "At Hub",
  "Customs",
  "Out for Delivery",
  "Delivered",
];

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