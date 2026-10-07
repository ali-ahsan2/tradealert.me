import React, { useEffect, useMemo, useState } from "react";
import { api, toast } from "../api.js";
import { Link, navigate, useQuery } from "../lib/router.jsx";
import { useMe } from "../lib/me.jsx";
import { coverage, dateTime, delta, deltaTone, pct, plural, score as fmtScore, shortDate, signed, tone } from "../lib/fmt.js";
import { EVIDENCE, HARD_FILTER_FORMAT, SNAPSHOT_LABELS, SNAPSHOT_ORDER, nounFor } from "../lib/evidence.js";
import SearchBar from "../components/SearchBar.jsx";
import ScoreBadge from "../components/ScoreBadge.jsx";
import Pin from "../components/Pin.jsx";
import PriceChart from "../components/PriceChart.jsx";
import Sparkline from "../components/Sparkline.jsx";
import { AlertItem } from "../components/EventList.jsx";
import { AgeChip, ErrorCard, Monogram, Skeleton, StatusChip } from "../components/ui.jsx";

const COVERAGE_SENTENCE = { full: "Full coverage", partial: "Partial coverage", thin: "Thin coverage" };

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

function topDrivers(components, n = 2) {
  return [...(components || [])]
    .filter((c) => c.score != null && c.weight != null)
    .sort((a, b) => b.score * b.weight - a.score * a.weight)
    .slice(0, n);
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
  const [note, setNote] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteBusy, setNoteBusy] = useState(false);
  const [events, setEvents] = useState([]);
  const [fields, setFields] = useState(null);

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
  const snaps = Object.entries(d.snapshot || {}).sort(
    ([a], [b]) => (SNAPSHOT_ORDER.indexOf(a) + 1 || 99) - (SNAPSHOT_ORDER.indexOf(b) + 1 || 99)
  );
  const missingComponents = fields ? fields.missing_components || [] : [];
  const fieldSeries = fields ? Object.entries(fields.fields || {}).filter(([, pts]) => pts.length >= 2) : [];
  const sincePin = fields && fields.since_pin;
  const missing = s ? Math.max(0, s.components_total - s.components_present) : 0;
  const hardFilters = s && s.hard_filters ? s.hard_filters : [];
  const components = s && s.components ? s.components : [];
  const changes = d.changes;
  const peers = d.peers || [];
  const reactions = d.past_reactions || [];
  const lensHref = (key) => (key === "fast_mover" ? `/stock/${d.symbol}` : `/stock/${d.symbol}?strategy=${encodeURIComponent(key)}`);

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
            <Link to={`/industries/${d.industry.key}`}>{d.industry.label}</Link> · benchmark{" "}
            <span className="mono">{d.industry.benchmark_etf}</span>
            {d.lane ? ` · lane ${d.lane}` : ""}
            {d.group ? ` · group ${d.group}` : ""}
          </div>
        </div>
        <div className="actions">
          <Pin symbol={d.symbol} pinned={pinned} onChange={(_, on) => setPinned(on)} label />
          {atCap && (
            <button className="btn btn-secondary btn-sm" disabled={busy} onClick={swap} title="Drops your oldest watchlist pick to make room">
              Replace oldest pick ({cap.used}/{cap.limit})
            </button>
          )}
          <Link to={`/alerts?tab=armed&symbol=${encodeURIComponent(d.symbol)}`} className="btn btn-secondary btn-sm">
            Arm an alert
          </Link>
          <Link to={`/compare?symbols=${encodeURIComponent(d.symbol)}${strat.key !== "fast_mover" ? `&strategy=${strat.key}` : ""}`} className="btn btn-secondary btn-sm">
            Compare
          </Link>
          <button className="btn-quiet" onClick={() => window.print()}>
            Print
          </button>
        </div>
      </header>

      {pinned && (
        <section className="card notebox" style={{ marginBottom: "var(--s-5)" }} aria-labelledby="note-h">
          <div className="card-title">
            <h2 id="note-h" style={{ fontSize: "var(--fs-sm)" }}>
              Your note
            </h2>
            {!noteOpen && (
              <button className="btn-quiet" onClick={() => setNoteOpen(true)}>
                {note ? "Edit" : "Add a note"}
              </button>
            )}
          </div>
          {noteOpen ? (
            <>
              <textarea value={note} maxLength={280} onChange={(e) => setNote(e.target.value)} placeholder="Why you pinned it, what would change your mind…" />
              <div className="row" style={{ marginTop: "var(--s-2)" }}>
                <button className="btn btn-primary btn-sm" disabled={noteBusy} onClick={saveNote}>
                  {noteBusy ? "Saving…" : "Save note"}
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
          {sincePin && (
            <div className="sincepin xs">
              <span>
                Pinned {shortDate(sincePin.pinned_at, tz)}
                {sincePin.score_at_pin != null && s ? (
                  <>
                    {" "}
                    · score <b>{fmtScore(sincePin.score_at_pin)}</b> → <b>{fmtScore(s.value)}</b>{" "}
                    <span className={deltaTone(s.value - sincePin.score_at_pin)}>({delta(s.value - sincePin.score_at_pin)})</span>
                  </>
                ) : null}
              </span>
              {sincePin.chg_pct != null && (
                <span>
                  Price since pinned <b className={tone(sincePin.chg_pct)}>{signed(sincePin.chg_pct, 1, "%")}</b>
                  {sincePin.benchmark_chg_pct != null && (
                    <>
                      {" "}
                      vs {sincePin.benchmark} <span className={tone(sincePin.benchmark_chg_pct)}>{signed(sincePin.benchmark_chg_pct, 1, "%")}</span>
                    </>
                  )}
                  {sincePin.last_date ? ` · close ${shortDate(sincePin.last_date)}` : ""}
                </span>
              )}
            </div>
          )}
        </section>
      )}

      <div className="report">
        <div className="report-main stack">
          <section className="card scoreblock" aria-labelledby="score-h">
            <h2 id="score-h" className="sr-only">
              Score
            </h2>
            {s ? (
              <>
                <div className="row1">
                  <ScoreBadge size="full" band={s.band} value={s.value} present={s.components_present} total={s.components_total} strategy={strat} />
                  <div className="strat">
                    <div className="strat-name">
                      <Monogram>{strat.monogram}</Monogram>
                      <Link to={`/strategies/${strat.key}`} style={{ color: "inherit" }}>
                        {strat.label}
                      </Link>
                      <StatusChip calibrated={strat.calibrated} />
                    </div>
                    <div className="muted small">
                      {strat.calibrated
                        ? `A ${noun} from the calibrated strategy · run ${dateTime(d.run.as_of, tz)}`
                        : `A ${noun}; weights not yet backed by resolved outcomes · run ${dateTime(d.run.as_of, tz)}`}
                    </div>
                  </div>
                  {history.length > 1 && (
                    <div className="hist" style={{ marginLeft: "auto" }}>
                      <Sparkline points={history} label={`${strat.label} score over ${history.length} runs`} />
                      <div className="hist-meta">
                        {plural(history.length, "run")} · from {fmtScore(history[0].value)} to {fmtScore(history[history.length - 1].value)}
                        {bandChanges ? ` · ${plural(bandChanges, "band change")}` : " · no band change"}
                      </div>
                    </div>
                  )}
                </div>
                <div className="row2">
                  <div>
                    <b>{COVERAGE_SENTENCE[cov.state]}</b> · {s.components_present} of {s.components_total} components had data on this run.
                  </div>
                  {s.shrinkage_applied != null && Math.abs(s.shrinkage_applied) >= 0.5 && (
                    <div>
                      Shrunk toward neutral (40) from <b>{Math.round(s.shrinkage_from ?? s.value)}</b> to <b>{Math.round(s.value)}</b> because {missing} of{" "}
                      {s.components_total} components had no data.
                    </div>
                  )}
                  {s.delta_1d != null && (
                    <div>
                      <span className={deltaTone(s.delta_1d)}>{delta(s.delta_1d)}</span> since the previous run
                      {changes && changes.prev_band && changes.prev_band !== s.band ? (
                        <>
                          {" "}
                          · band moved from <b>{changes.prev_band}</b> to <b>{s.band}</b>
                        </>
                      ) : null}
                      .
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

            <div className="lens-tabs" role="group" aria-label="Strategies" style={{ marginTop: "var(--s-4)" }}>
              {d.strategies.map((l) => {
                const drivers = topDrivers(l.components);
                return (
                  <button key={l.key} className="lens-card" aria-pressed={l.key === strat.key} onClick={() => navigate(lensHref(l.key), { replace: true })}>
                    <div className="lc-top">
                      <Monogram size={18}>{l.monogram}</Monogram>
                      {l.label}
                      {!l.calibrated && <span className="chip chip-prov">Prov.</span>}
                    </div>
                    <div className="lc-score">
                      {l.value != null ? (
                        <>
                          <b>{fmtScore(l.value, l.components_present, l.components_total)}</b>
                          <span>{l.band}</span>
                          <span className="faint">
                            · {l.components_present}/{l.components_total}
                          </span>
                        </>
                      ) : (
                        <span>no run</span>
                      )}
                    </div>
                    {drivers.length > 0 && (
                      <div className="xs faint" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {drivers.map((c) => c.label).join(" · ")}
                      </div>
                    )}
                  </button>
                );
              })}
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
                The filters are the evidenced part of the system; the scorecard below only ranks what passes them. Each row shows the actual figure
                against the rule.
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
                        <span className={`verdict ${f.pass ? "pass" : "fail"}`}>{f.pass ? "✓ PASS" : "✕ FAIL"}</span>
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
                <p className="muted small" style={{ marginBottom: 0 }}>
                  No per-component detail was stored for this score.
                </p>
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

          {s && fields && (missing > 0 || missingComponents.length > 0) && (
            <section className="card" aria-labelledby="mc-h">
              <div className="card-title">
                <h2 id="mc-h">What would complete this score</h2>
                <span className="muted small">
                  {missingComponents.length} of {s.components_total} components without data
                </span>
              </div>
              <p className="muted small">
                These declared components had no input on this run, so their weight was redistributed and the score shrunk toward neutral. Each names the
                stored field that would fill it; weights are {strat.label}'s live declaration.
              </p>
              {missingComponents.length === 0 ? (
                <p className="muted small" style={{ marginBottom: 0 }}>
                  The declared weights do not name the missing components; the breakdown above lists what did have data.
                </p>
              ) : (
                <div className="weights">
                  {missingComponents.map((c) => (
                    <div className="weight-row" key={c.key}>
                      <span>
                        {c.label}
                        {c.source && <span className="xs faint" style={{ display: "block" }}>{c.source}</span>}
                      </span>
                      <span className="cmp-track" aria-hidden="true">
                        <span style={{ width: `${Math.round((c.share || 0) * 100)}%` }} />
                      </span>
                      <span className="w">{c.share != null ? `${Math.round(c.share * 100)}%` : c.weight}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {changes && changes.components.some((c) => c.delta != null && Math.abs(c.delta) >= 0.01) && (
            <section className="card" aria-labelledby="chg-h">
              <div className="card-title">
                <h2 id="chg-h">What changed since the previous run</h2>
                <span className="muted small">
                  {shortDate(changes.prev_run.as_of, tz)} → {shortDate(d.run.as_of, tz)}
                </span>
              </div>
              <p className="muted small">
                Score {fmtScore(changes.prev_value)} ({changes.prev_band}) → {fmtScore(s.value)} ({s.band}). Components ordered by the size of their move.
              </p>
              <div className="delta-list">
                {changes.components
                  .filter((c) => c.status !== "kept" || (c.delta != null && Math.abs(c.delta) >= 0.01))
                  .slice(0, 8)
                  .map((c) => (
                    <div className="delta-row" key={c.key}>
                      <span>
                        {c.label}
                        {c.status === "added" && <span className="judg xs faint"> · new data</span>}
                        {c.status === "dropped" && <span className="judg xs faint"> · data gone</span>}
                      </span>
                      <span className="vals">
                        {c.prev_value != null ? String(c.prev_value) : "—"} → {c.value != null ? String(c.value) : "—"}
                      </span>
                      <span className={`d ${c.delta > 0 ? "pos" : c.delta < 0 ? "neg" : ""}`}>
                        {c.delta == null ? "—" : `${c.delta > 0 ? "+" : ""}${c.delta.toFixed(2)}`}
                      </span>
                    </div>
                  ))}
              </div>
            </section>
          )}

          <PriceChart symbol={d.symbol} />

          {fieldSeries.length > 0 && (
            <section className="card" aria-labelledby="fs-h">
              <div className="card-title">
                <h2 id="fs-h">Inputs over time</h2>
                <span className="muted small">every point is a stored snapshot · last {fields.days} days</span>
              </div>
              <div className="fieldgrid">
                {fieldSeries.map(([k, pts]) => {
                  const [label, fmt] = SNAPSHOT_LABELS[k] || [k, (x) => x];
                  const first = pts[0].value;
                  const last = pts[pts.length - 1].value;
                  const vals = pts.map((p) => p.value);
                  const chg = first ? ((last - first) / Math.abs(first)) * 100 : null;
                  return (
                    <div className="fieldcard" key={k}>
                      <div className="fc-top">
                        <span className="fc-label">{label}</span>
                        <span className="fc-val mono">{fmt(last)}</span>
                      </div>
                      <Sparkline points={vals} min={Math.min(...vals)} max={Math.max(...vals)} neutral={null} width={200} height={32} label={`${label}: ${pts.length} snapshots`} />
                      <div className="fc-foot xs faint">
                        {pts.length} snapshots · from {fmt(first)}
                        {chg != null && Number.isFinite(chg) ? (
                          <>
                            {" "}
                            · <span className={tone(chg)}>{signed(chg, 0, "%")}</span>
                          </>
                        ) : null}{" "}
                        · {shortDate(pts[pts.length - 1].as_of)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {reactions.length > 0 && (
            <section className="card" aria-labelledby="rx-h">
              <div className="card-title">
                <h2 id="rx-h">How it moved after past dated events</h2>
                <span className="muted small">measured, not predicted</span>
              </div>
              <p className="muted small">
                Each row is a real past event and the move that followed inside the window. A hit is {EVIDENCE.hitDefinition}.
              </p>
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
                      <td className="mono">{shortDate(r.date)}</td>
                      <td>{r.kind.replace(/_/g, " ")}</td>
                      <td className={`num ${r.max_move_pct > 0 ? "pos" : r.max_move_pct < 0 ? "neg" : ""}`}>{pct(r.max_move_pct)}</td>
                      <td className={`num ${r.close_move_pct > 0 ? "pos" : r.close_move_pct < 0 ? "neg" : ""}`}>{pct(r.close_move_pct)}</td>
                      <td className="num">{r.volume_spike_x != null ? `${r.volume_spike_x.toFixed(1)}x` : "—"}</td>
                      <td>
                        {r.hit == null ? (
                          <span className="faint">open</span>
                        ) : (
                          <span className={`verdict ${r.hit ? "pass" : "fail"}`}>
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
            </section>
          )}

          <section className="card" aria-labelledby="ev-h">
            <div className="card-title">
              <h2 id="ev-h">Events on this name</h2>
              <Link to={`/alerts?tab=armed&symbol=${encodeURIComponent(d.symbol)}`} className="small">
                Arm an alert →
              </Link>
            </div>
            {events.length === 0 ? (
              <p className="muted small" style={{ marginBottom: 0 }}>
                No alert has fired on {d.symbol} in the last 120 days.
              </p>
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
          </section>

          {peers.length > 1 && (
            <section className="card" aria-labelledby="peers-h">
              <div className="card-title">
                <h2 id="peers-h">Also ranked in {d.industry.label}</h2>
                <Link to={`/industries/${d.industry.key}`} className="small">
                  Industry page →
                </Link>
              </div>
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
                      <th scope="col">Band</th>
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
                        <td className={`num ${deltaTone(p.delta_1d)}`}>{delta(p.delta_1d)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
                No market snapshot is on file for this name. The score above rests on the operator's research pass and whatever filings the pipeline has
                read.
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
            <h3>Find more like it</h3>
            <div className="aside-note">
              <Link to={`/screen?industries=${d.industry.key}${strat.key !== "fast_mover" ? `&strategy=${strat.key}` : ""}`}>Screen {d.industry.label}</Link>
              {d.lane ? (
                <>
                  {" "}
                  · <Link to={`/screen?lane=${encodeURIComponent(d.lane)}`}>{d.lane}-lane names</Link>
                </>
              ) : null}
              {s && s.hard_filters && s.hard_filters.length > 0 && s.hard_filters.every((f) => f.pass) ? (
                <>
                  {" "}
                  · <Link to="/screen?hf=pass">Everything that cleared the screen</Link>
                </>
              ) : null}
              {" "}· <Link to="/calendar">Calendar</Link>
            </div>
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
            {history.length > 0 && (
              <div className="kv">
                <span className="k">Runs on record</span>
                <span className="v">{history.length}</span>
              </div>
            )}
          </section>
          <section>
            <h3>Calibration record</h3>
            {strat.calibrated ? (
              <div className="aside-note">
                {strat.label} is calibrated on {strat.resolved_outcomes_count} resolved outcomes. Filter-passing events moved {EVIDENCE.hitRate}% of the time (
                {EVIDENCE.hits} of {EVIDENCE.events}), against {EVIDENCE.earningsRate}% for earnings events generally and {EVIDENCE.randomRate}% on a random
                day. The test measures movement, not direction or profit, over {EVIDENCE.window}. <Link to={`/strategies/${strat.key}`}>Evidence page</Link>
              </div>
            ) : (
              <div className="aside-note">
                {strat.label} has {strat.resolved_outcomes_count ?? 0} resolved outcomes. Its weights can be calibrated once {EVIDENCE.calibrationThreshold}{" "}
                resolve. Until then it produces candidates, not signals. <Link to={`/strategies/${strat.key}`}>Evidence page</Link>
              </div>
            )}
          </section>
          <section>
            <div className="aside-note">Not investment advice. Every figure here is a claim to re-verify against its primary source before you act on it.</div>
          </section>
        </aside>
      </div>
    </div>
  );
}
