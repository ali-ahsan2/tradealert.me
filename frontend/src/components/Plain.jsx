import React from "react";
import { STRATEGY_STATUS } from "../lib/glossary.js";
import { firesSentence } from "../lib/plain.js";
import "./plain.css";

// Plain-words cards for strategies and industries (DESIGN_V6 §8). Both read
// the `plain` object the API attaches to a strategy or industry and render
// nothing when it is absent, so every screen can place them today and the
// copy arrives from app/plain_copy.py through the existing endpoints.
//
// strategy.plain = { one_line, looks_for[], judgment, move, ignores, record,
//                    record_numbers: {hits, n} | null, record_definition,
//                    status: "measured" | "provisional" | "not_running" }
// A brief plain (board rows, dossier lenses) carries only
// { one_line, status, record }; the card degrades to what it has.

// <StrategyPlainCard strategy={s} compact /> — one line, bold label.
// <StrategyPlainCard strategy={s} /> — the full card, record included.
// `record={false}` leaves the record section to the page.
export function StrategyPlainCard({ strategy, compact = false, record = true, className = "" }) {
  const p = strategy && strategy.plain;
  if (!p || !p.one_line) return null;
  if (compact) {
    return (
      <p className={`plain plain-compact ${className}`}>
        {strategy.label ? <b>{strategy.label}.</b> : null} {p.one_line}
      </p>
    );
  }
  const notRunning = p.status === "not_running";
  return (
    <div className={`plain plain-card ${className}`}>
      <p className="plain-lede">{p.one_line}</p>
      {p.looks_for && p.looks_for.length > 0 && (
        <>
          <h4>{notRunning ? "What it is built to look for" : "What it looks for"}</h4>
          <ul>
            {p.looks_for.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          {p.judgment && <p className="plain-judgment">{p.judgment}</p>}
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
      {record && p.record && (
        <>
          <h4>Its record</h4>
          <RecordLine plain={p} />
        </>
      )}
    </div>
  );
}

// The record as the API measured it: "26 of 32" large when there are
// numbers, then the sentence. Never invents a figure.
export function RecordLine({ plain, big = false, className = "" }) {
  if (!plain || !plain.record) return null;
  const n = plain.record_numbers;
  if (!n || !big) return <p className={`plain-record-text ${className}`}>{plain.record}</p>;
  return (
    <div className={`plain-record ${className}`}>
      <span className="plain-record-num">
        {n.hits}
        <small>of {n.n}</small>
      </span>
      <p className="plain-record-text" style={{ margin: 0 }}>
        {plain.record}
      </p>
    </div>
  );
}

// "Measured record" / "No record yet" / "Not running yet".
export function PlainStatusChip({ status, calibrated, className = "" }) {
  const key = status || (calibrated ? "measured" : "provisional");
  const s = STRATEGY_STATUS[key] || STRATEGY_STATUS.provisional;
  return (
    <span className={`plain-chip is-${key} ${className}`} title={s.title}>
      {s.chip}
    </span>
  );
}

// <IndustryPlainLine industry={i} /> — i.plain = { why_it_moves, what_is_in_it },
// i.month = { days, fired, measured, moved_10, top_triggers:[{key,label,n}] }.
// What tends to fire there is measured, so the line says so only when the
// record is big enough to say anything.
export function IndustryPlainLine({ industry, fires = true, className = "" }) {
  const p = industry && industry.plain;
  if (!p || !(p.why_it_moves || p.what_is_in_it)) return null;
  return (
    <p className={`plain plain-line ${className}`}>
      {p.why_it_moves && <span>{p.why_it_moves} </span>}
      {fires && <span className="plain-fires">{firesSentence(industry.month)}</span>}
    </p>
  );
}
