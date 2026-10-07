import React from "react";

const BANDS = ["strong", "elevated", "neutral", "weak", "excluded"];

// A band distribution as one segmented bar plus its legend. Counts are the
// claim; the colours only repeat them (PRODUCT_DESIGN §2.3).
export default function BandBar({ distribution = {}, width = "100%", legend = true, label }) {
  const total = BANDS.reduce((a, b) => a + (distribution[b] || 0), 0);
  if (!total) return <span className="xs faint">{label || "no scored names"}</span>;
  return (
    <span className="bandbar" style={{ width }}>
      <span className="dist" aria-hidden="true">
        {BANDS.map((b) => (distribution[b] ? <span key={b} className={b} style={{ width: `${(distribution[b] / total) * 100}%` }} /> : null))}
      </span>
      {legend && (
        <span className="dist-legend xs faint" aria-label={`Band distribution of ${total} names`}>
          {BANDS.filter((b) => distribution[b]).map((b) => (
            <span key={b}>
              {distribution[b]} {b}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}
