import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { getAdminDb, getFirebaseAdminApp } from "./firebase-admin.ts";

const COLLECTION = "adminPushTokens";

function tokenId(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 40);
}

export async function saveAdminPushToken(params: {
  uid: string;
  email: string;
  token: string;
  userAgent?: string;
  host?: "admin" | "webmail";
  role?: "owner" | "support";
}): Promise<void> {
  const token = String(params.token || "").trim();
  if (token.length < 20 || token.length > 4096) throw new Error("Invalid push token.");
  await getAdminDb()
    .collection(COLLECTION)
    .doc(tokenId(token))
    .set(
      {
        token,
        uid: params.uid,
        email: params.email,
        host: params.host || "admin",
        role: params.role || "owner",
        userAgent: String(params.userAgent || "").slice(0, 200),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
}

export async function removeAdminPushToken(token: string): Promise<void> {
  const t = String(token || "").trim();
  if (!t) return;
  await getAdminDb().collection(COLLECTION).doc(tokenId(t)).delete();
}

/**
 * Push a notification to every admin device that turned alerts on.
 * Never throws: a failed push must not break bookings, payments or support.
 */
export async function notifyAdmins(n: {
  title: string;
  body: string;
  /** Link opened on admin.shipwell.cc */
  url?: string;
  /** Link opened on webmail.shipwell.cc (defaults to the inbox) */
  webmailUrl?: string;
  tag?: string;
  /** "owner" = only the owner/admin devices. "team" = owner plus support staff. */
  audience?: "owner" | "team";
}): Promise<void> {
  try {
    const db = getAdminDb();
    const snap = await db.collection(COLLECTION).get();
    if (snap.empty) return;
    const audience = n.audience || "owner";
    const docs = snap.docs
      .map((d) => {
        const x = d.data();
        return {
          id: d.id,
          token: String(x.token || ""),
          host: x.host === "webmail" ? "webmail" : "admin",
          role: x.role === "support" ? "support" : "owner",
        };
      })
      .filter((d) => d.token && (audience === "team" || d.role === "owner"));
    const messaging = getMessaging(getFirebaseAdminApp());
    for (const host of ["admin", "webmail"] as const) {
      const group = docs.filter((d) => d.host === host);
      for (let i = 0; i < group.length; i += 500) {
        const chunk = group.slice(i, i + 500);
        const res = await messaging.sendEachForMulticast({
          tokens: chunk.map((d) => d.token),
          data: {
            title: n.title.slice(0, 120),
            body: n.body.slice(0, 240),
            url: host === "webmail" ? n.webmailUrl || "/" : n.url || "/",
            ...(n.tag ? { tag: n.tag } : {}),
          },
          webpush: { headers: { Urgency: "high", TTL: "86400" } },
        });
        await Promise.all(
          res.responses.map((r, idx) => {
            const code = r.error?.code || "";
            if (
              !r.success &&
              (code === "messaging/registration-token-not-registered" ||
                code === "messaging/invalid-registration-token" ||
                code === "messaging/invalid-argument")
            ) {
              return db.collection(COLLECTION).doc(chunk[idx].id).delete().catch(() => null);
            }
            return null;
          })
        );
      }
    }
  } catch (err) {
    console.error("notifyAdmins failed", err instanceof Error ? err.message : err);
  }
}
