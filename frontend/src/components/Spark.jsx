import React from "react";

// A price sparkline from stored closes only. Colour is the one meaning red
// and green carry: green when the window closed above where it opened, red
// below, accent when flat or when asked to stay neutral.
export default function Spark({ closes, width = 100, height = 32, tone, label, area = true }) {
  const vals = (closes || []).map(Number).filter((v) => Number.isFinite(v));
  if (vals.length < 2) return <span className="spark empty" style={{ width, height, display: "inline-block" }} aria-hidden="true" />;
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const span = hi - lo || 1;
  const step = width / (vals.length - 1);
  const pts = vals.map((v, i) => [i * step, height - 2 - ((v - lo) / span) * (height - 4)]);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const first = vals[0];
  const last = vals[vals.length - 1];
  const t = tone || (last > first ? "pos" : last < first ? "neg" : "flat");
  const chg = first ? ((last - first) / first) * 100 : 0;
  return (
    <svg
      className={`spark ${t}`}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label || `${vals.length} closes, ${chg >= 0 ? "+" : ""}${chg.toFixed(1)}% over the window`}
      preserveAspectRatio="none"
    >
      {area && <path className="sp-area" d={`${d} L${width},${height} L0,${height} Z`} />}
      <path className="sp-line" d={d} />
    </svg>
  );
}

export function Move({ value, digits = 1, className = "" }) {
  if (value == null || Number.isNaN(Number(value))) return <span className={`move flat ${className}`}>—</span>;
  const n = Number(value);
  const t = n > 0 ? "pos" : n < 0 ? "neg" : "flat";
  return (
    <span className={`move ${t} ${className}`}>
      {n > 0 ? "+" : ""}
      {n.toFixed(digits)}%
    </span>
  );
}

export function MoveChip({ value, digits = 1 }) {
  if (value == null || Number.isNaN(Number(value))) return <span className="move-chip">—</span>;
  const n = Number(value);
  const t = n > 0 ? "pos" : n < 0 ? "neg" : "";
  return (
    <span className={`move-chip ${t}`}>
      {n > 0 ? "+" : ""}
      {n.toFixed(digits)}%
    </span>
  );
}
