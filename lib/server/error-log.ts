import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb, isAdminIamError } from "./firebase-admin.ts";

export async function logServerError(params: {
  uid?: string | null;
  step: string;
  code: string;
  message: string;
  route?: string;
}): Promise<void> {
  const ts = Date.now();
  const payload = {
    uid: params.uid || null,
    step: String(params.step || "server").slice(0, 80),
    code: String(params.code || "SERVER_ERROR").slice(0, 80),
    message: String(params.message || "Server error").slice(0, 600),
    route: String(params.route || "").slice(0, 200),
    ts,
    createdAt: FieldValue.serverTimestamp(),
  };

  console.error("[ShipWell Server Error]", {
    uid: payload.uid,
    step: payload.step,
    code: payload.code,
    message: payload.message,
    route: payload.route,
    ts,
  });

  try {
    const db = getAdminDb();
    const id = `srv_${ts.toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    await db.collection("errorLogs").doc(id).set(payload);
  } catch (err) {
    if (!isAdminIamError(err)) {
      console.warn("Unable to write errorLogs entry:", err);
    }
  }
}
