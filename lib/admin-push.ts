import { getApp } from "firebase/app";
import {
  getMessaging,
  getToken,
  isSupported,
  onMessage,
  deleteToken,
} from "firebase/messaging";
import { auth } from "@/lib/firebase";
import { isAdminHostname } from "@/lib/host";

const VAPID_KEY = (import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined) || "";
const TOKEN_KEY = "sw_admin_push_token";

export type PushState =
  | "unsupported" // browser cannot do push (e.g. iOS Safari tab, not installed)
  | "not-configured" // VITE_FIREBASE_VAPID_KEY missing
  | "blocked" // user denied permission in browser settings
  | "off" // can enable
  | "on";

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIos(): boolean {
  return typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export async function registerAdminServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isAdminHostname() || !("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/firebase-messaging-sw.js");
  } catch (err) {
    console.error("service worker registration failed", err);
    return null;
  }
}

export async function getPushState(): Promise<PushState> {
  if (!isAdminHostname()) return "unsupported";
  if (!VAPID_KEY) return "not-configured";
  try {
    if (!(await isSupported()) || !("Notification" in window)) return "unsupported";
  } catch {
    return "unsupported";
  }
  if (Notification.permission === "denied") return "blocked";
  let saved = "";
  try {
    saved = localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    saved = "";
  }
  return Notification.permission === "granted" && saved ? "on" : "off";
}

async function authedFetch(method: string, token: string) {
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new Error("Please sign in again.");
  const res = await fetch("/api/admin/push-token", {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || "Could not save notification settings.");
  }
}

export async function enableAdminPush(): Promise<void> {
  if (!VAPID_KEY) throw new Error("Push key is not set yet (VITE_FIREBASE_VAPID_KEY).");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Notifications were not allowed. Allow them in your browser settings.");
  }
  const reg = await registerAdminServiceWorker();
  if (!reg) throw new Error("Could not start the notification service.");
  await navigator.serviceWorker.ready;
  const messaging = getMessaging(getApp());
  const token = await getToken(messaging, {
    vapidKey: VAPID_KEY,
    serviceWorkerRegistration: reg,
  });
  if (!token) throw new Error("Could not get a notification token.");
  await authedFetch("POST", token);
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* ignore */
  }
}

export async function disableAdminPush(): Promise<void> {
  let token = "";
  try {
    token = localStorage.getItem(TOKEN_KEY) || "";
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
  if (token) await authedFetch("DELETE", token).catch(() => null);
  try {
    await deleteToken(getMessaging(getApp()));
  } catch {
    /* ignore */
  }
}

/** Foreground messages (app is open): call the handler to show an in-app toast. */
export async function listenForegroundPush(
  handler: (n: { title: string; body: string; url: string }) => void
): Promise<() => void> {
  try {
    if (!VAPID_KEY || !(await isSupported())) return () => undefined;
    return onMessage(getMessaging(getApp()), (payload) => {
      const d = payload.data || {};
      handler({ title: d.title || "ShipWell Admin", body: d.body || "", url: d.url || "/" });
    });
  } catch {
    return () => undefined;
  }
}
