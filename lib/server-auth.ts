import firebaseConfigLocal from "../firebase-applet-config.json" with { type: "json" };
import { ADMIN_EMAIL, normalizeEmail } from "../types/tracking.ts";

export interface VerifiedServerUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  isAdmin: boolean;
}

interface LookupUser {
  localId?: string;
  email?: string;
  emailVerified?: boolean;
  customAttributes?: string;
}

export async function verifyFirebaseIdTokenFromHeaders(
  headers: Record<string, string | string[] | undefined>
): Promise<VerifiedServerUser | null> {
  const rawAuth = headers.authorization;
  const authHeader = Array.isArray(rawAuth) ? rawAuth[0] || "" : rawAuth || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const idToken = match?.[1]?.trim();
  if (!idToken || idToken.length < 20) {
    return null;
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

    if (!res.ok) {
      return null;
    }

    const data = (await res.json()) as { users?: LookupUser[] };
    const user = data.users?.[0];
    if (!user?.localId) {
      return null;
    }

    const email = normalizeEmail(user.email || "");
    const emailVerified = Boolean(user.emailVerified);
    let customClaimAdmin = false;
    if (user.customAttributes) {
      try {
        const claims = JSON.parse(user.customAttributes) as {
          admin?: boolean;
        };
        customClaimAdmin = claims.admin === true;
      } catch {
        customClaimAdmin = false;
      }
    }

    const isAdmin =
      customClaimAdmin || (email === ADMIN_EMAIL && emailVerified);

    return {
      uid: user.localId,
      email,
      emailVerified,
      isAdmin,
    };
  } catch {
    return null;
  }
}
