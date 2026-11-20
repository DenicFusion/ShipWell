import crypto from "crypto";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

declare global {
  var __shipwellInviteSecret: Buffer | undefined;
}

function getSecretKey(): Buffer {
  const envSecret = process.env.INVITE_TOKEN_SECRET;
  if (envSecret && envSecret.length >= 16) {
    return crypto.createHash("sha256").update(envSecret).digest();
  }
  if (!globalThis.__shipwellInviteSecret) {
    globalThis.__shipwellInviteSecret = crypto.randomBytes(32);
  }
  return globalThis.__shipwellInviteSecret;
}

export interface InviteTokenPayload {
  c: string; // tracking code
  e: string; // receiver email (lowercase)
  n: string; // receiver first name
  s: string; // sender full name
  iat: number;
  exp: number;
}

export interface VerifiedInviteResult {
  valid: boolean;
  expired: boolean;
  reason?: string;
  code?: string;
  receiverEmail?: string;
  receiverFirstName?: string;
  senderFullName?: string;
  maskedEmail?: string;
  tokenHash: string;
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function maskEmail(email: string): string {
  const clean = String(email || "").trim().toLowerCase();
  const [local, domain] = clean.split("@");
  if (!local || !domain) return "***";
  if (local.length <= 2) return `${local[0] || "*"}***@${domain}`;
  const stars = "*".repeat(Math.min(6, Math.max(3, local.length - 2)));
  return `${local[0]}${stars}${local[local.length - 1]}@${domain}`;
}

export function createSignedInviteToken(input: {
  code: string;
  receiverEmail: string;
  receiverFirstName: string;
  senderFullName: string;
}): { token: string; tokenHash: string; expiresAt: number } {
  const now = Date.now();
  const expiresAt = now + THIRTY_DAYS_MS;
  const payload: InviteTokenPayload = {
    c: input.code.trim().toUpperCase(),
    e: input.receiverEmail.trim().toLowerCase(),
    n: input.receiverFirstName.trim(),
    s: input.senderFullName.trim(),
    iat: now,
    exp: expiresAt,
  };

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getSecretKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  const token = Buffer.concat([iv, tag, encrypted]).toString("base64url");
  return {
    token,
    tokenHash: hashToken(token),
    expiresAt,
  };
}

export function verifySignedInviteToken(
  token: string,
  expectedCode?: string
): VerifiedInviteResult {
  const cleanToken = String(token || "").trim();
  const tokenHash = hashToken(cleanToken);
  if (!cleanToken) {
    return { valid: false, expired: false, reason: "Missing token", tokenHash };
  }

  try {
    const raw = Buffer.from(cleanToken, "base64url");
    if (raw.length < 29) {
      return { valid: false, expired: false, reason: "Invalid link", tokenHash };
    }
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ciphertext = raw.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", getSecretKey(), iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
    const payload = JSON.parse(decrypted) as InviteTokenPayload;

    if (
      expectedCode &&
      payload.c.toUpperCase() !== expectedCode.trim().toUpperCase()
    ) {
      return {
        valid: false,
        expired: false,
        reason: "Link does not match this shipment.",
        tokenHash,
      };
    }

    if (Date.now() > payload.exp) {
      return {
        valid: false,
        expired: true,
        code: payload.c,
        receiverEmail: payload.e,
        receiverFirstName: payload.n,
        senderFullName: payload.s,
        maskedEmail: maskEmail(payload.e),
        reason: "This link has expired.",
        tokenHash,
      };
    }

    return {
      valid: true,
      expired: false,
      code: payload.c,
      receiverEmail: payload.e,
      receiverFirstName: payload.n,
      senderFullName: payload.s,
      maskedEmail: maskEmail(payload.e),
      tokenHash,
    };
  } catch {
    return {
      valid: false,
      expired: false,
      reason: "Invalid or expired invite link.",
      tokenHash,
    };
  }
}
