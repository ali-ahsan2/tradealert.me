import React, { useEffect, useMemo, useState } from "react";
import { api, cached, toast } from "../api.js";
import { Link, navigate, useQuery } from "../lib/router.jsx";
import { useMe } from "../lib/me.jsx";
import { coverage, dateTime, delta, deltaTone, dollars, downloadText, fmtMoney, inDays, pct, score as fmtScore, toCsv, tone } from "../lib/fmt.js";
import { nounFor } from "../lib/evidence.js";
import { useRowNav } from "../lib/rownav.js";
import ScoreBadge from "../components/ScoreBadge.jsx";
import Pin from "../components/Pin.jsx";
import Spark, { Move } from "../components/Spark.jsx";
import { Empty, ErrorCard, Help, Monogram, Skeleton, StatusChip } from "../components/ui.jsx";

// The screener: every filter is a query-string parameter, so a screen is a
// link you can keep or send. Results are the subscriber's visible universe
// clamped to the plan's names_shown_limit; what was left out is reported as
// a count, never as a name.

const PARAMS = [
  "strategy", "bands", "min_score", "max_score", "coverage", "hf", "industries", "lane", "group", "q",
  "min_delta", "max_delta", "new", "cap_min", "cap_max", "si_min", "si_max", "float_max", "fee_min",
  "volx_min", "run3m_min", "run3m_max", "offhigh_max", "earnings_within", "pinned", "sort", "dir",
];

const PRESETS = [
  { key: "cleared", label: "Cleared the screen", desc: "Every hard filter passed", params: { hf: "pass", sort: "score" } },
  { key: "thin", label: "Thin coverage to verify", desc: "Fewer than half the inputs had data", params: { coverage: "thin", sort: "coverage", dir: "asc" } },
  { key: "new", label: "New this run", desc: "Not scored on the previous run", params: { new: "1" } },
  { key: "up", label: "Up 5+ since last run", desc: "Score rose five points or more", params: { min_delta: "5", sort: "delta" } },
  { key: "down", label: "Down 5+ since last run", desc: "Score fell five points or more", params: { max_delta: "-5", sort: "delta", dir: "asc" } },
  { key: "earnings", label: "Earnings within 14 days", desc: "A dated earnings print inside two weeks", params: { earnings_within: "14", sort: "earnings" } },
  { key: "squeeze", label: "Tight float, high short interest", desc: "Float under 30M shares and short interest over 15%", params: { float_max: "30", si_min: "15", sort: "si" } },
  { key: "fee", label: "Expensive to borrow", desc: "Borrow fee at 20% or more", params: { fee_min: "20", sort: "fee" } },
  { key: "volume", label: "Volume at 3x+", desc: "Volume above three times its 20-day average", params: { volx_min: "3", sort: "volx" } },
  { key: "pinned", label: "My pinned names", desc: "Only your watchlist", params: { pinned: "1" } },
];

const SORTS = [
  ["score", "Score"], ["delta", "Change since last run"], ["coverage", "Coverage"], ["symbol", "Symbol"],
  ["industry", "Industry"], ["cap", "Market cap"], ["si", "Short interest"], ["float", "Float"], ["fee", "Borrow fee"],
  ["volx", "Volume vs 20-day"], ["run3m", "3-month move"], ["chg30", "30-day price move"], ["earnings", "Next earnings"],
];

const BANDS = ["strong", "elevated", "neutral", "weak", "excluded"];
const MAX_COMPARE = 4;

function qs(obj) {
  const p = new URLSearchParams();
  PARAMS.forEach((k) => {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== "" && v !== false) p.set(k, String(v));
  });
  const s = p.toString();
  return s ? `?${s}` : "";
}

function Num({ id, label, value, onChange, step = 1, unit }) {
  return (
    <label className="fnum" htmlFor={id}>
      <span>{label}</span>
      <span className="fnum-in">
        <input id={id} type="number" inputMode="decimal" step={step} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
        {unit && <span className="faint xs">{unit}</span>}
      </span>
    </label>
  );
}

export default function Screen() {
  const { me } = useMe();
  const q = useQuery();
  const filters = useMemo(() => {
    const f = {};
    PARAMS.forEach((k) => {
      const v = q.get(k);
      if (v != null && v !== "") f[k] = v;
    });
    return f;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.toString()]);
  const [draft, setDraft] = useState(filters);
  const [strategies, setStrategies] = useState(null);
  const [industriesAll, setIndustriesAll] = useState([]);
  const [tiers, setTiers] = useState(null);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [pins, setPins] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [panel, setPanel] = useState(false);

  useEffect(() => setDraft(filters), [filters]);

  useEffect(() => {
    cached("/strategies").then((d) => setStrategies(d.strategies)).catch(() => setStrategies([]));
    cached("/industries").then((d) => setIndustriesAll(d.industries)).catch(() => setIndustriesAll([]));
    cached("/entitlements").then((d) => setTiers(d.tiers)).catch(() => setTiers(null));
    api("/me/picks")
      .then((d) => setPins(new Set(d.picks.map((p) => p.symbol))))
      .catch(() => setPins(new Set()));
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr(null);
    api(`/screen${qs(filters)}`)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setErr(e))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [filters, reload]);

  const go = (next) => navigate(`/screen${qs(next)}`, { replace: true });
  const apply = () => {
    go(draft);
    setPanel(false);
  };
  const clear = () => go({ strategy: filters.strategy });
  const preset = (p) => go({ strategy: filters.strategy, ...p.params });
  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const toggleIn = (k, v) => {
    const cur = (draft[k] || "").split(",").filter(Boolean);
    const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
    set(k, next.join(","));
  };
  const facetGo = (k, v) => {
    const cur = (filters[k] || "").split(",").filter(Boolean);
    const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
    go({ ...filters, [k]: next.join(",") });
  };

  const rows = data ? data.rows : [];
  const strat = (data && data.strategy) || (strategies || []).find((s) => s.key === (filters.strategy || "fast_mover")) || { key: "fast_mover", label: "Fast Mover", calibrated: true };
  const tz = me && me.settings ? me.settings.timezone : undefined;
  const scopeInds = data ? data.meta.scope : [];
  const scopeList = scopeInds.map((k) => industriesAll.find((i) => i.key === k)).filter(Boolean);
  const nextTier =
    tiers && me && me.tier
      ? [...tiers].sort((a, b) => a.price_monthly_cents - b.price_monthly_cents).find((t) => t.price_monthly_cents > me.tier.price_monthly_cents)
      : null;
  const activeCount = PARAMS.filter((k) => !["strategy", "sort", "dir"].includes(k) && filters[k]).length;
  const onPinChange = (sym, on) =>
    setPins((p) => {
      const n = new Set(p || []);
      if (on) n.add(sym);
      else n.delete(sym);
      return n;
    });
  const toggleSelect = (sym) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(sym)) n.delete(sym);
      else if (n.size < MAX_COMPARE) n.add(sym);
      else toast(`Compare holds up to ${MAX_COMPARE} names.`);
      return n;
    });
  const cursor = useRowNav(rows.length, {
    onOpen: (i) => rows[i] && navigate(`/stock/${rows[i].symbol}${strat.key !== "fast_mover" ? `?strategy=${strat.key}` : ""}`),
    onPin: (i) => {
      const r = rows[i];
      if (!r || !pins) return;
      const on = pins.has(r.symbol);
      api(`/me/picks${on ? `/${encodeURIComponent(r.symbol)}` : ""}`, on ? { method: "DELETE" } : { method: "POST", json: { symbol: r.symbol } })
        .then(() => {
          onPinChange(r.symbol, !on);
          toast(on ? `Removed ${r.symbol} from your watchlist.` : `Pinned ${r.symbol}.`);
        })
        .catch((e) => toast(e.detail || "That didn't work."));
    },
  });

  const exportCsv = () => {
    const cols = [
      { label: "rank", get: (r) => r.rank },
      { label: "symbol", get: (r) => r.symbol },
      { label: "theme", get: (r) => r.theme },
      { label: "industry", get: (r) => r.industry.label },
      { label: "lane", get: (r) => r.lane },
      { label: "strategy", get: () => strat.label },
      { label: "score", get: (r) => Math.round(r.value) },
      { label: "band", get: (r) => r.band },
      { label: "coverage", get: (r) => `${r.components_present}/${r.components_total}` },
      { label: "delta_since_last_run", get: (r) => (r.delta_1d == null ? "new" : Math.round(r.delta_1d)) },
      { label: "hard_filters", get: (r) => (r.hf_pass == null ? "" : r.hf_pass ? "pass" : "fail") },
      { label: "cap_usd_m", get: (r) => r.snapshot.cap_usd_m ?? "" },
      { label: "si_pct_float", get: (r) => r.snapshot.si_pct_float ?? "" },
      { label: "float_m", get: (r) => r.snapshot.float_m ?? "" },
      { label: "fee_pct", get: (r) => r.snapshot.fee_pct ?? "" },
      { label: "volx20d", get: (r) => r.snapshot.volx20d ?? "" },
      { label: "run3m_pct", get: (r) => r.snapshot.run3m_pct ?? "" },
      { label: "px_chg_30d", get: (r) => r.price.chg_30d ?? "" },
      { label: "px_rel_30d_vs_etf", get: (r) => r.price.rel_30d ?? "" },
      { label: "next_earnings", get: (r) => (r.earnings ? r.earnings.date : "") },
      { label: "run_as_of", get: () => data.as_of },
    ];
    downloadText(
      `tradealert-screen-${data.as_of.slice(0, 10)}.csv`,
      toCsv(rows, cols) + "\n# Research and information only; not investment advice. Scores rank names for a human to review.\n"
    );
  };

  const noun = nounFor(strat);
  const Panel = (
    <aside className={`fpanel card ${panel ? "open" : ""}`} aria-label="Filters">
      <div className="fpanel-head">
        <h2>Filters</h2>
        <button className="btn-quiet" onClick={clear}>
          Clear all
        </button>
      </div>
      <div className="fgroup">
        <span className="fgroup-label">Band</span>
        <div className="chips">
          {BANDS.map((b) => (
            <button key={b} className="fchip" aria-pressed={(draft.bands || "").split(",").includes(b)} onClick={() => toggleIn("bands", b)}>
              {b}
            </button>
          ))}
        </div>
      </div>
      <div className="fgroup two">
        <Num id="f-min" label="Score at least" value={draft.min_score} onChange={(v) => set("min_score", v)} />
        <Num id="f-max" label="at most" value={draft.max_score} onChange={(v) => set("max_score", v)} />
      </div>
      <div className="fgroup">
        <span className="fgroup-label">Coverage</span>
        <div className="chips">
          {[["", "Any"], ["full", "Full"], ["partial", "Partial"], ["thin", "Thin"]].map(([v, l]) => (
            <button key={v} className="fchip" aria-pressed={(draft.coverage || "") === v} onClick={() => set("coverage", v)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="fgroup">
        <span className="fgroup-label">
          Hard filters <Help text="Fast Mover's four filters: cap $300M-$3B, float under 50M, short interest over 10%, growth over 40%. Other strategies store no verdict." />
        </span>
        <div className="chips">
          {[["", "Any"], ["pass", "All passed"], ["fail", "Any failed"]].map(([v, l]) => (
            <button key={v} className="fchip" aria-pressed={(draft.hf || "") === v} onClick={() => set("hf", v)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      {scopeList.length > 1 && (
        <div className="fgroup">
          <span className="fgroup-label">Industry</span>
          <div className="chips">
            {scopeList.map((i) => (
              <button key={i.key} className="fchip" aria-pressed={(draft.industries || "").split(",").includes(i.key)} onClick={() => toggleIn("industries", i.key)}>
                {i.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="fgroup two">
        <label className="fnum" htmlFor="f-lane">
          <span>Lane</span>
          <select id="f-lane" value={draft.lane || ""} onChange={(e) => set("lane", e.target.value)}>
            <option value="">Any</option>
            <option value="Early">Early</option>
            <option value="Event">Event</option>
          </select>
        </label>
        <label className="fnum" htmlFor="f-group">
          <span>Group</span>
          <select id="f-group" value={draft.group || ""} onChange={(e) => set("group", e.target.value)}>
            <option value="">Any</option>
            <option value="A">A list</option>
            <option value="Bench">Bench</option>
            <option value="Scan">Scan</option>
          </select>
        </label>
      </div>
      <div className="fgroup">
        <label className="fnum" htmlFor="f-q">
          <span>Text in symbol, theme, hook or thesis</span>
          <input id="f-q" value={draft.q || ""} onChange={(e) => set("q", e.target.value)} placeholder="e.g. HALEU, drone, GLP" />
        </label>
      </div>
      <div className="fgroup two">
        <Num id="f-dmin" label="Δ run at least" value={draft.min_delta} onChange={(v) => set("min_delta", v)} />
        <Num id="f-dmax" label="at most" value={draft.max_delta} onChange={(v) => set("max_delta", v)} />
      </div>
      <label className="check" style={{ padding: 0 }}>
        <input type="checkbox" checked={draft.new === "1"} onChange={(e) => set("new", e.target.checked ? "1" : "")} />
        <span>New this run only</span>
      </label>
      <label className="check" style={{ padding: 0 }}>
        <input type="checkbox" checked={draft.pinned === "1"} onChange={(e) => set("pinned", e.target.checked ? "1" : "")} />
        <span>My pinned names only</span>
      </label>
      <h3 className="fgroup-label" style={{ marginTop: "var(--s-4)" }}>
        Market data on file
      </h3>
      <div className="fgroup two">
        <Num id="f-capmin" label="Cap at least" value={draft.cap_min} unit="$M" onChange={(v) => set("cap_min", v)} />
        <Num id="f-capmax" label="at most" value={draft.cap_max} unit="$M" onChange={(v) => set("cap_max", v)} />
      </div>
      <div className="fgroup two">
        <Num id="f-simin" label="Short interest at least" value={draft.si_min} unit="% float" onChange={(v) => set("si_min", v)} />
        <Num id="f-simax" label="at most" value={draft.si_max} unit="%" onChange={(v) => set("si_max", v)} />
      </div>
      <div className="fgroup two">
        <Num id="f-float" label="Float at most" value={draft.float_max} unit="M sh" onChange={(v) => set("float_max", v)} />
        <Num id="f-fee" label="Borrow fee at least" value={draft.fee_min} unit="%" onChange={(v) => set("fee_min", v)} />
      </div>
      <div className="fgroup two">
        <Num id="f-volx" label="Volume at least" value={draft.volx_min} unit="x 20d" step={0.5} onChange={(v) => set("volx_min", v)} />
        <Num id="f-offhigh" label="Within % of 52w high" value={draft.offhigh_max} unit="%" onChange={(v) => set("offhigh_max", v)} />
      </div>
      <div className="fgroup two">
        <Num id="f-r3min" label="3-month move at least" value={draft.run3m_min} unit="%" onChange={(v) => set("run3m_min", v)} />
        <Num id="f-r3max" label="at most" value={draft.run3m_max} unit="%" onChange={(v) => set("run3m_max", v)} />
      </div>
      <div className="fgroup">
        <Num id="f-earn" label="Earnings within" value={draft.earnings_within} unit="days" onChange={(v) => set("earnings_within", v)} />
      </div>
      <div className="fpanel-foot">
        <button className="btn btn-primary btn-block" onClick={apply}>
          Apply filters
        </button>
      </div>
    </aside>
  );

  return (
    <div className="wrap">
      <div className="pagehead">
        <div>
          <h1>Screener</h1>
          <div className="meta">Filter your universe on score, coverage, the hard filters and the market data on file. The address is the screen; share it as a link.</div>
        </div>
        <div className="actions">
          <select
            className="inline"
            value={filters.strategy || "fast_mover"}
            aria-label="Strategy lens"
            onChange={(e) => go({ ...filters, strategy: e.target.value === "fast_mover" ? "" : e.target.value })}
          >
            {(strategies || [{ key: "fast_mover", label: "Fast Mover", calibrated: true }]).map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
                {s.calibrated ? "" : " (provisional)"}
              </option>
            ))}
          </select>
          <button className="btn btn-secondary btn-sm fpanel-toggle" onClick={() => setPanel((p) => !p)} aria-expanded={panel}>
            Filters{activeCount ? ` · ${activeCount}` : ""}
          </button>
        </div>
      </div>

      <div className="presets" role="group" aria-label="Preset screens">
        {PRESETS.map((p) => {
          const on = Object.entries(p.params).every(([k, v]) => (filters[k] || "") === v);
          return (
            <button key={p.key} className="preset" aria-pressed={on} title={p.desc} onClick={() => preset(p)}>
              {p.label}
            </button>
          );
        })}
      </div>

      <div className="screen">
        {Panel}
        <div className="screen-main">
          {data && (
            <div className="boardhead">
              <Monogram size={20}>{strat.monogram}</Monogram>
              <b>{strat.label}</b>
              <StatusChip calibrated={strat.calibrated} short />
              <span>
                <b>{data.meta.matched}</b> {data.meta.matched === 1 ? "name matches" : "names match"} · showing {data.meta.shown}
              </span>
              <span>run {dateTime(data.as_of, tz)}</span>
              <span className="spacer" />
              <label className="ctl">
                Sort
                <select className="inline" value={filters.sort || "score"} onChange={(e) => go({ ...filters, sort: e.target.value, dir: "" })}>
                  {SORTS.map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <button className="btn-quiet" onClick={() => go({ ...filters, dir: data.meta.dir === "asc" ? "desc" : "asc" })} title="Flip sort direction">
                {data.meta.dir === "asc" ? "↑ asc" : "↓ desc"}
              </button>
              {rows.length > 0 && (
                <button className="btn-quiet" onClick={exportCsv}>
                  Export CSV
                </button>
              )}
              <button
                className="btn-quiet"
                title="Copy a link to this exact screen"
                onClick={() => {
                  const url = window.location.href;
                  const done = () => toast("Link copied. Anyone on your plan opens this screen with it.");
                  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done).catch(() => toast(url));
                  else toast(url);
                }}
              >
                Copy link
              </button>
            </div>
          )}

          {data && data.meta.matched > 0 && (
            <div className="facets">
              {BANDS.filter((b) => data.facets.band[b]).map((b) => (
                <button key={b} className="fchip" aria-pressed={(filters.bands || "").split(",").includes(b)} onClick={() => facetGo("bands", b)}>
                  {b} <span className="mono">{data.facets.band[b]}</span>
                </button>
              ))}
              {Object.entries(data.facets.industry).length > 1 &&
                Object.entries(data.facets.industry).map(([k, v]) => (
                  <button key={k} className="fchip" aria-pressed={(filters.industries || "").split(",").includes(k)} onClick={() => facetGo("industries", k)}>
                    {v.label} <span className="mono">{v.n}</span>
                  </button>
                ))}
              {(data.facets.hf.pass > 0 || data.facets.hf.fail > 0) && (
                <>
                  <button className="fchip" aria-pressed={filters.hf === "pass"} onClick={() => go({ ...filters, hf: filters.hf === "pass" ? "" : "pass" })}>
                    cleared <span className="mono">{data.facets.hf.pass}</span>
                  </button>
                  <button className="fchip" aria-pressed={filters.hf === "fail"} onClick={() => go({ ...filters, hf: filters.hf === "fail" ? "" : "fail" })}>
                    failed <span className="mono">{data.facets.hf.fail}</span>
                  </button>
                </>
              )}
              {["full", "partial", "thin"]
                .filter((c) => data.facets.coverage[c])
                .map((c) => (
                  <button key={c} className="fchip" aria-pressed={filters.coverage === c} onClick={() => go({ ...filters, coverage: filters.coverage === c ? "" : c })}>
                    {c} coverage <span className="mono">{data.facets.coverage[c]}</span>
                  </button>
                ))}
            </div>
          )}

          {err && <ErrorCard error={err} onRetry={() => setReload((n) => n + 1)} title="Couldn't run the screen." />}
          {loading && !err && <Skeleton rows={8} height={40} />}
          {!loading && data && rows.length === 0 && (
            <Empty
              title={activeCount ? "No names in your universe match this screen." : `No ${strat.label} ${noun}s scored on the latest run.`}
              action={
                activeCount ? (
                  <button className="btn btn-secondary" onClick={clear}>
                    Clear filters
                  </button>
                ) : null
              }
            >
              {activeCount ? "Loosen a filter, or try a preset above." : null}
            </Empty>
          )}

          {!loading && data && rows.length > 0 && (
            <>
              <div className="table-card cards">
                <table className="data compact screen-table">
                  <thead>
                    <tr>
                      <th scope="col" className="c-sel">
                        <span className="sr-only">Select for compare</span>
                      </th>
                      <th className="rank" scope="col">
                        #
                      </th>
                      <th scope="col">Name</th>
                      <th scope="col">Band</th>
                      <th scope="col" className="num">
                        Cov
                      </th>
                      <th scope="col" className="num">
                        Δ run
                      </th>
                      <th scope="col">
                        Screen <Help text="Hard-filter verdict stored with the score. — means the strategy stores none." />
                      </th>
                      <th scope="col" className="num">
                        Cap
                      </th>
                      <th scope="col" className="num">
                        SI %
                      </th>
                      <th scope="col" className="num">
                        Float
                      </th>
                      <th scope="col" className="num">
                        Fee
                      </th>
                      <th scope="col" className="num">
                        Vol×
                      </th>
                      <th scope="col" className="num">
                        3m
                      </th>
                      <th scope="col" className="num">
                        30d <Help text="Price change over 30 days from daily closes, with the gap to the industry's ETF beneath." />
                      </th>
                      <th scope="col">Earnings</th>
                      <th scope="col">
                        <span className="sr-only">Pin</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const cov = coverage(r.components_present, r.components_total);
                      const sn = r.snapshot;
                      return (
                        <tr
                          key={r.symbol}
                          data-rownav={i}
                          className={`rowlink ${cursor === i ? "cursor" : ""}`}
                          onClick={() => navigate(`/stock/${r.symbol}${strat.key !== "fast_mover" ? `?strategy=${strat.key}` : ""}`)}
                        >
                          <td className="c-sel c-hide" onClick={(e) => e.stopPropagation()}>
                            <input type="checkbox" checked={selected.has(r.symbol)} onChange={() => toggleSelect(r.symbol)} aria-label={`Select ${r.symbol} for compare`} />
                          </td>
                          <td className="rank c-rank">{r.rank}</td>
                          <td className="name-cell c-sym">
                            <Link className="sym" to={`/stock/${r.symbol}`} onClick={(e) => e.stopPropagation()}>
                              {r.symbol}
                            </Link>
                            <span className="theme" title={r.theme}>
                              {r.theme}
                            </span>
                            <span className="xs faint">
                              {r.industry.label}
                              {r.lane ? ` · ${r.lane}` : ""}
                            </span>
                          </td>
                          <td className="c-band">
                            <ScoreBadge band={r.band} value={r.value} present={r.components_present} total={r.components_total} strategy={strat} />
                          </td>
                          <td className="num c-cov cov-cell" data-label="Coverage" title={`${cov.present} of ${cov.total} inputs had data`}>
                            <span className="covbar" aria-hidden="true">
                              {[0, 1, 2].map((k) => (
                                <span key={k} className={k < cov.segments ? "filled" : ""} />
                              ))}
                            </span>
                            {r.components_present}/{r.components_total}
                          </td>
                          <td className={`num c-delta ${deltaTone(r.delta_1d)}`} data-label="Δ">
                            {delta(r.delta_1d)}
                          </td>
                          <td className="c-hide">
                            {r.hf_pass == null ? (
                              <span className="faint">—</span>
                            ) : (
                              <span className={`verdict ${r.hf_pass ? "pass" : "fail"}`}>{r.hf_pass ? "✓ PASS" : `✕ ${r.hf_fails} FAIL`}</span>
                            )}
                          </td>
                          <td className="num c-hide">{fmtMoney(sn.cap_usd_m)}</td>
                          <td className="num c-hide">{sn.si_pct_float == null ? "—" : `${sn.si_pct_float}%`}</td>
                          <td className="num c-hide">{sn.float_m == null ? "—" : `${sn.float_m}M`}</td>
                          <td className="num c-hide">{sn.fee_pct == null ? "—" : `${sn.fee_pct}%`}</td>
                          <td className="num c-hide">{sn.volx20d == null ? "—" : `${sn.volx20d}x`}</td>
                          <td className={`num c-hide ${tone(sn.run3m_pct)}`}>{pct(sn.run3m_pct, 0)}</td>
                          <td className="c-move" data-label="30d">
                            <span className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
                              <Spark closes={r.price.closes} width={72} height={24} />
                              <Move value={r.price.chg_30d} />
                            </span>
                            {r.price.rel_30d != null && (
                              <span className="xs faint" style={{ display: "block" }} title={`vs ${r.price.benchmark}`}>
                                {pct(r.price.rel_30d)} vs {r.price.benchmark}
                              </span>
                            )}
                          </td>
                          <td className="c-hide">
                            {r.earnings ? (
                              <span className={`chip chip-plain ${r.earnings.days != null && r.earnings.days >= 0 && r.earnings.days <= 14 ? "soon" : ""}`} title={`${r.earnings.date}${r.earnings.confidence ? ` · ${r.earnings.confidence}` : ""}`}>
                                {inDays(r.earnings.days)}
                              </span>
                            ) : (
                              <span className="faint">—</span>
                            )}
                          </td>
                          <td className="c-pin">{pins && <Pin symbol={r.symbol} pinned={pins.has(r.symbol)} onChange={onPinChange} />}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {selected.size > 0 && (
                <div className="selbar" role="status">
                  <span>
                    {selected.size} of {MAX_COMPARE} selected: <span className="mono">{[...selected].join(", ")}</span>
                  </span>
                  <span className="spacer" />
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={selected.size < 2}
                    onClick={() => navigate(`/compare?symbols=${[...selected].join(",")}${strat.key !== "fast_mover" ? `&strategy=${strat.key}` : ""}`)}
                  >
                    Compare{selected.size < 2 ? " (pick 2+)" : ""}
                  </button>
                  <button className="btn-quiet" onClick={() => setSelected(new Set())}>
                    Clear
                  </button>
                </div>
              )}

              {data.meta.truncated && (
                <div className="upgrade-card">
                  <div className="copy">
                    <b>{data.meta.matched - data.meta.shown}</b> more {data.meta.matched - data.meta.shown === 1 ? "name matches" : "names match"} this screen. Your plan shows the top{" "}
                    <b>{data.meta.names_shown_limit}</b>
                    {nextTier ? (
                      <>
                        ; <b>{nextTier.label}</b> shows the top {nextTier.names_shown_limit}.
                      </>
                    ) : (
                      "."
                    )}
                  </div>
                  {nextTier && (
                    <div className="actions">
                      <Link to="/pricing" className="btn btn-primary btn-sm">
                        See plans — {dollars(nextTier.price_monthly_cents)}/mo
                      </Link>
                    </div>
                  )}
                </div>
              )}

              <p className="footnote">
                Market data columns show the latest snapshot on file per name; each figure carries its own date on the report. <kbd className="kbd">j</kbd>/<kbd className="kbd">k</kbd>{" "}
                move, <kbd className="kbd">↵</kbd> open, <kbd className="kbd">p</kbd> pin. {strat.label} {noun}s rank names for a human to review; nothing here is a recommendation.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
