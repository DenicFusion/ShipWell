import crypto from "node:crypto";
import type { SecretMask } from "../../types/tracking.ts";

function getDerivedKey(): Buffer {
  const raw = (process.env.SETTINGS_ENCRYPTION_KEY || "").trim();
  if (!raw) {
    throw new Error(
      "SETTINGS_ENCRYPTION_KEY is not configured on the server. Set it in Firebase Secret Manager before saving secrets."
    );
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  try {
    const b64 = Buffer.from(raw, "base64");
    if (b64.length === 32) {
      return b64;
    }
  } catch {
    // fallback to sha256 derivation
  }
  return crypto.createHash("sha256").update(raw, "utf8").digest();
}

export function isEncryptionKeyConfigured(): boolean {
  return Boolean((process.env.SETTINGS_ENCRYPTION_KEY || "").trim());
}

export function encryptSecret(plaintext: string): string {
  const clean = plaintext.trim();
  if (!clean) return "";
  const key = getDerivedKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(clean, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptSecret(payload: string): string {
  if (!payload || typeof payload !== "string") return "";
  if (!payload.startsWith("v1:")) {
    throw new Error("Invalid encrypted secret format.");
  }
  const parts = payload.split(":");
  if (parts.length !== 4) {
    throw new Error("Corrupted encrypted secret envelope.");
  }
  const key = getDerivedKey();
  const iv = Buffer.from(parts[1], "base64");
  const tag = Buffer.from(parts[2], "base64");
  const ct = Buffer.from(parts[3], "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(ct), decipher.final()]);
  return out.toString("utf8");
}

export function buildSecretMask(
  plaintext: string,
  updatedBy?: string
): SecretMask {
  const clean = plaintext.trim();
  if (!clean) return { configured: false };
  const last4 = clean.slice(-4);
  const underscoreIdx = clean.indexOf("_", clean.indexOf("_") + 1);
  const prefix =
    underscoreIdx > 0 && underscoreIdx <= 14
      ? clean.slice(0, underscoreIdx + 1)
      : clean.slice(0, Math.min(4, Math.max(0, clean.length - 4)));
  return {
    configured: true,
    last4,
    prefix,
    masked: `${prefix}••••${last4}`,
    updatedAt: Date.now(),
    updatedBy: updatedBy || undefined,
  };
}

export function validateSecretPrefix(
  field:
    | "bachsSandboxKey"
    | "bachsLiveKey"
    | "bachsSandboxWebhook"
    | "bachsLiveWebhook"
    | "bachsPreviousWebhook"
    | "resendApiKey"
    | "resendInboundSecret"
    | "stripeSecretKey"
    | "stripeWebhookSecret"
    | "paystackSecretKey"
    | "paystackWebhookSecret",
  value: string
): string | null {
  const v = value.trim();
  if (!v) return null;

  if (field === "bachsSandboxKey") {
    if (v.startsWith("sk_live_")) {
      return "Wrong key for Bachs Sandbox secret key: you pasted a Live key (sk_live_...). Use your sk_sandbox_ key here.";
    }
    if (!v.startsWith("sk_sandbox_") && !v.startsWith("sk_test_")) {
      return "Bachs Sandbox secret key must start with sk_sandbox_.";
    }
  }
  if (field === "bachsLiveKey") {
    if (v.startsWith("sk_sandbox_") || v.startsWith("sk_test_")) {
      return "Wrong key for Bachs Live secret key: you pasted a Sandbox key. Use your sk_live_ key here.";
    }
    if (!v.startsWith("sk_live_")) {
      return "Bachs Live secret key must start with sk_live_.";
    }
  }
  if (field === "resendApiKey") {
    if (!v.startsWith("re_")) {
      return "Resend API key must start with re_.";
    }
  }
  if (field === "stripeSecretKey") {
    if (
      !v.startsWith("sk_test_") &&
      !v.startsWith("sk_live_") &&
      !v.startsWith("rk_test_") &&
      !v.startsWith("rk_live_")
    ) {
      return "Stripe secret key must start with sk_test_, sk_live_, or rk_.";
    }
  }
  if (field === "paystackSecretKey") {
    if (!v.startsWith("sk_test_") && !v.startsWith("sk_live_")) {
      return "Paystack secret key must start with sk_test_ or sk_live_.";
    }
  }
  return null;
}
