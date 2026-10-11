import React, { useEffect, useRef, useState } from "react";
import { createChart, CrosshairMode } from "lightweight-charts";
import { api } from "../api.js";
import { PanelHead, Term, SOURCE_STATUS_PLAIN, plainTech } from "./plain.jsx";

function pctCell(v) {
  if (v === null || v === undefined) return <span className="muted">—</span>;
  const cls = v > 0 ? "pos" : v < 0 ? "neg" : "";
  return <span className={`chg ${cls}`}>{v > 0 ? "+" : ""}{v.toFixed(2)}%</span>;
}

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

function due(iso) {
  if (!iso) return "—";
  const mins = Math.round((Date.parse(iso) - Date.now()) / 60000);
  if (Number.isNaN(mins)) return "—";
  if (mins <= 0) return "due now";
  if (mins < 60) return `in ${mins}m`;
  const h = Math.round(mins / 60);
  return h < 24 ? `in ${h}h` : `in ${Math.round(h / 24)}d`;
}

/* TradingView's own charting library, so the interaction model (crosshair,
   scroll to zoom, drag to pan) is the one the reference product uses. */
function PriceChart({ symbol, days, markers }) {
  const box = useRef(null);
  const chart = useRef(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!box.current) return undefined;
    const styles = getComputedStyle(document.documentElement);
    const token = (n, f) => styles.getPropertyValue(n).trim() || f;

    const c = createChart(box.current, {
      height: 380,
      layout: {
        background: { color: "transparent" },
        textColor: token("--ink-muted", "#9aa7ba"),
        fontFamily: token("--font-sans", "sans-serif"),
      },
      grid: {
        vertLines: { color: token("--border", "#202a3a") },
        horzLines: { color: token("--border", "#202a3a") },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: token("--border", "#202a3a") },
      timeScale: { borderColor: token("--border", "#202a3a"), rightOffset: 4 },
    });
    chart.current = c;

    const candles = c.addCandlestickSeries({
      upColor: token("--pos", "#31c48d"),
      downColor: token("--neg", "#e05656"),
      borderUpColor: token("--pos", "#31c48d"),
      borderDownColor: token("--neg", "#e05656"),
      wickUpColor: token("--pos", "#31c48d"),
      wickDownColor: token("--neg", "#e05656"),
    });
    const vol = c.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
      color: token("--border-strong", "#33415a"),
    });
    c.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    let alive = true;
    setErr("");
    api(`/admin/reporting/series/${encodeURIComponent(symbol)}?days=${days}`)
      .then((d) => {
        if (!alive) return;
        candles.setData(d.bars.map((b) => ({
          time: b.d, open: b.o, high: b.h, low: b.l, close: b.c,
        })));
        vol.setData(d.bars.map((b) => ({ time: b.d, value: b.v })));
        if (markers && d.events?.length) {
          candles.setMarkers(d.events.map((e) => ({
            time: e.date,
            position: "aboveBar",
            color: e.hit ? token("--pos", "#31c48d") : token("--ink-faint", "#5f6d80"),
            shape: "circle",
            text: e.kind === "earnings" ? "E" : e.kind.slice(0, 1).toUpperCase(),
          })));
        }
        c.timeScale().fitContent();
      })
      .catch((e) => alive && setErr(e.message));

    const ro = new ResizeObserver(() => {
      if (box.current) c.applyOptions({ width: box.current.clientWidth });
    });
    ro.observe(box.current);

    return () => { alive = false; ro.disconnect(); c.remove(); chart.current = null; };
  }, [symbol, days, markers]);

  return (
    <>
      {err && <div className="errorbox">{err}</div>}
      <div ref={box} className="chartbox" />
    </>
  );
}

function SourcesTable({ data }) {
  return (
    <div className="table-scroll">
      <table className="labtable">
        <thead>
          <tr>
            <th><Term k="feed">Source</Term></th>
            <th><Term k="provides">Provides</Term></th>
            <th><Term k="last_run">Last run</Term></th>
            <th><Term k="result">Result</Term></th>
            <th><Term k="rows">Rows</Term></th>
            <th><Term k="every">Every</Term></th>
            <th><Term k="next">Next</Term></th>
          </tr>
        </thead>
        <tbody>
          {data.sources.map((s) => (
            <tr key={s.key} className={s.status === "planned" ? "row-dim" : undefined}>
              <td>
                <strong>{s.label}</strong>
                {s.status === "planned" && <span className="badge"> not built</span>}
                {s.symbols_failing > 0 && (
                  <span className="badge warn" title="symbols erroring">
                    {" "}{s.symbols_failing} failing
                  </span>
                )}
              </td>
              <td className="muted">{s.provides}</td>
              <td title={s.last_run || ""}>{ago(s.last_run)}</td>
              <td>
                <span className={`badge ${s.last_status === "ok" ? "ok"
                  : s.last_status === "partial" ? "warn"
                  : s.last_status === "failed" ? "block" : ""}`}>
                  {plainTech(SOURCE_STATUS_PLAIN, s.last_status)}
                </span>
              </td>
              <td className="mono">{s.rows ? s.rows.toLocaleString() : "—"}</td>
              <td className="mono">{s.every_hours ? `${s.every_hours}h` : "—"}</td>
              <td title={s.next_due || ""}>{due(s.next_due)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ReportsScreen() {
  const [level, setLevel] = useState("sources");
  const [sym, setSym] = useState("SPY");
  const [symInput, setSymInput] = useState("SPY");
  const [days, setDays] = useState(365);
  const [markers, setMarkers] = useState(true);

  const [sources, setSources] = useState(null);
  const [bench, setBench] = useState(null);
  const [uni, setUni] = useState(null);
  const [stock, setStock] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    setErr("");
    const want = {
      sources: () => api("/admin/reporting/sources").then((d) => alive && setSources(d)),
      market: () => api("/admin/reporting/benchmarks").then((d) => alive && setBench(d)),
      universe: () => api("/admin/reporting/universe").then((d) => alive && setUni(d)),
      stock: () => api(`/admin/reporting/stock/${encodeURIComponent(sym)}`)
        .then((d) => alive && setStock(d)),
    }[level];
    if (want) want().catch((e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [level, sym]);

  const go = (e) => {
    e.preventDefault();
    const s = symInput.trim().toUpperCase();
    if (s) { setSym(s); setLevel("stock"); }
  };

  const tab = (id, label) => (
    <button key={id} className={level === id ? "active" : ""} onClick={() => setLevel(id)}>
      {label}
    </button>
  );

  return (
    <div className="labstack">
      <div className="card">
        <PanelHead id="reporting" title="Reporting">
          <p>Where the data comes from, and what it shows at every level.</p>
        </PanelHead>
        <nav className="labsubnav rep-nav">
          {tab("sources", "Sources")}
          {tab("universe", "Universe")}
          {tab("market", "Market")}
          {tab("stock", "Stock")}
        </nav>
      </div>

      {err && <div className="errorbox">{err}</div>}

      {level === "sources" && sources && (
        <>
          <div className="card">
            <PanelHead id="sources" title="Data sources">
              <p>Each feed, when it last ran and when it runs next.</p>
            </PanelHead>
            <SourcesTable data={sources} />
          </div>
          <div className="card">
            <PanelHead id="coverage" title="Coverage" />
            <div className="statrow">
              <div className="stat">
                <span className="stat-num">{sources.coverage.symbols}</span>
                <span className="stat-lab"><Term k="symbols_hist">symbols with price history</Term></span>
              </div>
              <div className="stat">
                <span className="stat-num">{Number(sources.coverage.bars).toLocaleString()}</span>
                <span className="stat-lab"><Term k="bars">daily bars</Term></span>
              </div>
              <div className="stat">
                <span className="stat-num">{String(sources.coverage.first_bar || "—")}</span>
                <span className="stat-lab"><Term k="earliest">earliest</Term></span>
              </div>
              <div className="stat">
                <span className="stat-num">{String(sources.coverage.last_bar || "—")}</span>
                <span className="stat-lab"><Term k="latest">latest</Term></span>
              </div>
            </div>
            <table className="labtable" style={{ marginTop: 12 }}>
              <thead>
                <tr>
                  <th><Term k="real_or_synthetic">Events</Term></th>
                  <th><Term k="kind">Kind</Term></th>
                  <th><Term k="count">Count</Term></th>
                  <th><Term k="hits">Hits</Term></th>
                  <th><Term k="hit_rate_default">Hit rate</Term></th>
                </tr>
              </thead>
              <tbody>
                {sources.events.map((e, i) => (
                  <tr key={i}>
                    <td>
                      <span className={`badge ${e.synthetic ? "warn" : "ok"}`}>
                        {e.synthetic ? "synthetic" : "real"}
                      </span>
                    </td>
                    <td>{e.event_kind}</td>
                    <td className="mono">{e.n}</td>
                    <td className="mono">{e.hits}</td>
                    <td className="mono">{e.n ? ((e.hits / e.n) * 100).toFixed(1) + "%" : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {level === "universe" && uni && (
        <div className="card">
          <PanelHead id="universe" title="Universe by industry">
            <p>How much of each industry has usable data behind it.</p>
          </PanelHead>
          <div className="table-scroll">
            <table className="labtable">
              <thead>
                <tr>
                  <th><Term k="industry">Industry</Term></th>
                  <th><Term k="instruments_count">Instruments</Term></th>
                  <th><Term k="with_bars">With bars</Term></th>
                  <th><Term k="real_events">Real events</Term></th>
                </tr>
              </thead>
              <tbody>
                {uni.industries.map((r) => (
                  <tr key={r.id}>
                    <td>{r.label}</td>
                    <td className="mono">{r.instruments}</td>
                    <td className="mono">{r.with_bars}</td>
                    <td className="mono">{r.real_events}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {uni.failing.length > 0 && (
            <>
              <h4 style={{ marginBottom: 6 }}>Symbols with no data</h4>
              <p className="muted" style={{ marginTop: 0 }}>
                Usually delisted or renamed. Recorded rather than hidden.
              </p>
              <div className="chiprow">
                {uni.failing.map((f) => (
                  <span className="badge warn" key={f.symbol} title={f.last_error}>
                    {f.symbol}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {level === "market" && bench && (
        <>
          <div className="card">
            <PanelHead id="market" title="Market, sectors and macro">
              <p>Click any row to chart it.</p>
            </PanelHead>
            <div className="table-scroll">
              <table className="labtable">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Name</th>
                    <th><Term k="bench_kind">Kind</Term></th>
                    <th><Term k="last">Last</Term></th>
                    <th><Term k="chg30">30d</Term></th>
                    <th><Term k="chg90">90d</Term></th>
                    <th><Term k="bars">Bars</Term></th>
                  </tr>
                </thead>
                <tbody>
                  {bench.benchmarks.map((b) => (
                    <tr key={b.symbol} className="row-click"
                        onClick={() => { setSym(b.symbol); setSymInput(b.symbol); setLevel("stock"); }}>
                      <td className="mono">{b.symbol}</td>
                      <td>{b.label}</td>
                      <td><span className="badge">{b.kind}</span></td>
                      <td className="mono">{b.last_close ? Number(b.last_close).toFixed(2) : "—"}</td>
                      <td>{pctCell(b.chg_30d)}</td>
                      <td>{pctCell(b.chg_90d)}</td>
                      <td className="mono">{b.bars}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {level === "stock" && (
        <>
          <div className="card">
            <form className="rep-toolbar" onSubmit={go}>
              <label className="labfield" style={{ maxWidth: 200 }}>
                Symbol
                <input value={symInput} onChange={(e) => setSymInput(e.target.value)}
                       placeholder="AAOI, SPY, XLK…" />
              </label>
              <button className="btn btn-primary" type="submit">Load</button>
              <span className="rep-spacer" />
              <div className="chiprow">
                {[90, 365, 730].map((d) => (
                  <button type="button" key={d}
                          className={`chip${days === d ? " on" : ""}`}
                          onClick={() => setDays(d)}>
                    {d === 90 ? "3M" : d === 365 ? "1Y" : "2Y"}
                  </button>
                ))}
                <button type="button" className={`chip${markers ? " on" : ""}`}
                        onClick={() => setMarkers((m) => !m)}>
                  Events
                </button>
              </div>
            </form>
          </div>
          <div className="card">
            <PanelHead id="chart" title={`${sym}${stock?.industry ? ` · ${stock.industry}` : ""}`}>
              <p>Candles with volume. Circles mark recorded events; filled means it moved.</p>
            </PanelHead>
            <PriceChart symbol={sym} days={days} markers={markers} />
          </div>
          {stock && (
            <div className="card">
              <PanelHead id="health" title="Data health" />
              <div className="statrow">
                <div className="stat">
                  <span className="stat-num">{stock.coverage?.bars ?? 0}</span>
                  <span className="stat-lab"><Term k="bars_stored">bars stored</Term></span>
                </div>
                <div className="stat">
                  <span className="stat-num">{String(stock.coverage?.last || "—")}</span>
                  <span className="stat-lab"><Term k="latest_bar">latest bar</Term></span>
                </div>
                <div className="stat">
                  <span className="stat-num">
                    {stock.events?.reduce((a, e) => a + Number(e.n), 0) ?? 0}
                  </span>
                  <span className="stat-lab"><Term k="events_count">events</Term></span>
                </div>
                {stock.benchmark && (
                  <div className="stat">
                    <span className="stat-num">{stock.benchmark.symbol}</span>
                    <span className="stat-lab"><Term k="sector_benchmark">sector benchmark</Term></span>
                  </div>
                )}
              </div>
              {stock.ingest?.last_error && (
                <div className="banner" style={{ marginTop: 12 }}>
                  Last ingest (data load) error: {stock.ingest.last_error}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
