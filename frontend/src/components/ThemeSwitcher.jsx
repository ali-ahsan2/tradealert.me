import React, { useEffect, useRef, useState } from "react";
import {
  THEMES,
  STYLES,
  BACKGROUNDS,
  RADII,
  FONTS,
  setTheme,
  setStyle,
  setBg,
  setRadius,
  setParalle,
  setPalette,
  resetPalette,
  resetPaletteField,
  paletteOverrides,
  themeState,
  isCustom,
  setFont,
  setSize,
} from "./theme.js";
import "./ThemeSwitcher.css";

const FIELDS = [
  { key: "bg", label: "Background" },
  { key: "surface", label: "Surface" },
  { key: "ink", label: "Foreground" },
  { key: "muted", label: "Muted" },
  { key: "accent", label: "Accent" },
  { key: "border", label: "Border" },
  { key: "neg", label: "Danger" },
];

export default function ThemeSwitcher() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("style");
  const [state, setState] = useState(themeState());
  const box = useRef(null);

  useEffect(() => {
    const onChange = () => setState(themeState());
    document.addEventListener("ta-theme", onChange);
    return () => document.removeEventListener("ta-theme", onChange);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (box.current && !box.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const { theme, palette, style, bg, radius, paralle, font, size } = state;

  return (
    <div className="ts" ref={box}>
      <button
        className="ts-trigger"
        aria-label={`Theme ${theme}, style ${style}`}
        title="Design"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="ts-dot" style={{ background: palette.accent || "#31c48d" }} />
        <span className="ts-glyph-mini" />
      </button>
      {open && (
        <div className="ts-panel">
          <div className="ts-tabs" role="tablist">
            {[
              ["style", "Style"],
              ["themes", "Themes"],
              ["palette", "Colors"],
            ].map(([k, label]) => (
              <button
                key={k}
                role="tab"
                aria-selected={tab === k}
                className={tab === k ? "active" : ""}
                onClick={() => setTab(k)}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "style" && (
            <div className="ts-style">
              <div className="ts-grid">
                {STYLES.map((s) => {
                  const on = s.key === style;
                  return (
                    <button
                      key={s.key}
                      className={`ts-stylecard ${on ? "active" : ""}`}
                      onClick={() => setStyle(s.key)}
                    >
                      <i
                        className={`ts-emblem ${s.display}`}
                        aria-hidden="true"
                      >
                        Aa
                      </i>
                      <b>{s.label}</b>
                      <span className="ts-desc">{s.desc}</span>
                    </button>
                  );
                })}
              </div>

              <div className="ts-block">
                <p className="ts-label">Background</p>
                <div className="ts-chips">
                  {BACKGROUNDS.map((b) => (
                    <button
                      key={b.key}
                      className={`ts-chip-btn ${b.key === bg ? "active" : ""}`}
                      onClick={() => setBg(b.key)}
                    >
                      {b.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="ts-block">
                <p className="ts-label">
                  Corner radius <span className="ts-px">{radius}px</span>
                </p>
                <div className="ts-chips">
                  {RADII.map((r) => (
                    <button
                      key={r.key}
                      className={`ts-chip-btn ${Math.abs(r.r - radius) <= 1 ? "active" : ""}`}
                      onClick={() => setRadius(r.r)}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
                <input
                  type="range"
                  className="ts-range"
                  min="0"
                  max="28"
                  step="1"
                  value={radius}
                  onChange={(e) => setRadius(Number(e.target.value))}
                  aria-label="Corner radius"
                />
              </div>

              <div className="ts-block">
                <p className="ts-label">Typographies</p>
                <div className="ts-chips">
                  {FONTS.map((f) => (
                    <button
                      key={f.key}
                      className={`ts-chip-btn ${f.key === font ? "active" : ""}`}
                      onClick={() => setFont(f.key)}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                <p className="ts-label">
                  Text size <span className="ts-px">{size}%</span>
                </p>
                <div className="ts-chips">
                  {[["small", 95], ["medium", 105], ["large", 115]].map(([k, v]) => (
                    <button
                      key={k}
                      className={`ts-chip-btn ${Math.abs(v - size) <= 2 ? "active" : ""}`}
                      onClick={() => setSize(v)}
                    >
                      {k}
                    </button>
                  ))}
                </div>
                <input
                  type="range"
                  className="ts-range"
                  min="90"
                  max="120"
                  step="1"
                  value={size}
                  onChange={(e) => setSize(Number(e.target.value))}
                  aria-label="Text size"
                />
              </div>

              <div className="ts-block">
                <p className="ts-label">Primary buttons</p>
                <label className={`ts-toggle ${paralle ? "on" : ""}`}>
                  <input
                    type="checkbox"
                    checked={paralle}
                    onChange={(e) => setParalle(e.target.checked)}
                  />
                  <span className="ts-toggle-track" aria-hidden="true">
                    <i />
                  </span>
                  Parallelogram
                </label>
              </div>
            </div>
          )}

          {tab === "themes" && (
            <div className="ts-grid">
              {THEMES.map((t) => {
                const on = t.key === theme;
                return (
                  <button
                    key={t.key}
                    className={`ts-theme ${on ? "active" : ""}`}
                    onClick={() => setTheme(t.key)}
                  >
                    <i
                      className="ts-chip"
                      style={{
                        background: t.base.bg,
                        color: t.base.ink,
                        boxShadow: `inset 0 0 0 2px ${t.base.accent}`,
                      }}
                    >
                      Aa
                    </i>
                    <span>{t.label}{on ? " ·" : ""}</span>
                  </button>
                );
              })}
            </div>
          )}

          {tab === "palette" && (
            <div className="ts-palette">
              <p className="ts-hint">
                Colors apply to this theme only. Raised levels, borders, and muted text derive
                from these seven.
              </p>
              {FIELDS.map((f) => {
                const custom = Boolean(paletteOverrides(theme)[f.key]);
                return (
                  <div className="ts-fieldrow" key={f.key}>
                    <label className="ts-field">
                      <span>{f.label}</span>
                      <input
                        type="color"
                        value={col16(palette[f.key], theme, f.key)}
                        onChange={(e) => setPalette(theme, f.key, e.target.value)}
                      />
                    </label>
                    <button
                      className={`ts-field-reset ${custom ? "can" : ""}`}
                      onClick={() => resetPaletteField(theme, f.key)}
                      aria-label={`Reset ${f.label} to theme default`}
                      title={`Reset ${f.label}`}
                      disabled={!custom}
                    >
                      ↺
                    </button>
                  </div>
                );
              })}
              {isCustom(theme) && (
                <button className="ts-reset" onClick={() => resetPalette(theme)}>
                  Reset all theme colors
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function col16(v, theme, field) {
  if (v) return v;
  const base = THEMES.find((t) => t.key === theme)?.base;
  return base ? base[field] : "#000000";
}