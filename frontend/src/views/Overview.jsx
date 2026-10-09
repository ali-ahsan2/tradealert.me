import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { Link } from "../lib/router.jsx";
import { useMe } from "../lib/me.jsx";
import { useMode } from "../lib/mode.js";
import { DAYS, age, dateTime, delta, inDays, plural, score as fmtScore, shortDate, signed, tone } from "../lib/fmt.js";
import { changeSentence, nextStep, triggerLabel, triggerSentence } from "../lib/plain.js";
import ScoreBadge from "../components/ScoreBadge.jsx";
import BandBar from "../components/BandBar.jsx";
import Spark, { Move, MoveChip } from "../components/Spark.jsx";
import Icon from "../components/Icons.jsx";
import Pin from "../components/Pin.jsx";
import Explain from "../components/Explain.jsx";
import NotifyButton from "../components/NotifyButton.jsx";
import { AgeChip, Empty, ErrorCard, Skeleton } from "../components/ui.jsx";
import "./overview.css";

// Home as a daily brief (DESIGN_V4.md §6). The page reads top to bottom
// the way an assistant would tell it: what changed on your names since
// the previous run, the alerts that fired, the dated events ahead, your
// pinned names, one next step. The rebased index, the movers and the
// industry cards stay, folded under "Markets" as price context: closed by
// default in Simple mode, open in Full. Every figure comes from the API
// as stored; nothing here is computed from data the product does not hold.

const RANGES = [
  ["1M", 30],
  ["3M", 90],
  ["1Y", 365],
];

const PREVIEW_ROWS = 6;
const BAND_RANK = { strong: 4, elevated: 3, neutral: 2, weak: 1, excluded: 0 };

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

// The rebased index: unchanged from v4 §2.5, now context under "Markets".
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
  const title = hasWatch ? "Your watchlist" : bench[0] ? bench[0].industry_label : "Your universe";
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
                {bench[0].symbol} · {bench[0].label}. Pin names to track your own list here.
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
          Nothing to chart yet. <Link to="/board">Pin a few names from the Board</Link> and this becomes your list.
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

// Section shell: a card with a plain heading, a muted note and one link out.
function Section({ id, title, note, more, children }) {
  return (
    <section className="card brief-sec" aria-labelledby={id}>
      <div className="brief-head">
        <div className="brief-head-l">
          <h2 id={id}>{title}</h2>
          {note && <span className="sum-note">{note}</span>}
        </div>
        {more}
      </div>
      {children}
    </section>
  );
}

function InlineError({ what, onRetry }) {
  return (
    <p className="muted small brief-inline-err">
      Couldn't load {what}.{" "}
      {onRetry && (
        <button type="button" className="btn-quiet" onClick={onRetry}>
          Retry
        </button>
      )}
    </p>
  );
}

// One sentence with the subscriber's own figures, under the title.
function Utility({ d, locked }) {
  const run = d.run;
  const inds = d.industries.length;
  if (!run) {
    return (
      <p className="utility">
        No completed <Explain term="run">run</Explain> yet. What changed, the alerts that fired and the events ahead appear here after the first run completes.
      </p>
    );
  }
  if (inds === 0) {
    return (
      <p className="utility">
        You are not following any industries yet, so there is nothing to brief. Choose the industries you want watched and this page fills from the next{" "}
        <Explain term="run">run</Explain>.
      </p>
    );
  }
  const scored = d.industries.reduce((acc, i) => acc + (i.scored || 0), 0);
  const c = d.changes;
  const moved = c ? c.summary.band_up + c.summary.band_down : null;
  const a = d.alerts;
  const cats = d.catalysts.next_14d;
  const indWord = inds === 1 ? "industry" : "industries";
  const alertsClause =
    locked || a.limit === 0 ? (
      <>
        <b>{a.fired_7d}</b> {a.fired_7d === 1 ? "alert" : "alerts"} fired in your industries this week
      </>
    ) : a.unread > 0 ? (
      <>
        <b>{a.unread}</b> {a.unread === 1 ? "alert is" : "alerts are"} waiting for you
      </>
    ) : (
      <>no alerts are waiting for you</>
    );
  const catsClause = (
    <>
      <b>{cats}</b> <Explain term="catalyst">{cats === 1 ? "catalyst" : "catalysts"}</Explain> {cats === 1 ? "falls" : "fall"} in the next 14 days
    </>
  );
  if (!c) {
    return (
      <p className="utility">
        On the first <Explain term="run">run</Explain> on record, <b>{scored}</b> names were <Explain term="score">scored</Explain> across your <b>{inds}</b> {indWord};{" "}
        <Explain term="band">band</Explain> changes appear from the second run. Meanwhile {alertsClause} and {catsClause}.
      </p>
    );
  }
  return (
    <p className="utility">
      Since the previous <Explain term="run">run</Explain>, <b>{moved}</b> of the <b>{scored}</b> names we <Explain term="score">score</Explain> across your <b>{inds}</b>{" "}
      {indWord} changed <Explain term="band">band</Explain>, {alertsClause}, and {catsClause}.
    </p>
  );
}

// Plain line for a pinned name: score since the pin date, then the next
// dated event on file. Facts only; no colour on score moves.
function pinSentence(p, st, tz) {
  const parts = [];
  const when = p.pinned_at ? ` on ${shortDate(p.pinned_at, tz)}` : "";
  if (p.value == null) parts.push("No score on this run.");
  else if (p.score_at_pin == null) parts.push(`Scores ${fmtScore(p.value)} now; no score was recorded when you pinned it.`);
  else {
    const r = Math.round(p.value - p.score_at_pin);
    if (r === 0) parts.push(`Unchanged since you pinned it${when}.`);
    else parts.push(`${r > 0 ? "Up" : "Down"} ${Math.abs(r)} point${Math.abs(r) === 1 ? "" : "s"} since you pinned it${when}.`);
  }
  if (st && st.earnings) parts.push(`Earnings ${inDays(st.earnings.days)}.`);
  else if (st) parts.push("No dated event on file.");
  return parts.join(" ");
}

export default function Overview() {
  const { me } = useMe();
  const { full } = useMode();
  const [d, setD] = useState(null);
  const [screen, setScreen] = useState(null);
  const [err, setErr] = useState(null);
  const [reload, setReload] = useState(0);

  const [chg, setChg] = useState(null);
  const [chgErr, setChgErr] = useState(null);
  const [showAllChg, setShowAllChg] = useState(false);

  const [events, setEvents] = useState(null);
  const [eventsErr, setEventsErr] = useState(null);
  const [evReload, setEvReload] = useState(0);

  const [picks, setPicks] = useState(null);
  const [picksErr, setPicksErr] = useState(null);
  const [stats, setStats] = useState(null);
  const [wlReload, setWlReload] = useState(0);
  const [pinnedSet, setPinnedSet] = useState(null);

  const [mktOpen, setMktOpen] = useState(full);
  useEffect(() => setMktOpen(full), [full]);

  const locked = Boolean(me && me.tier && me.tier.alerts_limit === 0);

  useEffect(() => {
    let alive = true;
    setErr(null);
    api("/overview")
      .then((x) => alive && setD(x))
      .catch((e) => alive && setErr(e));
    // movers: the biggest 30-day price moves among the names on the board
    api("/screen?sort=chg30&limit=40")
      .then((x) => alive && setScreen(x))
      .catch(() => alive && setScreen({ rows: [] }));
    // every band move since the previous run, up to the plan's limit (the
    // overview carries only the top three each way)
    setChg(null);
    setChgErr(null);
    api("/changes?strategy=fast_mover&vs=prev")
      .then((x) => alive && setChg(x))
      .catch((e) => alive && setChgErr(e));
    return () => {
      alive = false;
    };
  }, [reload]);

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
      .then((x) => {
        if (!alive) return;
        setPicks(x.picks || []);
        setPinnedSet(new Set((x.picks || []).map((p) => p.symbol)));
      })
      .catch((e) => alive && setPicksErr(e));
    api("/me/watchlist/stats")
      .then((x) => alive && setStats(x))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [reload, wlReload]);

  const onPin = (sym, on) => {
    setPinnedSet((s) => {
      const n = new Set(s || []);
      if (on) n.add(sym);
      else n.delete(sym);
      return n;
    });
    setWlReload((n) => n + 1);
  };
  const isPinned = (sym, fallback) => (pinnedSet ? pinnedSet.has(sym) : Boolean(fallback));

  const movers = useMemo(() => {
    if (!screen) return [];
    const rows = screen.rows.filter((r) => r.price && r.price.chg_30d != null);
    const up = rows.filter((r) => r.price.chg_30d >= 0).slice(0, 6);
    const down = rows.filter((r) => r.price.chg_30d < 0).reverse().slice(0, 4);
    const seen = new Set();
    return [...up, ...down].filter((r) => !seen.has(r.symbol) && seen.add(r.symbol));
  }, [screen]);

  // Band moves, ups first (largest first), then downs (largest first).
  const changes = useMemo(() => {
    if (chg && chg.prev_run) {
      const rows = [...chg.band_up.rows, ...chg.band_down.rows];
      const total = chg.band_up.total + chg.band_down.total;
      return {
        rows,
        total,
        more: total - rows.length,
        // the only thing that clamps /changes is the plan's names_shown_limit
        planClamped: chg.band_up.truncated || chg.band_down.truncated,
        k: chg.names_shown_limit,
        summary: chg.summary,
        prev_as_of: chg.prev_run.as_of,
      };
    }
    if (chg && !chg.prev_run) return { rows: [], total: 0, more: 0, planClamped: false, summary: null, prev_as_of: null, onlyOne: true };
    if (chgErr && d && d.changes) {
      // fallback: the overview's own top three each way; the rest is a count
      const c = d.changes;
      const rows = [...c.band_up, ...c.band_down];
      const total = c.summary.band_up + c.summary.band_down;
      return { rows, total, more: total - rows.length, planClamped: false, k: d.tier ? d.tier.names_shown_limit : 5, summary: c.summary, prev_as_of: c.prev_as_of };
    }
    if (chgErr && d && !d.changes) return { rows: [], total: 0, truncated: false, summary: null, prev_as_of: null, onlyOne: true };
    return null;
  }, [chg, chgErr, d]);

  const recentEvents = useMemo(() => {
    if (!events) return null;
    return [...events].sort((a, b) => (a.read === false) === (b.read === false) ? new Date(b.fired_at) - new Date(a.fired_at) : a.read === false ? -1 : 1);
  }, [events]);

  const statBySym = useMemo(() => Object.fromEntries(((stats && stats.picks) || []).map((p) => [p.symbol, p])), [stats]);
  const topPinned = useMemo(() => {
    if (!picks || picks.length === 0) return null;
    return [...picks].sort((a, b) => (BAND_RANK[b.band] ?? -1) - (BAND_RANK[a.band] ?? -1) || (b.value ?? -1) - (a.value ?? -1))[0];
  }, [picks]);

  const markRead = (ev) => {
    if (ev.read !== false || !ev.id) return;
    api("/me/alerts/read", { method: "POST", json: { event_id: ev.id } })
      .then(() => {
        setEvents((xs) => (xs || []).map((x) => (x.id === ev.id ? { ...x, read: true } : x)));
        window.dispatchEvent(new Event("alerts:read"));
      })
      .catch(() => {});
  };

  const tz = me && me.settings ? me.settings.timezone : undefined;
  const first = me && (me.name || me.email || "").split("@")[0];

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
        <div className="pagehead">
          <div>
            <h1>Your brief</h1>
          </div>
        </div>
        <Skeleton rows={1} height={48} />
        <Skeleton rows={3} height={84} />
      </div>
    );
  }

  const run = d.run;
  const w = d.watchlist;
  const a = d.alerts;
  const K = d.tier ? d.tier.names_shown_limit : 5;
  const noIndustries = d.industries.length === 0;

  // One next step for the account, from the same rule the dossier uses.
  let step;
  if (noIndustries) {
    step = {
      text: "Choose the industries you want watched. Everything on this page is built from them.",
      action: (
        <Link to="/onboarding" className="btn btn-primary btn-sm">
          Choose industries
        </Link>
      ),
    };
  } else if (picks) {
    const s = nextStep({
      pinned: picks.length > 0,
      armed: a.armed > 0,
      band: run && topPinned ? topPinned.band : null,
      verified: me ? me.verified : undefined,
      alertsLimit: a.limit,
    });
    if (s.kind === "pin") {
      step = {
        text: "Pin a name from the Board. Pinned names stay on this page and in your digest, and we track their score from the day you pinned them.",
        action: (
          <Link to="/board" className="btn btn-primary btn-sm">
            Open the Board
          </Link>
        ),
      };
    } else if (s.kind === "notify" && topPinned) {
      step = { text: `Turn on alerts for ${topPinned.symbol} so you hear the moment something changes on it.`, action: <NotifyButton symbol={topPinned.symbol} compact /> };
    } else if (s.kind === "why" && topPinned) {
      step = {
        text: `${topPinned.symbol} is ${topPinned.band} on this run. ${s.text}`,
        action: (
          <Link to={`/stock/${topPinned.symbol}`} className="btn btn-secondary btn-sm">
            Read why
          </Link>
        ),
      };
    } else {
      step = { text: s.text, action: null };
    }
  }

  const changeRows = changes && (showAllChg ? changes.rows : changes.rows.slice(0, PREVIEW_ROWS));
  const eventRows = recentEvents && recentEvents.slice(0, 5);
  const unreadNow = recentEvents ? recentEvents.filter((e) => e.read === false).length : a.unread;
  const pickRows = picks && picks.slice(0, PREVIEW_ROWS);

  return (
    <div className="wrap brief">
      <div className="pagehead">
        <div className="brief-title">
          <h1>Your brief</h1>
          <Utility d={d} locked={locked} />
          <div className="meta">
            {run ? (
              <>
                Run {dateTime(run.as_of, tz)} <AgeChip asOf={run.as_of} />
                {first ? ` · for ${first}` : ""}
              </>
            ) : (
              "No completed run yet."
            )}
          </div>
        </div>
        <div className="actions">
          <Link to="/screen" className="btn btn-secondary btn-sm">
            <Icon name="screen" size={16} /> Screen
          </Link>
          <Link to="/board" className="btn btn-primary btn-sm">
            Open the Board <Icon name="arrow" size={16} />
          </Link>
        </div>
      </div>

      {!run && (
        <>
          <Empty title="No scored run yet.">Scores appear after the first daily run completes.</Empty>
          {step && (
            <div className="nextstep" role="note">
              <span className="nextstep-k">Next step</span>
              <span>{step.text}</span>
              <span className="spacer" />
              {step.action}
            </div>
          )}
        </>
      )}

      {run && (
        <>
          {/* 2. What changed ------------------------------------------------ */}
          <Section
            id="br-chg"
            title="What changed"
            note={changes && changes.prev_as_of ? `since the run on ${shortDate(changes.prev_as_of, tz)}` : null}
            more={
              <Link to="/changes" className="more">
                All changes →
              </Link>
            }
          >
            {!changes && <Skeleton rows={2} height={64} />}
            {changes && changes.onlyOne && <p className="muted small">Only one run is on record. Changes appear once a second run completes.</p>}
            {changes && !changes.onlyOne && changes.rows.length === 0 && (
              <p className="muted small">
                No name changed band since the previous run.
                {changes.summary ? ` ${changes.summary.up} scores went up and ${changes.summary.down} went down without crossing a band line.` : ""}
              </p>
            )}
            {changes && changes.rows.length > 0 && (
              <ul className="brows">
                {changeRows.map((r) => (
                  <li className="brow" key={r.symbol}>
                    <div className="brow-main">
                      <div className="brow-top">
                        <Link className="sym" to={`/stock/${r.symbol}`}>
                          {r.symbol}
                        </Link>
                        <span className="theme" title={r.theme}>
                          {r.theme}
                        </span>
                        <Link className="ind" to={`/industries/${r.industry.key}`}>
                          {r.industry.label}
                        </Link>
                      </div>
                      <p className="brow-say">{changeSentence(r.delta, r.now && r.now.band, r.prev && r.prev.band)}</p>
                      <div className="brow-detail full-only">
                        {r.prev ? <ScoreBadge band={r.prev.band} value={r.prev.value} present={r.prev.present} total={r.prev.total} /> : <span className="chip chip-plain">not scored</span>}
                        <span aria-hidden="true">→</span>
                        {r.now ? <ScoreBadge band={r.now.band} value={r.now.value} present={r.now.present} total={r.now.total} /> : <span className="chip chip-plain">not scored</span>}
                        <span className="mono">Δ {delta(r.delta)}</span>
                      </div>
                    </div>
                    <div className="brow-side">
                      {r.now ? <ScoreBadge band={r.now.band} value={r.now.value} present={r.now.present} total={r.now.total} /> : <span className="chip chip-plain">not scored</span>}
                    </div>
                    <div className="brow-act">
                      <Pin symbol={r.symbol} pinned={isPinned(r.symbol, r.pinned)} onChange={onPin} />
                      <NotifyButton symbol={r.symbol} compact />
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {changes && changes.rows.length > PREVIEW_ROWS && (
              <button type="button" className="btn-quiet brief-toggle" onClick={() => setShowAllChg((v) => !v)} aria-expanded={showAllChg}>
                {showAllChg ? "Show fewer" : `Show all ${changes.rows.length}`}
              </button>
            )}
            {changes && changes.summary && (changes.more > 0 || changes.summary.new > 0 || changes.summary.cleared > 0 || changes.summary.failed > 0) && (
              <p className="hint">
                {changes.more > 0
                  ? changes.planClamped
                    ? `${changes.more} more changed band in your industries; your plan shows the top ${changes.k}. `
                    : `${changes.more} more changed band in your industries. `
                  : ""}
                {changes.summary.new > 0 ? `${plural(changes.summary.new, "name was", "names were")} scored for the first time on this run. ` : ""}
                {changes.summary.cleared > 0 || changes.summary.failed > 0
                  ? `${changes.summary.cleared} cleared the screen and ${changes.summary.failed} failed it. `
                  : ""}
                <Link to="/changes">See every change</Link>.
              </p>
            )}
          </Section>

          {/* 3. Alerts that fired ------------------------------------------- */}
          <Section
            id="br-al"
            title="Alerts that fired"
            note={locked ? null : "last 30 days, unread first"}
            more={
              <Link to="/alerts" className="more">
                All alerts →
              </Link>
            }
          >
            {locked ? (
              <div className="brief-locked">
                <p>
                  An <Explain term="alert">alert</Explain> is a message we send when a specific fact prints on a name you asked us to watch: a borrow fee doubling,
                  volume at three times normal, a dated catalyst landing in range. This week <b>{a.fired_7d}</b> {a.fired_7d === 1 ? "alert" : "alerts"} fired on{" "}
                  <b>{a.fired_7d_names}</b> {a.fired_7d_names === 1 ? "name" : "names"} in your industries.
                </p>
                <p className="muted small">Alerts start on the Basic plan: each one is emailed to you with the fact that fired it.</p>
                <div className="actrow">
                  <Link to="/pricing" className="btn btn-primary btn-sm">
                    See plans
                  </Link>
                  <Link to="/board" className="btn btn-secondary btn-sm">
                    Pin names meanwhile
                  </Link>
                </div>
              </div>
            ) : eventsErr ? (
              <InlineError what="recent alerts" onRetry={() => setEvReload((n) => n + 1)} />
            ) : !recentEvents ? (
              <Skeleton rows={2} height={64} />
            ) : recentEvents.length === 0 ? (
              <div className="brief-empty">
                <p>
                  Nothing fired on your names in the last 30 days. An <Explain term="alert">alert</Explain> is a message we send when a specific fact prints on a
                  name you asked us to watch, such as a borrow fee doubling or volume at three times normal.{" "}
                  {a.armed > 0 ? `You have ${plural(a.armed, "trigger")} armed.` : "You have no triggers armed yet."}
                </p>
                <div className="actrow">
                  {topPinned ? (
                    <>
                      <NotifyButton symbol={topPinned.symbol} compact />
                      <span className="xs faint">{triggerSentence("catalyst_dated", topPinned.symbol)}</span>
                    </>
                  ) : (
                    <Link to="/board" className="btn btn-secondary btn-sm">
                      Pin a name to watch
                    </Link>
                  )}
                </div>
              </div>
            ) : (
              <>
                <ul className="brows">
                  {eventRows.map((ev) => {
                    const unread = ev.read === false;
                    const ag = age(ev.fired_at);
                    return (
                      <li className={`brow ${unread ? "unread" : ""}`} key={ev.id}>
                        <div className="brow-main">
                          <div className="brow-top">
                            {unread && <span className="brow-dot" aria-label="Unread" />}
                            <Link className="sym" to={`/stock/${ev.symbol}`} onClick={() => markRead(ev)}>
                              {ev.symbol}
                            </Link>
                            <span className="chip chip-plain">{triggerLabel(ev.trigger_key)}</span>
                            <span className="when" title={dateTime(ev.fired_at, tz)}>
                              {ag ? `${ag.label} ago` : shortDate(ev.fired_at, tz)}
                            </span>
                          </div>
                          <p className="brow-say">{ev.detail || triggerSentence(ev.trigger_key, ev.symbol)}</p>
                          <div className="brow-detail full-only">
                            {ev.theme ? <span>{ev.theme}</span> : null}
                            <span>
                              {ev.channels && ev.channels.length
                                ? `delivered by ${ev.channels.join(", ")}${ev.delivered_at ? ` · ${shortDate(ev.delivered_at, tz)}` : ""}`
                                : "not armed on your account; shown because the name is in your universe"}
                            </span>
                          </div>
                        </div>
                        <div className="brow-act">
                          <Link to={`/stock/${ev.symbol}`} className="btn btn-secondary btn-sm" onClick={() => markRead(ev)}>
                            Open report
                          </Link>
                          {unread && (
                            <button type="button" className="btn-quiet" onClick={() => markRead(ev)}>
                              Mark read
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <p className="hint">
                  {recentEvents.length > eventRows.length ? `${recentEvents.length - eventRows.length} more in the last 30 days. ` : ""}
                  {unreadNow > 0 ? `${plural(unreadNow, "alert")} unread. ` : ""}
                  {a.armed > 0 ? `${plural(a.armed, "trigger")} armed.` : "No triggers armed yet; these fired on names in your universe."}
                </p>
              </>
            )}
          </Section>

          {/* 4. Coming up --------------------------------------------------- */}
          <Section
            id="br-cal"
            title="Coming up"
            note="dated events in the next 14 days"
            more={
              <Link to="/calendar?days=14" className="more">
                Calendar →
              </Link>
            }
          >
            {d.catalysts.upcoming.length === 0 ? (
              <p className="muted small">
                No dated event on file for your names in the next two weeks. Dates come from each name's latest snapshot; a name with no date on file is not
                listed, which is not the same as having no event.
              </p>
            ) : (
              <ul className="brows">
                {d.catalysts.upcoming.map((r) => (
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
                        Earnings <b>{inDays(r.days)}</b>, {shortDate(r.date)}
                        {r.confidence ? <span className="full-only"> · date {r.confidence}</span> : null}
                        {r.armed ? " · alert armed" : ""}
                        {r.pinned ? " · pinned" : ""}
                      </p>
                    </div>
                    <div className="brow-side">
                      {r.band ? <ScoreBadge band={r.band} value={r.value} present={r.components_present} total={r.components_total} /> : <span className="chip chip-plain">No score</span>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {d.catalysts.next_14d > d.catalysts.upcoming.length && (
              <p className="hint">
                {d.catalysts.next_14d - d.catalysts.upcoming.length} more in your industries; your plan shows the top {Math.min(5, K)}.{" "}
                <Link to="/calendar?days=14">Open the calendar</Link>.
              </p>
            )}
          </Section>

          {/* 5. Your watchlist ---------------------------------------------- */}
          <Section
            id="br-wl"
            title="Your watchlist"
            note={
              w.count > 0
                ? `${w.limit != null ? `${w.count} of ${w.limit} pins` : plural(w.count, "pin")} · ${w.strong_or_elevated} strong or elevated · ${w.cleared} clear the screen`
                : null
            }
            more={
              <Link to="/watchlist" className="more">
                Watchlist →
              </Link>
            }
          >
            {picksErr ? (
              <InlineError what="your watchlist" onRetry={() => setWlReload((n) => n + 1)} />
            ) : !picks ? (
              <Skeleton rows={2} height={64} />
            ) : picks.length === 0 ? (
              <div className="brief-empty">
                <p>
                  Nothing pinned yet. <Explain term="pin">Pinning</Explain> a name keeps it on this page and in your weekly digest, and from then on we track how its
                  score moved since the day you pinned it.
                  {w.limit != null ? ` Your plan holds ${plural(w.limit, "pin")}.` : ""}
                </p>
                <div className="actrow">
                  <Link to="/board" className="btn btn-primary btn-sm">
                    Open the Board
                  </Link>
                  <Link to="/screen" className="btn btn-secondary btn-sm">
                    Screen names
                  </Link>
                </div>
              </div>
            ) : (
              <>
                <ul className="brows">
                  {pickRows.map((p) => {
                    const st = statBySym[p.symbol];
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
                            <Link className="ind" to={`/industries/${p.industry.key}`}>
                              {p.industry.label}
                            </Link>
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
                              {st.hf_pass != null && <span className={`verdict ${st.hf_pass ? "pass" : "fail"}`}>{st.hf_pass ? "PASS" : "FAIL"}</span>}
                              {p.delta_1d != null && <span className="mono">Δ run {delta(p.delta_1d)}</span>}
                            </div>
                          )}
                        </div>
                        <div className="brow-side">
                          {st && st.unread > 0 && (
                            <Link to={`/alerts?symbol=${p.symbol}&unread=1`} className="chip chip-plain">
                              {st.unread} unread
                            </Link>
                          )}
                          {p.band ? <ScoreBadge band={p.band} value={p.value} /> : <span className="chip chip-plain">No score</span>}
                        </div>
                        <div className="brow-act">
                          <Pin symbol={p.symbol} pinned={isPinned(p.symbol, true)} onChange={onPin} />
                          <NotifyButton symbol={p.symbol} compact />
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {picks.length > pickRows.length && (
                  <p className="hint">
                    {picks.length - pickRows.length} more pinned. <Link to="/watchlist">Open the watchlist</Link>.
                  </p>
                )}
              </>
            )}
          </Section>

          {/* 6. One next step ----------------------------------------------- */}
          {step && (
            <div className="nextstep" role="note">
              <span className="nextstep-k">Next step</span>
              <span>{step.text}</span>
              <span className="spacer" />
              {step.action}
            </div>
          )}

          {/* 7. Markets: price context, folded ------------------------------ */}
          <details className="acc mkt" open={mktOpen} onToggle={(e) => setMktOpen(e.currentTarget.open)}>
            <summary>
              <h2>Markets</h2>
              <span className="sum-note">price context: your pins as a rebased index, the biggest 30-day moves, your industries</span>
            </summary>
            <div className="acc-body">
              <Hero />

              {movers.length > 0 && (
                <>
                  <div className="section-head">
                    <h2>Biggest price moves, 30 days</h2>
                    <span className="muted small">among your names · daily closes</span>
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
                  <h2 id="ov-ind">Your industries</h2>
                  <span className="muted small">Fast Mover on the latest run · names are your top {Math.min(3, K)}</span>
                </div>
                {noIndustries ? (
                  <Empty
                    title="You're not following any industries yet."
                    action={
                      <Link to="/onboarding" className="btn btn-primary">
                        Choose industries
                      </Link>
                    }
                  />
                ) : (
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
                          <span>mean {ind.mean_score != null ? Math.round(ind.mean_score) : "—"}</span>
                          <span>{ind.cleared} cleared the screen</span>
                          {ind.new > 0 && <span>{ind.new} new</span>}
                        </div>
                        <ul className="namelist">
                          {ind.top.map((r) => (
                            <NameLine
                              key={r.symbol}
                              r={r}
                              right={
                                <>
                                  <span className="mono xs faint">{delta(r.delta_1d)}</span>
                                  <ScoreBadge band={r.band} value={r.value} present={r.components_present} total={r.components_total} />
                                </>
                              }
                            />
                          ))}
                        </ul>
                        <div className="ovind-links small">
                          <Link to={`/board?industry=${ind.key}`}>Board</Link>
                          <Link to={`/screen?industries=${ind.key}`}>Screen</Link>
                          <Link to={`/industries/${ind.key}`}>Industry</Link>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </details>

          <p className="footnote">
            Scores from the run at {dateTime(run.as_of, tz)}; price moves from daily closes.{" "}
            {d.digest && (
              <>
                {d.digest.enabled
                  ? `Weekly digest: ${DAYS[d.digest.day]} at ${String(d.digest.hour).padStart(2, "0")}:00 ${d.digest.timezone}.`
                  : "Weekly digest is off."}{" "}
                <Link to="/digests">Preview</Link> · <Link to="/settings#digest">Change</Link>.{" "}
              </>
            )}
            Research and information only; nothing on this page is a recommendation.
          </p>
        </>
      )}
    </div>
  );
}
