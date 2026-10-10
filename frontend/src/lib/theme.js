// Theme preference: "system" (default, follows the OS), "light" or "dark".
// Stored per browser; applied as data-theme on the root so tokens.css can
// override the OS preference in either direction.
const KEY = "ta_theme";

export function getTheme() {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(t = getTheme()) {
  const root = document.documentElement;
  if (t === "light" || t === "dark") root.setAttribute("data-theme", t);
  else root.removeAttribute("data-theme");
  window.dispatchEvent(new CustomEvent("ta:theme", { detail: t }));
}

export function setTheme(t) {
  try {
    if (t === "light" || t === "dark") localStorage.setItem(KEY, t);
    else localStorage.removeItem(KEY);
  } catch {
    /* preference just won't persist */
  }
  applyTheme(t);
}

export const THEMES = [
  ["system", "Auto"],
  ["light", "Light"],
  ["dark", "Dark"],
];
