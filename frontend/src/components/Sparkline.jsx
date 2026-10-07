import React from "react";

// A real series only: every point is a run that happened. Width and height
// are in CSS pixels; the path scales to the box.
export default function Sparkline({ points, width = 160, height = 36, min = 0, max = 100, neutral = 40, label }) {
  const vals = (points || []).map((p) => (typeof p === "number" ? p : p.value)).filter((v) => v != null);
  if (vals.length < 2) return null;
  const lo = Math.min(min, ...vals);
  const hi = Math.max(max, ...vals);
  const span = hi - lo || 1;
  const step = width / (vals.length - 1);
  const d = vals
    .map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(height - ((v - lo) / span) * height).toFixed(1)}`)
    .join(" ");
  const last = vals[vals.length - 1];
  const first = vals[0];
  return (
    <svg
      className="sparkline"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label || `${vals.length} points, from ${Math.round(first)} to ${Math.round(last)}`}
    >
      {neutral != null && neutral >= lo && neutral <= hi && (
        <line x1="0" x2={width} y1={height - ((neutral - lo) / span) * height} y2={height - ((neutral - lo) / span) * height} className="sl-neutral" />
      )}
      <path d={d} className="sl-line" fill="none" />
      <circle cx={width} cy={height - ((last - lo) / span) * height} r="2.5" className="sl-dot" />
    </svg>
  );
}
