import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

const rootEl = document.getElementById("root");

/** Show the real error on screen instead of a blank page (so it can be screenshotted and fixed). */
function showFatal(err: unknown) {
  const msg =
    err instanceof Error ? `${err.name}: ${err.message}\n\n${err.stack || ""}` : String(err);
  console.error("[ShipWell] fatal", err);
  if (!rootEl) return;
  rootEl.innerHTML = "";
  const box = document.createElement("div");
  box.style.cssText =
    "min-height:100vh;background:#0b0b0d;color:#f4efe6;padding:24px;font:14px/1.5 system-ui,sans-serif";
  const h = document.createElement("h1");
  h.textContent = "ShipWell could not start";
  h.style.cssText = "font-size:20px;margin:0 0 12px;color:#d4af37";
  const pre = document.createElement("pre");
  pre.textContent = msg.slice(0, 1800);
  pre.style.cssText = "white-space:pre-wrap;word-break:break-word;font-size:12px;opacity:.85";
  const btn = document.createElement("button");
  btn.textContent = "Reload";
  btn.onclick = () => location.reload();
  btn.style.cssText =
    "margin-top:16px;padding:10px 18px;border-radius:10px;border:1px solid #d4af37;background:transparent;color:#d4af37";
  box.append(h, pre, btn);
  rootEl.appendChild(box);
}

window.addEventListener("error", (e) => {
  if (rootEl && !rootEl.hasChildNodes()) showFatal(e.error || e.message);
});
window.addEventListener("unhandledrejection", (e) => {
  if (rootEl && !rootEl.hasChildNodes()) showFatal(e.reason);
});

class Boundary extends React.Component<{ children: React.ReactNode }, { err: unknown }> {
  state = { err: null as unknown };
  static getDerivedStateFromError(err: unknown) {
    return { err };
  }
  componentDidCatch(err: unknown) {
    showFatal(err);
  }
  render() {
    return this.state.err ? null : this.props.children;
  }
}

import("./App")
  .then(({ default: App }) => {
    if (!rootEl) return;
    createRoot(rootEl).render(
      <React.StrictMode>
        <Boundary>
          <App />
        </Boundary>
      </React.StrictMode>
    );
  })
  .catch(showFatal);
