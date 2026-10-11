import React from "react";
import { coverage, score as fmtScore } from "../lib/fmt.js";
import { bandWord } from "../lib/plain.js";

// What each rating word means, in the words of DESIGN_V6 §7. A name that
// fails a must-pass rule is flagged FAIL and still rated; "excluded" is the
// engine's word for the band it lands in, never "left out before scoring".
const BAND_MEANING = {
  strong: "Top of the strategy's range on this run",
  elevated: "Above the strategy's typical range",
  neutral: "Within the typical range",
  weak: "Below the typical range",
  excluded: "Flagged FAIL on a must-pass rule or carries a penalty",
};

const COVERAGE_WORD = { full: "full data", partial: "some data missing", thin: "thin data" };

// The atomic unit: the rating word is the chip, the integer follows it. The
// coverage bar renders for Full mode and screen readers; Simple hides it
// (the ~ on a thin-coverage integer carries the same fact). Strong and
// elevated are solid; neutral, weak and excluded are outlined, so a list of
// forty names carries at most two filled pills, not forty.
export default function ScoreBadge({ band, value, present, total, size = "compact", strategy, className = "" }) {
  const b = band || "excluded";
  const cov = coverage(present, total);
  const label = [
    bandWord(b),
    value != null ? `score ${fmtScore(value, present, total)}` : "no score",
    COVERAGE_WORD[cov.state],
    strategy ? `${strategy.label}, ${strategy.calibrated ? "measured record" : "no record yet"}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <span
      className={`badge ${b} ${size} ${cov.state} ${className}`}
      aria-label={label}
      title={`${BAND_MEANING[b] || ""}${cov.state !== "full" ? ` · ${cov.present} of ${cov.total} inputs had data` : ""}`}
    >
      <span className="word">{bandWord(b)}</span>
      {(size === "full" || value != null) && <span className="num">{fmtScore(value, present, total)}</span>}
      <span className="cov" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span key={i} className={i < cov.segments ? "filled" : ""} />
        ))}
      </span>
    </span>
  );
}

// The rating as words, for a meta line: "Strong 72" / "Elevated ~54".
export function BandText({ band, value, present, total }) {
  if (!band) return null;
  return (
    <span className={`bandtext ${band}`}>
      <b>{bandWord(band)}</b>
      {value != null && <span className="num"> {fmtScore(value, present, total)}</span>}
    </span>
  );
}
