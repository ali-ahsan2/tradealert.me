import React, { useEffect, useMemo, useState } from "react";
import { api, cached, toast } from "../api.js";
import { Link } from "../lib/router.jsx";
import { useMe } from "../lib/me.jsx";
import { DAYS, delta, dollars, downloadText, inDays, pct, plural, score as fmtScore, shortDate, signed, toCsv, tone } from "../lib/fmt.js";
import { GLOSSARY } from "../lib/glossary.js";
import { CTA, bandWord } from "../lib/plain.js";
import { useMode } from "../lib/mode.js";
import { fetchRecord } from "../lib/record.js";
import { openUpgrade } from "../lib/upgrade.js";
import { LIST_CARDS, WATCHLIST_FACTS } from "../lib/caps.js";
import { FINE_PRINT_SHORT } from "../lib/legal.js";
import ScoreBadge from "../components/ScoreBadge.jsx";
import Spark, { Move } from "../components/Spark.jsx";
import NotifyButton from "../components/NotifyButton.jsx";
import ScreenHead from "../components/ScreenHead.jsx";
import FinePrint from "../components/FinePrint.jsx";
import { ShowAll } from "../components/NameCard.jsx";
import { Empty, ErrorCard, Notice, Skeleton } from "../components/ui.jsx";
import "./tools.css";

// My watchlist (DESIGN_V6 §5, §7): one line and one action at the top, then
// each name I watch as a card with one sentence (the lead fact from my
// record when there is one, else what the score has done since I started
// watching it), one meta line in words, the 30-day sparkline and its move,
// and two actions. Stop watching, reorder and the note live behind "More".
// Full mode keeps three stat tiles, a capped facts row, compare and the
// CSV export.

const SORTS = {
  order: ["Your order", null],
  score: ["Score", (a, b) => (b.value ?? -1) - (a.value ?? -1)],
  since_pin: ["Score since you started", (a, b) => ((b.value ?? 0) - (b.score_at_pin ?? 0)) - ((a.value ?? 0) - (a.score_at_pin ?? 0))],
  px: ["Price since you started", (a, b) => ((b.st && b.st.chg_since_pin) ?? -Infinity) - ((a.st && a.st.chg_since_pin) ?? -Infinity)],
  earnings: ["Next earnings", (a, b) => ((a.st && a.st.earnings && a.st.earnings.days) ?? Infinity) - ((b.st && b.st.earnings && b.st.earnings.days) ?? Infinity)],
};

function plainDays(n) {
  if (n == null) return "—";
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

// Which inputs-with-data counts apply to a pick's score: the picks payload
// carries them; the stats row is the fallback when it does too.
function coverageOf(p) {
  const st = p.st || {};
  const present = p.components_present ?? st.components_present;
  const total = p.components_total ?? st.components_total;
  return { present, total, known: present != null && total != null && total > 0 };
}

// The score since I started watching, as one sentence from the stored
// figures. The current score keeps its ~ on thin data; the score on the day
// I started has no input count on record, so it is the stored integer.
function sincePinSentence(p) {
  if (p.value == null) return "No score in the latest scoring.";
  const { present, total } = coverageOf(p);
  const now = fmtScore(p.value, present, total);
  if (p.score_at_pin == null) return `Scores ${now} now; it had no score when you started watching.`;
  const was = fmtScore(p.score_at_pin);
  const dlt = Math.round(p.value) - Math.round(p.score_at_pin);
  if (dlt === 0) return `Same score as when you started watching, ${now}.`;
  return `Score ${dlt > 0 ? "up" : "down"} ${Math.abs(dlt)} point${Math.abs(dlt) === 1 ? "" : "s"} since you started watching, from ${was} to ${now}.`;
}

// The screen's one line (DESIGN_V6 §7), fourteen words at most, from the
// watched names and their stats: "You watch 4 names; 3 score higher since
// you started; 2 have alerts on."
function watchLine({ picks, err, tier, limit, used, comparable, higher, lower, withAlerts }) {
  if (err) return "Your watchlist could not be loaded.";
  if (!picks) return "Checking the names you watch…";
  if (picks.length === 0) {
    return tier && limit != null ? `You are not watching any names yet; ${tier.label} watches up to ${limit} for you.` : "You are not watching any names yet.";
  }
  let mid;
  if (comparable === 0) mid = "none was scored when you started";
  else if (higher > 0) mid = `${higher} score${higher === 1 ? "s" : ""} higher since you started`;
  else if (lower > 0) mid = `${lower} score${lower === 1 ? "s" : ""} lower since you started`;
  else mid = "none changed score since you started";
  const tail = withAlerts == null ? "" : withAlerts === 0 ? "; none has alerts on" : `; ${withAlerts} ${withAlerts === 1 ? "has" : "have"} alerts on`;
  return `You watch ${plural(used, "name")}; ${mid}${tail}.`;
}

// The lead fact on a pinned name from the subscriber's record (DESIGN_V5
// §5): of the alerts that fired on it in the window, the one with the
// biggest measured move (else the latest), said as what they were told or
// what fired while they were not watching. One record request per page,
// never one per card.
function pickLead(a, b) {
  if (!a) return b;
  const am = a.max_5d != null;
  const bm = b.max_5d != null;
  if (am !== bm) return am ? a : b;
  if (am && b.max_5d !== a.max_5d) return b.max_5d > a.max_5d ? b : a;
  return b.date > a.date ? b : a;
}

function leadsBySymbol(rec) {
  const m = {};
  if (!rec) return m;
  const all = [...((rec.told && rec.told.events) || []), ...((rec.missed && rec.missed.events) || [])];
  for (const e of all) m[e.symbol] = pickLead(m[e.symbol], e);
  return m;
}

// Red and green only on the price move itself.
function LeadFact({ e }) {
  if (!e) return null;
  const peak = e.max_5d != null ? <span className={`num ${tone(e.max_5d)}`}>{pct(e.max_5d)}</span> : null;
  let words;
  if (e.told) {
    if (peak && e.peak_after_sessions) words = <>You were told {plural(e.peak_after_sessions, "session")} before a {peak} peak.</>;
    else if (peak) words = <>You were told; it moved {peak} at the high within five sessions.</>;
    else if (e.pending) words = <>You were told on {shortDate(e.date)}; the five-session window is still open.</>;
    else words = <>You were told on {shortDate(e.date)}; the move after is not measured yet.</>;
  } else if (peak) words = <>An alert fired on it while you were not watching: {peak} at the high within five sessions.</>;
  else if (e.pending) words = <>An alert fired on it on {shortDate(e.date)} while you were not watching; the five-session window is still open.</>;
  else words = <>An alert fired on it on {shortDate(e.date)} while you were not watching.</>;
  return <p className="rec-say tl-lead">{words}</p>;
}

// The badge, only with the coverage it can prove. ScoreBadge draws a full
// bar when the counts are missing, so without them the band word and the
// score() figure stand alone with a hint.
function PickBand({ p }) {
  if (!p.band) return <span className="chip chip-plain">No score</span>;
  const { present, total, known } = coverageOf(p);
  if (known) return <ScoreBadge band={p.band} value={p.value} present={present} total={total} />;
  return (
    <span className="tl-nocov" title="The scoring did not record how many inputs had data for this score">
      <span>
        <b>{bandWord(p.band)}</b> <span className="num">{fmtScore(p.value)}</span>
      </span>
      <span className="hint">input count not on file</span>
    </span>
  );
}

// The rating as words for the Simple card's meta line: "Elevated ~54".
function bandWords(p) {
  if (!p.band) return "no score yet";
  const { present, total } = coverageOf(p);
  return (
    <>
      <b>{bandWord(p.band)}</b> {fmtScore(p.value, present, total)}
    </>
  );
}

function NoteEditor({ pick, onSaved }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(pick.note || "");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api(`/me/picks/${encodeURIComponent(pick.symbol)}`, { method: "PATCH", json: { note: v } });
      onSaved(pick.symbol, v);
      setOpen(false);
    } catch (e) {
      toast(e.detail || "Couldn't save the note.");
    } finally {
      setBusy(false);
    }
  };
  if (!open) {
    return (
      <span className="small" style={{ flexBasis: "100%", color: pick.note ? "var(--ink)" : "var(--ink-faint)" }}>
        {pick.note || "No note."}{" "}
        <button className="btn-quiet" onClick={() => setOpen(true)}>
          {pick.note ? "Edit" : "Add a note"}
        </button>
      </span>
    );
  }
  return (
    <div className="notebox" style={{ flexBasis: "100%" }}>
      <textarea value={v} maxLength={280} onChange={(e) => setV(e.target.value)} placeholder="Why you watch it, what would change your mind…" />
      <div className="row" style={{ marginTop: "var(--s-2)" }}>
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button className="btn-quiet" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <span className="xs faint">{v.length}/280 · private to you</span>
      </div>
    </div>
  );
}

export default function Watchlist() {
  const { me } = useMe();
  const { simple } = useMode();
  const [picks, setPicks] = useState(null);
  const [settings, setSettings] = useState(null);
  const [tiers, setTiers] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [stats, setStats] = useState(null);
  const [sort, setSort] = useState("order");
  const [record, setRecord] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const signedIn = Boolean(me);

  useEffect(() => {
    let alive = true;
    setErr(null);
    api("/me/picks")
      .then((d) => alive && setPicks(d.picks))
      .catch((e) => alive && setErr(e));
    api("/me/watchlist/stats")
      .then((d) => alive && setStats(d))
      .catch(() => {});
    api("/me/settings")
      .then((d) => alive && setSettings(d))
      .catch(() => {});
    cached("/entitlements")
      .then((d) => alive && setTiers(d.tiers))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [reload]);

  // One record request for the whole page: which pinned names an alert
  // fired on in the last 90 days, and what followed.
  useEffect(() => {
    if (!signedIn) return undefined;
    let alive = true;
    fetchRecord(90)
      .then((d) => alive && setRecord(d))
      .catch(() => alive && setRecord(null));
    return () => {
      alive = false;
    };
  }, [signedIn, reload]);
  const leads = useMemo(() => leadsBySymbol(record), [record]);

  // A Notify button on a card changes the armed count the stats carry;
  // refresh them when any button on the page arms or disarms.
  useEffect(() => {
    const refresh = () =>
      api("/me/watchlist/stats")
        .then((d) => setStats(d))
        .catch(() => {});
    window.addEventListener("alerts:rules", refresh);
    return () => window.removeEventListener("alerts:rules", refresh);
  }, []);

  const move = async (i, dir) => {
    setBusy(true);
    try {
      const syms = picks.map((p) => p.symbol);
      const j = i + dir;
      [syms[i], syms[j]] = [syms[j], syms[i]];
      const { order } = await api("/me/picks/order", { method: "PUT", json: { symbols: syms } });
      const bySym = Object.fromEntries(picks.map((p) => [p.symbol, p]));
      setPicks(order.map((s) => bySym[s]).filter(Boolean));
    } catch (e) {
      toast(e.detail || "Couldn't reorder. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const unpin = async (sym) => {
    try {
      await api(`/me/picks/${encodeURIComponent(sym)}`, { method: "DELETE" });
      setPicks((p) => p.filter((x) => x.symbol !== sym));
      toast(`Stopped watching ${sym}.`);
    } catch (e) {
      toast(e.detail || "Couldn't stop watching it. Try again.");
    }
  };

  const bySym = useMemo(() => Object.fromEntries(((stats && stats.picks) || []).map((p) => [p.symbol, p])), [stats]);
  const ordered = useMemo(() => {
    if (!picks) return [];
    const withStats = picks.map((p) => ({ ...p, st: bySym[p.symbol] }));
    const cmp = SORTS[sort][1];
    return cmp ? [...withStats].sort(cmp) : withStats;
  }, [picks, bySym, sort]);
  const summary = stats && stats.summary;

  const exportCsv = () => {
    const cols = [
      { label: "symbol", get: (p) => p.symbol },
      { label: "theme", get: (p) => p.theme },
      { label: "industry", get: (p) => p.industry.label },
      { label: "pinned_at", get: (p) => p.pinned_at },
      { label: "score_at_pin", get: (p) => (p.score_at_pin == null ? "" : Math.round(p.score_at_pin)) },
      { label: "score_now", get: (p) => (p.value == null ? "" : Math.round(p.value)) },
      { label: "band", get: (p) => p.band || "" },
      { label: "price_since_pin_pct", get: (p) => (p.st && p.st.chg_since_pin != null ? p.st.chg_since_pin : "") },
      { label: "benchmark", get: (p) => (p.st && p.st.benchmark) || "" },
      { label: "benchmark_since_pin_pct", get: (p) => (p.st && p.st.benchmark_chg_since_pin != null ? p.st.benchmark_chg_since_pin : "") },
      { label: "next_earnings", get: (p) => (p.st && p.st.earnings ? p.st.earnings.date : "") },
      { label: "hard_filters", get: (p) => (p.st && p.st.hf_pass != null ? (p.st.hf_pass ? "pass" : "fail") : "") },
      { label: "note", get: (p) => p.note || "" },
    ];
    downloadText(`tradealert-watchlist-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(ordered, cols) + `\n# ${FINE_PRINT_SHORT}\n`);
  };

  const tier = me && me.tier;
  const limit = tier ? tier.picks_limit : null;
  const used = picks ? picks.length : 0;
  const atQuota = limit != null && used >= limit;
  const nextTier =
    tiers && tier ? [...tiers].sort((a, b) => a.price_monthly_cents - b.price_monthly_cents).find((t) => t.price_monthly_cents > tier.price_monthly_cents) : null;
  const tz = me && me.settings ? me.settings.timezone : undefined;

  // Figures for the utility line, from the picks and their stats.
  const comparable = ordered.filter((p) => p.value != null && p.score_at_pin != null).length;
  const higher = ordered.filter((p) => p.value != null && p.score_at_pin != null && Math.round(p.value - p.score_at_pin) > 0).length;
  const lower = ordered.filter((p) => p.value != null && p.score_at_pin != null && Math.round(p.value - p.score_at_pin) < 0).length;
  const withAlerts = stats ? ordered.filter((p) => p.st && p.st.armed > 0).length : null;

  const saveNote = (sym, note) => setPicks((xs) => xs.map((x) => (x.symbol === sym ? { ...x, note } : x)));

  // Simple shows LIST_CARDS cards before "Show all N" (lib/caps.js).
  const cards = simple && !showAll ? ordered.slice(0, LIST_CARDS) : ordered;

  return (
    <div className="wrap">
      <ScreenHead
        title="My watchlist"
        line={watchLine({ picks, err, tier, limit, used, comparable, higher, lower, withAlerts })}
        action={
          <Link to="/board" className="btn btn-primary">
            Watch more names for me
          </Link>
        }
        secondary={
          <>
            {picks && picks.length > 1 && (
              <label className="ctl">
                Sort
                <select className="inline" value={sort} onChange={(e) => setSort(e.target.value)}>
                  {Object.entries(SORTS).map(([k, [l]]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {picks && picks.length > 1 && (
              <Link to={`/compare?symbols=${picks.slice(0, 4).map((p) => p.symbol).join(",")}`} className="btn btn-secondary btn-sm full-only">
                Compare {Math.min(4, picks.length)}
              </Link>
            )}
            {picks && picks.length > 0 && (
              <button className="btn-quiet full-only" onClick={exportCsv}>
                Export CSV
              </button>
            )}
            {picks && picks.length > 0 && (
              <Link to="/screen?pinned=1" className="btn-quiet full-only">
                Find among my names
              </Link>
            )}
          </>
        }
      />

      {summary && summary.count > 0 && (
        <div className="tiles full-only">
          <div className="tile card">
            <span className="tile-label">Score since you started watching</span>
            <span className="tile-value">{delta(summary.mean_score_delta_since_pin)}</span>
            <span className="tile-sub">average across {plural(summary.count, "name")}</span>
          </div>
          <div className="tile card">
            <span className="tile-label">Price since you started watching</span>
            <span className={`tile-value ${tone(summary.mean_chg_since_pin)}`}>{signed(summary.mean_chg_since_pin, 1, "%")}</span>
            <span className="tile-sub">
              {summary.mean_rel_since_pin != null ? `${signed(summary.mean_rel_since_pin, 1, "%")} vs each name's industry ETF` : "no benchmark bars yet"}
            </span>
          </div>
          <div className="tile card">
            <span className="tile-label">Alerts on</span>
            <span className="tile-value">{summary.armed}</span>
            <span className="tile-sub">
              {summary.unread} unread {summary.unread === 1 ? "alert" : "alerts"} · {summary.earnings_14d} with earnings in 14 days
            </span>
          </div>
        </div>
      )}

      {atQuota && picks && picks.length > 0 && (
        <Notice tone="warn">
          You are watching all {limit} names {tier.label} allows.
          {nextTier ? (
            <>
              {" "}
              Stop watching one, or {nextTier.label} watches {plural(nextTier.picks_limit, "name")} for you for {dollars(nextTier.price_monthly_cents)}/mo.{" "}
              <button type="button" className="tl-linkbtn" onClick={() => openUpgrade("picks")}>
                {CTA.SHOW_PLANS}
              </button>
            </>
          ) : (
            " Stop watching one to make room."
          )}
        </Notice>
      )}

      {err && <ErrorCard error={err} onRetry={() => setReload((n) => n + 1)} title="Couldn't load your watchlist." />}
      {!err && !picks && <Skeleton rows={3} height={96} />}

      {picks && picks.length === 0 && (
        <Empty
          title="You are not watching any names yet."
          action={
            <Link to="/board" className="btn btn-primary">
              Show me the Board
            </Link>
          }
        >
          {GLOSSARY.pin.short} We keep a note of the score on the day you start watching a name, so this page can tell you what has changed since.
          {tier && limit != null && (
            <>
              {" "}
              {tier.label} watches up to {plural(limit, "name")} for you
              {nextTier ? `; ${nextTier.label} watches ${nextTier.picks_limit}.` : "."}
            </>
          )}
        </Empty>
      )}

      {picks && picks.length > 0 && simple && (
        <div className="wl-list">
          {cards.map((p) => {
            const st = p.st;
            const i = picks.findIndex((x) => x.symbol === p.symbol);
            const lead = leads[p.symbol];
            const ev = st && st.earnings ? `earnings ${plainDays(st.earnings.days)}` : null;
            return (
              <article className="card tl-wl" key={p.symbol} aria-label={p.symbol}>
                <div className="tl-main">
                  <div className="tl-head">
                    <Link className="sym" to={`/stock/${p.symbol}`}>
                      {p.symbol}
                    </Link>
                    <span className="tl-co" title={p.theme}>
                      {p.theme}
                    </span>
                  </div>
                  {lead ? <LeadFact e={lead} /> : <p className="tl-sent">{sincePinSentence(p)}</p>}
                  <p className="tl-meta">
                    {bandWords(p)}
                    {ev ? <> · {ev}</> : null}
                    {" · watching since "}
                    {shortDate(p.pinned_at, tz)}
                    {st && st.unread > 0 && (
                      <>
                        {" · "}
                        <Link to={`/alerts?tab=history&symbol=${p.symbol}&unread=1`}>
                          {st.unread} unread {st.unread === 1 ? "alert" : "alerts"}
                        </Link>
                      </>
                    )}
                  </p>
                </div>
                <div className="tl-side">
                  {st && st.closes && st.closes.length > 1 && (
                    <span className="wl-spark">
                      <Spark closes={st.closes} width={100} height={32} />
                      <Move value={st.chg_30d} /> <span className="xs faint">30 days</span>
                    </span>
                  )}
                </div>
                <div className="tl-acts">
                  <NotifyButton symbol={p.symbol} compact />
                  <Link to={`/stock/${p.symbol}`} className="btn btn-secondary btn-sm">
                    {CTA.REPORT}
                  </Link>
                  <details className="tl-more">
                    <summary className="btn-quiet">More</summary>
                    <div className="tl-more-body">
                      {sort === "order" && picks.length > 1 && (
                        <span className="tl-move" role="group" aria-label={`Reorder ${p.symbol}`}>
                          <button type="button" className="btn-quiet" disabled={busy || i === 0} onClick={() => move(i, -1)} aria-label={`Move ${p.symbol} up`} title="Move up">
                            ↑ Move up
                          </button>
                          <button
                            type="button"
                            className="btn-quiet"
                            disabled={busy || i === picks.length - 1}
                            onClick={() => move(i, 1)}
                            aria-label={`Move ${p.symbol} down`}
                            title="Move down"
                          >
                            ↓ Move down
                          </button>
                        </span>
                      )}
                      <button className="btn-quiet" onClick={() => unpin(p.symbol)}>
                        Stop watching
                      </button>
                      <NoteEditor pick={p} onSaved={saveNote} />
                    </div>
                  </details>
                </div>
              </article>
            );
          })}
          <ShowAll total={ordered.length} shown={cards.length} open={showAll} onToggle={() => setShowAll((v) => !v)} />
        </div>
      )}

      {picks && picks.length > 0 && !simple && (
        <div className="wl-list">
          {ordered.map((p) => {
            const i = picks.findIndex((x) => x.symbol === p.symbol);
            const since = p.value != null && p.score_at_pin != null ? p.value - p.score_at_pin : null;
            const st = p.st;
            const cov = coverageOf(p);
            return (
              <article className="card wl-card" key={p.symbol} aria-label={p.symbol}>
                <div className="order" aria-label="Reorder">
                  <button disabled={busy || sort !== "order" || i === 0} onClick={() => move(i, -1)} aria-label={`Move ${p.symbol} up`}>
                    ↑
                  </button>
                  <button disabled={busy || sort !== "order" || i === picks.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${p.symbol} down`}>
                    ↓
                  </button>
                </div>
                <div className="who">
                  <Link className="sym" to={`/stock/${p.symbol}`}>
                    {p.symbol}
                  </Link>
                  <span className="theme" title={p.theme}>
                    {p.theme}
                  </span>
                  <span className="xs faint">
                    <Link to={`/industries/${p.industry.key}`}>{p.industry.label}</Link> · {p.industry.benchmark_etf}
                    {p.lane ? ` · stage ${p.lane}` : ""}
                  </span>
                  <LeadFact e={leads[p.symbol]} />
                </div>
                <div className="act">
                  {st && st.closes && st.closes.length > 1 && (
                    <span className="wl-spark">
                      <Spark closes={st.closes} width={120} height={36} />
                      <Move value={st.chg_30d} /> <span className="xs faint">30d</span>
                    </span>
                  )}
                  <PickBand p={p} />
                  <NotifyButton symbol={p.symbol} compact />
                </div>
                <div className="facts">
                  {[
                    <span key="pinned">
                      Watching since {shortDate(p.pinned_at, tz)}
                      {p.score_at_pin != null && (
                        <>
                          {" "}
                          at <b>{fmtScore(p.score_at_pin)}</b>
                        </>
                      )}
                    </span>,
                    <span key="now">
                      Now <b>{fmtScore(p.value, cov.present, cov.total)}</b>
                    </span>,
                    since != null && (
                      <span key="since">
                        Score since then <b>{delta(since)}</b>
                      </span>
                    ),
                    st && st.chg_since_pin != null && (
                      <span key="px" title={st.last_date ? `close ${shortDate(st.last_date)}` : ""}>
                        Price since then <b className={tone(st.chg_since_pin)}>{signed(st.chg_since_pin, 1, "%")}</b>
                        {st.benchmark_chg_since_pin != null && (
                          <span className="xs faint">
                            {" "}
                            vs {st.benchmark} <span className={tone(st.benchmark_chg_since_pin)}>{signed(st.benchmark_chg_since_pin, 1, "%")}</span>
                          </span>
                        )}
                      </span>
                    ),
                    st && st.earnings && (
                      <span key="earn">
                        Earnings{" "}
                        <b className={st.earnings.days >= 0 && st.earnings.days <= 14 ? "soon" : ""}>{inDays(st.earnings.days)}</b>
                        <span className="xs faint"> {shortDate(st.earnings.date, "UTC")}</span>
                      </span>
                    ),
                    st && st.hf_pass != null && (
                      <span key="rules">
                        Rules <b className={`verdict ${st.hf_pass ? "pass" : "fail"}`}>{st.hf_pass ? "PASS" : "FAIL"}</b>
                      </span>
                    ),
                    p.delta_1d != null && (
                      <span key="run">
                        Since the last scoring <b>{delta(p.delta_1d)}</b>
                      </span>
                    ),
                    st && st.unread > 0 && (
                      <Link key="unread" to={`/alerts?tab=history&symbol=${p.symbol}&unread=1`} className="chip chip-plain">
                        {st.unread} unread {st.unread === 1 ? "alert" : "alerts"}
                      </Link>
                    ),
                  ]
                    .filter(Boolean)
                    .slice(0, WATCHLIST_FACTS)}
                  <span className="spacer" />
                  <Link to={`/stock/${p.symbol}`}>{CTA.REPORT}</Link>
                  <button className="btn-quiet" onClick={() => unpin(p.symbol)}>
                    Stop watching
                  </button>
                  <NoteEditor pick={p} onSaved={saveNote} />
                </div>
              </article>
            );
          })}
        </div>
      )}

      <div className="tl-foot">
        {settings && (
          <p className="hint tl-digest">
            {settings.digest_enabled ? (
              <>
                Your weekly brief goes out {DAYS[settings.digest_day]} at {String(settings.digest_hour).padStart(2, "0")}:00 {settings.timezone}.
              </>
            ) : (
              <>Your weekly brief is off.</>
            )}{" "}
            <Link to="/digests">My week</Link> · <Link to="/settings#digest">Change</Link>
            {me && !me.verified && <> · Verify your email before the first one can send.</>}
          </p>
        )}
        <FinePrint short />
      </div>
    </div>
  );
}
