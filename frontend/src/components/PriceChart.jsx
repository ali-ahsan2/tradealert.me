import React, { useEffect, useRef, useState } from "react";
import { createChart, CrosshairMode } from "lightweight-charts";
import { api } from "../api.js";
import { age, pct, price, seriesChange, shortDate } from "../lib/fmt.js";
import { ErrorCard, Skeleton } from "./ui.jsx";

// TradingView's own charting library, so crosshair, zoom and pan behave the
// way the reference products do. Every mark on the chart is a recorded fact:
// a bar that printed, an alert that fired, a dated event and how the name
// actually moved after it. Nothing decorative.

const RANGES = [
  ["3M", 90],
  ["6M", 180],
  ["1Y", 365],
  ["2Y", 730],
];

// One glyph per trigger so a marker stays legible at candle width.
const TRIGGER_GLYPH = {
  borrow_fee_2x: "B",
  si_cross: "SI",
  volume_3x: "V",
  catalyst_dated: "C",
  s3_424b: "F",
  band_change: "Δ",
  insider_buying: "I",
  social_surge: "S",
  contract_award: "$",
};

function token(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export default function PriceChart({ symbol, initialDays = 365 }) {
  const box = useRef(null);
  const [days, setDays] = useState(initialDays);
  const [markers, setMarkers] = useState(true);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr(null);
    api(`/stock/${encodeURIComponent(symbol)}/series?days=${days}`)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setErr(e))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [symbol, days, reload]);

  useEffect(() => {
    if (!box.current || !data || !data.bars.length) return undefined;
    const c = createChart(box.current, {
      height: 340,
      layout: {
        background: { color: "transparent" },
        textColor: token("--ink-muted", "#5b6472"),
        fontFamily: token("--font-sans", "sans-serif"),
        fontSize: 12,
      },
      grid: {
        vertLines: { color: token("--border", "#d8dce3") },
        horzLines: { color: token("--border", "#d8dce3") },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: token("--border", "#d8dce3") },
      timeScale: { borderColor: token("--border", "#d8dce3"), rightOffset: 3 },
      handleScale: { axisPressedMouseMove: true },
    });
    const pos = token("--pos", "#1f6b4a");
    const neg = token("--neg", "#9b2c2c");
    const candles = c.addCandlestickSeries({
      upColor: pos,
      downColor: neg,
      borderUpColor: pos,
      borderDownColor: neg,
      wickUpColor: pos,
      wickDownColor: neg,
    });
    const vol = c.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
      color: token("--border-strong", "#b4bac6"),
    });
    c.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    candles.setData(
      data.bars.map((b) => ({ time: b.d, open: b.o, high: b.h, low: b.l, close: b.c }))
    );
    vol.setData(data.bars.map((b) => ({ time: b.d, value: b.v })));

    if (markers) {
      const dated = (data.dated_events || []).map((e) => ({
        time: e.date,
        position: "aboveBar",
        shape: "circle",
        color: e.hit ? pos : token("--ink-faint", "#8b93a2"),
        text: e.kind === "earnings" ? "E" : e.kind.slice(0, 1).toUpperCase(),
      }));
      const alerts = (data.alerts || []).map((a) => ({
        time: a.date,
        position: "belowBar",
        shape: "arrowUp",
        color: token("--info", "#24466f"),
        text: TRIGGER_GLYPH[a.trigger_key] || "!",
      }));
      const all = [...dated, ...alerts].sort((x, y) => (x.time < y.time ? -1 : x.time > y.time ? 1 : 0));
      candles.setMarkers(all);
    }
    c.timeScale().fitContent();
    const ro = new ResizeObserver(() => {
      if (box.current) c.applyOptions({ width: box.current.clientWidth });
    });
    ro.observe(box.current);
    return () => {
      ro.disconnect();
      c.remove();
    };
  }, [data, markers]);

  const stockChg = data ? seriesChange(data.bars) : null;
  const benchChg = data && data.benchmark ? seriesChange(data.benchmark.bars) : null;
  const lastBar = data && data.bars.length ? data.bars[data.bars.length - 1] : null;
  const lastAge = lastBar ? age(`${lastBar.d}T21:00:00Z`) : null;

  return (
    <section className="card chartwrap" aria-labelledby="chart-h">
      <div className="card-title">
        <h2 id="chart-h">Price</h2>
        <div className="row">
          <div className="seg" role="group" aria-label="Range">
            {RANGES.map(([label, d]) => (
              <button key={d} aria-pressed={days === d} onClick={() => setDays(d)}>
                {label}
              </button>
            ))}
          </div>
          <button className="btn-quiet" aria-pressed={markers} onClick={() => setMarkers((m) => !m)}>
            {markers ? "Hide events" : "Show events"}
          </button>
        </div>
      </div>

      {err && <ErrorCard error={err} onRetry={() => setReload((n) => n + 1)} title="Couldn't load price history." />}
      {!err && loading && !data && <Skeleton rows={1} height={340} />}

      {data && data.bars.length === 0 && (
        <p className="muted small" style={{ padding: "var(--s-5) 0", marginBottom: 0 }}>
          No price history on file for {symbol} yet. Daily bars arrive with the next market-data pull
          {data.source.last_error ? `; the last attempt failed: ${data.source.last_error}` : ""}.
        </p>
      )}

      {data && data.bars.length > 0 && (
        <>
          <div className="chart-stats">
            <span>
              Last <b className="mono">{price(lastBar.c)}</b>
              <span className="faint xs"> {shortDate(lastBar.d)}{lastAge ? ` · ${lastAge.label} old` : ""}</span>
            </span>
            <span>
              {RANGES.find(([, d]) => d === days)?.[0]} change{" "}
              <b className={`mono ${stockChg > 0 ? "pos" : stockChg < 0 ? "neg" : ""}`}>{pct(stockChg)}</b>
            </span>
            {data.benchmark && benchChg != null && (
              <span>
                {data.benchmark.symbol} ({data.benchmark.label}){" "}
                <b className={`mono ${benchChg > 0 ? "pos" : benchChg < 0 ? "neg" : ""}`}>{pct(benchChg)}</b>
                {stockChg != null && (
                  <span className="faint xs"> · relative {pct(stockChg - benchChg)}</span>
                )}
              </span>
            )}
          </div>
          <div ref={box} className="chartbox" role="img" aria-label={`${symbol} daily candles over ${days} days`} />
          <div className="legend xs faint">
            <span>
              <i className="lg-dot pos" /> E = dated event, filled when the name then moved 20% or traded 3x volume
            </span>
            <span>
              <i className="lg-arrow" /> alert fired (B borrow, SI short interest, V volume, C catalyst, F filing, Δ band, I insider, S social, $ contract)
            </span>
            <span className="spacer" />
            <span>{data.source.name}</span>
          </div>
        </>
      )}
    </section>
  );
}
