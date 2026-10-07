import React, { useEffect, useState } from "react";

const PREVIEW = 8;
import { api, cached } from "../api.js";
import { Link, navigate, useQuery } from "../lib/router.jsx";
import { useMe } from "../lib/me.jsx";
import { dateTime, delta, deltaTone, plural, shortDate } from "../lib/fmt.js";
import { EVIDENCE } from "../lib/evidence.js";
import ScoreBadge from "../components/ScoreBadge.jsx";
import BandBar from "../components/BandBar.jsx";
import { Empty, ErrorCard, Monogram, Notice, Skeleton, StatusChip } from "../components/ui.jsx";

// What moved between two runs across the subscriber's universe: band
// crossings, the biggest score moves, names that entered or left, filter
// verdicts that flipped, and coverage that changed. Each list is clamped
// to the plan and says how many it left out.

const WINDOWS = [
  ["prev", "Previous run"],
  ["7d", "7 days"],
  ["30d", "30 days"],
  ["90d", "90 days"],
];

function ChangeTable({ title, list, kind, tz, k }) {
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
      <div className="table-card cards" style={{ boxShadow: "none" }}>
        <table className="data compact">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Industry</th>
              <th scope="col">Before</th>
              <th scope="col">Now</th>
              <th scope="col" className="num">
                Δ
              </th>
              {kind === "coverage" && (
                <th scope="col" className="num">
                  Coverage
                </th>
              )}
              {kind === "filter" && <th scope="col">Hard filters</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.symbol} className="rowlink" onClick={() => navigate(`/stock/${r.symbol}`)}>
                <td className="name-cell c-sym">
                  <Link className="sym" to={`/stock/${r.symbol}`} onClick={(e) => e.stopPropagation()}>
                    {r.symbol}
                  </Link>
                  <span className="theme" title={r.theme}>
                    {r.theme}
                  </span>
                  {r.pinned && <span className="xs faint">pinned</span>}
                </td>
                <td className="c-ind">
                  <Link to={`/industries/${r.industry.key}`} className="ind" onClick={(e) => e.stopPropagation()}>
                    {r.industry.label}
                  </Link>
                </td>
                <td className="c-hide">
                  {r.prev ? <ScoreBadge band={r.prev.band} value={r.prev.value} present={r.prev.present} total={r.prev.total} /> : <span className="chip chip-plain">not scored</span>}
                </td>
                <td className="c-band">
                  {r.now ? <ScoreBadge band={r.now.band} value={r.now.value} present={r.now.present} total={r.now.total} /> : <span className="chip chip-plain">not scored</span>}
                </td>
                <td className={`num c-delta ${deltaTone(r.delta)}`} data-label="Δ">
                  {r.delta == null ? (r.now ? "new" : "gone") : delta(r.delta)}
                </td>
                {kind === "coverage" && (
                  <td className="num c-hide">
                    {r.prev ? `${r.prev.present}/${r.prev.total}` : "—"} → {r.now ? `${r.now.present}/${r.now.total}` : "—"}
                  </td>
                )}
                {kind === "filter" && (
                  <td className="c-hide">
                    <span className={`verdict ${r.prev && r.prev.hf_pass ? "pass" : "fail"}`}>{r.prev && r.prev.hf_pass ? "PASS" : "FAIL"}</span> →{" "}
                    <span className={`verdict ${r.now && r.now.hf_pass ? "pass" : "fail"}`}>{r.now && r.now.hf_pass ? "PASS" : "FAIL"}</span>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list.rows.length > PREVIEW && (
        <button className="btn-quiet" style={{ marginTop: "var(--s-2)" }} onClick={() => setAll((a) => !a)} aria-expanded={all}>
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
  const q = useQuery();
  const strategy = q.get("strategy") || "fast_mover";
  const vs = WINDOWS.some(([k]) => k === q.get("vs")) ? q.get("vs") : "prev";
  const [strategies, setStrategies] = useState(null);
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [reload, setReload] = useState(0);

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

  const go = (s, v) => navigate(`/changes?${s !== "fast_mover" ? `strategy=${s}&` : ""}${v !== "prev" ? `vs=${v}` : ""}`.replace(/[?&]$/, ""), { replace: true });
  const tz = me && me.settings ? me.settings.timezone : undefined;
  const strat = (d && d.strategy) || (strategies || []).find((s) => s.key === strategy) || { key: strategy, label: "Changes", calibrated: false };
  const s = d && d.summary;

  return (
    <div className="wrap">
      <div className="pagehead">
        <div>
          <h1>Changes</h1>
          <div className="meta">What moved between two runs across the names you can see: bands crossed, scores shifted, names entered or left, filters flipped.</div>
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

      <div className="tabs" role="tablist" aria-label="Strategy">
        {(strategies || [{ key: "fast_mover", label: "Fast Mover", monogram: "FM", calibrated: true }]).map((st) => (
          <button key={st.key} role="tab" className="tab" aria-selected={st.key === strategy} onClick={() => go(st.key, vs)}>
            <Monogram size={20}>{st.monogram}</Monogram>
            {st.label}
            {!st.calibrated && <span className="chip chip-prov">Provisional</span>}
          </button>
        ))}
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

          <div className="tiles">
            <div className="tile card">
              <span className="tile-label">Band up / down</span>
              <span className="tile-value">
                <span className="pos">{s.band_up}</span> / <span className="neg">{s.band_down}</span>
              </span>
              <span className="tile-sub">crossed a band cutoff</span>
            </div>
            <div className="tile card">
              <span className="tile-label">Scores up / down</span>
              <span className="tile-value">
                <span className="pos">{s.up}</span> / <span className="neg">{s.down}</span>
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
                <span className="pos">{s.cleared}</span> / <span className="neg">{s.failed}</span>
              </span>
              <span className="tile-sub">hard-filter verdict flipped</span>
            </div>
          </div>

          <section className="card" aria-labelledby="dist-h">
            <div className="card-title">
              <h2 id="dist-h">Band distribution, before and after</h2>
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
            <ChangeTable title="Band up" list={d.band_up} tz={tz} k={d.names_shown_limit} />
            <ChangeTable title="Band down" list={d.band_down} tz={tz} k={d.names_shown_limit} />
            <ChangeTable title="Cleared the screen" list={d.cleared} kind="filter" tz={tz} k={d.names_shown_limit} />
            <ChangeTable title="Failed the screen" list={d.failed} kind="filter" tz={tz} k={d.names_shown_limit} />
            <ChangeTable title="New on the run" list={d.new} tz={tz} k={d.names_shown_limit} />
            <ChangeTable title="No longer scored" list={d.dropped} tz={tz} k={d.names_shown_limit} />
            <ChangeTable title="Biggest moves up" list={d.up} tz={tz} k={d.names_shown_limit} />
            <ChangeTable title="Biggest moves down" list={d.down} tz={tz} k={d.names_shown_limit} />
            <ChangeTable title="Coverage improved" list={d.coverage_up} kind="coverage" tz={tz} k={d.names_shown_limit} />
            <ChangeTable title="Coverage lost" list={d.coverage_down} kind="coverage" tz={tz} k={d.names_shown_limit} />
          </div>

          {s.compared === 0 && <Empty title={`No ${strat.label} scores in your universe on either run.`} />}

          <p className="footnote">
            A band move is a crossing of this strategy's fixed cutoffs; a score move is the difference in the integer score on the 0 to 100 scale. Both are
            machine output for a human to review, not recommendations.
          </p>
        </>
      )}
    </div>
  );
}
