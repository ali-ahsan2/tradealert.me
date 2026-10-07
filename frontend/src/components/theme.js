const THEME_KEY = "ta_theme";
const PALETTE_KEY = "ta_palette";
const LEGACY_ACCENTS_KEY = "ta_accents";
const STYLE_KEY = "ta_style";
const BG_KEY = "ta_bg";
const RADIUS_KEY = "ta_radius";
const SHAPE_KEY = "ta_shape";
const PARALLE_KEY = "ta_paralle";
const FONT_KEY = "ta_displayfont";
const SIZE_KEY = "ta_textsize";

export const THEMES = [
  { key: "dark", label: "Dark desk", swatches: ["#31c48d", "#c49c31", "#7a5cff", "#e05656"],
    base: { bg: "#0b0f15", ink: "#e6ebf2", accent: "#31c48d", surface: "#11161f", border: "#202a3a", neg: "#e05656", warn: "#d9a441", warnFill: "#2c2513", muted: "#9ca0a7" } },
  { key: "paper", label: "Paper", swatches: ["#1f6f45", "#8a5c1f", "#8a4a23", "#33579a"],
    base: { bg: "#f2efe7", ink: "#23201a", accent: "#1f6f45", surface: "#faf8f2", border: "#e0dacb", neg: "#b3382e", warn: "#96701c", warnFill: "#f3e9cd", muted: "#696660" } },
  { key: "mist", label: "Mist", swatches: ["#3357c4", "#1f8a8c", "#6d4fae", "#b3382e"],
    base: { bg: "#eef1f6", ink: "#1b2230", accent: "#3357c4", surface: "#f6f8fb", border: "#d4dbe5", neg: "#ba352b", warn: "#8a6616", warnFill: "#f2ead0", muted: "#636873" } },
  { key: "terminal", label: "Terminal", swatches: ["#39e075", "#33c9d6", "#cfe35a", "#ff7e5f"],
    base: { bg: "#0a0f0b", ink: "#d8f2e0", accent: "#39e075", surface: "#0f1611", border: "#1e2d22", neg: "#ff7e5f", warn: "#cfe35a", warnFill: "#202a12", muted: "#92a598" } },
  { key: "midnight", label: "Midnight", swatches: ["#41c6d8", "#7a8cff", "#e05656", "#c98adf"],
    base: { bg: "#0b1220", ink: "#dfe7f8", accent: "#41c6d8", surface: "#111a30", border: "#20304d", neg: "#e05656", warn: "#d9a441", warnFill: "#262716", muted: "#979faf" } },
];

export const STYLES = [
  { key: "corporate", label: "Corporate", corner: 4, bg: "solid", display: "sans", copy: "contemporary", sh: "flat",
    desc: "Dense enterprise. Calm, flat, on-brand." },
  { key: "brutalist", label: "Brutalist", corner: 0, bg: "solid", display: "sans", copy: "brutalist", sh: "hard",
    desc: "Hard edges, ink borders, heavy claims." },
  { key: "glass", label: "Glass", corner: 16, bg: "solid", display: "sans", copy: "contemporary", sh: "frost",
    desc: "Frosted panels, backdrop blur, airy glow." },
  { key: "swiss", label: "Swiss", corner: 2, bg: "grid", display: "sans", copy: "contemporary", sh: "hair",
    desc: "Hairline grids, minimal marks, asymmetry." },
];

export const BACKGROUNDS = [
  { key: "grid", label: "Grid" },
  { key: "solid", label: "Solid" },
  { key: "band", label: "Big band" },
  { key: "dots", label: "Dots" },
  { key: "diag", label: "Diagonals" },
  { key: "rings", label: "Rings" },
  { key: "noise", label: "Grain" },
  { key: "photo", label: "Photo" },
];

export const FONTS = [
  { key: "auto", label: "Auto" },
  { key: "sans", label: "Sans" },
  { key: "serif", label: "Serif" },
  { key: "mono", label: "Mono" },
];

export const RADII = [
  { key: "sharp", label: "Sharp", r: 3 },
  { key: "mellow", label: "Mellow", r: 8 },
  { key: "round", label: "Round", r: 16 },
  { key: "pill", label: "Pill", r: 24 },
];

function hex(c) {
  let s = String(c).replace("#", "");
  if (s.length === 3) s = s.split("").map((x) => x + x).join("");
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

function sh(c) {
  return "#" + c.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0")).join("");
}

function mix(a, b, t) {
  const A = hex(a), B = hex(b);
  return sh(A.map((v, i) => v + (B[i] - v) * t));
}

const BLACK = "#000000", WHITE = "#ffffff";

function lum(c) {
  const [r, g, b] = hex(c);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function derive(base, over) {
  const p = { ...base, ...over };
  const dark = lum(p.bg) < 0.42;
  return {
    "--bg": p.bg,
    "--bg-bleed": dark ? mix(p.bg, BLACK, 0.03) : mix(p.bg, WHITE, 0.02),
    "--surface": p.surface,
    "--surface-raised": dark ? mix(p.surface, WHITE, 0.06) : mix(p.surface, WHITE, 0.35),
    "--surface-sunken": dark ? mix(p.bg, BLACK, 0.045) : mix(p.bg, BLACK, 0.035),
    "--border": p.border,
    "--border-strong": dark ? mix(p.border, p.ink, 0.28) : mix(p.border, p.ink, 0.18),
    "--ink": p.ink,
    "--ink-muted": p.muted || mix(p.ink, p.bg, 0.34),
    "--ink-faint": mix(mix(p.ink, p.bg, 0.34), p.bg, 0.5),
    "--accent": p.accent,
    "--neg": p.neg,
    "--warn": p.warn,
    "--warn-fill": p.warnFill,
    "--bg2": mix(p.accent, p.bg, dark ? 0.5 : 0.36),
    "--bg2-dim": mix(p.accent, p.bg, dark ? 0.2 : 0.12),
    "--stage-ink": lum(mix(p.accent, p.bg, 0.42)) < 0.5 ? "#f2f5fa" : "#10141c",
  };
}

// Storage access throws, not returns null, in Safari private browsing. Every
// read and write goes through these so a blocked store degrades to defaults
// instead of taking the page down.
function lsGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function lsSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* preference just won't persist */
  }
}

function readJSON(key, fallback) {
  try {
    return JSON.parse(lsGet(key) || "") || fallback;
  } catch {
    return fallback;
  }
}

export function paletteMasters(theme) {
  const base = THEMES.find((t) => t.key === theme)?.base || THEMES[0].base;
  const stored = readJSON(PALETTE_KEY, {})[theme];
  if (stored) return stored;
  const legacy = readJSON(LEGACY_ACCENTS_KEY, {})[theme];
  return legacy ? { accent: legacy } : {};
}

export function styleOf() {
  return STYLES.find((s) => s.key === currentStyle()) || STYLES[0];
}

export function currentStyle() {
  return lsGet(STYLE_KEY) || "corporate";
}

export function currentBg() {
  const saved = lsGet(BG_KEY);
  return saved || styleOf().bg;
}

export function currentRadius() {
  const saved = lsGet(RADIUS_KEY);
  if (saved !== null) return clampR(Number(saved));
  const legacy = lsGet(SHAPE_KEY);
  if (legacy) return legacy === "pill" ? 20 : legacy === "squared" ? 3 : 8;
  return styleOf().corner;
}

export function currentParalle() {
  return lsGet(PARALLE_KEY) === "1";
}

export function currentFont() {
  return lsGet(FONT_KEY) || "auto";
}

export function currentSize() {
  const raw = lsGet(SIZE_KEY);
  if (raw === null) return 100;
  const v = Number(raw);
  return Number.isFinite(v) ? Math.max(90, Math.min(120, Math.round(v))) : 100;
}

function clampR(v) {
  return Math.max(0, Math.min(28, Math.round(v)));
}

export function themeState() {
  const theme = currentTheme();
  return {
    theme,
    palette: paletteMasters(theme),
    style: currentStyle(),
    bg: currentBg(),
    radius: currentRadius(),
    paralle: currentParalle(),
    font: currentFont(),
    size: currentSize(),
  };
}

export function currentTheme() {
  return lsGet(THEME_KEY) || "dark";
}

function shadowFor(mode, tok, dark) {
  const acc = tok["--accent"], ink = tok["--ink"], b = tok["--border-strong"], bd = tok["--border"];
  switch (mode) {
    case "hard":
      return [`5px 5px 0 0 ${b}`, `8px 8px 0 0 ${ink}`, "none"];
    case "rect":
      return [`3px 3px 0 0 ${ink}`, `6px 6px 0 0 ${ink}`, "none"];
    case "ring":
      return [`0 0 0 1px ${bd}`, `0 0 0 1px ${b}, 0 14px 26px -18px rgba(0,0,0,0.5)`, "none"];
    case "glow":
      return [`0 0 0 1px ${bd}`, `0 0 0 1px ${b}, 0 0 30px -6px ${acc}`, "none"];
    case "neon":
      return [`0 2px 18px -6px ${acc}`, `0 0 34px -4px ${acc}`, `inset 0 0 18px -12px ${acc}`];
    case "bevel":
      return [`inset -1px -1px 0 0 ${b}, inset 1px 1px 0 0 ${tok["--surface-raised"]}`, `inset -2px -2px 0 0 ${b}`, `inset 1px 1px 0 0 ${tok["--surface-raised"]}`];
    case "frost":
      return dark
        ? ["0 8px 28px -14px rgba(0,0,0,0.5)", "0 18px 44px -16px rgba(0,0,0,0.55)", "none"]
        : ["0 8px 24px -16px rgba(20,30,40,0.18)", "0 20px 40px -20px rgba(20,30,40,0.2)", "none"];
    case "hair":
      return [dark ? "0 1px 0 rgba(255,255,255,0.04)" : "0 1px 0 rgba(20,30,40,0.04)", "none", "none"];
    case "flat":
      return ["none", "none", "none"];
    case "deep":
      return dark
        ? ["0 1px 1px rgba(0,0,0,0.25), 0 18px 40px -24px rgba(0,0,0,0.55)", "0 2px 2px rgba(0,0,0,0.3), 0 34px 70px -28px rgba(0,0,0,0.6)", dark ? "inset 0 1px 0 rgba(255,255,255,0.05)" : "inset 0 1px 0 rgba(255,255,255,0.85)"]
        : ["0 1px 1px rgba(20,30,40,0.04), 0 20px 44px -28px rgba(20,30,40,0.22)", "0 2px 2px rgba(20,30,40,0.05), 0 36px 72px -32px rgba(20,30,40,0.28)", dark ? "inset 0 1px 0 rgba(255,255,255,0.05)" : "inset 0 1px 0 rgba(255,255,255,0.85)"];
    default:
      return dark
        ? ["0 1px 1px rgba(0,0,0,0.35), 0 10px 28px -14px rgba(0,0,0,0.6)", "0 2px 2px rgba(0,0,0,0.42), 0 26px 60px -18px rgba(0,0,0,0.72)", "inset 0 1px 0 rgba(255,255,255,0.055)"]
        : ["0 1px 1px rgba(20,30,40,0.05), 0 10px 24px -12px rgba(20,30,40,0.18)", "0 2px 2px rgba(20,30,40,0.06), 0 28px 56px -20px rgba(20,30,40,0.3)", "inset 0 1px 0 rgba(255,255,255,0.75)"];
  }
}

function paint(theme, style, bg, radius, paralle) {
  const base = THEMES.find((t) => t.key === theme)?.base || THEMES[0].base;
  const over = paletteMasters(theme);
  const tok = derive(base, over);
  const dark = lum(base.bg) < 0.42;
  const st = STYLES.find((s) => s.key === style) || STYLES[0];
  const [stack, lift, tileHi] = shadowFor(st.sh, tok, dark);

  const r = clampR(radius);
  const el = document.documentElement;
  el.dataset.theme = theme;
  el.dataset.style = style;
  el.dataset.bg = bg;
  el.dataset.radius = String(r);
  el.dataset.cta = paralle ? "paralle" : "square";
  el.dataset.font = currentFont();
  el.dataset.size = String(currentSize());
  el.style.setProperty("--fs-scale", (currentSize() / 100).toFixed(2));

  const vars = {
    "--shadow": stack,
    "--shadow-lift": lift,
    "--stack": stack,
    "--stack-lift": lift,
    "--tile-hi": tileHi,
  };
  for (const k in vars) el.style.setProperty(k, vars[k]);
  for (const k in tok) el.style.setProperty(k, tok[k]);
  el.style.setProperty("--r-sm", `${Math.max(1, Math.round(r * 0.45))}px`);
  el.style.setProperty("--r-md", `${Math.round(r * 0.72)}px`);
  el.style.setProperty("--r", `${r}px`);
  el.style.setProperty("--r-pill", "999px");

  const light = dark === false;
  const m = document.querySelector('meta[name="color-scheme"]');
  if (m) m.setAttribute("content", light ? "light" : "dark");
  const tc = document.querySelector('meta[name="theme-color"]');
  if (tc) tc.setAttribute("content", tok["--bg"]);
  document.dispatchEvent(new CustomEvent("ta-theme", { detail: { theme, style, bg, radius: r, paralle } }));
}

function apply() {
  paint(currentTheme(), currentStyle(), currentBg(), currentRadius(), currentParalle());
}

export function setTheme(theme) {
  lsSet(THEME_KEY, theme);
  apply();
}

export function setStyle(style) {
  lsSet(STYLE_KEY, style);
  apply();
}

export function setBg(bg) {
  lsSet(BG_KEY, bg);
  apply();
}

export function setRadius(r) {
  lsSet(RADIUS_KEY, String(clampR(r)));
  apply();
}

export function setParalle(on) {
  lsSet(PARALLE_KEY, on ? "1" : "0");
  apply();
}

export function setFont(k) {
  lsSet(FONT_KEY, k);
  apply();
}

export function setSize(v) {
  lsSet(SIZE_KEY, String(Math.max(90, Math.min(120, Math.round(v)))));
  apply();
}

export function setPalette(theme, field, value) {
  const all = readJSON(PALETTE_KEY, {});
  const cur = { ...paletteMasters(theme) };
  cur[field] = value;
  all[theme] = cur;
  lsSet(PALETTE_KEY, JSON.stringify(all));
  apply();
}

export function paletteOverrides(theme) {
  return readJSON(PALETTE_KEY, {})[theme] || {};
}

export function resetPaletteField(theme, field) {
  const all = readJSON(PALETTE_KEY, {});
  const cur = all[theme];
  if (cur && field in cur) {
    delete cur[field];
    if (Object.keys(cur).length === 0) delete all[theme];
    else all[theme] = cur;
    lsSet(PALETTE_KEY, JSON.stringify(all));
  }
  apply();
}

export function resetPalette(theme) {
  const all = readJSON(PALETTE_KEY, {});
  delete all[theme];
  lsSet(PALETTE_KEY, JSON.stringify(all));
  apply();
}

export function isCustom(theme) {
  return Boolean(readJSON(PALETTE_KEY, {})[theme]);
}