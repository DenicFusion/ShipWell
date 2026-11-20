import { NextRequest } from "next/server";
import firebaseConfigLocal from "../firebase-applet-config.json";
import { ADMIN_EMAIL, normalizeEmail } from "@/types/tracking";

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

export async function verifyFirebaseIdTokenFromRequest(
  req: NextRequest
): Promise<VerifiedServerUser | null> {
  const authHeader = req.headers.get("authorization") || "";
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
        cache: "no-store",
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
