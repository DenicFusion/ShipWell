import type { ResolvedTheme, ThemePreference } from "@/types/tracking";

const THEME_STORAGE_KEY = "sw_theme";

export function normalizeThemePreference(raw: unknown): ThemePreference {
  if (raw === "dark" || raw === "light" || raw === "system") {
    return raw;
  }
  return "system";
}

export function getStoredThemePreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  try {
    return normalizeThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

export function saveThemePreferenceLocal(pref: ThemePreference): void {
  if (typeof window === "undefined") return;
  try {
    if (pref === "system") {
      window.localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      window.localStorage.setItem(THEME_STORAGE_KEY, pref);
    }
  } catch {
    // ignore storage errors
  }
}

export function resolveTheme(pref: ThemePreference): ResolvedTheme {
  if (pref === "light" || pref === "dark") return pref;
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  }
  return "dark";
}

export function applyThemeToDocument(
  pref: ThemePreference,
  animate = false
): ResolvedTheme {
  const resolved = resolveTheme(pref);
  if (typeof document === "undefined") return resolved;

  const root = document.documentElement;
  if (animate) {
    root.classList.add("tt");
    window.setTimeout(() => {
      root.classList.remove("tt");
    }, 340);
  }

  root.setAttribute("data-theme", resolved);
  root.style.colorScheme = resolved;

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute("content", resolved === "light" ? "#F3F6FA" : "#07090F");
  }
  return resolved;
}

export function subscribeSystemTheme(
  onChange: (resolved: ResolvedTheme) => void
): () => void {
  if (typeof window === "undefined" || !window.matchMedia) {
    return () => undefined;
  }
  const mq = window.matchMedia("(prefers-color-scheme: light)");
  const handler = () => onChange(mq.matches ? "light" : "dark");
  if (mq.addEventListener) {
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }
  mq.addListener(handler);
  return () => mq.removeListener(handler);
}
