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

export async function dispatchTransactionalEmail(
  to: string,
  payload: EmailPayload
): Promise<DispatchResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from =
    process.env.EMAIL_FROM || "ShipWell <notifications@shipwell.example>";
  const replyTo =
    process.env.EMAIL_REPLY_TO || "support@shipwell.example";

  if (!apiKey) {
    return {
      status: "queued_preview",
      providerId: `preview_${Date.now().toString(36)}`,
    };
  }

  let lastErr = "Email delivery failed";
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
        return {
          status: "sent",
          providerId: json.id || `resend_${Date.now()}`,
        };
      }
      lastErr = `HTTP ${res.status}`;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : "Network error";
    }
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 250 * attempt));
    }
  }

  return { status: "failed", error: lastErr };
}
