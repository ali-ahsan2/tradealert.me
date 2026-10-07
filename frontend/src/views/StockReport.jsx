import React, { useEffect, useState } from "react";
import { api, toast } from "../api.js";
import { Link, navigate, useQuery } from "../lib/router.jsx";
import { useMe } from "../lib/me.jsx";
import { coverage, dateTime, delta, deltaTone, plural, score as fmtScore, shortDate } from "../lib/fmt.js";
import { EVIDENCE, HARD_FILTER_FORMAT, SNAPSHOT_LABELS, nounFor } from "../lib/evidence.js";
import SearchBar from "../components/SearchBar.jsx";
import ScoreBadge from "../components/ScoreBadge.jsx";
import Pin from "../components/Pin.jsx";
import { AgeChip, ErrorCard, Monogram, Skeleton, StatusChip } from "../components/ui.jsx";

const COVERAGE_SENTENCE = {
  full: "Full coverage",
  partial: "Partial coverage",
  thin: "Thin coverage",
};

// Byte-identical for a name outside the subscriber's universe and a name
// that does not exist. No upgrade prompt here, ever.
function NotAvailable({ symbol }) {
  return (
    <div className="wrap wrap-narrow">
      <Link to="/board" className="backlink">
        ← Board
      </Link>
      <div className="card state-card">
        <p className="state-title">No report available for {symbol.toUpperCase()}.</p>
        <p className="muted">Search your universe for another name.</p>
        <div style={{ display: "flex", justifyContent: "center", marginTop: "var(--s-3)" }}>
          <SearchBar />
        </div>
        <Link to="/board" className="btn btn-secondary">
          Back to Board
        </Link>
      </div>
    </div>
  );
}

export default function StockReport({ symbol }) {
  const { me } = useMe();
  const q = useQuery();
  const strategyKey = q.get("strategy") || "fast_mover";
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [reload, setReload] = useState(0);
  const [pinned, setPinned] = useState(false);
  const [cap, setCap] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setErr(null);
    setD(null);
    api(`/stock/${encodeURIComponent(symbol)}?strategy=${encodeURIComponent(strategyKey)}`)
      .then((x) => {
        if (!alive) return;
        setD(x);
        setPinned(Boolean(x.pinned));
      })
      .catch((e) => alive && setErr(e));
    return () => {
      alive = false;
    };
  }, [symbol, strategyKey, reload]);

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

  if (err) {
    if (err.status === 404) return <NotAvailable symbol={symbol} />;
    return (
      <div className="wrap wrap-narrow">
        <Link to="/board" className="backlink">
          ← Board
        </Link>
        <ErrorCard error={err} onRetry={() => setReload((n) => n + 1)} title="Couldn't load this report." />
      </div>
    );
  }

  if (!d) {
    return (
      <div className="wrap">
        <Link to="/board" className="backlink">
          ← Board
        </Link>
        <div className="rhead">
          <h1>{symbol.toUpperCase()}</h1>
        </div>
        <div className="report">
          <div className="report-main stack">
            <Skeleton rows={3} height={64} />
            <Skeleton rows={5} height={40} />
          </div>
          <Skeleton rows={6} height={36} />
        </div>
      </div>
    );
  }

  const s = d.score;
  const strat = d.strategy;
  const tz = me && me.settings ? me.settings.timezone : undefined;
  const noun = nounFor(strat);
  const cov = s ? coverage(s.components_present, s.components_total) : null;
  const atCap = cap && cap.limit != null && cap.used >= cap.limit && !pinned;
  const snaps = Object.entries(d.snapshot || {});
  const missing = s ? Math.max(0, s.components_total - s.components_present) : 0;
  const hardFilters = s && s.hard_filters ? s.hard_filters : [];
  const components = s && s.components ? s.components : [];

  const swap = async () => {
    setBusy(true);
    try {
      const r = await api("/me/picks/swap", { method: "POST", json: { symbol: d.symbol } });
      toast(r.dropped ? `Dropped ${r.dropped} and pinned ${d.symbol}.` : `Pinned ${d.symbol}.`);
      setPinned(true);
    } catch (e2) {
      toast(e2.detail || "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wrap">
      <Link to="/board" className="backlink">
        ← Board
      </Link>

      <header className="rhead">
        <div>
          <h1>
            {d.symbol}
            <span className="company">{d.theme}</span>
          </h1>
          <div className="meta">
            {d.industry.label} · benchmark <span className="mono">{d.industry.benchmark_etf}</span>
            {d.lane ? ` · lane ${d.lane}` : ""}
            {d.group ? ` · group ${d.group}` : ""}
          </div>
        </div>
        <div className="actions">
          <Pin symbol={d.symbol} pinned={pinned} onChange={(_, on) => setPinned(on)} label />
          {atCap && (
            <button
              className="btn btn-secondary btn-sm"
              disabled={busy}
              onClick={swap}
              title="Drops your oldest watchlist pick to make room"
            >
              Replace oldest pick ({cap.used}/{cap.limit})
            </button>
          )}
          <Link to={`/alerts?tab=armed&symbol=${encodeURIComponent(d.symbol)}`} className="btn btn-secondary btn-sm">
            Arm an alert
          </Link>
          <button className="btn-quiet" onClick={() => window.print()}>
            Print
          </button>
        </div>
      </header>

      <div className="report">
        <div className="report-main stack">
          <section className="card scoreblock" aria-labelledby="score-h">
            <h2 id="score-h" className="sr-only">
              Score
            </h2>
            {s ? (
              <>
                <div className="row1">
                  <ScoreBadge
                    size="full"
                    band={s.band}
                    value={s.value}
                    present={s.components_present}
                    total={s.components_total}
                    strategy={strat}
                  />
                  <div className="strat">
                    <div className="strat-name">
                      <Monogram>{strat.monogram}</Monogram>
                      {strat.label}
                      <StatusChip calibrated={strat.calibrated} />
                    </div>
                    <div className="muted small">
                      {strat.calibrated
                        ? `A ${noun} from the calibrated strategy · run ${dateTime(d.run.as_of, tz)}`
                        : `A ${noun}; weights not yet backed by resolved outcomes · run ${dateTime(d.run.as_of, tz)}`}
                    </div>
                  </div>
                </div>
                <div className="row2">
                  <div>
                    <b>{COVERAGE_SENTENCE[cov.state]}</b> · {s.components_present} of {s.components_total}{" "}
                    components had data on this run.
                  </div>
                  {s.shrinkage_applied != null && Math.abs(s.shrinkage_applied) >= 0.5 && (
                    <div>
                      Shrunk toward neutral (40) from <b>{Math.round(s.shrinkage_from ?? s.value)}</b> to{" "}
                      <b>{Math.round(s.value)}</b> because {missing} of {s.components_total} components
                      had no data.
                    </div>
                  )}
                  {s.delta_1d != null && (
                    <div>
                      <span className={deltaTone(s.delta_1d)}>{delta(s.delta_1d)}</span> since the previous run.
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="row1">
                <div className="strat">
                  <div className="strat-name">
                    <Monogram>{strat.monogram}</Monogram>
                    {strat.label}
                    <StatusChip calibrated={strat.calibrated} />
                  </div>
                  <div className="muted small">
                    No {strat.label} score for {d.symbol} on the run at {dateTime(d.run.as_of, tz)}.
                  </div>
                </div>
              </div>
            )}
            <div className="lenses" role="group" aria-label="Other strategies">
              {d.strategies.map((l) => (
                <button
                  key={l.key}
                  className="lens"
                  aria-pressed={l.key === strat.key}
                  onClick={() =>
                    navigate(
                      l.key === "fast_mover"
                        ? `/stock/${d.symbol}`
                        : `/stock/${d.symbol}?strategy=${encodeURIComponent(l.key)}`,
                      { replace: true }
                    )
                  }
                  title={l.calibrated ? "Calibrated" : "Provisional — uncalibrated"}
                >
                  <Monogram size={18}>{l.monogram}</Monogram>
                  {l.label}
                  <span className="mono">{l.value != null ? `${l.band} ${fmtScore(l.value)}` : "no run"}</span>
                </button>
              ))}
            </div>
          </section>

          {hardFilters.length > 0 && (
            <section className="card" aria-labelledby="hf-h">
              <div className="card-title">
                <h2 id="hf-h">Hard filters</h2>
                <span className="muted small">
                  {EVIDENCE.hits} of {EVIDENCE.events} filter-passing events moved ({EVIDENCE.hitRate}%)
                </span>
              </div>
              <p className="muted small">
                The filters are the evidenced part of the system; the scorecard below only ranks
                what passes them. Each row shows the actual figure against the rule.
              </p>
              <table className="hf">
                <thead>
                  <tr>
                    <th scope="col">Criterion</th>
                    <th scope="col" className="num">
                      Actual
                    </th>
                    <th scope="col">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {hardFilters.map((f) => (
                    <tr key={f.key}>
                      <td>{f.label}</td>
                      <td className="num">{(HARD_FILTER_FORMAT[f.key] || String)(f.value)}</td>
                      <td>
                        <span className={`verdict ${f.pass ? "pass" : "fail"}`}>
                          {f.pass ? "✓ PASS" : "✕ FAIL"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {s && (
            <section className="card" aria-labelledby="bd-h">
              <div className="card-title">
                <h2 id="bd-h">Score breakdown</h2>
                <span className="muted small">{components.length} components with data</span>
              </div>
              <p className="muted small">
                Weights renormalise over the components that had data.{" "}
                {missing > 0
                  ? `${plural(missing, "component")} had none on this run; the weight was redistributed, not zeroed, and the total was shrunk toward neutral.`
                  : "Every declared component had data on this run."}
              </p>
              {components.length === 0 ? (
                <p className="muted small">No per-component detail was stored for this score.</p>
              ) : (
                <div className="complist">
                  {components.map((c) => {
                    const judgment = !c.backed;
                    const assumed = typeof c.value === "string" && c.value.includes("(assumed)");
                    return (
                      <div key={c.key} className="comp">
                        <div className="lbl">
                          {c.label}
                          {judgment && <span className="judg"> · judgment</span>}
                          {!judgment && assumed && <span className="judg"> · assumed</span>}
                          {c.value != null && <span className="val">{String(c.value)}</span>}
                        </div>
                        <div className="track" aria-hidden="true">
                          <span className="fill" style={{ width: `${Math.round((c.score || 0) * 100)}%` }} />
                        </div>
                        <div className="w" title="desirability 0–1 × weight">
                          {(c.score ?? 0).toFixed(2)} × {c.weight}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {s && s.haircuts && s.haircuts.length > 0 && (
            <section className="haircuts" aria-labelledby="hc-h">
              <h3 id="hc-h">Haircuts and penalties</h3>
              <ul>
                {s.haircuts.map((h, i) => (
                  <li key={i}>
                    <span className="mono">−{h.points}</span> · {h.label}
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

          {(d.hook || d.thesis) && (
            <section className="card opnote" aria-labelledby="op-h">
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
        </div>

        <aside className="sidebar" aria-label="Evidence">
          <section>
            <h3>Data on file</h3>
            {snaps.length === 0 ? (
              <div className="aside-note">
                No market snapshot is on file for this name. The score above rests on the
                operator's research pass and whatever filings the pipeline has read.
              </div>
            ) : (
              snaps.map(([k, v]) => {
                const [label, fmt] = SNAPSHOT_LABELS[k] || [k, (x) => x];
                return (
                  <div className="kv" key={k}>
                    <span className="k">{label}</span>
                    <span className="v">
                      {fmt(v.value)}
                      <AgeChip asOf={v.as_of} />
                    </span>
                  </div>
                );
              })
            )}
          </section>
          <section>
            <h3>Run</h3>
            <div className="kv">
              <span className="k">Scored</span>
              <span className="v">{shortDate(d.run.as_of, tz)}</span>
            </div>
            {s && s.delta_1d != null && (
              <div className="kv">
                <span className="k">Δ vs prior run</span>
                <span className={`v ${deltaTone(s.delta_1d)}`}>{delta(s.delta_1d)}</span>
              </div>
            )}
          </section>
          <section>
            <h3>Calibration record</h3>
            {strat.calibrated ? (
              <div className="aside-note">
                {strat.label} is calibrated on {strat.resolved_outcomes_count} resolved outcomes.
                Filter-passing events moved {EVIDENCE.hitRate}% of the time ({EVIDENCE.hits} of{" "}
                {EVIDENCE.events}), against {EVIDENCE.earningsRate}% for earnings events generally and{" "}
                {EVIDENCE.randomRate}% on a random day. The test measures movement, not direction or
                profit, over {EVIDENCE.window}.
              </div>
            ) : (
              <div className="aside-note">
                {strat.label} has {strat.resolved_outcomes_count ?? 0} resolved outcomes. Its weights can
                be calibrated once {EVIDENCE.calibrationThreshold} resolve. Until then it produces
                candidates, not signals.
              </div>
            )}
          </section>
          <section>
            <div className="aside-note">
              Not investment advice. Every figure here is a claim to re-verify against its primary
              source before you act on it.
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
