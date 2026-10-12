import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { PanelHead, Term, fmtNum } from "./plain.jsx";

/* The engine screen: is the product actually watching, and what did the
   watching produce. Three screens: Status (universe, data, the latest run,
   every trigger's source and whether it fires), Replay (run the triggers
   over stored history and read what followed), Universe (the rule that
   admits a name, and what it would admit). */

function ago(iso) {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (Number.isNaN(mins)) return "—";
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function pct(v, digits = 1) {
  if (v === null || v === undefined) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

function signed(v) {
  if (v === null || v === undefined) return <span className="muted">—</span>;
  const cls = v > 0 ? "pos" : v < 0 ? "neg" : "";
  return <span className={`chg ${cls}`}>{v > 0 ? "+" : ""}{Number(v).toFixed(1)}%</span>;
}

function useLoad(loader, deps) {
  const [state, set] = useState({ data: null, err: "", loading: true });
  const run = () => {
    set((s) => ({ ...s, loading: true, err: "" }));
    loader()
      .then((data) => set({ data, err: "", loading: false }))
      .catch((e) => set({ data: null, err: e.message || String(e), loading: false }));
  };
  useEffect(run, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...state, reload: run };
}

function Busy({ on, children }) {
  return on ? <span className="muted">Working…</span> : children;
}

// --------------------------------------------------------------------------
// Status
// --------------------------------------------------------------------------

function StatusScreen({ onReplay }) {
  const { data, err, loading, reload } = useLoad(() => api("/admin/lab/engine/status"), []);
  const [busy, setBusy] = useState("");
  const [last, setLast] = useState(null);
  const act = async (what) => {
    setBusy(what);
    try {
      const r = await api(`/admin/lab/engine/${what}`, { method: "POST", json: {} });
      setLast({ what, r });
      reload();
    } catch (e) {
      setLast({ what, err: e.message || String(e) });
    } finally {
      setBusy("");
    }
  };
  if (err) return <div className="errorbox">{err}</div>;
  if (loading || !data) return <p className="muted">Loading…</p>;
  const { universe, data: d, runs, triggers, replays, records } = data;
  const run = runs[0];
  const synthetic = (d.bars.sources || []).includes("dev_fixture");
  return (
    <>
      {data.engine_live ? (
        <p className="badge ok block">
          The engine is live: the morning pass writes a scored run subscribers read and records new alerts.
        </p>
      ) : (
        <div className="errorbox">
          The engine is off (ENGINE_LIVE is not 1). Score now and Evaluate triggers now are dry runs: they show
          what would happen and write nothing a subscriber reads. Turn it on once the replays look right and the
          research inputs are loaded ({d.research_rows} of {universe.active} names have them).
        </div>
      )}
      {synthetic && (
        <div className="errorbox">
          The stored bars include the dev fixture (a seeded random walk). Everything below
          describes synthetic data until a real price ingest has run.
        </div>
      )}
      <div className="card">
        <PanelHead
          id="engine_run"
          title="The latest run"
          plain="did it score the universe this morning"
          actions={
            <>
              <button className="btn btn-primary" disabled={!!busy} onClick={() => act("score")}>
                Score now
              </button>
              <button className="btn" disabled={!!busy} onClick={() => act("triggers")}>
                Evaluate triggers now
              </button>
            </>
          }
        />
        {run ? (
          <dl className="kv">
            <dt>Run</dt><dd className="mono">#{run.id} as of {run.as_of.slice(0, 10)} · {run.status}</dd>
            <dt>Scored</dt><dd>{run.scored} names · {run.strong} strong · {run.elevated} elevated</dd>
            <dt>Finished</dt><dd>{ago(run.completed_at)}</dd>
          </dl>
        ) : (
          <p className="muted">No run yet. Press Score now.</p>
        )}
        {last && (
          <p className={last.err ? "errorbox" : "muted"}>
            <Busy on={busy === last.what}>
              {last.err
                ? `${last.what}: ${last.err}`
                : last.what === "score"
                  ? last.r.written
                    ? `Scored ${last.r.scored} names into run #${last.r.run_id}; ${last.r.band_changes} band changes` +
                      (last.r.band_changes_withheld ? " (alerts withheld: regime change)" : `, ${last.r.alerts_fired} alerts fired`)
                    : `Dry run: scored ${last.r.scored} names, bands ${JSON.stringify(last.r.bands)}, mean coverage ` +
                      `${last.r.mean_coverage}. Nothing written: ${last.r.dry_run_reason}.`
                  : `Looked back from ${last.r.on} for ${last.r.evaluated.join(", ")}: ${last.r.fired} facts in the window ` +
                    JSON.stringify(last.r.by_trigger) +
                    (last.r.write ? `, ${last.r.written} new alerts recorded.` : `. Nothing written: ${last.r.dry_run_reason}.`)}
            </Busy>
          </p>
        )}
      </div>

      <div className="card">
        <PanelHead id="engine_universe" title="The universe" plain="what it watches" />
        <p>
          <b>{universe.active}</b> active names across {universe.industries.length} industries.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>Industry</th><th>Active</th><th>From the workbench</th><th>By rule</th></tr>
            </thead>
            <tbody>
              {universe.industries.map((i) => (
                <tr key={i.key}>
                  <td>{i.label}</td>
                  <td className="mono">{i.active}</td>
                  <td className="mono">{i.origins.workbench || 0}</td>
                  <td className="mono">{i.origins.rule || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <PanelHead id="engine_data" title="The data" plain="what the triggers can read today" />
        <dl className="kv">
          <dt>Daily bars</dt>
          <dd>
            {d.bars.tickers} names, {d.bars.earliest} to {d.bars.latest}; {d.bars.fresh_tickers} with a bar in the
            last five days · sources {(d.bars.sources || []).join(", ") || "none"} · provider now:{" "}
            <span className="mono">{d.bars.provider}</span>
          </dd>
          {Object.entries(d.snapshots).map(([f, s]) => (
            <React.Fragment key={f}>
              <dt>Snapshot · {f}</dt>
              <dd>{s.tickers} names · latest {ago(s.latest)} · {(s.sources || []).join(", ")}</dd>
            </React.Fragment>
          ))}
          <dt>EDGAR filings</dt>
          <dd>{d.filings.rows} rows on {d.filings.tickers} names · latest {d.filings.latest || "none"} · {d.tickers_with_sic} tickers carry a SIC code</dd>
          <dt>Research inputs</dt>
          <dd>
            {d.research_rows} of {universe.active} active names carry the operator's heat, quality and haircuts
            {d.research_rows < universe.active ? " · names without them score on market data alone, with no haircut" : ""}
          </dd>
        </dl>
        {d.recent_passes.length > 0 && (
          <div className="table-scroll">
            <table>
              <thead><tr><th>Pass</th><th>When</th><th>Status</th><th>OK</th><th>Failed</th><th>Rows</th></tr></thead>
              <tbody>
                {d.recent_passes.map((p, i) => (
                  <tr key={i}>
                    <td className="mono">{p.source}</td>
                    <td>{ago(p.started_at)}</td>
                    <td><span className={`badge ${p.status === "ok" ? "ok" : p.status === "running" ? "" : "warn"}`}>{p.status}</span></td>
                    <td className="mono">{p.ok}</td><td className="mono">{p.failed}</td><td className="mono">{p.rows}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <PanelHead id="engine_triggers" title="The triggers" plain="which facts it can notice, and from where" />
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>Trigger</th><th>Source</th><th>Fires live</th><th>Replays</th><th>Fired, 7d / 30d</th><th>Last</th></tr>
            </thead>
            <tbody>
              {triggers.map((t) => (
                <tr key={t.key}>
                  <td>
                    <div className="mono">{t.key}</div>
                    <div className="muted" style={{ maxWidth: 420 }}>{t.note}</div>
                  </td>
                  <td>{t.source}</td>
                  <td><span className={`badge ${t.live ? "ok" : "warn"}`}>{t.live ? "yes" : "no"}</span></td>
                  <td><span className={`badge ${t.replay ? "ok" : ""}`}>{t.replay ? "yes" : "no"}</span></td>
                  <td className="mono">{t.fired_7d} / {t.fired_30d}</td>
                  <td>{ago(t.last_fired)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <PanelHead id="engine_record" title="The published record" plain="the number subscribers read" />
        <div className="table-scroll">
          <table>
            <thead><tr><th>Strategy</th><th>Record</th><th>Source</th></tr></thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.key}>
                  <td className="mono">{r.key}</td>
                  <td className="mono">{r.n ? `${r.hits} of ${r.n}` : "none"}</td>
                  <td className="muted">{r.source || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {replays.length > 0 && (
          <>
            <h4>Recent replays</h4>
            <div className="table-scroll">
              <table>
                <thead><tr><th>#</th><th>Span</th><th>Triggers</th><th>Alerts</th><th>Moved</th><th></th></tr></thead>
                <tbody>
                  {replays.map((r) => (
                    <tr key={r.id}>
                      <td className="mono">{r.id}</td>
                      <td>{r.from} to {r.to}{r.synthetic ? <span className="badge warn" style={{ marginLeft: 6 }}>synthetic</span> : null}</td>
                      <td className="muted">{r.triggers.join(", ")}</td>
                      <td className="mono">{r.alerts}</td>
                      <td className="mono">{r.n ? `${r.hits} of ${r.n} (${pct(r.hit_rate)})` : "—"}</td>
                      <td><button className="btn" onClick={() => onReplay(r.id)}>Open</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  );
}

// --------------------------------------------------------------------------
// Replay
// --------------------------------------------------------------------------

const ALL_TRIGGERS = ["volume_3x", "borrow_fee_2x", "si_cross", "catalyst_dated", "s3_424b"];

function isoDaysAgo(n) {
  const d = new Date(Date.now() - n * 86400000);
  return d.toISOString().slice(0, 10);
}

function SummaryTable({ by, baseline }) {
  const keys = Object.keys(by || {});
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Trigger</th><th><Term k="n">alerts</Term></th><th>names</th>
            <th><Term k="hit_rate">moved</Term></th><th>95% range</th>
            <th>median largest move, 5 sessions</th><th>peak session</th>
            <th><Term k="difference">vs random days</Term></th><th><Term k="p">p</Term></th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => {
            const s = by[k];
            return (
              <tr key={k}>
                <td className="mono">{k}</td>
                <td className="mono">{s.n}</td>
                <td className="mono">{s.instruments}</td>
                <td className="mono">{s.n ? `${s.hits} (${pct(s.hit_rate)})` : "—"}</td>
                <td className="mono">{s.ci ? `${pct(s.ci[0])} to ${pct(s.ci[1])}` : "—"}</td>
                <td className="mono">{s.median_max_move_5d !== undefined ? `${s.median_max_move_5d}%` : "—"}</td>
                <td className="mono">{s.median_peak_session ?? "—"}</td>
                <td className="mono">{s.difference !== undefined ? `${s.difference > 0 ? "+" : ""}${s.difference} pts` : "—"}</td>
                <td className="mono">{s.p !== undefined && s.p !== null ? s.p.toFixed(4) : "—"}</td>
              </tr>
            );
          })}
          {baseline && (
            <tr>
              <td className="muted">random days (baseline)</td>
              <td className="mono">{baseline.n}</td>
              <td className="mono">{baseline.instruments}</td>
              <td className="mono">{baseline.n ? `${baseline.hits} (${pct(baseline.hit_rate)})` : "—"}</td>
              <td className="mono">{baseline.ci ? `${pct(baseline.ci[0])} to ${pct(baseline.ci[1])}` : "—"}</td>
              <td className="mono">{baseline.median_max_move_5d !== undefined ? `${baseline.median_max_move_5d}%` : "—"}</td>
              <td className="mono">{baseline.median_peak_session ?? "—"}</td>
              <td /><td />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function ReplayResult({ rid }) {
  const { data, err, loading, reload } = useLoad(() => api(`/admin/lab/engine/replay/${rid}`), [rid]);
  const [pub, setPub] = useState(null);
  if (err) return <div className="errorbox">{err}</div>;
  if (loading || !data) return <p className="muted">Loading replay #{rid}…</p>;
  const s = data.summary || {};
  const ov = s.overall || {};
  const canPublish = data.status === "completed" && !s.synthetic_data_used && (ov.n || 0) >= 10;
  const publish = async () => {
    try {
      const r = await api(`/admin/lab/engine/replay/${rid}/publish`, { method: "POST", json: { strategy_key: "fast_mover" } });
      setPub({ ok: r });
      reload();
    } catch (e) {
      setPub({ err: e.message || String(e) });
    }
  };
  return (
    <div className="card">
      <PanelHead
        id="engine_replay_result"
        title={<>Replay #{rid} · {data.from} to {data.to}</>}
        actions={
          <button className="btn btn-primary" disabled={!canPublish} onClick={publish}
            title={canPublish ? "Make this the strategy's published record, with this replay named as the source"
              : "Needs a completed replay over real bars with at least ten resolved alerts"}>
            Publish as the record
          </button>
        }
      />
      {s.synthetic_data_used && (
        <div className="errorbox">This replay ran over synthetic bars. It proves the machinery, not the strategy, and cannot be published.</div>
      )}
      {pub && (pub.err ? <div className="errorbox">{pub.err}</div> : <p className="muted">Published: {pub.ok.record_source}</p>)}
      <p>
        <b>{s.alerts}</b> alerts would have fired on <b>{s.instruments}</b> names over <b>{s.sessions}</b> sessions
        {ov.n ? <>; <b>{ov.hits} of {ov.n}</b> resolved alerts moved ({pct(ov.hit_rate)}), against {pct((s.baseline || {}).hit_rate)} on random days</> : null}.
        {s.unresolved ? <> {s.unresolved} are still inside their window.</> : null}
      </p>
      <p className="muted">A hit is {s.hit_definition}. {s.footer}</p>
      <SummaryTable by={s.by_trigger} baseline={s.baseline} />
      {s.not_replayed && Object.keys(s.not_replayed).length > 0 && (
        <>
          <h4>Not replayed</h4>
          <ul className="muted">
            {Object.entries(s.not_replayed).map(([k, why]) => <li key={k}><span className="mono">{k}</span>: {why}</li>)}
          </ul>
        </>
      )}
      {s.by_industry && Object.keys(s.by_industry).length > 0 && (
        <>
          <h4>By industry, all triggers</h4>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Industry</th><th>alerts</th><th>moved</th><th>median largest move</th></tr></thead>
              <tbody>
                {Object.entries(s.by_industry).map(([k, v]) => (
                  <tr key={k}>
                    <td className="mono">{k}</td><td className="mono">{v.n}</td>
                    <td className="mono">{v.n ? `${v.hits} (${pct(v.hit_rate)})` : "—"}</td>
                    <td className="mono">{v.median_max_move_5d ?? "—"}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <h4>The alerts, newest first</h4>
      <div className="table-scroll">
        <table>
          <thead><tr><th>Date</th><th>Name</th><th>Trigger</th><th>What fired</th><th>close +5</th><th>largest +5</th><th>vol x</th><th>peak</th><th>moved</th></tr></thead>
          <tbody>
            {(data.alerts || []).slice(0, 120).map((a, i) => (
              <tr key={i}>
                <td className="mono">{a.fired_on}</td>
                <td className="mono">{a.symbol}</td>
                <td className="mono">{a.trigger}</td>
                <td className="muted">{a.detail}</td>
                <td>{signed(a.fwd_close_5d)}</td>
                <td>{signed(a.fwd_max_5d)}</td>
                <td className="mono">{a.vol_spike_x ?? "—"}</td>
                <td className="mono">{a.peak_after_sessions ?? "—"}</td>
                <td>{a.resolved ? <span className={`badge ${a.hit ? "ok" : ""}`}>{a.hit ? "yes" : "no"}</span> : <span className="muted">open</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReplayScreen({ openId }) {
  const [from, setFrom] = useState(isoDaysAgo(400));
  const [to, setTo] = useState(isoDaysAgo(20));
  const [keys, setKeys] = useState(ALL_TRIGGERS);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [rid, setRid] = useState(openId || null);
  useEffect(() => { if (openId) setRid(openId); }, [openId]);
  const toggle = (k) => setKeys((ks) => (ks.includes(k) ? ks.filter((x) => x !== k) : [...ks, k]));
  const run = async () => {
    setBusy(true);
    setErr("");
    try {
      const r = await api("/admin/lab/engine/replay", {
        method: "POST", json: { from_date: from, to_date: to, triggers: keys, note },
      });
      setRid(r.replay_run_id);
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="card">
        <PanelHead id="engine_replay" title="Replay history" plain="what would have fired, and what followed" />
        <div className="formrow">
          <label>From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label>To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
        <div className="formrow">
          {ALL_TRIGGERS.map((k) => (
            <label key={k} className="mono">
              <input type="checkbox" checked={keys.includes(k)} onChange={() => toggle(k)} /> {k}
            </label>
          ))}
        </div>
        <div className="formrow">
          <label>Note <input type="text" value={note} maxLength={300} placeholder="why this span, what you expect" onChange={(e) => setNote(e.target.value)} style={{ width: 360 }} /></label>
          <button className="btn btn-primary" disabled={busy || !keys.length} onClick={run}>
            {busy ? "Replaying…" : "Run the replay"}
          </button>
        </div>
        {err && <div className="errorbox">{err}</div>}
        <p className="muted">
          Every stored session in the span is evaluated with the same trigger code the morning pass runs; each
          firing is resolved against the bars that followed and set beside random sessions for the same names.
          Nothing here reaches a subscriber.
        </p>
      </div>
      {rid && <ReplayResult rid={rid} />}
    </>
  );
}

// --------------------------------------------------------------------------
// Universe
// --------------------------------------------------------------------------

function UniverseScreen() {
  const { data, err, loading, reload } = useLoad(() => api("/admin/lab/engine/universe"), []);
  const [capMin, setCapMin] = useState(50);
  const [capMax, setCapMax] = useState(5000);
  const [identity, setIdentity] = useState(false);
  const [busy, setBusy] = useState("");
  const [plan, setPlan] = useState(null);
  const [perr, setPerr] = useState("");
  const call = async (what) => {
    setBusy(what);
    setPerr("");
    try {
      const r = await api(`/admin/lab/engine/universe/${what}`, {
        method: "POST", json: { cap_min_m: Number(capMin), cap_max_m: Number(capMax), fetch_identity: identity },
      });
      setPlan({ what, r });
      if (what === "apply") reload();
    } catch (e) {
      setPerr(e.message || String(e));
    } finally {
      setBusy("");
    }
  };
  if (err) return <div className="errorbox">{err}</div>;
  if (loading || !data) return <p className="muted">Loading…</p>;
  return (
    <>
      <div className="card">
        <PanelHead id="engine_universe_rule" title="The rule" plain="how a name gets in" />
        <p>
          Listed on {data.exchanges.join(", ")}; SIC code in one of the lists below; market cap between
          ${data.cap_band_m[0]}M and ${fmtNum(data.cap_band_m[1])}M once a stats snapshot exists. SPACs, REITs and
          asset-backed issuers ({data.excluded_sic.join(", ")}) never enter.
        </p>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Industry</th><th>SIC codes</th><th>Active now (workbench / rule)</th></tr></thead>
            <tbody>
              {Object.entries(data.sic_map).map(([k, codes]) => {
                const c = data.counts[k] || {};
                return (
                  <tr key={k}>
                    <td className="mono">{k}</td>
                    <td className="mono muted">{codes.join(" ")}</td>
                    <td className="mono">{(c.workbench || {}).active || 0} / {(c.rule || {}).active || 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card">
        <PanelHead id="engine_universe_build" title="Build it" plain="see what the rule admits, then write it" />
        <div className="formrow">
          <label>Cap from $<input type="number" value={capMin} onChange={(e) => setCapMin(e.target.value)} style={{ width: 90 }} />M</label>
          <label>to $<input type="number" value={capMax} onChange={(e) => setCapMax(e.target.value)} style={{ width: 90 }} />M</label>
          <label><input type="checkbox" checked={identity} onChange={(e) => setIdentity(e.target.checked)} /> fetch identity for unknown companies (one EDGAR call each; minutes)</label>
        </div>
        <div className="formrow">
          <button className="btn" disabled={!!busy} onClick={() => call("plan")}>{busy === "plan" ? "Planning…" : "Plan (no writes)"}</button>
          <button className="btn btn-primary" disabled={!!busy || !plan || plan.what !== "plan"} onClick={() => call("apply")}
            title={plan && plan.what === "plan" ? "" : "Plan first"}>
            {busy === "apply" ? "Writing…" : "Apply the plan"}
          </button>
        </div>
        {perr && <div className="errorbox">{perr}</div>}
        {plan && (
          <>
            <dl className="kv">
              <dt>Listed</dt><dd className="mono">{plan.r.listed}</dd>
              <dt>With a SIC code</dt><dd className="mono">{plan.r.with_sic} ({plan.r.no_sic} unknown{plan.r.identity_fetched ? `, ${plan.r.identity_fetched} fetched this pass` : ""})</dd>
              <dt>Mapped to an industry</dt><dd className="mono">{plan.r.with_sic - plan.r.unmapped_sic}</dd>
              <dt>Out of the cap band</dt><dd className="mono">{plan.r.out_of_cap_band}</dd>
              <dt>Admitted</dt><dd className="mono">{plan.r.admitted} ({plan.r.cap_unknown_admitted} with no cap yet)</dd>
              {plan.r.written !== undefined && (<><dt>Written</dt><dd className="mono">{plan.r.written} instruments, {plan.r.deactivated} deactivated</dd></>)}
            </dl>
            <div className="table-scroll">
              <table>
                <thead><tr><th>Industry</th><th>Admitted</th></tr></thead>
                <tbody>
                  {Object.entries(plan.r.by_industry || {}).map(([k, n]) => (
                    <tr key={k}><td className="mono">{k}</td><td className="mono">{n}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            {plan.r.sample && (
              <div className="table-scroll">
                <table>
                  <thead><tr><th>Symbol</th><th>Name</th><th>Exchange</th><th>SIC</th><th>Industry</th><th>Cap $M</th></tr></thead>
                  <tbody>
                    {plan.r.sample.map((s) => (
                      <tr key={s.symbol}><td className="mono">{s.symbol}</td><td>{s.name}</td><td>{s.exchange}</td><td className="mono">{s.sic}</td><td className="mono">{s.industry}</td><td className="mono">{s.cap_m ?? "—"}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

export default function EngineScreen({ sub, onSub }) {
  const [openReplay, setOpenReplay] = useState(null);
  const tab = (label, id) => (
    <button className={sub === id ? "active" : ""} aria-current={sub === id ? "page" : undefined} onClick={() => onSub(id)}>
      {label}
    </button>
  );
  return (
    <>
      <nav className="labsubnav">
        {tab("Status", "engine")}
        {tab("Replay", "engine_replay")}
        {tab("Universe", "engine_universe")}
      </nav>
      {sub === "engine" && <StatusScreen onReplay={(id) => { setOpenReplay(id); onSub("engine_replay"); }} />}
      {sub === "engine_replay" && <ReplayScreen openId={openReplay} />}
      {sub === "engine_universe" && <UniverseScreen />}
    </>
  );
}
