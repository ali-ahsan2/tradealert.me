import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { Link, navigate, useQuery } from "../lib/router.jsx";
import { useMe } from "../lib/me.jsx";
import { useMode } from "../lib/mode.js";
import { openUpgrade } from "../lib/upgrade.js";
import { HOME_ROWS } from "../lib/caps.js";
import { bestToldEvent, beyondPlanSentence, dayMonth, fetchRecord, missedCardSentence, toldCardLatest, toldCardSentence, toldHeadline } from "../lib/record.js";
import { prefersReducedMotion, useCountUp, useReveal } from "../lib/motion.js";
import { DAYS, age, dateTime, delta, plural, score as fmtScore, shortDate, signed, tone } from "../lib/fmt.js";
import { TRIGGER_PLAIN } from "../lib/glossary.js";
import { changeSentence, triggerLabel, triggerSentence } from "../lib/plain.js";
import ScoreBadge from "../components/ScoreBadge.jsx";
import BandBar from "../components/BandBar.jsx";
import Spark, { Move, MoveChip } from "../components/Spark.jsx";
import Icon from "../components/Icons.jsx";
import Explain from "../components/Explain.jsx";
import NotifyButton from "../components/NotifyButton.jsx";
import FinePrint from "../components/FinePrint.jsx";
import { YoudHaveKnown, YourRecord, withMoveColour } from "../components/RecordCard.jsx";
import { Empty, ErrorCard, Notice, Skeleton } from "../components/ui.jsx";
import "./overview.css";

// Home (DESIGN_V6 §4): what happened for me and what should I look at, in
// one glance. Above the fold: a greeting, one line with today's counts and
// one action, three equal cards (told me, I'd have known, coming up), one
// line of record, three rows of what changed. Then a quiet plan line, the
// how-it-works card until dismissed, and everything else inside one
// <details>, fetched on first open. Above the fold the page makes two
// requests: the overview payload and the record. Every figure comes from
// the API as stored; nothing here is computed from data the product does
// not hold, and nothing promises anything.

const HOW_KEY = "ta_how_done";
const RANGES = [
  ["1M", 30],
  ["3M", 90],
  ["1Y", 365],
];
const BAND_RANK = { strong: 4, elevated: 3, neutral: 2, weak: 1, excluded: 0 };

function readFlag(key) {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeFlag(key) {
  try {
    localStorage.setItem(key, "1");
  } catch {
    /* the card just won't be remembered */
  }
}

function stripParam(name) {
  const qs = new URLSearchParams(window.location.search);
  if (!qs.has(name)) return;
  qs.delete(name);
  const rest = qs.toString();
  navigate(`${window.location.pathname}${rest ? `?${rest}` : ""}`, { replace: true });
}

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// "Good morning, Ali." by the viewer's clock; the first word of the name.
function greeting(name) {
  const h = new Date().getHours();
  const part = h >= 5 && h < 12 ? "morning" : h >= 12 && h < 18 ? "afternoon" : "evening";
  const first = name ? String(name).trim().split(/\s+/)[0] : "";
  return first ? `Good ${part}, ${first}.` : `Good ${part}.`;
}

// "this morning's scoring" / "yesterday's scoring" / "the scoring on Aug 9",
// by the viewer's calendar day ("run" stays a Full-mode word).
function runWhen(asOf, tz) {
  const day = (t) => {
    try {
      return new Date(t).toLocaleDateString("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", ...(tz ? { timeZone: tz } : {}) });
    } catch {
      return new Date(t).toLocaleDateString("en-CA");
    }
  };
  const r = day(asOf);
  if (r === day(Date.now())) return "this morning's scoring";
  if (r === day(Date.now() - 864e5)) return "yesterday's scoring";
  return `the scoring on ${dayMonth(asOf)}`;
}

// "today", "tomorrow", "in 3 days", "yesterday", "4 days ago"
function inWords(days) {
  if (days == null) return "";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

// "2 hours ago", "3 days ago"; null when the stamp cannot be read
function agoWords(iso) {
  const a = age(iso);
  if (!a) return null;
  if (a.hours < 1) return "just now";
  if (a.hours < 48) return `${plural(Math.round(a.hours), "hour")} ago`;
  return `${plural(Math.round(a.hours / 24), "day")} ago`;
}

// A stored alert fact that is a key with underscores or a fixture tag is not
// a sentence; the trigger's plain sentence stands in for it.
function machineShaped(s) {
  return !s || /_/.test(s) || /^\W*(dev\s+)?fixture/i.test(s);
}

// Coverage for a pinned name: the pick row carries it; the stats row is the
// fallback. [present, total], or [undefined, undefined] when neither has it.
function pickCoverage(p, st) {
  if (p && p.components_total != null) return [p.components_present, p.components_total];
  if (st && st.components_total != null) return [st.components_present, st.components_total];
  return [undefined, undefined];
}

// Plain line for a pinned name: score since the pin date, then the next
// dated event on file. Facts only; no colour on score moves.
function pinSentence(p, st, tz) {
  const parts = [];
  const when = p.pinned_at ? ` on ${shortDate(p.pinned_at, tz)}` : "";
  const [cp, ct] = pickCoverage(p, st);
  if (p.value == null) parts.push("No score on this run.");
  else if (p.score_at_pin == null) parts.push(`Scores ${fmtScore(p.value, cp, ct)} now; no score was recorded when you pinned it.`);
  else {
    const r = Math.round(p.value - p.score_at_pin);
    if (r === 0) parts.push(`Unchanged since you pinned it${when}.`);
    else parts.push(`${r > 0 ? "Up" : "Down"} ${Math.abs(r)} point${Math.abs(r) === 1 ? "" : "s"} since you pinned it${when}.`);
  }
  if (st && st.earnings) parts.push(`Earnings ${inWords(st.earnings.days)}.`);
  return parts.join(" ");
}

function InlineError({ what, onRetry }) {
  return (
    <p className="muted brief-inline-err">
      Couldn't load {what}.{" "}
      {onRetry && (
        <button type="button" className="btn-quiet" onClick={onRetry}>
          Retry
        </button>
      )}
    </p>
  );
}

// Section shell: a card with a plain heading, a muted note and one link out.
function Section({ id, title, note, more, children, className = "", level = 2 }) {
  const H = level === 3 ? "h3" : "h2";
  return (
    <section className={`card brief-sec ${className}`} aria-labelledby={`${id}-h`} id={id}>
      <div className="brief-head">
        <div className="brief-head-l">
          <H id={`${id}-h`}>{title}</H>
          {note && <span className="sum-note">{note}</span>}
        </div>
        {more}
      </div>
      {children}
    </section>
  );
}

// A link label whose last word keeps the arrow beside it when the label
// wraps, so the arrow never sits alone on a line.
function Tail({ text }) {
  const i = text.lastIndexOf(" ");
  return (
    <>
      {i > 0 ? `${text.slice(0, i)} ` : ""}
      <span className="nowrap">
        {i > 0 ? text.slice(i + 1) : text}
        <Icon name="arrow" size={16} />
      </span>
    </>
  );
}

// One of the three cards: a big number that counts up once it is seen, one
// sentence, an optional short second line, one link. The number is a count
// of recorded events.
function SumCard({ id, title, n, say, sub = null, to, cta, loading = false, error = null, onRetry }) {
  const [ref, seen] = useReveal();
  const v = useCountUp(n == null ? 0 : n, { active: seen && !loading && !error });
  return (
    <section className={`card sumcard reveal ${seen ? "in" : ""}`} ref={ref} aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>{title}</h2>
      <div className="sum-body">
        {loading ? (
          <Skeleton rows={1} height={64} />
        ) : error ? (
          <InlineError what={title.toLowerCase()} onRetry={onRetry} />
        ) : (
          <>
            <p className="sum-n" aria-label={String(n)}>
              {v}
            </p>
            <p className="sum-say">{say}</p>
            {sub && <p className="sum-sub">{sub}</p>}
          </>
        )}
      </div>
      <Link to={to} className="sum-link">
        <Tail text={cta} />
      </Link>
    </section>
  );
}

// The line under the greeting: today's counts, every number a fact.
function TheLine({ d, locked, tz }) {
  const a = d.alerts;
  const c = d.changes;
  const cats = d.catalysts.next_14d;
  const parts = [];
  if (locked || a.limit === 0) {
    parts.push(
      a.fired_7d > 0 ? (
        <>
          <b>{a.fired_7d}</b> {a.fired_7d === 1 ? "alert" : "alerts"} fired in your {d.industries.length === 1 ? "industry" : "industries"} this week
        </>
      ) : (
        <>no alerts fired this week</>
      )
    );
  } else {
    parts.push(
      a.unread > 0 ? (
        <>
          <b>{a.unread}</b> {a.unread === 1 ? "alert" : "alerts"} for you
        </>
      ) : (
        <>no alerts waiting</>
      )
    );
  }
  if (c) {
    const moved = c.summary.band_up + c.summary.band_down;
    parts.push(
      moved > 0 ? (
        <>
          <b>{moved}</b> {moved === 1 ? "name" : "names"} changed rating
        </>
      ) : (
        <>no rating changes</>
      )
    );
  }
  parts.push(
    cats > 0 ? (
      <>
        <b>{cats}</b> {cats === 1 ? "date" : "dates"} in the next two weeks
      </>
    ) : (
      <>no dates in the next two weeks</>
    )
  );
  return (
    <p className="home-line">
      Since {runWhen(d.run.as_of, tz)}:{" "}
      {parts.map((p, i) => (
        <React.Fragment key={i}>
          {i > 0 ? ", " : ""}
          {p}
        </React.Fragment>
      ))}
      .
    </p>
  );
}

// How this works: the three sentences, shown until dismissed once per
// browser; the first visit (?welcome=1) titles it "Your first brief".
function HowCard({ welcome, onDone }) {
  return (
    <section className="card howcard" aria-labelledby="how-h">
      <div className="brief-head">
        <h2 id="how-h">{welcome ? "Your first brief" : "How this works"}</h2>
      </div>
      <ul className="how-list">
        <li>
          <span className="how-ic" aria-hidden="true">
            <Icon name="check" size={18} />
          </span>
          <span>I pick my industries.</span>
        </li>
        <li>
          <span className="how-ic" aria-hidden="true">
            <Icon name="search" size={18} />
          </span>
          <span>It watches every name in them, every morning.</span>
        </li>
        <li>
          <span className="how-ic" aria-hidden="true">
            <Icon name="alerts" size={18} />
          </span>
          <span>It tells me the day a fact changes, and keeps score of how early.</span>
        </li>
      </ul>
      <button type="button" className="btn btn-secondary btn-sm" onClick={onDone}>
        Got it
      </button>
    </section>
  );
}

// One row of what changed: symbol, theme, the plain sentence, the band word
// as text, one action. Full mode adds the before and after under it.
function ChangeRow({ r }) {
  return (
    <li className="brow">
      <div className="brow-main">
        <div className="brow-top">
          <Link className="sym" to={`/stock/${r.symbol}`}>
            {r.symbol}
          </Link>
          <span className="theme" title={r.theme}>
            {r.theme}
          </span>
        </div>
        <p className="brow-say">{changeSentence(r.delta, r.now && r.now.band, r.prev && r.prev.band)}</p>
        <div className="brow-detail full-only">
          {r.prev ? <ScoreBadge band={r.prev.band} value={r.prev.value} present={r.prev.present} total={r.prev.total} /> : <span className="chip chip-plain">not scored</span>}
          <span aria-hidden="true">→</span>
          {r.now ? <ScoreBadge band={r.now.band} value={r.now.value} present={r.now.present} total={r.now.total} /> : <span className="chip chip-plain">not scored</span>}
          {r.delta != null && <span>{delta(r.delta)} points</span>}
        </div>
      </div>
      <span className="bandword simple-only">{r.now ? cap(r.now.band) : "Not scored"}</span>
      <div className="brow-act">
        <NotifyButton symbol={r.symbol} compact label="Alert me" onLabel="Alerting me" />
      </div>
    </li>
  );
}

function IndexChart({ series, ghost, label }) {
  const pts = series || [];
  if (pts.length < 2) return null;
  const W = 800;
  const H = 240;
  const all = pts.concat(ghost || []).map((p) => p.v);
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const span = hi - lo || 1;
  const x = (i, n) => (i / (n - 1)) * W;
  const y = (v) => H - 8 - ((v - lo) / span) * (H - 16);
  const path = (s) => s.map((p, i) => `${i ? "L" : "M"}${x(i, s.length).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const d = path(pts);
  const up = pts[pts.length - 1].v >= pts[0].v;
  const base = y(100);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <line x1="0" x2={W} y1={base} y2={base} stroke="var(--border-strong)" strokeDasharray="0" strokeWidth="1" />
      {ghost && ghost.length > 1 && <path d={path(ghost)} fill="none" stroke="var(--ink-faint)" strokeWidth="1.5" opacity="0.6" />}
      <path d={`${d} L${W},${H} L0,${H} Z`} fill={up ? "var(--pos)" : "var(--neg)"} opacity="0.12" />
      <path d={d} fill="none" stroke={up ? "var(--pos)" : "var(--neg)"} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={W} cy={y(pts[pts.length - 1].v)} r="4" fill={up ? "var(--pos)" : "var(--neg)"} />
    </svg>
  );
}

// The rebased index: price context inside Markets, fetched when opened.
function Hero() {
  const [days, setDays] = useState(90);
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let alive = true;
    api(`/me/watchlist/series?days=${days}`)
      .then((x) => alive && setD(x))
      .catch((e) => alive && setErr(e));
    return () => {
      alive = false;
    };
  }, [days]);
  if (err) return null;
  if (!d) return <Skeleton rows={1} height={320} />;
  const hasWatch = d.watchlist.points.length > 1;
  const bench = d.benchmarks.filter((b) => b.points.length > 1);
  const main = hasWatch ? d.watchlist.points : bench[0] ? bench[0].points : [];
  const chg = hasWatch ? d.watchlist.change_pct : bench[0] ? bench[0].change_pct : null;
  const ghost = hasWatch && bench[0] ? bench[0].points : null;
  const title = hasWatch ? "My watchlist" : bench[0] ? bench[0].industry_label : "My names";
  return (
    <section className="card hero" aria-labelledby="hero-h">
      <div className="hero-top">
        <div>
          <div className="hero-label" id="hero-h">
            {title} · {RANGES.find(([, v]) => v === days)[0]}
          </div>
          <div className="hero-num">{chg == null ? "—" : <Move value={chg} digits={1} />}</div>
          <div className="hero-sub">
            {hasWatch ? (
              <>
                <span>{plural(d.watchlist.symbols.length, "pinned name")}, equal-weight</span>
                {bench[0] && bench[0].change_pct != null && (
                  <span>
                    vs {bench[0].symbol} <Move value={bench[0].change_pct} />
                  </span>
                )}
              </>
            ) : bench[0] ? (
              <span>
                {bench[0].symbol} · {bench[0].label}. Watch names and this becomes your own list.
              </span>
            ) : (
              <span>No bars on file yet.</span>
            )}
          </div>
        </div>
        <div className="seg" role="group" aria-label="Range">
          {RANGES.map(([l, v]) => (
            <button key={v} aria-pressed={days === v} onClick={() => setDays(v)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      {main.length > 1 ? (
        <div className="hero-chart">
          <IndexChart series={main} ghost={ghost} label={`${title}, rebased to 100, ${days} days`} />
        </div>
      ) : (
        <p className="muted small" style={{ marginTop: "var(--s-4)" }}>
          Nothing to chart yet. <Link to="/board">Watch a few names from Explore</Link> and this becomes your list.
        </p>
      )}
      <div className="hero-foot">
        <span className="hero-legend">
          <i /> {hasWatch ? "your watchlist" : title}
        </span>
        {ghost && (
          <span className="hero-legend">
            <i className="ghost" /> {bench[0].symbol}
          </span>
        )}
        <span>rebased to 100 at the start of the window · relative movement, not a balance</span>
        {bench.length > 1 && (
          <span>
            also following:{" "}
            {bench.slice(1).map((b) => (
              <span key={b.symbol} style={{ marginRight: 10 }}>
                {b.symbol} <Move value={b.change_pct} />
              </span>
            ))}
          </span>
        )}
      </div>
    </section>
  );
}

function NameLine({ r, right, href }) {
  return (
    <li className="nameline">
      <Link className="sym" to={href || `/stock/${r.symbol}`}>
        {r.symbol}
      </Link>
      <span className="theme muted small" title={r.theme}>
        {r.theme}
      </span>
      <span className="spacer" />
      {right}
    </li>
  );
}

// Markets: the rebased index, the biggest 30-day moves and the industry
// cards. Mounted on first open, so its three requests wait until asked for.
function Markets({ d, K, reload }) {
  const [screen, setScreen] = useState(null);
  useEffect(() => {
    let alive = true;
    // movers: the biggest 30-day price moves among the names on the board,
    // fetched from both ends so the strip shows real decliners (the server
    // clamps each list to the plan's names_shown_limit)
    Promise.allSettled([api("/screen?sort=chg30&limit=6"), api("/screen?sort=chg30&dir=asc&limit=4")]).then(([u, dn]) => {
      if (!alive) return;
      setScreen({
        up: u.status === "fulfilled" ? u.value : { rows: [], meta: {} },
        down: dn.status === "fulfilled" ? dn.value : { rows: [], meta: {} },
      });
    });
    return () => {
      alive = false;
    };
  }, [reload]);

  const movers = useMemo(() => {
    if (!screen) return [];
    const priced = (x) => ((x && x.rows) || []).filter((r) => r.price && r.price.chg_30d != null);
    const up = priced(screen.up).filter((r) => r.price.chg_30d > 0);
    const down = priced(screen.down).filter((r) => r.price.chg_30d < 0);
    const seen = new Set();
    return [...up, ...down].filter((r) => !seen.has(r.symbol) && seen.add(r.symbol));
  }, [screen]);
  // caption only on a genuine plan clamp (matched beyond the names the plan shows), not on our own limit
  const planClamped = (m) => Boolean(m && m.names_shown_limit != null && m.matched > m.names_shown_limit);
  const moversClamped = Boolean(screen && (planClamped(screen.up.meta) || planClamped(screen.down.meta)));

  return (
    <div className="acc-body">
      <Hero />

      {movers.length > 0 && (
        <>
          <div className="section-head">
            <h3>Biggest price moves, 30 days</h3>
            <span className="muted small">{moversClamped ? "among the names your plan shows" : "among your names"} · daily closes</span>
          </div>
          <div className="movers-row">
            {movers.map((r) => (
              <Link key={r.symbol} to={`/stock/${r.symbol}`} className="mover-card">
                <span className="sym">{r.symbol}</span>
                <span className="theme">{r.theme}</span>
                <Spark closes={r.price.closes} width={140} height={36} />
                <Move value={r.price.chg_30d} />
                <span className="xs faint">
                  {r.band} {fmtScore(r.value, r.components_present, r.components_total)}
                </span>
              </Link>
            ))}
          </div>
        </>
      )}

      <section className="section" aria-labelledby="ov-ind" style={{ marginTop: 0 }}>
        <div className="section-head">
          <h3 id="ov-ind">My industries</h3>
          <span className="muted small">this morning's scoring · the top {Math.min(3, K)} names in each</span>
        </div>
        <div className="ovgrid">
          {d.industries.map((ind) => (
            <article className="card ovind" key={ind.key}>
              <div className="ovind-head">
                <Link to={`/industries/${ind.key}`} className="ovind-title">
                  {ind.label}
                </Link>
                {ind.benchmark && (
                  <span className="row" style={{ gap: 8 }}>
                    <Spark closes={ind.benchmark.closes} width={64} height={22} />
                    <span className="xs faint">{ind.benchmark.symbol}</span>
                    <MoveChip value={ind.benchmark.chg_30d} />
                  </span>
                )}
              </div>
              <BandBar distribution={ind.distribution} />
              <div className="ovind-facts xs faint">
                <span>{ind.scored} scored</span>
                <span>{ind.cleared} passed every must-pass rule</span>
                {ind.new > 0 && <span>{ind.new} new</span>}
              </div>
              <ul className="namelist">
                {ind.top.map((r) => (
                  <NameLine
                    key={r.symbol}
                    r={r}
                    right={
                      <>
                        {r.delta_1d != null && (
                          <span className="xs faint full-only nowrap" title="since the last run">
                            {delta(r.delta_1d)} since last run
                          </span>
                        )}
                        <ScoreBadge band={r.band} value={r.value} present={r.components_present} total={r.components_total} />
                      </>
                    }
                  />
                ))}
              </ul>
              <div className="ovind-links small">
                <Link to={`/board?industry=${ind.key}`}>Board</Link>
                <Link to={`/screen?industries=${ind.key}`}>Find</Link>
                <Link to={`/industries/${ind.key}`}>Industry</Link>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

// Everything below the fold: the alerts that fired, the full "I'd have
// known" and record lists, coming up, the watchlist and Markets. Mounted on
// the first open of "More on my names", so its requests wait until then.
function MoreOnMyNames({ d, record, recErr, onRecRetry, locked, tz, full, K, reload }) {
  const [events, setEvents] = useState(null);
  const [eventsErr, setEventsErr] = useState(null);
  const [evReload, setEvReload] = useState(0);
  const [picks, setPicks] = useState(null);
  const [picksErr, setPicksErr] = useState(null);
  const [stats, setStats] = useState(null);
  const [wlReload, setWlReload] = useState(0);
  const [mktOpen, setMktOpen] = useState(full);
  const [mktSeen, setMktSeen] = useState(full);
  useEffect(() => setMktOpen(full), [full]);
  useEffect(() => {
    if (mktOpen) setMktSeen(true);
  }, [mktOpen]);

  useEffect(() => {
    if (locked) return undefined;
    let alive = true;
    setEvents(null);
    setEventsErr(null);
    api("/alert-events?days=30&limit=20")
      .then((x) => alive && setEvents(x.events || []))
      .catch((e) => alive && setEventsErr(e));
    return () => {
      alive = false;
    };
  }, [locked, reload, evReload]);

  useEffect(() => {
    let alive = true;
    setPicksErr(null);
    api("/me/picks")
      .then((x) => alive && setPicks(x.picks || []))
      .catch((e) => alive && setPicksErr(e));
    api("/me/watchlist/stats")
      .then((x) => alive && setStats(x))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [reload, wlReload]);

  const recentEvents = useMemo(() => {
    if (!events) return null;
    return [...events].sort((a, b) => ((a.read === false) === (b.read === false) ? new Date(b.fired_at) - new Date(a.fired_at) : a.read === false ? -1 : 1));
  }, [events]);
  // Alerts sent to this account lead; the ones that merely fired across the
  // subscriber's industries are a count, the same split the Alerts page makes.
  const sentEvents = recentEvents ? recentEvents.filter((ev) => ev.channels && ev.channels.length) : null;
  const eventRows = recentEvents ? (sentEvents.length ? sentEvents : recentEvents).slice(0, HOME_ROWS) : null;
  const otherCount = recentEvents && sentEvents ? recentEvents.length - sentEvents.length : 0;

  const statBySym = useMemo(() => Object.fromEntries(((stats && stats.picks) || []).map((p) => [p.symbol, p])), [stats]);
  const topPinned = useMemo(() => {
    if (!picks || picks.length === 0) return null;
    return [...picks].sort((a, b) => (BAND_RANK[b.band] ?? -1) - (BAND_RANK[a.band] ?? -1) || (b.value ?? -1) - (a.value ?? -1))[0];
  }, [picks]);
  const pickRows = picks && picks.slice(0, HOME_ROWS);

  const markRead = (ev) => {
    if (ev.read !== false || !ev.id) return;
    api("/me/alerts/read", { method: "POST", json: { event_id: ev.id } })
      .then(() => {
        setEvents((xs) => (xs || []).map((x) => (x.id === ev.id ? { ...x, read: true } : x)));
        window.dispatchEvent(new Event("alerts:read"));
      })
      .catch(() => {});
  };

  const a = d.alerts;
  const w = d.watchlist;
  // coming up: dated events ahead first, nearest first
  const upcoming = [...(d.catalysts.upcoming || [])].sort((x, y) => x.days - y.days);
  const ahead = upcoming.filter((r) => r.days >= 0);
  const calRows = (ahead.length ? ahead : upcoming).slice(0, HOME_ROWS);
  const calTotal = d.catalysts.next_14d;

  return (
    <div className="acc-body">
      {/* Alerts that fired ------------------------------------------------ */}
      <Section
        id="more-alerts"
        level={3}
        title="Alerts that fired"
        note={locked ? null : "last 30 days, unread first"}
        more={
          !locked && recentEvents && recentEvents.length > 0 ? (
            <Link to="/alerts" className="more-all">
              {recentEvents.length > (eventRows || []).length ? `Show all ${recentEvents.length}` : "My alerts"}
            </Link>
          ) : null
        }
      >
        {locked ? (
          <div className="brief-locked">
            <p>
              Your plan does not send alerts yet. This week <b>{a.fired_7d}</b> {a.fired_7d === 1 ? "alert" : "alerts"} fired on <b>{a.fired_7d_names}</b>{" "}
              {a.fired_7d_names === 1 ? "name" : "names"} in your {d.industries.length === 1 ? "industry" : "industries"}.
            </p>
            <div className="actrow">
              <button type="button" className="btn btn-primary btn-sm" onClick={() => openUpgrade("alerts")}>
                Show me plans with alerts
              </button>
            </div>
          </div>
        ) : eventsErr ? (
          <InlineError what="recent alerts" onRetry={() => setEvReload((n) => n + 1)} />
        ) : !recentEvents ? (
          <Skeleton rows={2} height={56} />
        ) : recentEvents.length === 0 ? (
          <div className="brief-empty">
            <p>
              Nothing fired on your names in the last 30 days.{" "}
              {a.armed > 0 ? `You have ${plural(a.armed, "alert")} armed.` : "You have asked for no alerts yet."}
            </p>
            <div className="actrow">
              {topPinned ? (
                <>
                  <NotifyButton symbol={topPinned.symbol} compact label="Alert me" onLabel="Alerting me" />
                  <span className="xs faint">{triggerSentence("catalyst_dated", topPinned.symbol)}</span>
                </>
              ) : (
                <Link to="/board" className="btn btn-secondary btn-sm">
                  Watch a name for me
                </Link>
              )}
            </div>
          </div>
        ) : (
          <>
            <ul className="brows">
              {eventRows.map((ev) => {
                const unread = ev.read === false;
                const ago = agoWords(ev.fired_at);
                return (
                  <li className={`brow ${unread ? "unread" : ""}`} key={ev.id}>
                    <div className="brow-main">
                      <div className="brow-top">
                        {unread && <span className="brow-dot" aria-label="Unread" />}
                        <Link className="sym" to={`/stock/${ev.symbol}`} onClick={() => markRead(ev)}>
                          {ev.symbol}
                        </Link>
                        <Explain
                          title={TRIGGER_PLAIN[ev.trigger_key] ? TRIGGER_PLAIN[ev.trigger_key][0] : undefined}
                          text={TRIGGER_PLAIN[ev.trigger_key] ? `We tell you when ${TRIGGER_PLAIN[ev.trigger_key][1]}.` : undefined}
                        >
                          <span className="chip chip-plain">{triggerLabel(ev.trigger_key)}</span>
                        </Explain>
                        <span className="when" title={dateTime(ev.fired_at, tz)}>
                          {ago || shortDate(ev.fired_at, tz)}
                        </span>
                      </div>
                      <p className="brow-say">{machineShaped(ev.detail) ? triggerSentence(ev.trigger_key, ev.symbol) : ev.detail}</p>
                      <div className="brow-detail full-only">
                        {ev.theme ? <span>{ev.theme}</span> : null}
                        <span>
                          {ev.channels && ev.channels.length
                            ? `delivered by ${ev.channels.join(", ")}${ev.delivered_at ? ` · ${shortDate(ev.delivered_at, tz)}` : ""}`
                            : "not armed on your account; shown because the name is in your industries"}
                        </span>
                      </div>
                    </div>
                    <div className="brow-act">
                      <Link to={`/stock/${ev.symbol}`} className="btn btn-secondary btn-sm" onClick={() => markRead(ev)}>
                        Read it
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
            {sentEvents.length > 0 && otherCount > 0 && (
              <p className="brief-line">
                {otherCount} more fired in your industries on names you weren't watching. <Link to="/alerts?tab=outcomes">Show me</Link>.
              </p>
            )}
          </>
        )}
      </Section>

      {/* What I'd have known: the misses, with the lead time ----------- */}
      <Section
        id="more-known"
        level={3}
        title="What I'd have known"
        note="alerts on names you weren't watching, last 30 days"
        more={
          <Link to="/alerts?tab=outcomes" className="more-all">
            Show me what I missed
          </Link>
        }
      >
        {recErr ? <InlineError what="your record" onRetry={onRecRetry} /> : !record ? <Skeleton rows={2} height={56} /> : <YoudHaveKnown record={record} />}
      </Section>

      {/* My record: told, then what the price did ------------------------ */}
      <Section
        id="more-record"
        level={3}
        title="My record"
        note="what you were told, and the five sessions after"
        more={
          <Link to="/alerts?tab=outcomes" className="more-all">
            My record
          </Link>
        }
      >
        {recErr ? <InlineError what="your record" onRetry={onRecRetry} /> : !record ? <Skeleton rows={2} height={56} /> : <YourRecord record={record} topPinned={topPinned} canAlert={!locked} />}
        {record && record.method && <p className="brief-line full-only">{record.method}</p>}
      </Section>

      {/* Coming up ------------------------------------------------------- */}
      <Section
        id="more-cal"
        level={3}
        title="Coming up"
        note="dated events in the next 14 days"
        more={
          <Link to="/calendar?days=14" className="more-all">
            {calTotal > calRows.length ? `Show all ${calTotal}` : "See the calendar"}
          </Link>
        }
      >
        {calRows.length === 0 ? (
          <p className="brief-line">No dated event on file for your names in the next two weeks. A name with no date on file is not listed.</p>
        ) : (
          <ul className="brows">
            {calRows.map((r) => (
              <li className="brow brow-cal" key={`${r.symbol}-${r.date}`}>
                <div className="brow-main">
                  <div className="brow-top">
                    <Link className="sym" to={`/stock/${r.symbol}`}>
                      {r.symbol}
                    </Link>
                    <span className="theme" title={r.theme}>
                      {r.theme}
                    </span>
                  </div>
                  <p className="brow-say">
                    Earnings {inWords(r.days)}, {dayMonth(r.date)}.{r.armed ? " You asked to be alerted." : ""}
                    {r.pinned ? " Watching." : ""}
                    {r.confidence ? <span className="full-only"> Date {r.confidence}.</span> : null}
                  </p>
                </div>
                <span className="bandword simple-only">{r.band ? cap(r.band) : "No score"}</span>
                <div className="brow-act full-only">
                  {r.band ? <ScoreBadge band={r.band} value={r.value} present={r.components_present} total={r.components_total} /> : <span className="chip chip-plain">No score</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
        {calTotal > K && (
          <p className="brief-line">
            Your plan shows the top {K} of them.{" "}
            <button type="button" className="btn-quiet hint-up" onClick={() => openUpgrade("names")}>
              See what the next plan lists
            </button>
          </p>
        )}
      </Section>

      {/* My watchlist ---------------------------------------------------- */}
      <Section
        id="more-wl"
        level={3}
        title="My watchlist"
        note={w.count > 0 ? (w.limit != null ? `${w.count} of ${w.limit} pins` : plural(w.count, "pin")) : null}
        more={
          picks && picks.length > 0 ? (
            <Link to="/watchlist" className="more-all">
              {picks.length > HOME_ROWS ? `Show all ${picks.length}` : "My watchlist"}
            </Link>
          ) : null
        }
      >
        {picksErr ? (
          <InlineError what="your watchlist" onRetry={() => setWlReload((n) => n + 1)} />
        ) : !picks ? (
          <Skeleton rows={2} height={56} />
        ) : picks.length === 0 ? (
          <div className="brief-empty">
            <p>
              Nothing watched yet. A watched name stays on this page and in your weekly brief.
              {w.limit != null ? ` Your plan holds ${plural(w.limit, "pin")}.` : ""}
            </p>
            <div className="actrow">
              <Link to="/board" className="btn btn-secondary btn-sm">
                Show me the Board
              </Link>
            </div>
          </div>
        ) : (
          <ul className="brows">
            {pickRows.map((p) => {
              const st = statBySym[p.symbol];
              const [cp, ct] = pickCoverage(p, st);
              return (
                <li className="brow" key={p.symbol}>
                  <div className="brow-main">
                    <div className="brow-top">
                      <Link className="sym" to={`/stock/${p.symbol}`}>
                        {p.symbol}
                      </Link>
                      <span className="theme" title={p.theme}>
                        {p.theme}
                      </span>
                      {st && st.unread > 0 && (
                        <Link to={`/alerts?symbol=${p.symbol}&unread=1`} className="chip chip-plain">
                          {st.unread} unread
                        </Link>
                      )}
                    </div>
                    <p className="brow-say">{pinSentence(p, st, tz)}</p>
                    {st && (
                      <div className="brow-detail full-only">
                        {st.closes && st.closes.length > 1 && <Spark closes={st.closes} width={90} height={24} />}
                        {st.chg_30d != null && (
                          <span>
                            30d <Move value={st.chg_30d} />
                          </span>
                        )}
                        {st.chg_since_pin != null && (
                          <span>
                            since pin <b className={tone(st.chg_since_pin)}>{signed(st.chg_since_pin, 1, "%")}</b>
                            {st.benchmark_chg_since_pin != null ? (
                              <>
                                {" "}
                                vs {st.benchmark} <span className={tone(st.benchmark_chg_since_pin)}>{signed(st.benchmark_chg_since_pin, 1, "%")}</span>
                              </>
                            ) : null}
                          </span>
                        )}
                        {p.band && ct != null && <ScoreBadge band={p.band} value={p.value} present={cp} total={ct} />}
                      </div>
                    )}
                  </div>
                  <span className="bandword simple-only">{p.band ? cap(p.band) : "No score"}</span>
                  <div className="brow-act">
                    <NotifyButton symbol={p.symbol} compact label="Alert me" onLabel="Alerting me" />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {/* Markets: price context, folded --------------------------------- */}
      <details className="acc mkt" open={mktOpen} onToggle={(e) => setMktOpen(e.currentTarget.open)}>
        <summary>
          <h3>Markets</h3>
          <span className="sum-note">your pins as an index, the biggest 30-day moves, your industries</span>
        </summary>
        {mktSeen && <Markets d={d} K={K} reload={reload} />}
      </details>
    </div>
  );
}

export default function Overview() {
  const { me } = useMe();
  const { full } = useMode();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [reload, setReload] = useState(0);

  // the record: told, missed, beyond (DESIGN_V5 §3)
  const [record, setRecord] = useState(null);
  const [recErr, setRecErr] = useState(null);
  const [recReload, setRecReload] = useState(0);

  // ?welcome=1 (set by onboarding) titles the how-it-works card "Your first
  // brief"; the card itself shows until dismissed once per browser
  const q = useQuery();
  const welcome = q.get("welcome") === "1";
  const [howDone, setHowDone] = useState(() => readFlag(HOW_KEY));
  const dismissHow = () => {
    setHowDone(true);
    writeFlag(HOW_KEY);
    stripParam("welcome");
  };
  const showHow = welcome || !howDone;

  // ?verified=1: one line, then the flag leaves the address bar
  const [verifiedNote, setVerifiedNote] = useState(() => new URLSearchParams(window.location.search).get("verified") === "1");
  useEffect(() => {
    if (verifiedNote) stripParam("verified");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // everything below the fold: closed in Simple, open in Full, mounted on
  // the first open so its requests wait until then
  const [moreOpen, setMoreOpen] = useState(full);
  const [moreSeen, setMoreSeen] = useState(full);
  useEffect(() => setMoreOpen(full), [full]);
  useEffect(() => {
    if (moreOpen) setMoreSeen(true);
  }, [moreOpen]);

  const locked = Boolean(me && me.tier && me.tier.alerts_limit === 0);
  const tz = me && me.settings ? me.settings.timezone : undefined;

  useEffect(() => {
    let alive = true;
    setErr(null);
    api("/overview")
      .then((x) => alive && setD(x))
      .catch((e) => alive && setErr(e));
    return () => {
      alive = false;
    };
  }, [reload]);

  useEffect(() => {
    let alive = true;
    setRecErr(null);
    fetchRecord(30)
      .then((x) => alive && setRecord(x))
      .catch((e) => alive && setRecErr(e));
    return () => {
      alive = false;
    };
  }, [reload, recReload]);

  // a plan change made in the upgrade sheet (sandbox) re-briefs in place
  useEffect(() => {
    const onPlan = () => setReload((n) => n + 1);
    window.addEventListener("plan:changed", onPlan);
    return () => window.removeEventListener("plan:changed", onPlan);
  }, []);

  const hello = greeting(me && me.name);

  if (err) {
    return (
      <div className="wrap wrap-narrow">
        <ErrorCard error={err} onRetry={() => setReload((n) => n + 1)} title="Couldn't load your brief." />
      </div>
    );
  }
  if (!d) {
    return (
      <div className="wrap brief">
        <header className="home-head">
          <h1>{hello}</h1>
          <Skeleton rows={1} height={28} />
        </header>
        <div className="home-sk three">
          <Skeleton rows={1} height={150} />
          <Skeleton rows={1} height={150} />
          <Skeleton rows={1} height={150} />
        </div>
        <Skeleton rows={3} height={56} />
      </div>
    );
  }

  const run = d.run;
  const a = d.alerts;
  const K = d.tier ? d.tier.names_shown_limit : 5;
  const noIndustries = d.industries.length === 0;

  const verified = verifiedNote && (
    <Notice tone="pos" className="home-notice" onDismiss={() => setVerifiedNote(false)}>
      <p>Email verified. Alerts are live.</p>
    </Notice>
  );

  // One line and one button: the page cannot brief without industries.
  if (noIndustries) {
    return (
      <div className="wrap brief">
        {verified}
        <header className="home-head">
          <h1>{hello}</h1>
          <p className="home-line">You follow no industries yet, so there is nothing to brief.</p>
          <div className="home-cta">
            <Link to="/onboarding" className="btn btn-primary">
              Pick my industries <Icon name="arrow" size={16} />
            </Link>
          </div>
        </header>
        {showHow && <HowCard welcome={welcome} onDone={dismissHow} />}
      </div>
    );
  }

  if (!run) {
    return (
      <div className="wrap brief">
        {verified}
        <header className="home-head">
          <h1>{hello}</h1>
          <p className="home-line">No morning run has completed yet. Your brief fills after the first one.</p>
        </header>
        <Empty title="Nothing scored yet.">The engine runs each morning; what changed, the alerts and the dates ahead appear here after it.</Empty>
        {showHow && <HowCard welcome={welcome} onDone={dismissHow} />}
      </div>
    );
  }

  // The one action, by urgency: unread alerts; else a dated event on a name
  // you watch; else the first change on the page.
  const upcoming = d.catalysts.upcoming || [];
  const watchedEvent = upcoming.find((r) => r.days >= 0 && (r.pinned || r.armed));
  const scrollToChanged = () => {
    const el = document.getElementById("changed");
    if (el) el.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  };
  let primary;
  if (!locked && a.unread > 0) {
    primary = (
      <Link to="/alerts" className="btn btn-primary">
        Read my alerts <Icon name="arrow" size={16} />
      </Link>
    );
  } else if (watchedEvent) {
    primary = (
      <Link to="/calendar?days=14" className="btn btn-primary">
        See what's coming <Icon name="arrow" size={16} />
      </Link>
    );
  } else {
    primary = (
      <button type="button" className="btn btn-primary" onClick={scrollToChanged}>
        Show me what changed
      </button>
    );
  }

  // the three cards
  const recLoading = !record && !recErr;
  const told = record ? record.told : null;
  const missed = record ? record.missed : null;
  const cats = d.catalysts.next_14d;
  const nearest = [...upcoming].sort((x, y) => x.days - y.days).find((r) => r.days >= 0) || null;
  const comingSay = cats === 0 ? "No dated event on file in the next two weeks." : `${plural(cats, "date")} in the next two weeks.`;
  const comingSub = cats > 0 && nearest ? `Nearest: ${nearest.symbol} earnings ${inWords(nearest.days)}.` : null;

  // one line of record, only once a told alert has been measured
  const recordLine = told && bestToldEvent(told) ? toldHeadline(told) : null;

  // what changed: the overview's own top names each way; the rest is a count
  const c = d.changes;
  const changeRows = c ? [...c.band_up, ...c.band_down].slice(0, HOME_ROWS) : [];
  const changeTotal = c ? c.summary.band_up + c.summary.band_down : 0;

  // my plan: the industries the plan watches, and what fired in the others
  const tier = me && me.tier;
  const followed = d.industries.length;
  const limit = tier ? tier.industries_limit : null;
  const showPlan = Boolean(tier) && limit != null && limit < 999;
  const planFirst =
    limit != null && followed < limit
      ? `Your plan watches up to ${plural(limit, "industry", "industries")}; you follow ${followed}.`
      : `Your plan watches ${plural(followed, "industry", "industries")}.`;
  const planSecond = record ? beyondPlanSentence(record.beyond) : null;

  return (
    <div className="wrap brief">
      {verified}

      {/* 1. The greeting, the line, one action --------------------------- */}
      <header className="home-head">
        <h1>{hello}</h1>
        <TheLine d={d} locked={locked} tz={tz} />
        <div className="home-cta">{primary}</div>
      </header>

      {/* 2. Three cards --------------------------------------------------- */}
      <div className="sumgrid">
        <SumCard
          id="sum-told"
          title="Told me"
          n={locked ? 0 : told ? told.summary.fired : null}
          say={toldCardSentence(told, { locked })}
          sub={locked ? null : toldCardLatest(told)}
          to="/alerts"
          cta="My alerts"
          loading={!locked && recLoading}
          error={!locked && recErr ? recErr : null}
          onRetry={() => setRecReload((n) => n + 1)}
        />
        <SumCard
          id="sum-missed"
          title="I'd have known"
          n={missed ? missed.summary.fired : null}
          say={missedCardSentence(missed)}
          to="/alerts?tab=outcomes"
          cta="Show me what I missed"
          loading={recLoading}
          error={recErr}
          onRetry={() => setRecReload((n) => n + 1)}
        />
        <SumCard id="sum-cal" title="Coming up" n={cats} say={comingSay} sub={comingSub} to="/calendar?days=14" cta="See the calendar" />
      </div>

      {/* 3. My record, one line ------------------------------------------- */}
      {recordLine && (
        <div className="home-record">
          <p>{withMoveColour(recordLine)}</p>
          <Link to="/alerts?tab=outcomes" className="more-all">
            <Tail text="My record" />
          </Link>
        </div>
      )}

      {/* 4. What changed, three rows -------------------------------------- */}
      <Section
        id="changed"
        title="What changed"
        note={c && c.prev_as_of ? `since the scoring on ${dayMonth(c.prev_as_of)}` : null}
        more={
          changeTotal > changeRows.length ? (
            <Link to="/changes" className="more-all">
              Show all {changeTotal}
            </Link>
          ) : null
        }
      >
        {!c && <p className="brief-line">Only one run is on record. Changes appear once a second run completes.</p>}
        {c && changeRows.length === 0 && (
          <p className="brief-line">
            No name changed rating since the last scoring.
            {c.summary ? ` ${c.summary.up} scores went up and ${c.summary.down} went down without changing rating.` : ""}
          </p>
        )}
        {changeRows.length > 0 && (
          <ul className="brows">
            {changeRows.map((r) => (
              <ChangeRow r={r} key={r.symbol} />
            ))}
          </ul>
        )}
        {c && changeTotal > K && (
          <p className="brief-line">
            Your plan lists the top {K} of them.{" "}
            <button type="button" className="btn-quiet hint-up" onClick={() => openUpgrade("names")}>
              See what the next plan lists
            </button>
          </p>
        )}
      </Section>

      {/* 5. My plan, quiet ------------------------------------------------- */}
      {showPlan && (
        <div className="home-plan">
          <p>
            {planFirst}
            {planSecond ? ` ${planSecond}` : ""}
          </p>
          <button type="button" className="linkbtn" onClick={() => openUpgrade("beyond")}>
            See what the next plan watches
          </button>
        </div>
      )}

      {/* 6. How this works, until dismissed -------------------------------- */}
      {showHow && <HowCard welcome={welcome} onDone={dismissHow} />}

      {/* 7. Everything else, behind one details ---------------------------- */}
      <details className="acc more" open={moreOpen} onToggle={(e) => setMoreOpen(e.currentTarget.open)}>
        <summary>
          <h2>More on my names</h2>
          <span className="sum-note">the alerts that fired, what you'd have known, your record, coming up, your watchlist, markets</span>
        </summary>
        {moreSeen && (
          <MoreOnMyNames
            d={d}
            record={record}
            recErr={recErr}
            onRecRetry={() => setRecReload((n) => n + 1)}
            locked={locked}
            tz={tz}
            full={full}
            K={K}
            reload={reload}
          />
        )}
      </details>

      <div className="footnote">
        <p>
          Rated at {dateTime(run.as_of, tz)}; price moves from daily closes.{" "}
          {d.digest && (
            <>
              {d.digest.enabled
                ? `Weekly brief: ${DAYS[d.digest.day]} at ${String(d.digest.hour).padStart(2, "0")}:00 ${d.digest.timezone}.`
                : "Weekly brief is off."}{" "}
              <Link to="/digests">Preview</Link> · <Link to="/settings#digest">Change</Link>.
            </>
          )}
        </p>
        <FinePrint short />
      </div>
    </div>
  );
}
