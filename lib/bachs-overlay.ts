export type BachsOverlayEventType =
  | "checkout.completed"
  | "checkout.failed"
  | "checkout.error"
  | "checkout.closed";

declare global {
  interface Window {
    Bachs?: {
      Initialize?: (opts: {
        onEvent?: (ev: { type?: string; data?: unknown } | string) => void;
      }) => void;
      Checkout?: {
        open?: (opts: { checkoutUrl: string }) => void;
        close?: () => void;
      };
    };
  }
}

let loadPromise: Promise<boolean> | null = null;

export function loadBachsOverlayScript(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (window.Bachs?.Checkout?.open) return Promise.resolve(true);
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<boolean>((resolve) => {
    const finish = (ok: boolean) => {
      if (!ok) loadPromise = null;
      resolve(ok);
    };

    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://checkout.bachs.io/bachs.js"]'
    );
    if (existing) {
      if (window.Bachs?.Checkout?.open) {
        finish(true);
        return;
      }
      existing.addEventListener(
        "load",
        () => finish(Boolean(window.Bachs?.Checkout?.open)),
        { once: true }
      );
      existing.addEventListener("error", () => finish(false), { once: true });
      window.setTimeout(
        () => finish(Boolean(window.Bachs?.Checkout?.open)),
        2500
      );
      return;
    }

    const script = document.createElement("script");
    script.src = "https://checkout.bachs.io/bachs.js";
    script.async = true;
    script.onload = () => finish(Boolean(window.Bachs?.Checkout?.open));
    script.onerror = () => finish(false);
    document.head.appendChild(script);
    window.setTimeout(
      () => finish(Boolean(window.Bachs?.Checkout?.open)),
      2800
    );
  });

  return loadPromise;
}

function hasVisibleBachsOverlay(): boolean {
  if (typeof document === "undefined") return false;
  const nodes = document.querySelectorAll(
    'iframe[src*="bachs.io"], [id*="bachs"], [class*="bachs"]'
  );
  for (const el of Array.from(nodes)) {
    const rect = el.getBoundingClientRect();
    if (rect.width > 50 && rect.height > 50) {
      return true;
    }
  }
  return false;
}

function triggerTabFallback(checkoutUrl: string): boolean {
  try {
    const a = document.createElement("a");
    a.href = checkoutUrl;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    return true;
  } catch {
    return false;
  }
}

export async function openBachsOverlay(
  checkoutUrl: string,
  onEvent?: (type: string) => void,
  onFallback?: (checkoutUrl: string, reason: string) => void
): Promise<"overlay" | "fallback"> {
  let sawOverlayEvent = false;
  const wrappedOnEvent = (type: string) => {
    sawOverlayEvent = true;
    onEvent?.(type);
  };

  const ready = await loadBachsOverlayScript();
  if (ready && window.Bachs?.Checkout?.open) {
    try {
      window.Bachs.Initialize?.({
        onEvent: (raw) => {
          const type =
            typeof raw === "string"
              ? raw
              : String((raw as { type?: string })?.type || "");
          if (type) wrappedOnEvent(type);
        },
      });
      window.Bachs.Checkout.open({ checkoutUrl });

      // Iframe preview environments can block overlay mounting.
      // Verify within 3 seconds that the overlay actually opened; otherwise fall back.
      window.setTimeout(() => {
        if (!sawOverlayEvent && !hasVisibleBachsOverlay()) {
          console.warn(
            "[ShipWell Booking] Bachs overlay did not render within 3s; activating fallback tab/button."
          );
          triggerTabFallback(checkoutUrl);
          onFallback?.(
            checkoutUrl,
            "Overlay blocked or slow in embedded preview — continue via hosted Bachs checkout."
          );
        }
      }, 3000);

      return "overlay";
    } catch (err) {
      console.warn("[ShipWell Booking] Bachs.Checkout.open threw:", err);
    }
  } else {
    console.warn(
      "[ShipWell Booking] bachs.js unavailable or timed out; opening fallback checkout."
    );
  }

  triggerTabFallback(checkoutUrl);
  onFallback?.(
    checkoutUrl,
    "Opening hosted Bachs checkout. Use the Continue to payment button if a new tab did not open."
  );
  return "fallback";
}
