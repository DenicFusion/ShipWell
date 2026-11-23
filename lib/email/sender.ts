import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb, isAdminIamError } from "../server/firebase-admin.ts";
import {
  DEFAULT_EMAIL_FROM,
  DEFAULT_EMAIL_REPLY_TO,
  loadSettingsBundle,
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
  status: "sent" | "queued_preview" | "failed";
  providerId?: string;
  error?: string;
}

export interface DispatchMeta {
  template?: string;
  code?: string | null;
  createdBy?: string;
  fromOverride?: string;
  replyToOverride?: string;
  logToFirestore?: boolean;
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
    await db.collection("emailLogs").add({
      to: entry.to.slice(0, 160),
      from: entry.from.slice(0, 160),
      code: entry.code ? entry.code.slice(0, 24) : "",
      template: entry.template.slice(0, 60),
      subject: entry.subject.slice(0, 240),
      status: entry.status,
      providerId: (entry.providerId || "").slice(0, 128),
      htmlPreview: (entry.htmlPreview || "").slice(0, 24000),
      createdBy: entry.createdBy.slice(0, 128),
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
  let apiKey = process.env.RESEND_API_KEY || "";
  let from = meta.fromOverride || process.env.EMAIL_FROM || DEFAULT_EMAIL_FROM;
  let replyTo =
    meta.replyToOverride || process.env.EMAIL_REPLY_TO || DEFAULT_EMAIL_REPLY_TO;

  try {
    const { publicSettings, secrets } = await loadSettingsBundle();
    if (secrets.resendApiKey) {
      apiKey = secrets.resendApiKey;
    }
    if (!meta.fromOverride && publicSettings.resend.from) {
      from = publicSettings.resend.from;
    }
    if (!meta.replyToOverride && publicSettings.resend.replyTo) {
      replyTo = publicSettings.resend.replyTo;
    }
  } catch {
    // fallback to env values cleanly
  }

  let result: DispatchResult;
  if (!apiKey) {
    result = {
      status: "queued_preview",
      providerId: `preview_${Date.now().toString(36)}`,
    };
  } else {
    let lastErr = "Email delivery failed";
    let sentResult: DispatchResult | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from,
            to: [to],
            reply_to: replyTo,
            subject: payload.subject,
            html: payload.html,
            text: payload.text,
          }),
        });
        if (res.ok) {
          const json = (await res.json()) as { id?: string };
          sentResult = {
            status: "sent",
            providerId: json.id || `resend_${Date.now()}`,
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
    result = sentResult || { status: "failed", error: lastErr };
  }

  if (meta.logToFirestore !== false) {
    await writeEmailLogSafe({
      to,
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
