/// <reference types="vite/client" />
import { StepError } from "@/lib/error-logger";

const FUNCTIONS_BASE =
  (import.meta.env.VITE_FUNCTIONS_BASE_URL as string | undefined)?.replace(
    /\/+$/,
    ""
  ) || "";

export function resolveApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return FUNCTIONS_BASE ? `${FUNCTIONS_BASE}${normalized}` : normalized;
}

export interface ApiFetchOptions extends RequestInit {
  step?: string;
  timeoutMs?: number;
}

export async function apiFetch<T = Record<string, unknown>>(
  path: string,
  options: ApiFetchOptions = {}
): Promise<T> {
  const {
    step = "api_request",
    timeoutMs = 30_000,
    headers,
    ...rest
  } = options;
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  const url = resolveApiUrl(path);
  let res: Response;
  let rawText = "";
  try {
    res = await fetch(url, {
      ...rest,
      headers,
      signal: controller.signal,
    });
    // Keep the timer running while the body is read, so a half-open response can never hang forever
    rawText = await res.text();
  } catch (err) {
    if (
      (err instanceof DOMException && err.name === "AbortError") ||
      controller.signal.aborted
    ) {
      throw new StepError(
        step,
        "TIMEOUT",
        "Request timed out. Please check your connection and try again."
      );
    }
    throw new StepError(
      step,
      "NETWORK_ERROR",
      err instanceof Error ? err.message : "Network connection failed."
    );
  } finally {
    globalThis.clearTimeout(timer);
  }

  const contentType = res.headers.get("content-type") || "";

  if (
    contentType.includes("text/html") ||
    rawText.trimStart().startsWith("<!DOCTYPE") ||
    rawText.trimStart().startsWith("<html")
  ) {
    throw new StepError(
      step,
      `HTTP_${res.status}_HTML`,
      `API endpoint (${path}) returned HTML instead of JSON (HTTP ${res.status}). Check server routing.`
    );
  }

  let parsed: Record<string, unknown> = {};
  if (rawText) {
    try {
      parsed = JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      if (!res.ok) {
        throw new StepError(
          step,
          `HTTP_${res.status}`,
          rawText.slice(0, 200) || `Request failed with HTTP ${res.status}.`
        );
      }
      throw new StepError(
        step,
        "INVALID_JSON",
        "Server returned a non-JSON response."
      );
    }
  }

  if (!res.ok) {
    const code =
      typeof parsed.code === "string" && parsed.code
        ? parsed.code
        : `HTTP_${res.status}`;
    const errMsg =
      typeof parsed.error === "string" && parsed.error
        ? parsed.error
        : `Request failed (HTTP ${res.status}).`;
    throw new StepError(step, code, errMsg);
  }

  return parsed as T;
}
