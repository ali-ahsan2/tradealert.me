import React from "react";
import { coverage, score as fmtScore } from "../lib/fmt.js";

const BAND_MEANING = {
  strong: "Top of the strategy's range on this run",
  elevated: "Above the strategy's typical range",
  neutral: "Within the typical range; no signal",
  weak: "Below typical range",
  excluded: "Failed a hard filter or carries a disqualifying haircut",
};

const COVERAGE_WORD = { full: "full coverage", partial: "partial coverage", thin: "thin coverage" };

// The atomic unit: band word first, integer second, coverage bar beneath.
// The band is the claim the engine actually makes; the number is detail.
export default function ScoreBadge({ band, value, present, total, size = "compact", strategy }) {
  const b = band || "excluded";
  const cov = coverage(present, total);
  const label = [
    b.charAt(0).toUpperCase() + b.slice(1),
    value != null ? `score ${fmtScore(value, present, total)}` : "no score",
    COVERAGE_WORD[cov.state],
    strategy ? `${strategy.label}, ${strategy.calibrated ? "calibrated" : "provisional"}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <span
      className={`badge ${b} ${size} ${cov.state}`}
      aria-label={label}
      title={`${BAND_MEANING[b] || ""}${cov.state !== "full" ? ` · ${cov.present} of ${cov.total} components had data` : ""}`}
    >
      <span className="word">{b}</span>
      {(size === "full" || value != null) && (
        <span className="num">{fmtScore(value, present, total)}</span>
      )}
      <span className="cov" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span key={i} className={i < cov.segments ? "filled" : ""} />
        ))}
      </span>
    </span>
  );
}
