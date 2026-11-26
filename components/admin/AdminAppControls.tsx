import React, { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, Download } from "lucide-react";
import toast from "react-hot-toast";
import {
  disableAdminPush,
  enableAdminPush,
  getPushState,
  isIos,
  isStandalone,
  listenForegroundPush,
  registerAdminServiceWorker,
  type PushState,
} from "@/lib/admin-push";
import { isAdminHostname } from "@/lib/host";

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};

/** Install-app and notification controls. Renders only on admin.shipwell.cc. */
export function AdminAppControls() {
  const [state, setState] = useState<PushState>("unsupported");
  const [busy, setBusy] = useState(false);
  const [installEvent, setInstallEvent] = useState<InstallEvent | null>(null);
  const [installed, setInstalled] = useState(isStandalone());

  const refresh = useCallback(() => {
    getPushState().then(setState);
  }, []);

  useEffect(() => {
    if (!isAdminHostname()) return;
    registerAdminServiceWorker();
    refresh();
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as InstallEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallEvent(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    let off: (() => void) | undefined;
    listenForegroundPush((n) => {
      toast(`${n.title}${n.body ? `: ${n.body}` : ""}`, { icon: "🔔", duration: 6000 });
    }).then((u) => (off = u));
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      off?.();
    };
  }, [refresh]);

  if (!isAdminHostname()) return null;

  const btn: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "8px 12px",
    borderRadius: 12,
    border: "1px solid var(--border)",
    background: "var(--card2)",
    color: "var(--text)",
    fontSize: 12.5,
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };

  async function toggle() {
    setBusy(true);
    try {
      if (state === "on") {
        await disableAdminPush();
        toast.success("Notifications turned off on this device");
      } else {
        await enableAdminPush();
        toast.success("Notifications are on for this device");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not change notifications.");
    } finally {
      setBusy(false);
      refresh();
    }
  }

  const hint: React.CSSProperties = { color: "var(--muted)", fontSize: 11.5, maxWidth: 220, lineHeight: 1.35 };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      {!installed && installEvent && (
        <button
          type="button"
          style={btn}
          onClick={async () => {
            await installEvent.prompt();
            await installEvent.userChoice.catch(() => null);
            setInstallEvent(null);
          }}
        >
          <Download className="w-4 h-4" /> Install
        </button>
      )}
      {(state === "off" || state === "on") && (
        <button
          type="button"
          style={btn}
          disabled={busy}
          onClick={toggle}
          aria-label={state === "on" ? "Turn off live alerts" : "Turn on live alerts"}
        >
          {state === "on" ? <BellOff className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
          {busy ? "Please wait…" : state === "on" ? "Alerts on" : "Turn on alerts"}
        </button>
      )}
      {state === "blocked" && (
        <span style={hint}>Alerts blocked. Allow notifications for this site in browser settings.</span>
      )}
      {state === "not-configured" && (
        <span style={hint}>Live alerts need VITE_FIREBASE_VAPID_KEY in Vercel.</span>
      )}
      {state === "unsupported" && !installed && isIos() && (
        <span style={hint}>iPhone: tap Share, then Add to Home Screen, to get alerts.</span>
      )}
    </div>
  );
}
