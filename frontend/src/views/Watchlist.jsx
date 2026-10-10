import React, { useEffect, useMemo, useState } from "react";
import { api, cached, toast } from "../api.js";
import { Link } from "../lib/router.jsx";
import { useMe } from "../lib/me.jsx";
import { DAYS, delta, dollars, downloadText, inDays, plural, score as fmtScore, shortDate, signed, toCsv, tone } from "../lib/fmt.js";
import { GLOSSARY } from "../lib/glossary.js";
import { bandWord } from "../lib/plain.js";
import { useMode } from "../lib/mode.js";
import ScoreBadge from "../components/ScoreBadge.jsx";
import Spark, { Move } from "../components/Spark.jsx";
import NotifyButton from "../components/NotifyButton.jsx";
import { Empty, ErrorCard, Notice, Skeleton } from "../components/ui.jsx";
import "./tools.css";

// The names the subscriber pinned, each in plain words: what the score has
// done since they pinned it, the next dated event, a 30-day sparkline and
// one tap to be told about it. Full mode keeps the stat tiles, the facts
// row, reordering, notes, compare and the CSV export.

const SORTS = {
  order: ["Your order", null],
  score: ["Score", (a, b) => (b.value ?? -1) - (a.value ?? -1)],
  since_pin: ["Score since pinned", (a, b) => ((b.value ?? 0) - (b.score_at_pin ?? 0)) - ((a.value ?? 0) - (a.score_at_pin ?? 0))],
  px: ["Price since pinned", (a, b) => ((b.st && b.st.chg_since_pin) ?? -Infinity) - ((a.st && a.st.chg_since_pin) ?? -Infinity)],
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

// The score since pinning, as one sentence from the stored figures. The
// current score keeps its ~ on thin coverage; the score at pin has no
// coverage on record, so it is the stored integer.
function sincePinSentence(p) {
  if (p.value == null) return "No score on this run.";
  const { present, total } = coverageOf(p);
  const now = fmtScore(p.value, present, total);
  if (p.score_at_pin == null) return `Scores ${now} now; no score was on file when you pinned it.`;
  const was = fmtScore(p.score_at_pin);
  const dlt = Math.round(p.value) - Math.round(p.score_at_pin);
  if (dlt === 0) return `Same score as when you pinned it, ${now}.`;
  return `Score ${dlt > 0 ? "up" : "down"} ${Math.abs(dlt)} point${Math.abs(dlt) === 1 ? "" : "s"} since you pinned it, from ${was} to ${now}.`;
}

// The badge, only with the coverage it can prove. ScoreBadge draws a full
// bar when the counts are missing, so without them the band word and the
// score() figure stand alone with a hint.
function PickBand({ p }) {
  if (!p.band) return <span className="chip chip-plain">No run</span>;
  const { present, total, known } = coverageOf(p);
  if (known) return <ScoreBadge band={p.band} value={p.value} present={present} total={total} />;
  return (
    <span className="tl-nocov" title="The run did not record how many inputs had data for this score">
      <span>
        <b>{bandWord(p.band)}</b> <span className="mono">{fmtScore(p.value)}</span>
      </span>
      <span className="hint">input count not on file</span>
    </span>
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
      <textarea value={v} maxLength={280} onChange={(e) => setV(e.target.value)} placeholder="Why you pinned it, what would change your mind…" />
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
      toast(`Removed ${sym} from your watchlist.`);
    } catch (e) {
      toast(e.detail || "Couldn't unpin. Try again.");
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
    downloadText(`tradealert-watchlist-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(ordered, cols) + "\n# Research and information only; not investment advice.\n");
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

  return (
    <div className="wrap">
      <div className="pagehead">
        <div>
          <h1>Watchlist</h1>
          <p className="utility">
            {!picks && !err && "Checking the names you follow…"}
            {err && "Your watchlist could not be loaded."}
            {picks &&
              (picks.length === 0 ? (
                <>
                  You follow no names yet{tier && limit != null ? <>; {tier.label} lets you pin up to <b>{limit}</b></> : null}.
                </>
              ) : (
                <>
                  You follow <b>{used}</b> {used === 1 ? "name" : "names"}
                  {tier && limit != null ? ` (${used} of ${limit} on ${tier.label})` : ""}.{" "}
                  {comparable === 0 ? (
                    <>No score was on file when you pinned them, so there is nothing to compare yet</>
                  ) : higher + lower > 0 ? (
                    <>
                      <b>{higher}</b> score higher than when you pinned {higher === 1 ? "it" : "them"} and <b>{lower}</b> lower
                    </>
                  ) : (
                    <>None has changed score since you pinned it</>
                  )}
                  {withAlerts == null ? "." : withAlerts === 0 ? "; none has alerts on yet." : <>; <b>{withAlerts}</b> {withAlerts === 1 ? "has" : "have"} alerts on.</>}
                </>
              ))}
          </p>
        </div>
        <div className="actions">
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
          <Link to="/screen?pinned=1" className="btn btn-secondary btn-sm full-only">
            Screen my picks
          </Link>
          <Link to="/board" className="btn btn-secondary btn-sm">
            Pin more from the Board
          </Link>
        </div>
      </div>

      {summary && summary.count > 0 && (
        <div className="tiles full-only">
          <div className="tile card">
            <span className="tile-label">Score since pinned</span>
            <span className="tile-value">{delta(summary.mean_score_delta_since_pin)}</span>
            <span className="tile-sub">mean across {plural(summary.count, "pick")}</span>
          </div>
          <div className="tile card">
            <span className="tile-label">Price since pinned</span>
            <span className={`tile-value ${tone(summary.mean_chg_since_pin)}`}>{signed(summary.mean_chg_since_pin, 1, "%")}</span>
            <span className="tile-sub">
              {summary.mean_rel_since_pin != null ? `${signed(summary.mean_rel_since_pin, 1, "%")} vs each name's industry ETF` : "no benchmark bars yet"}
            </span>
          </div>
          <div className="tile card">
            <span className="tile-label">Pass every filter</span>
            <span className="tile-value">{summary.cleared}</span>
            <span className="tile-sub">every Fast Mover hard filter passed</span>
          </div>
          <div className="tile card">
            <span className="tile-label">Earnings in 14 days</span>
            <span className="tile-value">{summary.earnings_14d}</span>
            <span className="tile-sub">
              {summary.unread} unread {summary.unread === 1 ? "alert" : "alerts"} · {summary.armed} armed
            </span>
          </div>
        </div>
      )}

      {settings && (
        <Notice tone="info">
          {settings.digest_enabled ? (
            <>
              Weekly digest: {DAYS[settings.digest_day]} at {String(settings.digest_hour).padStart(2, "0")}:00 {settings.timezone}, to {me ? me.email : "you"}.
            </>
          ) : (
            <>Your weekly digest is off.</>
          )}{" "}
          <Link to="/digests">Preview and past digests</Link> · <Link to="/settings#digest">Change</Link>
          {me && !me.verified && <> · Verify your email before the first one can send.</>}
        </Notice>
      )}

      {atQuota && picks && picks.length > 0 && (
        <Notice tone="warn">
          You're using all {limit} picks on {tier.label}.
          {nextTier ? (
            <>
              {" "}
              Unpin one, or {nextTier.label} follows {plural(nextTier.picks_limit, "name")} for you for {dollars(nextTier.price_monthly_cents)}/mo.{" "}
              <Link to="/pricing">See plans</Link>
            </>
          ) : (
            " Unpin one to make room."
          )}
        </Notice>
      )}

      {err && <ErrorCard error={err} onRetry={() => setReload((n) => n + 1)} title="Couldn't load your watchlist." />}
      {!err && !picks && <Skeleton rows={3} height={96} />}

      {picks && picks.length === 0 && (
        <Empty
          title="Your watchlist is empty."
          action={
            <Link to="/board" className="btn btn-primary">
              Go to the Board
            </Link>
          }
        >
          {GLOSSARY.pin.short} We keep a note of the score on the day you pin a name, so this page can tell you what has changed since.
          {tier && limit != null && (
            <>
              {" "}
              {tier.label} includes {plural(limit, "pick")}
              {nextTier ? `; ${nextTier.label} includes ${nextTier.picks_limit}.` : "."}
            </>
          )}
        </Empty>
      )}

      {picks && picks.length > 0 && simple && (
        <div className="wl-list">
          {ordered.map((p) => {
            const st = p.st;
            const i = picks.findIndex((x) => x.symbol === p.symbol);
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
                  <p className="tl-sent">{sincePinSentence(p)}</p>
                  <p className="tl-meta">
                    {st && st.earnings ? (
                      <>
                        Earnings <b className={st.earnings.days >= 0 && st.earnings.days <= 14 ? "soon" : ""}>{plainDays(st.earnings.days)}</b> ({shortDate(st.earnings.date, "UTC")})
                      </>
                    ) : (
                      "No dated event on file"
                    )}
                    {" · pinned "}
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
                      <Move value={st.chg_30d} /> <span className="xs faint">30d</span>
                    </span>
                  )}
                  <PickBand p={p} />
                </div>
                <div className="tl-acts">
                  <NotifyButton symbol={p.symbol} compact />
                  <Link to={`/stock/${p.symbol}`} className="btn btn-secondary btn-sm">
                    Open report
                  </Link>
                  <button className="btn-quiet" onClick={() => unpin(p.symbol)}>
                    Unpin
                  </button>
                  {sort === "order" && picks.length > 1 && (
                    <span className="tl-move" role="group" aria-label={`Reorder ${p.symbol}`}>
                      <button type="button" className="btn-quiet" disabled={busy || i === 0} onClick={() => move(i, -1)} aria-label={`Move ${p.symbol} up`} title="Move up">
                        ↑
                      </button>
                      <button type="button" className="btn-quiet" disabled={busy || i === picks.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${p.symbol} down`} title="Move down">
                        ↓
                      </button>
                    </span>
                  )}
                  <NoteEditor pick={p} onSaved={saveNote} />
                </div>
              </article>
            );
          })}
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
                    {p.lane ? ` · lane ${p.lane}` : ""}
                  </span>
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
                  <span>
                    Pinned {shortDate(p.pinned_at, tz)}
                    {p.score_at_pin != null && (
                      <>
                        {" "}
                        at <b>{fmtScore(p.score_at_pin)}</b>
                      </>
                    )}
                  </span>
                  <span>
                    Now <b>{fmtScore(p.value, cov.present, cov.total)}</b>
                  </span>
                  <span>
                    Since pinned <b>{since == null ? "—" : delta(since)}</b>
                  </span>
                  <span>
                    Since last run <b>{delta(p.delta_1d)}</b>
                  </span>
                  {st && st.chg_since_pin != null && (
                    <span title={st.last_date ? `close ${shortDate(st.last_date)}` : ""}>
                      Price since pinned <b className={tone(st.chg_since_pin)}>{signed(st.chg_since_pin, 1, "%")}</b>
                      {st.benchmark_chg_since_pin != null && (
                        <span className="xs faint">
                          {" "}
                          vs {st.benchmark} <span className={tone(st.benchmark_chg_since_pin)}>{signed(st.benchmark_chg_since_pin, 1, "%")}</span>
                        </span>
                      )}
                    </span>
                  )}
                  {st && st.hf_pass != null && (
                    <span>
                      Filters: <b className={`verdict ${st.hf_pass ? "pass" : "fail"}`}>{st.hf_pass ? "PASS" : "FAIL"}</b>
                    </span>
                  )}
                  {st && st.earnings && (
                    <span>
                      Earnings{" "}
                      <b className={st.earnings.days >= 0 && st.earnings.days <= 14 ? "soon" : ""}>
                        {inDays(st.earnings.days)}
                      </b>
                      <span className="xs faint"> {shortDate(st.earnings.date, "UTC")}</span>
                    </span>
                  )}
                  {st && st.unread > 0 && (
                    <Link to={`/alerts?tab=history&symbol=${p.symbol}&unread=1`} className="chip chip-plain">
                      {st.unread} unread {st.unread === 1 ? "alert" : "alerts"}
                    </Link>
                  )}
                  <span className="spacer" />
                  <Link to={`/stock/${p.symbol}`}>Open full report</Link>
                  <button className="btn-quiet" onClick={() => unpin(p.symbol)}>
                    Unpin
                  </button>
                  <NoteEditor pick={p} onSaved={saveNote} />
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
