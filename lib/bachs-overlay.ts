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
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://checkout.bachs.io/bachs.js"]'
    );
    if (existing) {
      if (window.Bachs?.Checkout?.open) {
        resolve(true);
        return;
      }
      existing.addEventListener("load", () => resolve(Boolean(window.Bachs?.Checkout?.open)), {
        once: true,
      });
      existing.addEventListener("error", () => resolve(false), { once: true });
      setTimeout(() => resolve(Boolean(window.Bachs?.Checkout?.open)), 4000);
      return;
    }

    const script = document.createElement("script");
    script.src = "https://checkout.bachs.io/bachs.js";
    script.async = true;
    script.onload = () => resolve(Boolean(window.Bachs?.Checkout?.open));
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
    setTimeout(() => resolve(Boolean(window.Bachs?.Checkout?.open)), 5000);
  });

  return loadPromise;
}

export async function openBachsOverlay(
  checkoutUrl: string,
  onEvent?: (type: string) => void
): Promise<"overlay" | "redirect"> {
  const ready = await loadBachsOverlayScript();
  if (ready && window.Bachs?.Checkout?.open) {
    try {
      window.Bachs.Initialize?.({
        onEvent: (raw) => {
          const type =
            typeof raw === "string"
              ? raw
              : String((raw as { type?: string })?.type || "");
          if (type && onEvent) {
            onEvent(type);
          }
        },
      });
      window.Bachs.Checkout.open({ checkoutUrl });
      return "overlay";
    } catch {
      // Fallback to hosted redirect if overlay fails
    }
  }
  window.location.assign(checkoutUrl);
  return "redirect";
}
