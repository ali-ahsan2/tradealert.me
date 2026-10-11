import { useEffect, useState } from "react";

// Simple / Full. Simple is the default for everyone: plain labels, the
// columns a newcomer needs, explanations inline. Full shows every column and
// control. Nothing is removed from the product; Full is one tap away and the
// choice persists. The attribute on <html> lets CSS hide `.full-only`
// elements without each component checking.

export const MODES = [
  ["simple", "Simple"],
  ["full", "Full"],
];
const KEY = "ta_mode";

export function getMode() {
  try {
    const v = localStorage.getItem(KEY);
    return v === "full" ? "full" : "simple";
  } catch {
    return "simple";
  }
}

export function applyMode(mode = getMode()) {
  document.documentElement.setAttribute("data-mode", mode);
}

export function setMode(mode) {
  const m = mode === "full" ? "full" : "simple";
  try {
    localStorage.setItem(KEY, m);
  } catch {
    /* preference just won't persist */
  }
  applyMode(m);
  window.dispatchEvent(new CustomEvent("ta:mode", { detail: m }));
}

export function useMode() {
  const [mode, set] = useState(getMode);
  useEffect(() => {
    const on = (e) => set(e.detail || getMode());
    window.addEventListener("ta:mode", on);
    return () => window.removeEventListener("ta:mode", on);
  }, []);
  return { mode, simple: mode === "simple", full: mode === "full", setMode };
}
