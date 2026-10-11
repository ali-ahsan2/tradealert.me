import React from "react";

// Plain-words cards for strategies and industries (DESIGN_V6 §8). Both read
// the `plain` object the API attaches to a strategy or industry and render
// nothing when it is absent, so every screen can place them today and the
// copy arrives from app/plain_copy.py through the existing endpoints.

// <StrategyPlainCard strategy={s} compact /> — s.plain = { one_line,
// looks_for[], move, ignores, record }
export function StrategyPlainCard({ strategy, compact = false, className = "" }) {
  const p = strategy && strategy.plain;
  if (!p || !p.one_line) return null;
  if (compact) {
    return (
      <p className={`plain plain-compact ${className}`}>
        <b>{strategy.label}.</b> {p.one_line}
      </p>
    );
  }
  return (
    <div className={`plain plain-card ${className}`}>
      <p className="plain-lede">{p.one_line}</p>
      {p.looks_for && p.looks_for.length > 0 && (
        <>
          <h4>What it looks for</h4>
          <ul>
            {p.looks_for.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </>
      )}
      {p.move && (
        <>
          <h4>The move it tries to catch</h4>
          <p>{p.move}</p>
        </>
      )}
      {p.ignores && (
        <>
          <h4>What it ignores</h4>
          <p>{p.ignores}</p>
        </>
      )}
      {p.record && (
        <>
          <h4>Its record</h4>
          <p>{p.record}</p>
        </>
      )}
    </div>
  );
}

// <IndustryPlainLine industry={i} /> — i.plain = { why_it_moves, what_fires }
export function IndustryPlainLine({ industry, className = "" }) {
  const p = industry && industry.plain;
  if (!p || !(p.why_it_moves || p.what_fires)) return null;
  return (
    <p className={`plain plain-line ${className}`}>
      {p.why_it_moves && <span>{p.why_it_moves} </span>}
      {p.what_fires && <span className="muted">What tends to fire here: {p.what_fires}</span>}
    </p>
  );
}
