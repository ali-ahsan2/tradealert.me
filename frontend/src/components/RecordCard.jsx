import React from "react";
import { Link } from "../lib/router.jsx";
import { plural, tone } from "../lib/fmt.js";
import { HOME_ROWS } from "../lib/caps.js";
import { beyondSentence, leadPhrase, missSentence, tallySentence, toldHeadline } from "../lib/record.js";
import { openUpgrade } from "../lib/upgrade.js";
import { Move } from "./Spark.jsx";
import NotifyButton from "./NotifyButton.jsx";
import "./upgrade.css";

// The record cards (DESIGN_V5 §4.5, §5; DESIGN_V6 §4). Both render the body
// of a card from GET /api/me/record and nothing else: the caller supplies the
// heading. Three rows each (lib/caps.js), then the caller's "Show all" link.
//
//   <YoudHaveKnown record={record} />
//     the alerts that fired on names in your industries with no rule armed,
//     biggest measured move first, each with its lead time and Notify me;
//     the tally; the names the plan did not list, as a count; and, as
//     counts only, what fired beyond the industries you follow.
//
//   <YourRecord record={record} topPinned={pick} canAlert={bool} />
//     what you were told and what the price did in the five sessions after.
//
// Every figure is a recorded fact. Red and green appear on the price move
// and nowhere else. Tickers come only from the events the API already
// clamped to the plan; `beyond` never carries one.

const MAX_ROWS = HOME_ROWS;

// biggest measured move first; open windows after, newest first
function rank(a, b) {
  const am = a.max_5d == null ? -Infinity : a.max_5d;
  const bm = b.max_5d == null ? -Infinity : b.max_5d;
  if (am !== bm) return bm - am;
  return String(b.date || "").localeCompare(String(a.date || ""));
}

// pct() already signs a positive move; a sentence builder that adds its own
// "+" in front of it would print "++24.1%", so one sign is kept.
const oneSign = (s) => (s || "").replace(/\+\+/g, "+");

// The row's sentence without the symbol (it is the link beside it) and
// without the lead (it is the chip beside it).
function sayFor(e) {
  const say = oneSign(missSentence(e, { withSymbol: false }));
  const lead = leadPhrase(e);
  const tail = ` · ${lead}`;
  return lead && say.endsWith(tail) ? say.slice(0, say.length - tail.length) : say;
}

function LeadChip({ e }) {
  const lead = leadPhrase(e);
  if (!lead) return null;
  return <span className={`lead-chip ${e.pending ? "open" : ""}`}>{lead}</span>;
}

// symbol · move at the high (price colour) · lead chip, then the sentence.
export function RecordRow({ e, action }) {
  return (
    <li className="rec-row">
      <div className="rec-main">
        <div className="rec-top">
          <Link className="sym" to={`/stock/${encodeURIComponent(e.symbol)}`}>
            {e.symbol}
          </Link>
          {e.max_5d != null && (
            <span className="rec-move" title="at the high within five sessions">
              <Move value={e.max_5d} />
            </span>
          )}
          <LeadChip e={e} />
        </div>
        <p className="rec-say">{sayFor(e)}</p>
      </div>
      {action && <div className="rec-act">{action}</div>}
    </li>
  );
}

// "You were told 2 sessions before CAMT peaked +13.5%." with the move in
// price colour; the rest of the sentence stays plain. Exported for Home's
// one-line record.
export function withMoveColour(raw) {
  const s = oneSign(raw);
  const m = s.match(/([+\-−]?\d+(?:\.\d+)?%)(\.?)$/);
  if (!m) return s;
  const n = Number(m[1].replace("−", "-").replace("%", ""));
  return (
    <>
      {s.slice(0, m.index)}
      <b className={tone(n)}>{m[1]}</b>
      {m[2]}
    </>
  );
}

export function YoudHaveKnown({ record }) {
  if (!record || !record.missed) return null;
  const missed = record.missed;
  const summary = missed.summary || {};
  const rows = [...(missed.events || [])].sort(rank).slice(0, MAX_ROWS);
  const more = Math.max(0, (missed.names_total || 0) - (missed.names_shown || 0));
  const k = missed.names_shown_limit;
  const beyondLine = beyondSentence(record.beyond);
  return (
    <div className="rec">
      {rows.length === 0 ? (
        <p className="rec-empty">
          {summary.fired
            ? tallySentence(summary)
            : "Nothing fired on a name you weren't watching in the last 30 days. When one does, it is listed here with what the price did in the five sessions after."}
        </p>
      ) : (
        <>
          <ul className="rec-list">
            {rows.map((e) => (
              <RecordRow key={e.id ?? `${e.symbol}-${e.date}-${e.trigger_key}`} e={e} action={<NotifyButton symbol={e.symbol} compact label="Alert me" onLabel="Alerting you" />} />
            ))}
          </ul>
          <p className="rec-sum">
            {tallySentence(summary)}
            {more > 0 && (
              <>
                {" "}
                {plural(more, "more name")} {more === 1 ? "is" : "are"} beyond the top {k} your plan lists.{" "}
                <button type="button" className="btn-quiet rec-up" onClick={() => openUpgrade("names")}>
                  Show me what the next plan lists
                </button>
              </>
            )}
          </p>
        </>
      )}
      {beyondLine && (
        <div className="rec-beyond">
          <p>{beyondLine}</p>
          <button type="button" className="btn-quiet" onClick={() => openUpgrade("beyond")}>
            See what the next plan watches
          </button>
        </div>
      )}
    </div>
  );
}

export function YourRecord({ record, topPinned = null, canAlert = true }) {
  if (!record || !record.told) return null;
  const told = record.told;
  const summary = told.summary || {};
  if (!summary.fired) {
    return (
      <div className="rec">
        <p className="rec-empty">
          You have not been told about an alert yet.{" "}
          {canAlert
            ? topPinned
              ? `Ask to be alerted on ${topPinned.symbol} and this fills from the first one, with what the price did after.`
              : "Pin a name and ask to be alerted; this fills from the first one, with what the price did after."
            : "Alerts start on the next plan; this fills from the first one you are told about."}
        </p>
        <div className="rec-nudge">
          {canAlert && topPinned && <NotifyButton symbol={topPinned.symbol} compact label="Alert me" onLabel="Alerting you" />}
          {canAlert && !topPinned && (
            <Link to="/board" className="btn btn-secondary btn-sm">
              Show me the Board
            </Link>
          )}
          {!canAlert && (
            <button type="button" className="btn-quiet" onClick={() => openUpgrade("alerts")}>
              See plans with alerts
            </button>
          )}
        </div>
      </div>
    );
  }
  const head = toldHeadline(told);
  const rows = [...(told.events || [])].sort(rank).slice(0, MAX_ROWS);
  return (
    <div className="rec">
      {head && <p className="rec-head">{withMoveColour(head)}</p>}
      {rows.length > 0 && (
        <ul className="rec-list">
          {rows.map((e) => (
            <RecordRow key={e.id ?? `${e.symbol}-${e.date}-${e.trigger_key}`} e={e} />
          ))}
        </ul>
      )}
      <p className="rec-sum">{tallySentence(summary, { subject: "alerts you were told about" })}</p>
    </div>
  );
}
