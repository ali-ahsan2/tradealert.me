import React, { useEffect, useMemo, useState } from "react";
import { api, cached } from "../api.js";
import { Link, navigate, useQuery } from "../lib/router.jsx";
import { useMe } from "../lib/me.jsx";
import { dateTime, delta, plural, shortDate } from "../lib/fmt.js";
import { EVIDENCE } from "../lib/evidence.js";
import { changeSentence } from "../lib/plain.js";
import { useMode } from "../lib/mode.js";
import ScoreBadge from "../components/ScoreBadge.jsx";
import BandBar from "../components/BandBar.jsx";
import Pin from "../components/Pin.jsx";
import NotifyButton from "../components/NotifyButton.jsx";
import Explain from "../components/Explain.jsx";
import { Empty, ErrorCard, Monogram, Notice, Skeleton, StatusChip } from "../components/ui.jsx";
import "./tools.css";

// What moved between two runs across the subscriber's universe, each row a
// plain sentence: which name, what its score did, which band it sits in
// now, and one tap to pin it or be told about it. Every list is clamped to
// the plan and says how many it left out.

const PREVIEW = 8;

const WINDOWS = [
  ["prev", "Since last run"],
  ["7d", "vs 7 days ago"],
  ["30d", "vs 30 days ago"],
  ["90d", "vs 90 days ago"],
];

const SINCE = {
  prev: "since the last run",
  "7d": "since 7 days ago",
  "30d": "since 30 days ago",
  "90d": "since 90 days ago",
};

const VERSUS = {
  prev: "the previous run",
  "7d": "7 days ago",
  "30d": "30 days ago",
  "90d": "90 days ago",
};

// [key, Full title, Simple title, one-line meaning, kind]
const SECTIONS = [
  ["band_up", "Band up", "Moved up a band", "The score crossed into a higher band."],
  ["band_down", "Band down", "Moved down a band", "The score crossed into a lower band."],
  ["cleared", "Cleared the screen", "Now pass every hard filter", "A hard filter is a pass-or-fail rule a name must clear before it is scored at all. These names now pass all of them.", "filter"],
  ["failed", "Failed the screen", "Now fail a hard filter", "These names passed every hard filter before and fail at least one now.", "filter"],
  ["new", "New on the run", "New this run", "Scored now, not scored before."],
  ["dropped", "No longer scored", "No longer scored", "Scored before, not scored now."],
  ["up", "Biggest moves up", "Biggest score rises", "The largest point gains, whether or not the band changed."],
  ["down", "Biggest moves down", "Biggest score falls", "The largest point falls, whether or not the band changed."],
  ["coverage_up", "Coverage improved", "More inputs had data", "More of the strategy's inputs had data this time, so the number rests on more.", "coverage"],
  ["coverage_down", "Coverage lost", "Fewer inputs had data", "Fewer of the strategy's inputs had data this time, so read the number as rougher.", "coverage"],
];

// One sentence per row, built from the engine's own fields. "Since the last
// run" becomes the window actually compared.
function sentenceFor(r, vs) {
  const since = SINCE[vs] || SINCE.prev;
  const ago = VERSUS[vs] || VERSUS.prev;
  if (r.now && !r.prev) return vs === "prev" ? "New on the board this run." : `Not scored ${ago}; scored now.`;
  if (!r.now && r.prev) return vs === "prev" ? "No longer scored this run." : `Scored ${ago}; not scored now.`;
  return changeSentence(r.delta, r.now && r.now.band, r.prev && r.prev.band).replace("since the last run", since);
}

function ChangeList({ title, hint, list, kind, vs, k, pinned, onPin }) {
  const [all, setAll] = useState(false);
  if (!list || list.total === 0) return null;
  const rows = all ? list.rows : list.rows.slice(0, PREVIEW);
  return (
    <section className="card" aria-label={title}>
      <div className="card-title">
        <h2>{title}</h2>
        <span className="muted small">
          {list.total} {list.total === 1 ? "name" : "names"}
          {list.truncated ? ` · your plan shows ${list.rows.length}` : ""}
        </span>
      </div>
      {hint && <p className="tl-why simple-only">{hint}</p>}
      <div>
        {rows.map((r) => (
          <div className="tl-row" key={r.symbol}>
            <div className="tl-main">
              <div className="tl-head">
                <Link className="sym" to={`/stock/${r.symbol}`}>
                  {r.symbol}
                </Link>
                <span className="tl-co" title={r.theme}>
                  {r.theme}
                </span>
              </div>
              <p className="tl-sent">{sentenceFor(r, vs)}</p>
              <p className="tl-meta full-only">
                <Link to={`/industries/${r.industry.key}`}>{r.industry.label}</Link>
                {" · before: "}
                {r.prev ? <ScoreBadge band={r.prev.band} value={r.prev.value} present={r.prev.present} total={r.prev.total} /> : "not scored"}
                {" · Δ "}
                <span className="mono">{r.delta == null ? (r.now ? "new" : "gone") : delta(r.delta)}</span>
                {kind === "coverage" && (
                  <>
                    {" · inputs with data "}
                    {r.prev ? `${r.prev.present}/${r.prev.total}` : "—"} → {r.now ? `${r.now.present}/${r.now.total}` : "—"}
                  </>
                )}
                {kind === "filter" && (
                  <>
                    {" · filters: "}
                    <span className={`verdict ${r.prev && r.prev.hf_pass ? "pass" : "fail"}`}>{r.prev && r.prev.hf_pass ? "PASS" : "FAIL"}</span> →{" "}
                    <span className={`verdict ${r.now && r.now.hf_pass ? "pass" : "fail"}`}>{r.now && r.now.hf_pass ? "PASS" : "FAIL"}</span>
                  </>
                )}
              </p>
            </div>
            <div className="tl-acts">
              {r.now ? <ScoreBadge band={r.now.band} value={r.now.value} present={r.now.present} total={r.now.total} /> : <span className="chip chip-plain">not scored</span>}
              <Pin symbol={r.symbol} pinned={pinned.has(r.symbol)} onChange={onPin} />
              <NotifyButton symbol={r.symbol} compact />
            </div>
          </div>
        ))}
      </div>
      {list.rows.length > PREVIEW && (
        <button className="btn-quiet" style={{ marginTop: "var(--s-2)", minHeight: 40 }} onClick={() => setAll((a) => !a)} aria-expanded={all}>
          {all ? "Show fewer" : `Show all ${list.rows.length}`}
        </button>
      )}
      {list.truncated && (
        <p className="xs faint" style={{ margin: "var(--s-2) 0 0" }}>
          {list.total - list.rows.length} more in your industries; your plan shows the top {k}. <Link to="/pricing">See plans</Link>.
        </p>
      )}
    </section>
  );
}

export default function Changes() {
  const { me } = useMe();
  const { simple } = useMode();
  const q = useQuery();
  const strategy = q.get("strategy") || "fast_mover";
  const vs = WINDOWS.some(([k]) => k === q.get("vs")) ? q.get("vs") : "prev";
  const [strategies, setStrategies] = useState(null);
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [reload, setReload] = useState(0);
  const [pinned, setPinned] = useState(() => new Set());

  useEffect(() => {
    cached("/strategies").then((x) => setStrategies(x.strategies)).catch(() => setStrategies([]));
  }, []);

  useEffect(() => {
    let alive = true;
    setErr(null);
    setD(null);
    api(`/changes?strategy=${encodeURIComponent(strategy)}&vs=${vs}`)
      .then((x) => alive && setD(x))
      .catch((e) => alive && setErr(e));
    return () => {
      alive = false;
    };
  }, [strategy, vs, reload]);

  // The pinned set is owned here so one Pin tap updates every list the
  // name appears in.
  useEffect(() => {
    if (!d || !d.prev_run) return;
    const s = new Set();
    SECTIONS.forEach(([key]) => ((d[key] && d[key].rows) || []).forEach((r) => r.pinned && s.add(r.symbol)));
    setPinned(s);
  }, [d]);

  const onPin = (sym, on) =>
    setPinned((prev) => {
      const n = new Set(prev);
      if (on) n.add(sym);
      else n.delete(sym);
      return n;
    });

  const go = (s, v) => navigate(`/changes?${s !== "fast_mover" ? `strategy=${s}&` : ""}${v !== "prev" ? `vs=${v}` : ""}`.replace(/[?&]$/, ""), { replace: true });
  const tz = me && me.settings ? me.settings.timezone : undefined;
  const strat = (d && d.strategy) || (strategies || []).find((s) => s.key === strategy) || { key: strategy, label: "Changes", calibrated: false };
  const s = d && d.summary;
  const bandMoved = s ? s.band_up + s.band_down : 0;
  const versus = useMemo(() => VERSUS[vs] || VERSUS.prev, [vs]);

  return (
    <div className="wrap">
      <div className="pagehead">
        <div>
          <h1>Changes</h1>
          <p className="utility">
            {!d && !err && "Comparing the latest run with the one before…"}
            {err && err.status === 404 && "No completed run yet, so there is nothing to compare."}
            {err && err.status !== 404 && "The comparison could not be loaded."}
            {d && !d.prev_run && "Only one run is on record, so there is nothing to compare yet. Changes appear once a second run completes."}
            {d && d.prev_run && s && (
              <>
                <b>{bandMoved}</b> {bandMoved === 1 ? "name" : "names"} changed band versus <b>{versus}</b>
                {bandMoved > 0 ? (
                  <>
                    : <b>{s.band_up}</b> moved up, <b>{s.band_down}</b> moved down
                  </>
                ) : null}
                {s.new > 0 ? (
                  <>
                    {bandMoved > 0 ? ", " : "; "}
                    <b>{s.new}</b> {s.new === 1 ? "is" : "are"} new
                  </>
                ) : null}
                . {plural(s.compared, "name")} compared on <b>{strat.label}</b>.
              </>
            )}
          </p>
        </div>
        <div className="actions">
          <div className="seg" role="group" aria-label="Compare with">
            {WINDOWS.map(([k, l]) => (
              <button key={k} aria-pressed={vs === k} onClick={() => go(strategy, k)}>
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* The lens row: a label says what the pills are, the pills wrap rather
          than clip mid-word, and the Provisional chip explains itself. Each
          tab is a div because the chip inside it is a button of its own. */}
      <div className="tl-lens">
        <span className="tl-lens-l">
          <Explain term="strategy">Scoring lens</Explain>:
        </span>
        <div className="tabs tl-tabs" role="tablist" aria-label="Scoring lens">
          {(strategies || [{ key: "fast_mover", label: "Fast Mover", monogram: "FM", calibrated: true }]).map((st) => (
            <div
              key={st.key}
              role="tab"
              tabIndex={0}
              className="tab"
              aria-selected={st.key === strategy}
              onClick={() => go(st.key, vs)}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  go(st.key, vs);
                }
              }}
            >
              <Monogram size={20}>{st.monogram}</Monogram>
              {st.label}
              {!st.calibrated && (
                <Explain term="provisional" className="tl-xchip">
                  <span className="chip chip-prov">Provisional</span>
                </Explain>
              )}
            </div>
          ))}
        </div>
      </div>

      {err && err.status !== 404 && <ErrorCard error={err} onRetry={() => setReload((n) => n + 1)} title="Couldn't load changes." />}
      {err && err.status === 404 && <Empty title="No completed run yet." />}
      {!err && !d && <Skeleton rows={6} height={64} />}

      {d && !d.prev_run && <Empty title="Only one run is on record.">Changes appear once a second run completes.</Empty>}

      {d && d.prev_run && (
        <>
          {!strat.calibrated && (
            <Notice tone="warn">
              <b>{strat.label}</b> is provisional: its weights are not yet backed by resolved outcomes ({strat.resolved_outcomes_count ?? 0} of {EVIDENCE.calibrationThreshold}), so
              these are moves in candidates, not signals.
            </Notice>
          )}
          <div className="boardhead">
            <b>{strat.label}</b>
            <StatusChip calibrated={strat.calibrated} short />
            <span>
              {shortDate(d.prev_run.as_of, tz)} → {dateTime(d.as_of, tz)}
            </span>
            <span>{plural(s.compared, "name")} compared</span>
            {vs !== "prev" && <span className="xs faint">(oldest run inside the window, or the oldest on record when history is shorter)</span>}
          </div>

          <div className="tiles full-only">
            <div className="tile card">
              <span className="tile-label">Band up / down</span>
              <span className="tile-value">
                {s.band_up} / {s.band_down}
              </span>
              <span className="tile-sub">crossed a band cutoff</span>
            </div>
            <div className="tile card">
              <span className="tile-label">Scores up / down</span>
              <span className="tile-value">
                {s.up} / {s.down}
              </span>
              <span className="tile-sub">mean Δ {delta(s.mean_delta)} · {s.unchanged} unchanged</span>
            </div>
            <div className="tile card">
              <span className="tile-label">Entered / left</span>
              <span className="tile-value">
                {s.new} / {s.dropped}
              </span>
              <span className="tile-sub">scored now but not before, and the reverse</span>
            </div>
            <div className="tile card">
              <span className="tile-label">Cleared / failed the screen</span>
              <span className="tile-value">
                {s.cleared} / {s.failed}
              </span>
              <span className="tile-sub">hard-filter verdict flipped</span>
            </div>
          </div>

          <section className="card" aria-labelledby="dist-h">
            <div className="card-title">
              <h2 id="dist-h">{simple ? "How names were spread across the bands, before and after" : "Band distribution, before and after"}</h2>
            </div>
            <div className="distpair">
              <div>
                <div className="xs faint">{shortDate(d.prev_run.as_of, tz)}</div>
                <BandBar distribution={d.distribution.prev} />
              </div>
              <div>
                <div className="xs faint">{shortDate(d.as_of, tz)}</div>
                <BandBar distribution={d.distribution.now} />
              </div>
            </div>
          </section>

          <div className="stack">
            {SECTIONS.map(([key, fullTitle, simpleTitle, hint, kind]) => (
              <ChangeList key={key} title={simple ? simpleTitle : fullTitle} hint={hint} list={d[key]} kind={kind} vs={vs} k={d.names_shown_limit} pinned={pinned} onPin={onPin} />
            ))}
          </div>

          {s.compared === 0 && <Empty title={`No ${strat.label} scores in your universe on either run.`} />}
          {s.compared > 0 && SECTIONS.every(([key]) => !d[key] || d[key].total === 0) && (
            <Empty title="Nothing moved between these two runs.">Every score on your names came out the same.</Empty>
          )}

          <p className="footnote">
            A band move is a crossing of this strategy's fixed cutoffs; a score move is the difference in the integer score on the 0 to 100 scale. Both are
            machine output for a human to review, not recommendations.
          </p>
        </>
      )}
    </div>
  );
}
