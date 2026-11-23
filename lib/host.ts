export const PUBLIC_ORIGIN = "https://shipwell.cc";
export const ADMIN_ORIGIN = "https://admin.shipwell.cc";

export function isPreviewHostname(hostname?: string): boolean {
  const host = (
    hostname ||
    (typeof window !== "undefined" ? window.location.hostname : "")
  ).toLowerCase();
  if (!host) return true;
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.endsWith(".run.app") ||
    host.endsWith(".web.app") ||
    host.endsWith(".firebaseapp.com") ||
    host.endsWith(".vercel.app")
  );
}

export function isAdminHostname(hostname?: string): boolean {
  const host = (
    hostname ||
    (typeof window !== "undefined" ? window.location.hostname : "")
  ).toLowerCase();
  if (!host) return false;
  return host === "admin.shipwell.cc" || host.startsWith("admin.");
}

export function isProductionPublicHost(hostname?: string): boolean {
  const host = (
    hostname ||
    (typeof window !== "undefined" ? window.location.hostname : "")
  ).toLowerCase();
  return host === "shipwell.cc" || host === "www.shipwell.cc";
}

export function getPublicOrigin(): string {
  if (typeof window === "undefined") return PUBLIC_ORIGIN;
  if (isPreviewHostname(window.location.hostname)) {
    return window.location.origin;
  }
  return PUBLIC_ORIGIN;
}

export function getAdminOrigin(): string {
  if (typeof window === "undefined") return ADMIN_ORIGIN;
  if (isPreviewHostname(window.location.hostname)) {
    return window.location.origin;
  }
  return ADMIN_ORIGIN;
}

/**
 * Generates an internal router path for admin routes:
 * - On admin.shipwell.cc: "/shipments", "/login", "/payments", "/"
 * - On preview hosts (localhost / .run.app / .vercel.app): "/admin/shipments", "/admin/login", "/admin"
 */
export function adminPath(subpath = ""): string {
  const clean = subpath.replace(/^\/+/, "");
  if (typeof window !== "undefined" && isAdminHostname(window.location.hostname)) {
    return clean ? `/${clean}` : "/";
  }
  return clean ? `/admin/${clean}` : "/admin";
}

export function buildPublicTrackingUrl(code: string): string {
  return `${getPublicOrigin()}/track/${encodeURIComponent(code)}`;
}
