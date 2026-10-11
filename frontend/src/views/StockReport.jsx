import React, { useEffect, useMemo, useState } from "react";
import { api, cached, toast } from "../api.js";
import { Link, navigate, useQuery } from "../lib/router.jsx";
import { useMe } from "../lib/me.jsx";
import { coverage, dateTime, delta, inDays, pct, plural, price as fmtPrice, score as fmtScore, shortDate, signed, tone } from "../lib/fmt.js";
import { EVIDENCE, SNAPSHOT_LABELS, SNAPSHOT_ORDER } from "../lib/evidence.js";
import { FIELD_TERM, GLOSSARY, PLAIN_FIELD } from "../lib/glossary.js";
import { CTA, bandWord, changeSentence, list as plainList, nextStep, triggerLabel } from "../lib/plain.js";
import { useMode } from "../lib/mode.js";
import { useReveal } from "../lib/motion.js";
import { fetchSymbolRecord, leadPhrase, movePhrase } from "../lib/record.js";
import { KNOWN_ROWS, KNOWN_ROWS_FULL } from "../lib/caps.js";
import SearchBar from "../components/SearchBar.jsx";
import ScoreBadge from "../components/ScoreBadge.jsx";
import Pin from "../components/Pin.jsx";
import PriceChart from "../components/PriceChart.jsx";
import Sparkline from "../components/Sparkline.jsx";
import Spark, { Move } from "../components/Spark.jsx";
import { AlertItem } from "../components/EventList.jsx";
import Explain from "../components/Explain.jsx";
import NotifyButton, { useRulesFor } from "../components/NotifyButton.jsx";
import ScreenHead from "../components/ScreenHead.jsx";
import FinePrint from "../components/FinePrint.jsx";
import { PlainStatusChip, RecordLine, StrategyPlainCard } from "../components/Plain.jsx";
import { ModeControl } from "../components/Shell.jsx";
import { AgeChip, ErrorCard, Monogram, Skeleton } from "../components/ui.jsx";
import "./stock.css";

// The dossier (DESIGN_V6 §5, §7): the head is the name, the verdict
// sentence and one action ("Alert me") with "Watch this for me" beside it;
// then one chart, why in plain words, what you'd have known, what the
// strategy looks for, and everything else behind one "More detail". The recipe stays private
// (§8, §10): inputs are named and marked lifted / weighed / no data, rules
// are named and marked PASS / FAIL, and no weight, share, cutoff or filter
// value is rendered in either mode.

// Byte-identical for a name outside the subscriber's universe and a name
// that does not exist. No upgrade prompt here, ever.
function NotAvailable({ symbol }) {
  return (
    <div className="wrap wrap-narrow">
      <Link to="/board" className="backlink">
        ← Explore
      </Link>
      <div className="card state-card">
        <p className="state-title">No report available for {symbol.toUpperCase()}.</p>
        <p className="muted">Search your industries for another name.</p>
        <div style={{ display: "flex", justifyContent: "center", marginTop: "var(--s-3)" }}>
          <SearchBar />
        </div>
        <Link to="/board" className="btn btn-secondary">
          {CTA.BOARD}
        </Link>
      </div>
    </div>
  );
}

// Plain names for the engine's inputs (DESIGN_V6 §7, §8). Simple never
// shows an engine label such as "size (scaled)"; Full may.
const PLAIN_INPUT = {
  float: "few shares available to trade",
  si: "heavy short interest",
  dtc: "slow for short sellers to exit",
  fee: "costly to borrow",
  cap: "company size",
  growth: "revenue growth",
  cat: "a dated event ahead",
  mom: "recent price action",
  news: "the news (an operator's reading)",
  qual: "company quality (an operator's reading)",
};

// Plain names for the must-pass rules.
const PLAIN_RULE = { cap: "Company size", float: "Shares that trade", si: "Short interest", growth: "Revenue growth" };

// Which glossary entry explains a score component. Keys follow the engine's
// component_json; the label match covers strategies that name them differently.
const COMPONENT_TERM = { float: "float", si: "short_interest", dtc: "days_to_cover", fee: "borrow_fee", cap: "market_cap", cat: "catalyst", vol: "volume_x" };

function termFor(key, label) {
  if (COMPONENT_TERM[key]) return COMPONENT_TERM[key];
  if (FIELD_TERM[key]) return FIELD_TERM[key];
  const l = (label || "").toLowerCase();
  if (l.includes("short interest")) return "short_interest";
  if (l.includes("borrow")) return "borrow_fee";
  if (l.includes("float")) return "float";
  if (l.includes("cover")) return "days_to_cover";
  if (l.includes("catalyst")) return "catalyst";
  if (l.includes("volume")) return "volume_x";
  if (l.includes("market cap") || l.includes("size")) return "market_cap";
  return null;
}

function plainInput(c) {
  if (PLAIN_INPUT[c.key]) return PLAIN_INPUT[c.key];
  const l = (c.label || c.key || "").toLowerCase();
  if (l.includes("short interest")) return PLAIN_INPUT.si;
  if (l.includes("borrow")) return PLAIN_INPUT.fee;
  if (l.includes("float")) return PLAIN_INPUT.float;
  if (l.includes("cover")) return PLAIN_INPUT.dtc;
  if (l.includes("catalyst")) return PLAIN_INPUT.cat;
  if (l.includes("size") || l.includes("cap")) return PLAIN_INPUT.cap;
  if (l.includes("growth")) return PLAIN_INPUT.growth;
  if (l.includes("momentum") || l.includes("coil")) return PLAIN_INPUT.mom;
  if (l.includes("news") || l.includes("narrative")) return PLAIN_INPUT.news;
  if (l.includes("quality")) return PLAIN_INPUT.qual;
  return c.label || c.key;
}

function plainRule(f) {
  return PLAIN_RULE[f.key] || f.label || f.name || f.key || "a must-pass rule";
}

// Inputs in the order the engine ranks them when it says so; else by how
// much each one moved the score. Weights are never shown, only used to
// order when no rank is given.
function orderInputs(components) {
  return [...(components || [])].sort((a, b) => {
    if (a.rank != null && b.rank != null) return a.rank - b.rank;
    const wa = (a.score ?? 0) * (a.weight ?? 1);
    const wb = (b.score ?? 0) * (b.weight ?? 1);
    return wb - wa;
  });
}

// A component's desirability runs 0 to 1: above the halfway mark it pushed
// the score up, below it pulled it down. Stated in words, never in colour.
// A judgment input is the operator's reading, not measured data.
function inputStatus(c) {
  if (c.backed === false) return ["judg", c.value != null ? "operator's reading" : "no data"];
  if (c.score == null) return ["none", "no data"];
  if (c.score > 0.5) return ["up", "lifted"];
  if (c.score < 0.5) return ["down", "weighed"];
  return ["even", "had data"];
}

// nextStep() reads the triggers armed on the name to pick its "nothing to
// do" sentence. Until the rules have loaded the set is unknown, so the card
// says only what is always true instead of the band-change hint.
function armedSet(rules) {
  return rules ? new Set(rules.map((r) => r.trigger_key)) : undefined;
}

// Two sentences are shortened here to the fourteen-word card cap
// (DESIGN_V6 §2); lib/plain.js keeps the longer forms for other screens.
function stepFor(args) {
  const s = nextStep(args);
  if (s.kind === "why") return { text: "Read why before you rely on the number: it lists the inputs behind it.", kind: "why" };
  if (s.kind === "wait" && args.armedKeys === undefined && args.alertsLimit !== 0 && args.verified !== false) {
    return { text: "Nothing to do. We keep watching; your weekly brief carries its latest rating word.", kind: "wait" };
  }
  return s;
}

// "XLE" reads as "XLE (Energy ETF)" when the series payload names the fund.
function benchName(code, bench) {
  if (!code) return "";
  if (!bench || bench.symbol !== code || !bench.label) return code;
  return `${code} (${bench.label}${/\bETF\b/i.test(bench.label) ? "" : " ETF"})`;
}

// Whole days from today (UTC calendar date) to an ISO date string.
function daysUntil(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((t - today) / 864e5);
}

// "today", "tomorrow", "in 12 days", "3 days ago".
function daysWords(n) {
  if (n == null) return null;
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

// "Tue 7 Oct" in the viewer's zone.
function scoredWhen(iso, tz) {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "";
  return t.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", ...(tz ? { timeZone: tz } : {}) });
}

function lowerFirst(s) {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

function FieldLabel({ k, simple }) {
  const full = SNAPSHOT_LABELS[k] ? SNAPSHOT_LABELS[k][0] : k;
  const text = simple ? PLAIN_FIELD[k] || full : full;
  const term = FIELD_TERM[k];
  return term && GLOSSARY[term] ? <Explain term={term}>{text}</Explain> : <>{text}</>;
}

// What you'd have known (DESIGN_V5 §5): every alert that fired on this name
// in the last year, whether this account was told, and the measured move
// after each. Facts only: fired, told, moved, peaked, N sessions before.
function knownHeadline(rec, symbol, best) {
  const fired = rec.summary.fired;
  const toldN = rec.told ? rec.told.fired : 0;
  let toldWord;
  if (toldN === 0) toldWord = fired === 1 ? "you were not told about it" : "you were told about none of them";
  else if (toldN === fired) toldWord = fired === 1 ? "you were told about it" : "you were told about all of them";
  else toldWord = `you were told about ${toldN}`;
  const first = `${plural(fired, "alert")} fired on ${symbol} in the last year; ${toldWord}.`;
  if (!best) return (rec.events || []).some((e) => e.pending) ? `${first} The five-session windows are still open.` : first;
  const lead = leadPhrase(best);
  return `${first} The biggest: ${moveText(best)}${lead ? `, ${lead}` : ""}.`;
}

// "+13.9% at the high within five sessions, closed +8.8%": the same words as
// record.js movePhrase, with pct() carrying the sign once.
function moveText(e) {
  if (e.max_5d == null) return movePhrase(e);
  const peak = `${pct(e.max_5d)} at the high within five sessions`;
  return e.chg_5d != null ? `${peak}, closed ${pct(e.chg_5d)}` : peak;
}

// The move after an alert; red and green on the price numbers only.
function MoveWords({ e }) {
  if (!e || e.max_5d == null) return <>{movePhrase(e)}</>;
  return (
    <>
      <span className={`num ${tone(e.max_5d)}`}>{pct(e.max_5d)}</span> at the high within five sessions
      {e.chg_5d != null && (
        <>
          , closed <span className={`num ${tone(e.chg_5d)}`}>{pct(e.chg_5d)}</span>
        </>
      )}
    </>
  );
}

function plainTrigger(e, simple) {
  const l = triggerLabel(e.trigger_key);
  return simple && l !== e.trigger_key ? l : e.trigger;
}

// rec: undefined while loading, null when there is no record to show (a
// name outside your industries answers 404 exactly like the dossier).
function KnownCard({ rec, symbol, simple, full, cap }) {
  const [ref, seen] = useReveal();
  const [all, setAll] = useState(false);
  if (rec === null) return null;
  const events = rec ? rec.events || [] : [];
  const fired = rec ? (rec.summary ? rec.summary.fired : events.length) : 0;
  const missedAny = events.some((e) => !e.told);
  const best = events.filter((e) => e.max_5d != null).sort((a, b) => b.max_5d - a.max_5d)[0];
  const shown = all ? events : events.slice(0, cap);
  return (
    <section ref={ref} className={`card sr-known reveal ${seen ? "in" : ""}`} aria-labelledby="known-h">
      <div className="card-title">
        <h2 id="known-h">What you'd have known</h2>
        {rec && missedAny && <NotifyButton symbol={symbol} compact />}
      </div>
      {!rec ? (
        <Skeleton rows={2} height={36} />
      ) : fired === 0 ? (
        <p className="sr-known-empty">No alerts have fired on {symbol} in the last year.</p>
      ) : (
        <>
          <p className="sr-known-h">{knownHeadline(rec, symbol, best)}</p>
          <div className="sr-known-rows">
            {shown.map((e, i) => {
              const lead = leadPhrase(e);
              return (
                <div className="rec-row" key={`${e.trigger_key}-${e.date}-${i}`}>
                  <div className="rec-main">
                    <div className="rec-top">
                      <span className="trig" title={e.detail || undefined}>
                        {plainTrigger(e, simple)}
                      </span>
                      <span className="when">{shortDate(e.date)}</span>
                      <span className={`sr-known-tag ${e.told ? "told" : ""}`}>{e.told ? "sent to you" : "not watching"}</span>
                    </div>
                    <p className="rec-say">
                      <MoveWords e={e} />
                    </p>
                    {full && e.detail && <p className="rec-detail">{e.detail}</p>}
                  </div>
                  {lead && (
                    <div className="rec-act">
                      <span className={`lead-chip ${e.pending ? "open" : ""}`}>{lead}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {events.length > shown.length && (
            <button type="button" className="btn-quiet sr-known-more" onClick={() => setAll(true)}>
              Show all {events.length}
            </button>
          )}
          <p className="hint">
            Measured from the last daily close on or before each alert to the close five sessions later and the highest high inside those sessions. “Sent to
            you” means a delivery left for your account for that alert; “not watching” means none did.
          </p>
        </>
      )}
    </section>
  );
}

// A section of "More detail": a plain block in Simple (inside the one
// closed details), an open accordion in Full.
function Block({ full, title, note, children, id }) {
  if (full) {
    return (
      <details className="acc" open id={id}>
        <summary>
          <span>{title}</span> {note && <span className="sum-note">{note}</span>}
        </summary>
        <div className="acc-body">{children}</div>
      </details>
    );
  }
  return (
    <section className="sr-block" id={id}>
      <h3>
        {title} {note && <span className="sum-note">{note}</span>}
      </h3>
      {children}
    </section>
  );
}

export default function StockReport({ symbol }) {
  const { me } = useMe();
  const { simple, full } = useMode();
  const q = useQuery();
  const strategyKey = q.get("strategy") || "fast_mover";
  const sym = symbol.toUpperCase();
  const rules = useRulesFor(sym, Boolean(me));
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [reload, setReload] = useState(0);
  const [pinned, setPinned] = useState(false);
  const [cap, setCap] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteBusy, setNoteBusy] = useState(false);
  const [events, setEvents] = useState([]);
  const [fields, setFields] = useState(null);
  const [series, setSeries] = useState(null);
  const [stratList, setStratList] = useState(null);

  // The plain card for the strategy (DESIGN_V6 §8) rides on the public
  // strategies list, cached across pages.
  useEffect(() => {
    cached("/strategies")
      .then((x) => setStratList(x.strategies || []))
      .catch(() => setStratList([]));
  }, []);

  useEffect(() => {
    let alive = true;
    setFields(null);
    api(`/stock/${encodeURIComponent(symbol)}/fields?strategy=${encodeURIComponent(strategyKey)}`)
      .then((x) => alive && setFields(x))
      .catch(() => alive && setFields({ fields: {}, missing_components: [], since_pin: null }));
    return () => {
      alive = false;
    };
  }, [symbol, strategyKey, pinned]);

  useEffect(() => {
    let alive = true;
    setErr(null);
    setD(null);
    api(`/stock/${encodeURIComponent(symbol)}?strategy=${encodeURIComponent(strategyKey)}`)
      .then((x) => {
        if (!alive) return;
        setD(x);
        setPinned(Boolean(x.pinned));
        setNote(x.note || "");
        setEvents(x.events || []);
      })
      .catch((e) => alive && setErr(e));
    return () => {
      alive = false;
    };
  }, [symbol, strategyKey, reload]);

  // The price figures (today, 30d, ETF 30d) come from a fixed 90-day window
  // and stand in for the chart until it mounts. Reset on every symbol change
  // so a new dossier never wears the previous ticker's prices.
  useEffect(() => {
    let alive = true;
    setSeries(null);
    api(`/stock/${encodeURIComponent(symbol)}/series?days=90`)
      .then((x) => alive && setSeries(x))
      .catch(() => alive && setSeries(null));
    return () => {
      alive = false;
    };
  }, [symbol, reload]);

  useEffect(() => {
    let alive = true;
    // uncached on purpose: the swap button below must reflect a pin or
    // unpin made seconds ago, or it would drop a pick that had room
    api("/entitlements")
      .then((ent) => {
        if (!alive || !ent.current) return;
        setCap({ limit: ent.current.picks_limit, used: ent.usage ? ent.usage.picks_used : 0 });
      })
      .catch(() => setCap(null));
    return () => {
      alive = false;
    };
  }, [symbol, pinned]);

  // The record on this name: every alert that fired in the last year, told
  // or not, with the measured move after. Needs an account; a 404 (outside
  // your industries) or any other failure hides the card.
  const signedIn = Boolean(me);
  const [rec, setRec] = useState(undefined);
  useEffect(() => {
    if (!signedIn) return undefined;
    let alive = true;
    setRec(undefined);
    fetchSymbolRecord(sym, 365)
      .then((x) => alive && setRec(x))
      .catch(() => alive && setRec(null));
    return () => {
      alive = false;
    };
  }, [sym, signedIn, reload]);

  const history = d ? d.history || [] : [];
  const bandChanges = useMemo(() => {
    let n = 0;
    for (let i = 1; i < history.length; i += 1) if (history[i].band !== history[i - 1].band) n += 1;
    return n;
  }, [history]);

  if (err) {
    if (err.status === 404) return <NotAvailable symbol={symbol} />;
    return (
      <div className="wrap wrap-narrow">
        <Link to="/board" className="backlink">
          ← Explore
        </Link>
        <ErrorCard error={err} onRetry={() => setReload((n) => n + 1)} title="Couldn't load this report." />
      </div>
    );
  }

  if (!d) {
    return (
      <div className="wrap sr-wrap">
        <Link to="/board" className="backlink">
          ← Explore
        </Link>
        <div className="rhead">
          <h1>{sym}</h1>
        </div>
        <div className="report">
          <div className="report-main stack">
            <Skeleton rows={1} height={72} />
            <Skeleton rows={1} height={280} />
            <Skeleton rows={4} height={40} />
          </div>
          {full && <Skeleton rows={6} height={36} />}
        </div>
      </div>
    );
  }

  const s = d.score;
  const strat = d.strategy;
  const stratPlain = (stratList || []).find((x) => x.key === strat.key) || null;
  const tz = me && me.settings ? me.settings.timezone : undefined;
  const cov = s ? coverage(s.components_present, s.components_total) : null;
  const atCap = cap && cap.limit != null && cap.used >= cap.limit && !pinned;
  const snaps = Object.entries(d.snapshot || {}).sort(
    ([a], [b]) => (SNAPSHOT_ORDER.indexOf(a) + 1 || 99) - (SNAPSHOT_ORDER.indexOf(b) + 1 || 99)
  );
  const missingComponents = fields ? fields.missing_components || [] : [];
  const snap = d.snapshot || {};
  const bars = series ? series.bars : [];
  const lastBar = bars.length ? bars[bars.length - 1] : null;
  const prevBar = bars.length > 1 ? bars[bars.length - 2] : null;
  const bar30 = bars.length > 21 ? bars[bars.length - 22] : null;
  const dayMove = lastBar && prevBar && prevBar.c ? ((lastBar.c - prevBar.c) / prevBar.c) * 100 : null;
  const move30 = lastBar && bar30 && bar30.c ? ((lastBar.c - bar30.c) / bar30.c) * 100 : null;
  const benchBars = series && series.benchmark ? series.benchmark.bars : [];
  const b30 = benchBars.length > 21 ? benchBars[benchBars.length - 22] : null;
  const bLast = benchBars.length ? benchBars[benchBars.length - 1] : null;
  const bench30 = bLast && b30 && b30.c ? ((bLast.c - b30.c) / b30.c) * 100 : null;
  const KEY_STATS = ["cap_usd_m", "float_m", "si_pct_float", "fee_pct", "dtc", "run3m_pct", "off_high_pct", "earnings"].filter((k) => snap[k]);
  const fieldSeries = fields ? Object.entries(fields.fields || {}).filter(([, pts]) => pts.length >= 2) : [];
  const sincePin = fields && fields.since_pin;
  const missing = s ? Math.max(0, s.components_total - s.components_present) : 0;
  const hardFilters = s && s.hard_filters ? s.hard_filters : [];
  const components = orderInputs(s && s.components ? s.components : []);
  const haircuts = s && s.haircuts ? s.haircuts : [];
  const changes = d.changes;
  const peers = d.peers || [];
  const reactions = d.past_reactions || [];
  const resolvedReactions = reactions.filter((r) => r.hit != null);
  const reactionHits = resolvedReactions.filter((r) => r.hit).length;
  const lensHref = (key) => (key === "fast_mover" ? `/stock/${d.symbol}` : `/stock/${d.symbol}?strategy=${encodeURIComponent(key)}`);
  const compareHref = `/compare?symbols=${encodeURIComponent(d.symbol)}${strat.key !== "fast_mover" ? `&strategy=${strat.key}` : ""}`;
  const armedN = rules ? rules.length : null;
  const step = stepFor({
    pinned,
    armed: Boolean(armedN),
    band: s ? s.band : null,
    verified: me ? me.verified : undefined,
    alertsLimit: me && me.tier ? me.tier.alerts_limit : undefined,
    armedKeys: armedSet(rules),
  });
  const earnIso = snap.earnings && typeof snap.earnings.value === "string" ? snap.earnings.value : null;
  const earnDays = earnIso ? daysUntil(earnIso) : null;
  const earnConf = snap.earnings_conf ? String(snap.earnings_conf.value) : "";
  // a confirmed date on file while the score still carries an assumed
  // catalyst: the engine picks the date up on its next run
  const earnConfirmed = Boolean(earnIso) && /^confirmed$/i.test(earnConf.trim());
  const catalystAssumed = components.some(
    (c) => (c.key === "cat" || termFor(c.key, c.label) === "catalyst") && typeof c.value === "string" && c.value.includes("(assumed)")
  );
  const changedInputs = changes
    ? changes.components.filter((c) => c.status !== "kept" || (c.delta != null && Math.abs(c.delta) >= 0.01)).slice(0, 8)
    : [];
  const detailLabel = (k) => (SNAPSHOT_LABELS[k] ? SNAPSHOT_LABELS[k][0] : k);
  const inputName = (c) => (simple ? plainInput(c) : c.label || c.key);

  // The lede: the rating word and the integer, in one sentence.
  const failedRules = hardFilters.filter((f) => f.pass === false);
  let lede;
  let detailLines = [];
  if (!s || (s.value == null && s.band !== "excluded")) {
    lede = (
      <>
        No {strat.label} score for {d.symbol} in the latest scoring.
      </>
    );
    detailLines = ["The engine had no inputs for it yet."];
  } else if (s.band === "excluded") {
    lede = (
      <>
        {d.symbol} is <b className="sr-band">flagged FAIL</b> on {strat.label}
        {failedRules.length ? <>: it failed {failedRules.length === 1 ? "a must-pass rule" : `${failedRules.length} must-pass rules`} ({plainList(failedRules.map(plainRule))})</> : " for a penalty"}
        .
      </>
    );
    detailLines = [s.value != null ? `It is still rated, ${fmtScore(s.value, s.components_present, s.components_total)} of 100.` : "It is still rated."];
  } else {
    const n = Math.round(s.value);
    lede = (
      <>
        {d.symbol} is <b className="sr-band">{lowerFirst(bandWord(s.band))}</b> on {strat.label}: {cov.state === "thin" ? "about " : ""}
        {n} of 100.
      </>
    );
    if (s.components_total) {
      detailLines.push(
        cov.state === "full"
          ? `All ${s.components_total} inputs had data.`
          : `${s.components_present} of ${s.components_total} inputs had data${cov.state === "thin" ? ", so read the number as approximate" : ""}.`
      );
    }
    if (s.shrinkage_applied != null && Math.abs(s.shrinkage_applied) >= 0.5) {
      const from = Math.round(s.shrinkage_from != null ? s.shrinkage_from : s.value + s.shrinkage_applied);
      detailLines.push(`Missing data pulled it toward neutral${full ? " (shrinkage)" : ""}, from ${from} to ${n}.`);
    }
    if (haircuts.length) detailLines.push(`A penalty was applied for ${plainList(haircuts.map((h) => h.label || h.key))}.`);
    if (strat.calibrated === false) detailLines.push(`${strat.label} has no measured record yet, so this is a candidate rather than a signal.`);
  }

  // Why, as three plain bullets.
  const capped = (names) => (names.length <= 3 ? plainList(names) : `${plainList(names.slice(0, 3))} and ${names.length - 3} more`);
  const lifted = components.filter((c) => inputStatus(c)[0] === "up").map(inputName);
  const weighed = components.filter((c) => inputStatus(c)[0] === "down").map(inputName);
  const noData = [
    ...components.filter((c) => inputStatus(c)[0] === "none").map(inputName),
    ...missingComponents.filter((m) => !components.some((c) => c.key === m.key)).map(inputName),
  ];
  const whyBullets = [];
  if (stratPlain && stratPlain.plain && stratPlain.plain.one_line) whyBullets.push(<>{strat.label} hunts {lowerFirst(stratPlain.plain.one_line)}</>);
  if (s) {
    whyBullets.push(
      <>
        <b>What lifted it:</b> {lifted.length ? `${capped(lifted)}.` : "nothing stood out."}
      </>
    );
    // Three names at most, then a count; missing data is a count of all the inputs seen here.
    const inputsTotal = lifted.length + weighed.length + noData.length;
    const heldSentence = weighed.length ? `${capped(weighed)}.` : "nothing weighed on it.";
    const noDataSentence = noData.length ? ` No data yet for ${noData.length} of ${inputsTotal} inputs.` : " Every input had data.";
    whyBullets.push(
      <>
        <b>What held it back:</b> {heldSentence}
        {noDataSentence}
      </>
    );
  }

  const swap = async () => {
    setBusy(true);
    try {
      const r = await api("/me/picks/swap", { method: "POST", json: { symbol: d.symbol } });
      toast(r.dropped ? `Stopped watching ${r.dropped}; now watching ${d.symbol}.` : `Watching ${d.symbol} for you.`);
      setPinned(true);
    } catch (e2) {
      toast(e2.detail || "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const saveNote = async () => {
    setNoteBusy(true);
    try {
      await api(`/me/picks/${encodeURIComponent(d.symbol)}`, { method: "PATCH", json: { note } });
      toast("Note saved.");
      setNoteOpen(false);
    } catch (e) {
      toast(e.detail || "Couldn't save the note.");
    } finally {
      setNoteBusy(false);
    }
  };

  // ---- blocks for "More detail" -------------------------------------------

  const whatChanged = s && (
    <Block full={full} title="What changed" note={changes && changes.prev_run ? `${shortDate(changes.prev_run.as_of, tz)} → ${shortDate(d.run.as_of, tz)}` : null} id="changed">
      <p className="sr-chg">
        {changeSentence(s.delta_1d, s.band, changes ? changes.prev_band : null)}
        {changes && changes.prev_value != null ? (
          <>
            {" "}
            Score <b>{fmtScore(changes.prev_value, changes.prev_components_present, changes.prev_components_total)}</b> ({bandWord(changes.prev_band).toLowerCase()}) →{" "}
            <b>{fmtScore(s.value, s.components_present, s.components_total)}</b> ({bandWord(s.band).toLowerCase()}).
          </>
        ) : null}
      </p>
      {history.length > 1 && (
        <div className="hist">
          <Sparkline points={history} label={`${strat.label} score over ${history.length} runs`} />
          <div className="hist-meta">
            {plural(history.length, simple ? "morning" : "run")} on record · from {fmtScore(history[0].value, history[0].components_present, history[0].components_total)} to{" "}
            {fmtScore(history[history.length - 1].value, history[history.length - 1].components_present, history[history.length - 1].components_total)}
            {bandChanges ? ` · ${plural(bandChanges, "rating change")}` : " · no rating change"}
          </div>
        </div>
      )}
      {pinned && sincePin && (
        <div className="sincepin xs">
          <span>
            Watching since {shortDate(sincePin.pinned_at, tz)}
            {sincePin.score_at_pin != null ? (
              <>
                {" "}
                · score <b>{fmtScore(sincePin.score_at_pin)}</b> → <b>{fmtScore(s.value, s.components_present, s.components_total)}</b> ({delta(s.value - sincePin.score_at_pin)})
              </>
            ) : null}
          </span>
          {sincePin.chg_pct != null && (
            <span>
              Price since then <b className={tone(sincePin.chg_pct)}>{signed(sincePin.chg_pct, 1, "%")}</b>
              {sincePin.benchmark_chg_pct != null && (
                <>
                  {" "}
                  vs {benchName(sincePin.benchmark, series && series.benchmark)}{" "}
                  <span className={tone(sincePin.benchmark_chg_pct)}>{signed(sincePin.benchmark_chg_pct, 1, "%")}</span>
                </>
              )}
              {sincePin.last_date ? ` · close ${shortDate(sincePin.last_date)}` : ""}
            </span>
          )}
        </div>
      )}
      {changedInputs.length > 0 && (
        <div className="delta-list" style={{ marginTop: "var(--s-3)" }}>
          <p className="hint" style={{ marginTop: 0, marginBottom: "var(--s-2)" }}>
            Each input's reading before and after, biggest moves first.
          </p>
          {changedInputs.map((c) => (
            <div className="delta-row" key={c.key}>
              <span>
                {inputName(c)}
                {c.status === "added" && <span className="judg xs faint"> · new data</span>}
                {c.status === "dropped" && <span className="judg xs faint"> · data gone</span>}
              </span>
              <span className="vals">
                {c.prev_value != null ? String(c.prev_value) : "—"} → {c.value != null ? String(c.value) : "—"}
              </span>
              <span className="d">{c.delta == null ? "" : c.delta > 0 ? "rose" : c.delta < 0 ? "fell" : "held"}</span>
            </div>
          ))}
        </div>
      )}
    </Block>
  );

  const comingUp = (
    <Block full={full} title="Coming up" note={<Link to="/calendar">My calendar →</Link>} id="upcoming">
      {earnIso ? (
        <ul className="sr-up" aria-label="Dated events">
          <li>
            <span className="when">{earnDays == null ? shortDate(earnIso) : daysWords(earnDays)}</span>
            <span>
              Earnings {shortDate(earnIso)}
              {earnConf ? <span className="muted"> · date {earnConf}</span> : null}{" "}
              <span className="full-only">
                <AgeChip asOf={snap.earnings.as_of} prefix="checked " suffix=" ago" />
              </span>
            </span>
            <span className="spacer" />
            <NotifyButton symbol={d.symbol} triggers={["catalyst_dated"]} label="Alert me before it" compact />
          </li>
        </ul>
      ) : (
        <p className="muted small" style={{ marginBottom: 0 }}>
          No dated event is on file for {d.symbol}. That is not the same as having none: the date comes from the latest market snapshot, and this name has
          no earnings date in it yet.
        </p>
      )}
      {earnIso && earnDays != null && earnDays < 0 && <p className="hint">That date has passed; no later one is on file yet.</p>}
      {reactions.length > 0 && (
        <details className="acc" open={full} style={{ marginTop: "var(--s-3)" }}>
          <summary>
            How it moved after past dated events <span className="sum-note">{plural(reactions.length, "event")}, measured</span>
          </summary>
          <div className="acc-body">
            <p className="muted small">
              Each row is a real past event and the move that followed inside the window. A hit is {EVIDENCE.hitDefinition}.
              {resolvedReactions.length >= 10 ? ` ${reactionHits} of ${resolvedReactions.length} resolved events moved.` : ""}
            </p>
            {full ? (
              <div className="tscroll">
                <table className="hf reactions">
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Event</th>
                      <th scope="col" className="num">
                        Max move
                      </th>
                      <th scope="col" className="num">
                        Close move
                      </th>
                      <th scope="col" className="num">
                        Volume
                      </th>
                      <th scope="col">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reactions.map((r) => (
                      <tr key={`${r.date}-${r.kind}`}>
                        <td className="num">{shortDate(r.date)}</td>
                        <td>{r.kind.replace(/_/g, " ")}</td>
                        <td className={`num ${tone(r.max_move_pct)}`}>{pct(r.max_move_pct)}</td>
                        <td className={`num ${tone(r.close_move_pct)}`}>{pct(r.close_move_pct)}</td>
                        <td className="num">{r.volume_spike_x != null ? `${r.volume_spike_x.toFixed(1)}x` : "—"}</td>
                        <td>
                          {r.hit == null ? (
                            <span className="faint">open</span>
                          ) : (
                            <span className="outcome">
                              {r.hit ? "HIT" : "MISS"}
                              {r.days_to_move != null ? ` · ${r.days_to_move}d` : ""}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <ul className="sr-reactions">
                {reactions.map((r) => (
                  <li key={`${r.date}-${r.kind}`}>
                    <b>{shortDate(r.date)}</b>, {r.kind.replace(/_/g, " ")}: <span className={`num ${tone(r.max_move_pct)}`}>{pct(r.max_move_pct)}</span> at the high
                    {r.close_move_pct != null ? (
                      <>
                        , closed <span className={`num ${tone(r.close_move_pct)}`}>{pct(r.close_move_pct)}</span>
                      </>
                    ) : null}
                    {r.hit == null ? " · window open" : r.hit ? " · moved" : " · did not move"}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </details>
      )}
    </Block>
  );

  const fullBreakdown = s && (
    <Block full={full} title="Every input" note={`${components.length} with data${missing > 0 ? `, ${missing} without` : ""}`} id="breakdown">
      <p className="muted small">
        Each input is named and marked by what it did to the score: lifted it, weighed on it, or had no data.{" "}
        {missing > 0 ? `${plural(missing, "input")} had none this time, which pulled the total toward neutral.` : "Every input had data this time."}
      </p>
      {components.length === 0 ? (
        <p className="muted small" style={{ marginBottom: 0 }}>
          No per-input detail was stored for this score.
        </p>
      ) : (
        <ul className="sr-inputs" aria-label="Inputs">
          {components.map((c) => {
            const [kind, word] = inputStatus(c);
            const assumed = typeof c.value === "string" && c.value.includes("(assumed)");
            return (
              <li key={c.key}>
                <span className="lbl">
                  {inputName(c)}
                  {assumed && c.backed !== false && (
                    <span className="judg">
                      {" "}
                      · <Explain term="assumed">assumed</Explain>
                    </span>
                  )}
                </span>
                {full && c.value != null && c.backed !== false && <span className="val">{String(c.value)}</span>}
                <span className={`st st-${kind}`}>{word}</span>
              </li>
            );
          })}
          {missingComponents
            .filter((m) => !components.some((c) => c.key === m.key))
            .map((m) => (
              <li key={`missing-${m.key}`} className="missing">
                <span className="lbl">
                  {inputName(m)}
                  {m.source && full && <span className="judg"> · {m.source}</span>}
                </span>
                <span className="st st-none">no data</span>
              </li>
            ))}
        </ul>
      )}
      {catalystAssumed && earnConfirmed && <p className="hint">The dated-event input is an assumption until the next scoring picks up the confirmed date.</p>}
    </Block>
  );

  const keyStats = KEY_STATS.length > 0 && (
    <Block full={full} title="Key stats" note="latest on file, each with its age" id="stats">
      <div className="kstats">
        {KEY_STATS.map((k) => {
          const [, fmt] = SNAPSHOT_LABELS[k] || [k, (x) => x];
          return (
            <div className="kstat" key={k}>
              <span className="k">
                <FieldLabel k={k} simple={simple} />
              </span>
              <span className="v">
                {fmt(snap[k].value)}
                <AgeChip asOf={snap[k].as_of} />
              </span>
            </div>
          );
        })}
      </div>
    </Block>
  );

  const inputsOverTime = fieldSeries.length > 0 && (
    <Block full={full} title="Inputs over time" note={`every point is a stored snapshot · last ${fields.days} days`} id="series">
      <div className="fieldgrid">
        {fieldSeries.map(([k, pts]) => {
          const [, fmt] = SNAPSHOT_LABELS[k] || [k, (x) => x];
          const label = simple ? PLAIN_FIELD[k] || detailLabel(k) : detailLabel(k);
          const first = pts[0].value;
          const last = pts[pts.length - 1].value;
          const vals = pts.map((p) => p.value);
          const chg = first ? ((last - first) / Math.abs(first)) * 100 : null;
          const priceLike = k === "px" || k === "hi52" || k === "lo52";
          return (
            <div className="fieldcard" key={k}>
              <div className="fc-top">
                <span className="fc-label">
                  <FieldLabel k={k} simple={simple} />
                </span>
                <span className="fc-val num">{fmt(last)}</span>
              </div>
              <Sparkline points={vals} min={Math.min(...vals)} max={Math.max(...vals)} neutral={null} width={200} height={32} label={`${label}: ${pts.length} snapshots`} />
              <div className="fc-foot xs faint">
                {pts.length} snapshots · from {fmt(first)}
                {chg != null && Number.isFinite(chg) ? (
                  <>
                    {" "}
                    · <span className={priceLike ? tone(chg) : ""}>{signed(chg, 0, "%")}</span>
                  </>
                ) : null}{" "}
                · {shortDate(pts[pts.length - 1].as_of)}
              </div>
            </div>
          );
        })}
      </div>
    </Block>
  );

  const otherLenses = (
    <Block full={full} title="Other strategies" note={`${plural(d.strategies.length, "strategy", "strategies")} on this name`} id="lenses">
      <p className="hint" style={{ marginTop: 0, marginBottom: "var(--s-3)" }}>
        Each strategy rates the same name by its own recipe. Tap one to read this report through it.
      </p>
      <div className="lens-tabs" role="group" aria-label="Strategies">
        {d.strategies.map((l) => {
          const st = (l.plain && l.plain.status) || (l.value == null ? "not_running" : l.calibrated ? "measured" : "provisional");
          return (
            <button key={l.key} className="lens-card" aria-pressed={l.key === strat.key} onClick={() => navigate(lensHref(l.key), { replace: true })}>
              <div className="lc-top">
                <span className="full-only">
                  <Monogram size={18}>{l.monogram}</Monogram>
                </span>
                {l.label}
                {full && st !== "measured" && l.value != null && <PlainStatusChip status={st} />}
              </div>
              <div className="lc-score">
                {l.value != null ? (
                  <>
                    <b>{fmtScore(l.value, l.components_present, l.components_total)}</b>
                    <span>{bandWord(l.band).toLowerCase()}</span>
                    <span className="faint full-only">
                      · {l.components_present}/{l.components_total}
                    </span>
                  </>
                ) : (
                  <span>{st === "not_running" ? "not running yet" : "no score yet"}</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </Block>
  );

  const alsoRanked = peers.length > 1 && (
    <Block full={full} title={`Also rated in ${d.industry.label}`} note={plural(peers.length, "name")} id="peers">
      {full ? (
        <div className="tscroll">
          <div className="table-card peers" style={{ boxShadow: "none" }}>
            <table className="data compact">
              <thead>
                <tr>
                  <th className="rank" scope="col">
                    #
                  </th>
                  <th scope="col">Name</th>
                  <th scope="col" className="num">
                    Score
                  </th>
                  <th scope="col">Rating</th>
                  <th scope="col" className="num">
                    Δ run
                  </th>
                </tr>
              </thead>
              <tbody>
                {peers.map((p) => (
                  <tr key={p.symbol} className={p.self ? "me" : "rowlink"} onClick={() => !p.self && navigate(lensHref(strat.key).replace(d.symbol, p.symbol))}>
                    <td className="rank">{p.rank}</td>
                    <td className="name-cell">
                      <span className="sym">{p.symbol}</span>
                      <span className="theme">{p.theme}</span>
                    </td>
                    <td className="num">{fmtScore(p.value, p.components_present, p.components_total)}</td>
                    <td>
                      <ScoreBadge band={p.band} value={p.value} present={p.components_present} total={p.components_total} />
                    </td>
                    <td className="num">{delta(p.delta_1d)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <ol className="sr-peers">
          {peers.map((p) => (
            <li key={p.symbol} className={p.self ? "me" : ""}>
              <span className="rank">{p.rank}</span>
              {p.self ? <span className="sym">{p.symbol}</span> : <Link className="sym" to={lensHref(strat.key).replace(d.symbol, p.symbol)}>{p.symbol}</Link>}
              <span className="theme">{p.theme}</span>
              <span className="muted">
                {bandWord(p.band)} {fmtScore(p.value, p.components_present, p.components_total)}
              </span>
            </li>
          ))}
        </ol>
      )}
      <p className="hint">
        <Link to={`/industries/${d.industry.key}`}>Industry page →</Link>
      </p>
    </Block>
  );

  const alertsBlock = (
    <Block full={full} title="Alerts fired on this name" note={events.length ? `${plural(events.length, "alert")} in 120 days` : "none in 120 days"} id="alerts">
      {events.length === 0 ? (
        <p className="muted small">No alert has fired on {d.symbol} in the last 120 days.</p>
      ) : (
        <div className="alert-list">
          {events.map((ev) => (
            <AlertItem
              key={ev.id}
              ev={{ ...ev, symbol: d.symbol }}
              tz={tz}
              showSymbol={false}
              onRead={(id) => {
                setEvents((xs) => xs.map((x) => (x.id === id ? { ...x, read: true } : x)));
                window.dispatchEvent(new Event("alerts:read"));
              }}
            />
          ))}
        </div>
      )}
      <p className="hint">
        <Link to={`/alerts?tab=armed&symbol=${encodeURIComponent(d.symbol)}`}>Choose which facts alert me →</Link>
      </p>
    </Block>
  );

  const notesBlock = (d.hook || d.thesis || pinned) && (
    <Block full={full} title="Notes" note={[d.hook || d.thesis ? "operator note" : null, pinned ? "my note" : null].filter(Boolean).join(" · ")} id="notes">
      <div className="stack">
        {(d.hook || d.thesis) && (
          <section className="opnote" aria-labelledby="op-h">
            <div className="lab" id="op-h">
              Operator note
            </div>
            {d.hook && (
              <p>
                <b>{d.hook}</b>
              </p>
            )}
            {d.thesis && <p>{d.thesis}</p>}
            <p className="muted small" style={{ marginBottom: 0 }}>
              Human-written context, kept separate from the computed score above.
            </p>
          </section>
        )}
        {pinned && (
          <section className="notebox" aria-labelledby="note-h">
            <div className="card-title">
              <h3 id="note-h" style={{ fontSize: "var(--fs-sm)" }}>
                My note
              </h3>
              {!noteOpen && (
                <button className="btn-quiet" onClick={() => setNoteOpen(true)}>
                  {note ? "Edit" : "Add a note"}
                </button>
              )}
            </div>
            {noteOpen ? (
              <>
                <textarea value={note} maxLength={280} onChange={(e) => setNote(e.target.value)} placeholder="Why you are watching it, what would change your mind…" />
                <div className="row" style={{ marginTop: "var(--s-2)" }}>
                  <button className="btn btn-primary btn-sm" disabled={noteBusy} onClick={saveNote}>
                    {noteBusy ? "Saving…" : "Save my note"}
                  </button>
                  <button className="btn-quiet" onClick={() => setNoteOpen(false)}>
                    Cancel
                  </button>
                  <span className="xs faint">{note.length}/280 · private to you</span>
                </div>
              </>
            ) : (
              <p className="small" style={{ marginBottom: 0, color: note ? "var(--ink)" : "var(--ink-faint)" }}>
                {note || "No note yet."}
              </p>
            )}
          </section>
        )}
      </div>
    </Block>
  );

  // ---- evidence ------------------------------------------------------------

  const evidenceBlocks = (
    <>
      <Block full={full} title="Data on file" note={plural(snaps.length, "field")} id="data">
        {snaps.length === 0 ? (
          <div className="aside-note">
            No market snapshot is on file for this name. The score above rests on the operator's research pass and whatever filings the pipeline has read.
          </div>
        ) : (
          snaps.map(([k, val]) => {
            const [, fmt] = SNAPSHOT_LABELS[k] || [k, (x) => x];
            return (
              <div className="kv" key={k}>
                <span className="k">
                  <FieldLabel k={k} simple={simple} />
                </span>
                <span className="v">
                  {fmt(val.value)}
                  <AgeChip asOf={val.as_of} />
                </span>
              </div>
            );
          })
        )}
      </Block>
      <Block full={full} title="Find more like it" id="more-like">
        <div className="aside-note">
          <Link to={`/screen?industries=${d.industry.key}${strat.key !== "fast_mover" ? `&strategy=${strat.key}` : ""}`}>Find names in {d.industry.label}</Link>
          {d.lane ? (
            <>
              {" "}
              · <Link to={`/screen?lane=${encodeURIComponent(d.lane)}`}>{d.lane === "Event" ? "Names with a date set" : "Names with no date yet"}</Link>
            </>
          ) : null}
          {hardFilters.length > 0 && hardFilters.every((f) => f.pass) ? (
            <>
              {" "}
              · <Link to="/screen?hf=pass">Everything that passed every rule</Link>
            </>
          ) : null}{" "}
          · <Link to="/calendar">My calendar</Link>
          <span className="full-only">
            {" "}
            · <Link to={compareHref}>Compare</Link>
          </span>
        </div>
      </Block>
      <Block full={full} title={simple ? "This scoring" : "This run"} note="what this report was computed from" id="run">
        <div className="kv">
          <span className="k">Scored</span>
          <span className="v">{dateTime(d.run.as_of, tz)}</span>
        </div>
        {s && s.delta_1d != null && (
          <div className="kv">
            <span className="k">Change since the last scoring</span>
            <span className="v">{delta(s.delta_1d)}</span>
          </div>
        )}
        {history.length > 0 && (
          <div className="kv">
            <span className="k">{simple ? "Mornings on record" : "Runs on record"}</span>
            <span className="v">{history.length}</span>
          </div>
        )}
        {d.lane && (
          <div className="kv">
            <span className="k">{simple ? "Dated event" : "Stage"}</span>
            <span className="v">{simple ? (d.lane === "Event" ? "a date is set" : "no date set yet") : d.lane}</span>
          </div>
        )}
        {d.group && full && (
          <div className="kv">
            <span className="k">
              <Explain term="group">Group</Explain>
            </span>
            <span className="v">{d.group}</span>
          </div>
        )}
        <div className="kv">
          <span className="k">{simple ? "Compared with" : <Explain term="benchmark">Benchmark</Explain>}</span>
          <span className="v">{d.industry.benchmark_etf}</span>
        </div>
      </Block>
      <Block full={full} title="The strategy's record" note={strat.calibrated ? "measured" : "no record yet"} id="record">
        {simple && stratPlain && stratPlain.plain && stratPlain.plain.record ? (
          <div className="aside-note">
            <RecordLine plain={stratPlain.plain} /> <Link to={`/strategies/${strat.key}`}>{CTA.RECORD}</Link>
          </div>
        ) : strat.calibrated ? (
          <div className="aside-note">
            {strat.label}'s record rests on {strat.resolved_outcomes_count} resolved outcomes. Events that passed its must-pass rules moved {EVIDENCE.hitRate}% of
            the time ({EVIDENCE.hits} of {EVIDENCE.events}), against {EVIDENCE.earningsRate}% for earnings events generally and {EVIDENCE.randomRate}% on a
            random day. The test measures movement, not direction or profit, over {EVIDENCE.window}.{" "}
            <Link to={`/strategies/${strat.key}`}>{CTA.RECORD}</Link>
          </div>
        ) : (
          <div className="aside-note">
            {strat.label} has {strat.resolved_outcomes_count ?? 0} resolved outcomes. Its record can be measured once {EVIDENCE.calibrationThreshold} resolve.
            Until then it produces candidates, not signals. <Link to={`/strategies/${strat.key}`}>{CTA.RECORD}</Link>
          </div>
        )}
      </Block>
    </>
  );

  // The page foot: the fine print (DESIGN_V6 §6) and the print button, under
  // the main column in both modes.
  const foot = (
    <div className="sr-foot">
      <FinePrint short />
      <span>Re-verify any figure against its source before you act on it.</span>
      <button className="btn-quiet" onClick={() => window.print()}>
        Print this report
      </button>
    </div>
  );
  const stratStatus = (stratPlain && stratPlain.plain && stratPlain.plain.status) || (strat.calibrated ? "measured" : "provisional");

  const priceRow = lastBar && (
    <div className="sr-price" aria-label="Price context">
      <span className="sr-px">{fmtPrice(lastBar.c)}</span>
      <span>
        <Move value={dayMove} /> <span className="xs faint">today</span>
      </span>
      <span>
        <Move value={move30} /> <span className="xs faint">30 days</span>
      </span>
      {bench30 != null && series.benchmark && (
        <span>
          <span className="xs faint">vs {benchName(series.benchmark.symbol, series.benchmark)}</span> <Move value={bench30} /> <span className="xs faint">30 days</span>
        </span>
      )}
      <span className="xs faint">close {shortDate(lastBar.d)}</span>
    </div>
  );
  const chartPlaceholder =
    lastBar && bars.length > 1 ? (
      <div className="sr-chartph">
        {priceRow}
        <Spark closes={bars.map((b) => b.c)} width={600} height={160} />
      </div>
    ) : null;

  return (
    <div className="wrap sr-wrap">
      <ScreenHead
        className="sr-shead"
        kicker={
          <Link to="/board" className="backlink">
            ← Explore
          </Link>
        }
        title={
          <>
            {d.symbol} <span className="company">{d.theme}</span>
          </>
        }
        line={
          <>
            <span className="sr-lede">{lede}</span>
            {(full ? detailLines : detailLines.slice(0, 1)).map((line) => (
              <span className="sr-lede-d" key={line}>
                {line}
              </span>
            ))}
          </>
        }
        action={<NotifyButton symbol={d.symbol} />}
        secondary={
          <>
            <Pin symbol={d.symbol} pinned={pinned} onChange={(_, on) => setPinned(on)} label labels={[CTA.WATCH_FOR_ME, CTA.WATCHING]} />
            {atCap && (
              <button className="btn btn-secondary btn-sm" disabled={busy} onClick={swap} title="Stops watching your oldest name to make room">
                Replace my oldest name ({cap.used}/{cap.limit})
              </button>
            )}
            <Link to={compareHref} className="btn-quiet full-only">
              Compare
            </Link>
          </>
        }
      />

      <div className="sr-meta">
        <Link to={`/industries/${d.industry.key}`}>{d.industry.label}</Link>
        <span aria-hidden="true">·</span>
        <span>scored {scoredWhen(d.run.as_of, tz)}</span>
        {full && (
          <span className="sr-headfull">
            <span aria-hidden="true">·</span>
            <Monogram size={18}>{strat.monogram}</Monogram>
            <Link to={`/strategies/${strat.key}`} style={{ color: "inherit", fontWeight: 600 }}>
              {strat.label}
            </Link>
            <PlainStatusChip status={stratStatus} />
            <AgeChip asOf={d.run.as_of} />
            {d.lane ? <span className="chip chip-plain">stage {d.lane}</span> : null}
            {d.group ? <span className="chip chip-plain">group {d.group}</span> : null}
          </span>
        )}
        <span className="spacer" />
        <span className="sr-detail">
          <span className="xs faint">Detail</span>
          <ModeControl />
        </span>
      </div>

      {full && (
        <p className="utility">
          {history.length ? (
            <>
              We have scored <b>{d.symbol}</b> on <b>{plural(history.length, "run")}</b>
            </>
          ) : (
            <>
              <b>{d.symbol}</b> was not scored on this run
            </>
          )}
          {events.length ? (
            <>
              , and <b>{plural(events.length, "alert")}</b> fired on it in the last 120 days.
            </>
          ) : (
            <>; no alert has fired on it in the last 120 days.</>
          )}{" "}
          {armedN == null ? null : armedN ? (
            <>
              Alerts are on for <b>{plural(armedN, "fact")}</b> on it.
            </>
          ) : (
            <>No alert is on for it yet.</>
          )}
        </p>
      )}

      <div className="report">
        <div className="report-main stack">
          <PriceChart key={d.symbol} symbol={d.symbol} initialDays={90} placeholder={chartPlaceholder} />

          <div className="nextstep sr-next" role="note">
            <span className="nextstep-k">Next step</span>
            <span>{step.text}</span>
            {step.kind === "why" && (
              <>
                <span className="spacer" />
                <button
                  type="button"
                  className="btn-quiet"
                  onClick={() => {
                    const el = document.getElementById("why");
                    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                >
                  Read why ↓
                </button>
              </>
            )}
          </div>

          <section className="card sr-whycard" id="why" aria-labelledby="why-h">
            <div className="card-title">
              <h2 id="why-h">Why this score</h2>
              {s && (
                <span className="muted small">
                  {s.components_present} of {s.components_total} inputs had data
                </span>
              )}
            </div>
            {whyBullets.length > 0 ? (
              <ul className="sr-why">
                {whyBullets.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            ) : (
              <p className="sr-why-p">{s ? "No per-input detail was stored for this score." : "Nothing was scored, so there are no inputs to show."}</p>
            )}
            {s && (components.length > 0 || hardFilters.length > 0 || haircuts.length > 0) && (
              <details className="acc sr-showinputs" open={full}>
                <summary>
                  Show the inputs <span className="sum-note">{plural(components.length, "input")}{hardFilters.length ? `, ${plural(hardFilters.length, "must-pass rule")}` : ""}</span>
                </summary>
                <div className="acc-body">
                  {components.length > 0 && (
                    <ul className="sr-inputs" aria-label="Inputs">
                      {components.map((c) => {
                        const [kind, word] = inputStatus(c);
                        const term = termFor(c.key, c.label);
                        const assumed = typeof c.value === "string" && c.value.includes("(assumed)");
                        const name = inputName(c);
                        return (
                          <li key={c.key}>
                            <span className="lbl">
                              {full && term && GLOSSARY[term] ? <Explain term={term}>{name}</Explain> : name}
                              {assumed && c.backed !== false && (
                                <span className="judg">
                                  {" "}
                                  · <Explain term="assumed">assumed</Explain>
                                </span>
                              )}
                            </span>
                            {full && c.value != null && c.backed !== false && <span className="val">{String(c.value)}</span>}
                            <span className={`st st-${kind}`}>{word}</span>
                          </li>
                        );
                      })}
                      {missingComponents
                        .filter((m) => !components.some((c) => c.key === m.key))
                        .map((m) => (
                          <li key={`missing-${m.key}`} className="missing">
                            <span className="lbl">{inputName(m)}</span>
                            <span className="st st-none">no data</span>
                          </li>
                        ))}
                    </ul>
                  )}
                  {hardFilters.length > 0 && (
                    <>
                      <h3 className="sr-sub">Must-pass rules</h3>
                      <ul className="sr-hf" aria-label="Must-pass rules">
                        {hardFilters.map((f) => (
                          <li key={f.key}>
                            <span className="lbl">{plainRule(f)}</span>
                            <span className={`verdict ${f.pass ? "pass" : "fail"}`}>{f.pass ? "PASS" : "FAIL"}</span>
                          </li>
                        ))}
                      </ul>
                      <p className="hint">
                        A name that fails a rule is flagged FAIL and still rated.
                        {full && strat.calibrated ? (
                          <>
                            {" "}
                            The rules are the measured part: {EVIDENCE.hits} of {EVIDENCE.events} events that passed them moved ({EVIDENCE.hitRate}%).
                          </>
                        ) : null}
                      </p>
                    </>
                  )}
                  {haircuts.length > 0 && (
                    <section className="haircuts sr-haircuts" aria-labelledby="hc-h">
                      <h3 id="hc-h">Penalties</h3>
                      <ul>
                        {haircuts.map((h, i) => (
                          <li key={i}>
                            {h.label}
                            {h.evidence_url && (
                              <>
                                {" "}
                                <a href={h.evidence_url} target="_blank" rel="noreferrer">
                                  source
                                </a>
                              </>
                            )}
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                  <p className="hint">Lifted means the input pushed the score up; weighed means it pulled it down. Inputs with no data pulled the total toward neutral.</p>
                </div>
              </details>
            )}
          </section>

          {signedIn && <KnownCard key={d.symbol} rec={rec} symbol={d.symbol} simple={simple} full={full} cap={simple ? KNOWN_ROWS : KNOWN_ROWS_FULL} />}

          {full && whatChanged && <section className="card">{whatChanged}</section>}
          {full && <section className="card">{comingUp}</section>}

          {stratPlain && stratPlain.plain && stratPlain.plain.one_line && (
            <section className="card sr-strat" aria-labelledby="strat-h">
              <div className="card-title">
                <h2 id="strat-h">What {strat.label} looks for</h2>
                <Link to={`/strategies/${strat.key}`} className="small">
                  More about {strat.label} →
                </Link>
              </div>
              <StrategyPlainCard strategy={stratPlain} compact={simple} />
            </section>
          )}

          {simple ? (
            <details className="card sr-more">
              <summary>
                More detail <span className="sum-note">what changed, coming up, every input, key stats, other strategies, alerts, notes</span>
              </summary>
              <div className="sr-more-body">
                {whatChanged}
                {comingUp}
                {fullBreakdown}
                {keyStats}
                {inputsOverTime}
                {otherLenses}
                {alsoRanked}
                {alertsBlock}
                {notesBlock}
              </div>
            </details>
          ) : (
            <section className="card sr-details" aria-labelledby="more-h">
              <h2 id="more-h">More detail</h2>
              {fullBreakdown}
              {keyStats}
              {inputsOverTime}
              {otherLenses}
              {alsoRanked}
              {alertsBlock}
              {notesBlock}
            </section>
          )}

          {simple && (
            <details className="card sr-more sr-evidence">
              <summary>
                Evidence <span className="sum-note">data on file, this scoring, the strategy's record</span>
              </summary>
              <div className="sr-more-body">{evidenceBlocks}</div>
            </details>
          )}

          {foot}
        </div>

        {full && (
          <aside className="sidebar sr-side" aria-label="Evidence">
            <h2>Evidence</h2>
            {evidenceBlocks}
          </aside>
        )}
      </div>
    </div>
  );
}
