import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb, isAdminIamError } from "../server/firebase-admin.ts";
import {
  DEFAULT_EMAIL_FROM,
  DEFAULT_EMAIL_REPLY_TO,
  loadSettingsBundle,
  resolveEmailSender,
  type EmailSenderCategory,
} from "../server/settings-store.ts";
import type { EmailPayload } from "./templates.ts";

declare global {
  var __shipwellRateMap: Map<string, number[]> | undefined;
}

function getRateMap(): Map<string, number[]> {
  if (!globalThis.__shipwellRateMap) {
    globalThis.__shipwellRateMap = new Map();
  }
  return globalThis.__shipwellRateMap;
}

export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): boolean {
  const now = Date.now();
  const map = getRateMap();
  const prev = (map.get(key) || []).filter((ts) => now - ts < windowMs);
  if (prev.length >= maxRequests) {
    map.set(key, prev);
    return false;
  }
  prev.push(now);
  map.set(key, prev);
  return true;
}

export interface DispatchResult {
  status: "sent" | "queued_preview" | "failed" | "skipped_prefs";
  providerId?: string;
  from?: string;
  error?: string;
}

export interface DispatchMeta {
  template?: string;
  category?: EmailSenderCategory;
  prefKey?: "onway" | "scan" | "action";
  code?: string | null;
  createdBy?: string;
  fromOverride?: string;
  replyToOverride?: string;
  omitReplyTo?: boolean;
  logToFirestore?: boolean;
}

async function shouldSkipByUserPrefs(
  email: string,
  prefKey?: "onway" | "scan" | "action"
): Promise<boolean> {
  if (!prefKey) return false;
  try {
    const db = getAdminDb();
    const snap = await db
      .collection("users")
      .where("email", "==", email.trim().toLowerCase())
      .limit(1)
      .get();
    if (snap.empty) return false;
    const prefs = snap.docs[0].data()?.prefs as
      | { onway?: boolean; scan?: boolean; action?: boolean }
      | undefined;
    if (!prefs) return false;
    return prefs[prefKey] === false;
  } catch {
    return false;
  }
}

async function writeEmailLogSafe(entry: {
  to: string;
  from: string;
  code?: string | null;
  template: string;
  subject: string;
  status: DispatchResult["status"];
  providerId?: string;
  htmlPreview?: string;
  createdBy: string;
}) {
  try {
    const db = getAdminDb();
    const docStatus =
      entry.status === "skipped_prefs" ? "sent" : entry.status;
    await db.collection("emailLogs").add({
      to: entry.to.slice(0, 160),
      from: entry.from.slice(0, 160),
      code: entry.code ? entry.code.slice(0, 24) : "",
      template: entry.template.slice(0, 60),
      subject: entry.subject.slice(0, 240),
      status: docStatus,
      providerId: (entry.providerId || "").slice(0, 128),
      htmlPreview: (entry.htmlPreview || "").slice(0, 24000),
      createdBy: entry.createdBy.slice(0, 128),
      createdAt: FieldValue.serverTimestamp(),
    });
    await db.collection("mail").add({
      to: entry.to.slice(0, 160),
      from: entry.from.slice(0, 160),
      template: entry.template.slice(0, 60),
      subject: entry.subject.slice(0, 240),
      status: docStatus,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    if (!isAdminIamError(err)) {
      console.warn("Unable to persist emailLog:", err);
    }
  }
}

export async function dispatchTransactionalEmail(
  to: string,
  payload: EmailPayload,
  meta: DispatchMeta = {}
): Promise<DispatchResult> {
  const cleanTo = String(to || "").trim().toLowerCase();
  if (!cleanTo.includes("@")) {
    return { status: "failed", error: "Invalid recipient email." };
  }

  // Respect user notification preferences for non-security templates
  if (meta.category !== "security" && meta.prefKey) {
    const skipped = await shouldSkipByUserPrefs(cleanTo, meta.prefKey);
    if (skipped) {
      return { status: "skipped_prefs" };
    }
  }

  let apiKey = process.env.RESEND_API_KEY || "";
  let from = meta.fromOverride || process.env.EMAIL_FROM || DEFAULT_EMAIL_FROM;
  let replyTo: string | undefined =
    meta.omitReplyTo || meta.category === "security"
      ? undefined
      : meta.replyToOverride || process.env.EMAIL_REPLY_TO || DEFAULT_EMAIL_REPLY_TO;

  try {
    const { publicSettings, secrets } = await loadSettingsBundle();
    if (secrets.resendApiKey) {
      apiKey = secrets.resendApiKey;
    }
    if (meta.category) {
      const resolved = resolveEmailSender(publicSettings, meta.category);
      if (!meta.fromOverride) from = resolved.from;
      if (meta.category === "security" || meta.omitReplyTo) {
        replyTo = undefined;
      } else if (!meta.replyToOverride) {
        replyTo = resolved.replyTo;
      }
    } else {
      if (!meta.fromOverride && publicSettings.resend.from) {
        from = publicSettings.resend.from;
      }
      if (
        !meta.omitReplyTo &&
        !meta.replyToOverride &&
        publicSettings.resend.replyTo
      ) {
        replyTo = publicSettings.resend.replyTo;
      }
    }
  } catch {
    // fallback to env values cleanly
  }

  let result: DispatchResult;
  if (!apiKey) {
    result = {
      status: "queued_preview",
      providerId: `preview_${Date.now().toString(36)}`,
      from,
    };
  } else {
    let lastErr = "Email delivery failed";
    let sentResult: DispatchResult | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const resendBody: Record<string, unknown> = {
          from,
          to: [cleanTo],
          subject: payload.subject,
          html: payload.html,
          text: payload.text,
        };
        if (replyTo) {
          resendBody.reply_to = replyTo;
        }
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(resendBody),
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok) {
          const json = (await res.json()) as { id?: string };
          sentResult = {
            status: "sent",
            providerId: json.id || `resend_${Date.now()}`,
            from,
          };
          break;
        }
        lastErr = `HTTP ${res.status}`;
      } catch (err) {
        lastErr = err instanceof Error ? err.message : "Network error";
      }
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 250 * attempt));
      }
    }
    result = sentResult || { status: "failed", error: lastErr, from };
  }

  if (meta.logToFirestore !== false) {
    await writeEmailLogSafe({
      to: cleanTo,
      from,
      code: meta.code,
      template: meta.template || "transactional",
      subject: payload.subject,
      status: result.status,
      providerId: result.providerId,
      htmlPreview: payload.html,
      createdBy: meta.createdBy || "system",
    });
  }

  return result;
}
