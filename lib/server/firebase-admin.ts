import { getApp, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import firebaseConfigLocal from "../../firebase-applet-config.json" with { type: "json" };
import { ADMIN_EMAIL, normalizeEmail } from "../../types/tracking.ts";

export class AdminSdkUnavailableError extends Error {
  status = 503;
  constructor(message = "Firebase Admin SDK credentials are not available in this environment.") {
    super(message);
    this.name = "AdminSdkUnavailableError";
  }
}

export interface VerifiedServerUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  isAdmin: boolean;
  authTime: number;
}

export function getFirebaseAdminApp(): App {
  if (getApps().length > 0) {
    return getApp();
  }
  return initializeApp({
    projectId: firebaseConfigLocal.projectId,
  });
}

export function getAdminDb(): Firestore {
  const app = getFirebaseAdminApp();
  const dbId = firebaseConfigLocal.firestoreDatabaseId;
  if (dbId && dbId !== "(default)") {
    return getFirestore(app, dbId);
  }
  return getFirestore(app);
}

export function getAdminAuth(): Auth {
  return getAuth(getFirebaseAdminApp());
}

export function isAdminIamError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err || "");
  return (
    msg.includes("Could not load the default credentials") ||
    msg.includes("Unable to detect a Project Id") ||
    msg.includes("PERMISSION_DENIED") ||
    msg.includes("Missing or insufficient permissions") ||
    msg.includes("Metadata server") ||
    msg.includes("ENOTFOUND metadata")
  );
}

interface LookupUser {
  localId?: string;
  email?: string;
  emailVerified?: boolean;
  customAttributes?: string;
  lastLoginAt?: string;
}

function decodeJwtAuthTime(token: string): number {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return Math.floor(Date.now() / 1000);
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8")
    ) as { auth_time?: number; iat?: number };
    return Number(payload.auth_time || payload.iat || Math.floor(Date.now() / 1000));
  } catch {
    return Math.floor(Date.now() / 1000);
  }
}

export async function verifyFirebaseAdminAuth(
  headers: Record<string, string | string[] | undefined>
): Promise<VerifiedServerUser | null> {
  const rawAuth = headers.authorization;
  const authHeader = Array.isArray(rawAuth) ? rawAuth[0] || "" : rawAuth || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const idToken = match?.[1]?.trim();
  if (!idToken || idToken.length < 20) {
    return null;
  }

  // Primary: Firebase Admin Auth verification
  try {
    const decoded = await getAdminAuth().verifyIdToken(idToken, false);
    const email = normalizeEmail(decoded.email || "");
    const emailVerified = Boolean(decoded.email_verified);
    const claimAdmin = decoded.admin === true;
    const isAdmin = claimAdmin || (email === ADMIN_EMAIL && emailVerified);

    return {
      uid: decoded.uid,
      email,
      emailVerified,
      isAdmin,
      authTime: Number(decoded.auth_time || Math.floor(Date.now() / 1000)),
    };
  } catch {
    // Fallback for preview environments without Admin Auth SA credentials: Identity Toolkit
  }

  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(
        firebaseConfigLocal.apiKey
      )}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      }
    );

    if (!res.ok) return null;
    const data = (await res.json()) as { users?: LookupUser[] };
    const user = data.users?.[0];
    if (!user?.localId) return null;

    const email = normalizeEmail(user.email || "");
    const emailVerified = Boolean(user.emailVerified);
    let customClaimAdmin = false;
    if (user.customAttributes) {
      try {
        const claims = JSON.parse(user.customAttributes) as { admin?: boolean };
        customClaimAdmin = claims.admin === true;
      } catch {
        customClaimAdmin = false;
      }
    }

    const isAdmin = customClaimAdmin || (email === ADMIN_EMAIL && emailVerified);
    return {
      uid: user.localId,
      email,
      emailVerified,
      isAdmin,
      authTime: decodeJwtAuthTime(idToken),
    };
  } catch {
    return null;
  }
}

export function requireRecentAuth(
  user: VerifiedServerUser,
  maxAgeSeconds = 900
): boolean {
  const nowSec = Math.floor(Date.now() / 1000);
  return nowSec - user.authTime <= maxAgeSeconds;
}
