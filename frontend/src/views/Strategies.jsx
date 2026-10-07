import React, { useEffect, useState } from "react";
import { api, cached, getToken } from "../api.js";
import { Link } from "../lib/router.jsx";
import { dateTime, pct, plural, shortDate } from "../lib/fmt.js";
import { EVIDENCE, nounFor } from "../lib/evidence.js";
import { ErrorCard, Monogram, Notice, Skeleton, StatusChip } from "../components/ui.jsx";

const BANDS = ["strong", "elevated", "neutral", "weak", "excluded"];

// The evidence pages PRODUCT_DESIGN §3.3 asks every status badge to link to:
// what a strategy declares, what has been tested, and what it has not.

export default function Strategies() {
  const [list, setList] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    cached("/strategies").then((d) => setList(d.strategies)).catch((e) => setErr(e));
  }, []);
  return (
    <div className="wrap">
      <div className="pagehead">
        <div>
          <h1>Strategies</h1>
          <div className="meta">
            One engine, five lenses. Each declares its own components and runs through the same
            scoring math; only one has the resolved outcomes to back its weights.
          </div>
        </div>
      </div>
      {err && <ErrorCard error={err} title="Couldn't load strategies." onRetry={() => window.location.reload()} />}
      {!err && !list && <Skeleton rows={3} height={120} />}
      {list && (
        <div className="strat-grid">
          {list.map((s) => (
            <Link to={`/strategies/${s.key}`} className="card strat-card" key={s.key}>
              <div className="sc-top">
                <Monogram>{s.monogram}</Monogram>
                <h3>{s.label}</h3>
                <StatusChip calibrated={s.calibrated} short />
              </div>
              <p className="muted small" style={{ marginBottom: 0 }}>
                Produces {nounFor(s)}s.{" "}
                {s.calibrated
                  ? `Calibrated ${s.calibrated_at ? shortDate(s.calibrated_at) : ""} on ${s.resolved_outcomes_count} resolved outcomes.`
                  : `${s.resolved_outcomes_count ?? 0} of ${EVIDENCE.calibrationThreshold} resolved outcomes needed before weights can be calibrated.`}
              </p>
              <div className="sc-facts">
                <span>Evidence page →</span>
              </div>
            </Link>
          ))}
        </div>
      )}
      <p className="footnote">
        Calibration is a dated human decision on journal evidence, never automatic. A strategy's
        page records every such event.
      </p>
    </div>
  );
}

function fmtFilter(f) {
  const unit = f.unit ? ` ${f.unit}` : "";
  if (f.op === "between" && Array.isArray(f.value)) {
    return `${fmtNum(f.value[0], f.unit)} to ${fmtNum(f.value[1], f.unit)}`;
  }
  return `${f.op || ""} ${fmtNum(f.value, f.unit)}${unit && !/USD|shares/.test(f.unit || "") ? "" : ""}`.trim();
}

function fmtNum(v, unit) {
  if (v == null) return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  if (unit === "USD") return n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : `$${Math.round(n / 1e6)}M`;
  if (unit === "shares") return `${Math.round(n / 1e6)}M shares`;
  return `${n}${unit && !/USD|shares/.test(unit) ? ` ${unit}` : ""}`;
}

export function StrategyDetail({ strategyKey }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    setD(null);
    setErr(null);
    api(`/strategies/${encodeURIComponent(strategyKey)}`)
      .then((x) => alive && setD(x))
      .catch((e) => alive && setErr(e));
    return () => {
      alive = false;
    };
  }, [strategyKey, reload]);

  if (err) {
    return (
      <div className="wrap wrap-narrow">
        <Link to="/strategies" className="backlink">
          ← Strategies
        </Link>
        {err.status === 404 ? (
          <div className="card state-card">
            <p className="state-title">No such strategy.</p>
          </div>
        ) : (
          <ErrorCard error={err} onRetry={() => setReload((n) => n + 1)} />
        )}
      </div>
    );
  }
  if (!d) {
    return (
      <div className="wrap">
        <Skeleton rows={4} height={100} />
      </div>
    );
  }

  const noun = nounFor(d);
  const cutoffs = d.band_cutoffs || {};
  const scale = [
    ["strong", cutoffs.strong],
    ["elevated", cutoffs.elevated],
    ["neutral", cutoffs.neutral],
    ["weak", cutoffs.weak ?? 0],
  ].filter(([, v]) => v != null);
  const cal = d.calibration;
  const dist = d.latest_run ? d.latest_run.distribution : {};
  const distTotal = Object.values(dist).reduce((a, b) => a + b, 0);

  return (
    <div className="wrap">
      <Link to="/strategies" className="backlink">
        ← Strategies
      </Link>
      <div className="pagehead">
        <div>
          <h1 className="row">
            <Monogram size={28}>{d.monogram}</Monogram>
            {d.label}
            <StatusChip calibrated={d.calibrated} />
          </h1>
          <div className="meta">
            Produces {noun}s ·{" "}
            {d.calibrated
              ? `calibrated ${d.calibrated_at ? shortDate(d.calibrated_at) : ""} on ${d.resolved_outcomes_count} resolved outcomes`
              : `${d.resolved_outcomes_count ?? 0} of ${EVIDENCE.calibrationThreshold} resolved outcomes`}
            {d.version ? ` · version ${d.version.number} (${d.version.state})` : ""}
          </div>
        </div>
        <div className="actions">
          {getToken() && (
            <Link to={d.key === "fast_mover" ? "/board" : `/board?strategy=${d.key}`} className="btn btn-primary btn-sm">
              Open the Board on this lens
            </Link>
          )}
        </div>
      </div>

      {d.publishing_paused && (
        <Notice tone="warn">
          Publishing is paused for this strategy{d.publishing_paused_reason ? `: ${d.publishing_paused_reason}` : "."} Scores
          still compute; nothing new is sent.
        </Notice>
      )}

      <div className="report">
        <div className="report-main stack">
          <section className="card">
            <h2>What it screens for</h2>
            <p style={{ maxWidth: "68ch", lineHeight: 1.6, marginBottom: 0 }}>{d.description}</p>
            {d.score_evidence_note && <p className="muted small" style={{ marginTop: "var(--s-3)", marginBottom: 0 }}>{d.score_evidence_note}</p>}
          </section>

          <section className="card">
            <div className="card-title">
              <h2>Evidence</h2>
              <span className="muted small">{d.calibrated ? "Backtested" : "Not yet tested on outcomes"}</span>
            </div>
            {d.key === "fast_mover" ? (
              <>
                <p style={{ maxWidth: "68ch", lineHeight: 1.6 }}>
                  Across {EVIDENCE.events} events on {EVIDENCE.tickers} names over roughly two years, the names that cleared
                  every hard filter moved <b>{EVIDENCE.hitRate}%</b> of the time ({EVIDENCE.hits} of {EVIDENCE.events}), against{" "}
                  {EVIDENCE.earningsRate}% for earnings events generally and {EVIDENCE.randomRate}% on a random day. A hit is{" "}
                  {EVIDENCE.hitDefinition}, measured from {EVIDENCE.window}.
                </p>
                <div className="card card-sunken" style={{ marginBottom: 0 }}>
                  <p className="eyebrow">What the test does not prove</p>
                  <ul className="small" style={{ margin: "var(--s-2) 0 0", paddingLeft: "1.2em", lineHeight: 1.7 }}>
                    <li>It measures whether a large move happened, not its direction.</li>
                    <li>No trades are simulated and no profit is claimed.</li>
                    <li>{EVIDENCE.events} events is a small sample across a limited set of regimes.</li>
                  </ul>
                </div>
              </>
            ) : (
              <p style={{ maxWidth: "68ch", lineHeight: 1.6, marginBottom: 0 }}>
                The inputs are wired and every component scores, but no resolved outcomes back the weights yet. Until{" "}
                {EVIDENCE.calibrationThreshold} outcomes resolve and a human reviews them, this strategy produces candidates,
                not signals, and its band words are not comparable to Fast Mover's.
              </p>
            )}
          </section>

          <section className="card">
            <div className="card-title">
              <h2>Declared components</h2>
              <span className="muted small">
                {d.components.length ? `${d.components.length} components · weights sum to ${Math.round(d.declared_weight_total)}` : "none declared yet"}
              </span>
            </div>
            <p className="muted small">
              Weights renormalise over the components that have data on a given run; the share column is each weight's part of
              the declared total.
            </p>
            {d.components.length === 0 ? (
              <p className="muted small" style={{ marginBottom: 0 }}>
                No component weights are declared on the live version yet.
              </p>
            ) : (
              <div className="weights">
                {d.components.map((c) => (
                  <div className="weight-row" key={c.key}>
                    <span>{c.label}</span>
                    <span className="cmp-track" style={{ margin: 0 }} aria-hidden="true">
                      <span style={{ width: `${Math.round((c.share || 0) * 100)}%` }} />
                    </span>
                    <span className="w">
                      {c.weight}
                      {c.share != null ? ` · ${Math.round(c.share * 100)}%` : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {d.hard_filters.length > 0 && (
            <section className="card">
              <div className="card-title">
                <h2>Hard filters</h2>
                <span className="muted small">the evidenced claim</span>
              </div>
              <table className="hf">
                <thead>
                  <tr>
                    <th scope="col">Criterion</th>
                    <th scope="col" className="num">
                      Rule
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {d.hard_filters.map((f) => (
                    <tr key={f.key}>
                      <td>{f.label}</td>
                      <td className="num">{fmtFilter(f)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {scale.length > 0 && (
            <section className="card">
              <div className="card-title">
                <h2>Bands</h2>
                <span className="muted small">lower bound of each band, on a 0 to 100 score</span>
              </div>
              <div className="cutoffs" role="img" aria-label={scale.map(([b, v]) => `${b} from ${v}`).join(", ")}>
                {[...scale].reverse().map(([band, lo], i, arr) => {
                  const hi = i + 1 < arr.length ? arr[i + 1][1] : 100;
                  const w = Math.max(0, hi - lo);
                  return (
                    <span key={band} className={`badge ${band}`} style={{ flex: `${w} 0 0`, padding: 0, border: 0, borderRadius: 0 }}>
                      <b>{band}</b>
                      <i>{lo}</i>
                    </span>
                  );
                })}
              </div>
              <p className="muted small" style={{ marginBottom: 0 }}>
                Bands are labels on a fixed scale, not gates. Excluded is reserved for a failed hard filter or a disqualifying
                haircut.
              </p>
            </section>
          )}
        </div>

        <aside className="sidebar" aria-label="Record">
          <section>
            <h3>Calibration record</h3>
            <div className="kv">
              <span className="k">Resolved outcomes</span>
              <span className="v">{cal.resolved}</span>
            </div>
            <div className="kv">
              <span className="k">Hit rate</span>
              <span className="v">{cal.resolved >= 10 && cal.hit_rate != null ? `${Math.round(cal.hit_rate * 100)}%` : cal.resolved ? "too few to rate" : "—"}</span>
            </div>
            <div className="kv">
              <span className="k">Mean move</span>
              <span className="v">{cal.resolved >= 10 ? pct(cal.mean_return_pct) : "—"}</span>
            </div>
            {Object.keys(cal.by_band || {}).length > 0 && (
              <div style={{ marginTop: "var(--s-3)" }}>
                <div className="xs faint" style={{ marginBottom: 4 }}>
                  By going-in band
                </div>
                {BANDS.filter((b) => cal.by_band[b]).map((b) => {
                  const r = cal.by_band[b];
                  return (
                    <div className="kv" key={b}>
                      <span className="k">{b}</span>
                      <span className="v">
                        {r.n >= 10 && r.hit_rate != null ? `${Math.round(r.hit_rate * 100)}%` : "n<10"} · n={r.n}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="aside-note" style={{ marginTop: "var(--s-3)" }}>
              Rates are shown only once ten outcomes exist in a bucket. Misses count at the same weight as hits.
            </div>
          </section>

          {d.latest_run && (
            <section>
              <h3>Latest run</h3>
              <div className="kv">
                <span className="k">Scored</span>
                <span className="v">{plural(d.latest_run.scored, "name")}</span>
              </div>
              <div className="kv">
                <span className="k">Mean coverage</span>
                <span className="v">{d.latest_run.mean_coverage != null ? `${Math.round(d.latest_run.mean_coverage * 100)}%` : "—"}</span>
              </div>
              <div className="kv">
                <span className="k">As of</span>
                <span className="v">{shortDate(d.latest_run.as_of)}</span>
              </div>
              {distTotal > 0 && (
                <>
                  <div className="dist" style={{ marginTop: "var(--s-3)" }} aria-hidden="true">
                    {BANDS.map((b) => (dist[b] ? <span key={b} className={b} style={{ width: `${(dist[b] / distTotal) * 100}%` }} /> : null))}
                  </div>
                  <div className="dist-legend xs faint">
                    {BANDS.filter((b) => dist[b]).map((b) => (
                      <span key={b}>
                        {b} {dist[b]}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </section>
          )}

          {d.version && (
            <section>
              <h3>Live version</h3>
              <div className="kv">
                <span className="k">Version</span>
                <span className="v">
                  {d.version.number} · {d.version.state}
                </span>
              </div>
              <div className="kv">
                <span className="k">Effective</span>
                <span className="v">{d.version.effective_from ? shortDate(d.version.effective_from) : "—"}</span>
              </div>
              {d.version.hit_definition && (
                <div className="aside-note" style={{ marginTop: "var(--s-2)" }}>
                  Hit: a {d.version.hit_definition.price_move_pct}% move {d.version.hit_definition.combine} {d.version.hit_definition.volume_spike_x}x
                  volume, {d.version.hit_definition.window} window.
                </div>
              )}
            </section>
          )}

          <section>
            <h3>History</h3>
            {d.timeline.length === 0 ? (
              <div className="aside-note">No calibration events recorded yet.</div>
            ) : (
              <ul className="timeline">
                {d.timeline.map((t, i) => (
                  <li key={i}>
                    <div className="tl-when">{dateTime(t.at)}</div>
                    <div>
                      <b>{t.type.replace(/_/g, " ")}</b>
                      {t.resolved_outcomes != null ? ` · ${t.resolved_outcomes} outcomes` : ""}
                    </div>
                    {t.reason && <div className="muted">{t.reason}</div>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
