import { api } from "../api.js";
import { pct, plural, shortDate } from "./fmt.js";

// Sentences from the record endpoints (DESIGN_V5 §3). Every sentence states
// a recorded fact: what fired, whether this account was told, what the
// price did in the five sessions after, and how many sessions it took to
// peak. None of them promises anything.

export function fetchRecord(days = 30) {
  return api(`/me/record?days=${days}`);
}

export function fetchSymbolRecord(symbol, days = 365) {
  return api(`/me/record?symbol=${encodeURIComponent(symbol)}&days=${days}`);
}

export function fetchPulse(days = 30) {
  return api(`/pulse?days=${days}`);
}

const SESSIONS = (n) => `${n} ${n === 1 ? "session" : "sessions"}`;

// "told 3 sessions before the peak" / "window open" / null when unmeasured
export function leadPhrase(e) {
  if (!e) return null;
  if (e.pending) return "window open";
  if (e.max_5d == null) return null;
  if (e.peak_after_sessions == null) return "measured over 5 sessions";
  const verb = e.told ? "told" : "fired";
  return `${verb} ${SESSIONS(e.peak_after_sessions)} before the peak`;
}

// "+13.9% within 5 sessions (closed +8.8%)"
export function movePhrase(e) {
  if (!e || e.max_5d == null) return e && e.pending ? "five-session window still open" : "not yet measured";
  const peak = `${e.max_5d >= 0 ? "+" : ""}${pct(e.max_5d)} at the high within five sessions`;
  return e.chg_5d != null ? `${peak}, closed ${pct(e.chg_5d)}` : peak;
}

// One row's story: "CAMT · Dilution filing on Sep 25 · +10.9% at the high within five sessions · fired 5 sessions before the peak"
export function missSentence(e, { withSymbol = true } = {}) {
  const parts = [];
  if (withSymbol && e.symbol) parts.push(e.symbol);
  parts.push(`${e.trigger} on ${shortDate(e.date)}`);
  parts.push(movePhrase(e));
  const lead = leadPhrase(e);
  if (lead && !e.pending) parts.push(lead);
  return parts.join(" · ");
}

// A tally in one line: "6 alerts fired on 5 names; 1 of the 5 measured moved 10%+."
export function tallySentence(t, { subject = "alerts" } = {}) {
  if (!t || !t.fired) return `No ${subject} fired in this window.`;
  const head = `${plural(t.fired, "alert")} fired on ${plural(t.names, "name")}`;
  if (!t.measured) return `${head}; the five-session windows are still open.`;
  const moved = t.moved_10 ? `${t.moved_10} of the ${t.measured} measured moved 10%+` : `none of the ${t.measured} measured moved 10%+`;
  const twenty = t.moved_20 ? ` (${t.moved_20} moved 20%+)` : "";
  return `${head}; ${moved}${twenty}.`;
}

// The sentence that frames an upgrade honestly: counts only, no tickers.
export function beyondSentence(beyond) {
  if (!beyond || !beyond.summary || !beyond.summary.fired) return null;
  const s = beyond.summary;
  const where = s.industries === 1 && beyond.industries && beyond.industries[0]
    ? `in ${beyond.industries[0]}`
    : `across ${plural(s.industries, "industry", "industries")} you don't follow`;
  const moved = s.measured ? `; ${s.moved_10} moved 10%+ within five sessions` : "";
  return `${plural(s.fired, "alert")} fired ${where}${moved}.`;
}

// "You were told 1 session before a +13.5% peak" for the record card header
export function toldHeadline(told) {
  if (!told || !told.summary || !told.summary.fired) return null;
  const s = told.summary;
  const best = (told.events || []).filter((e) => e.max_5d != null).sort((a, b) => b.max_5d - a.max_5d)[0];
  if (!best) return `You were told about ${plural(s.fired, "alert")}; the windows are still open.`;
  const lead = best.peak_after_sessions ? ` ${SESSIONS(best.peak_after_sessions)} before` : "";
  return `You were told${lead} ${best.symbol} peaked ${best.max_5d >= 0 ? "+" : ""}${pct(best.max_5d)}.`;
}
