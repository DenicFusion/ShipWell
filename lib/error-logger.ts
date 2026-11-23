import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

export class StepError extends Error {
  step: string;
  code: string;

  constructor(step: string, code: string, message: string) {
    super(message);
    this.name = "StepError";
    this.step = step;
    this.code = code;
  }
}

export function extractErrorDetails(
  err: unknown,
  defaultStep = "unknown"
): { step: string; code: string; message: string } {
  if (err instanceof StepError) {
    return {
      step: err.step || defaultStep,
      code: err.code || "ERROR",
      message: err.message || "Operation failed.",
    };
  }
  if (err && typeof err === "object") {
    const obj = err as {
      step?: unknown;
      code?: unknown;
      message?: unknown;
      name?: unknown;
    };
    const step =
      typeof obj.step === "string" && obj.step ? obj.step : defaultStep;
    const rawCode =
      typeof obj.code === "string" && obj.code
        ? obj.code
        : typeof obj.name === "string" && obj.name !== "Error"
          ? obj.name
          : "UNKNOWN_ERROR";
    const message =
      typeof obj.message === "string" && obj.message
        ? obj.message
        : "Something went wrong.";
    return { step, code: rawCode, message };
  }
  return {
    step: defaultStep,
    code: "UNKNOWN_ERROR",
    message: typeof err === "string" && err ? err : "Something went wrong.",
  };
}

export function formatUserFacingError(
  err: unknown,
  defaultStep = "booking"
): {
  title: string;
  details: string;
  step: string;
  code: string;
} {
  const { step, code, message } = extractErrorDetails(err, defaultStep);
  return {
    title: message,
    details: `Details: step=${step}, code=${code}`,
    step,
    code,
  };
}

export async function logClientError(params: {
  uid?: string | null;
  step: string;
  code: string;
  message: string;
  route?: string;
}): Promise<void> {
  const ts = Date.now();
  const payload = {
    uid: params.uid || null,
    step: String(params.step || "unknown").slice(0, 80),
    code: String(params.code || "ERROR").slice(0, 80),
    message: String(params.message || "Error").slice(0, 600),
    route:
      params.route ||
      (typeof window !== "undefined" ? window.location.pathname : ""),
    ts,
  };

  console.error("[ShipWell Error]", payload);

  try {
    const id = `err_${ts.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    await setDoc(doc(db, "errorLogs", id), {
      ...payload,
      createdAt: serverTimestamp(),
    });
  } catch (writeErr) {
    console.warn("Could not write diagnostic errorLog:", writeErr);
  }
}
