import React, { useEffect, useMemo, useRef, useState } from "react";
import { createChart, CrosshairMode } from "lightweight-charts";
import { api } from "../api.js";
import { age, pct, price, seriesChange, shortDate } from "../lib/fmt.js";
import { ErrorCard, Skeleton } from "./ui.jsx";

// TradingView's own charting library, so crosshair, zoom and pan behave the
// way the reference products do. Every mark on the chart is a recorded fact:
// a bar that printed, an alert that fired, a dated event and how the name
// actually moved after it. Nothing decorative.

// label, days fetched, bars kept (the API's floor is 30 days; a week is a slice)
const RANGES = [
  ["1W", 30, 5],
  ["1M", 30, null],
  ["3M", 90, null],
  ["1Y", 365, null],
  ["2Y", 730, null],
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

export default function PriceChart({ symbol, initialDays = 90 }) {
  const box = useRef(null);
  const [range, setRange] = useState(() => RANGES.find(([, d]) => d === initialDays) || RANGES[2]);
  const days = range[1];
  const [markers, setMarkers] = useState(true);
  const [candles, setCandles] = useState(false);
  const [raw, setRaw] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  // bumped when the theme changes so the chart re-reads its colour tokens
  const [themeTick, setThemeTick] = useState(0);

  useEffect(() => {
    const bump = () => setThemeTick((n) => n + 1);
    window.addEventListener("ta:theme", bump);
    const mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    if (mq) {
      if (mq.addEventListener) mq.addEventListener("change", bump);
      else if (mq.addListener) mq.addListener(bump);
    }
    return () => {
      window.removeEventListener("ta:theme", bump);
      if (mq) {
        if (mq.removeEventListener) mq.removeEventListener("change", bump);
        else if (mq.removeListener) mq.removeListener(bump);
      }
    };
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr(null);
    api(`/stock/${encodeURIComponent(symbol)}/series?days=${days}`)
      .then((d) => alive && setRaw(d))
      .catch((e) => alive && setErr(e))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [symbol, days, reload]);

  // a week is the last five bars of the month fetch; memoised so the chart
  // effect below only rebuilds when the bars or the range actually change
  const keep = range[2];
  const data = useMemo(
    () =>
      raw
        ? keep
          ? { ...raw, bars: raw.bars.slice(-keep), benchmark: raw.benchmark ? { ...raw.benchmark, bars: raw.benchmark.bars.slice(-keep) } : null }
          : raw
        : null,
    [raw, keep]
  );

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
        vertLines: { visible: false },
        horzLines: { color: token("--chart-grid", "#eef0f5") },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: token("--border", "#d8dce3") },
      timeScale: { borderColor: token("--border", "#d8dce3"), rightOffset: 3 },
      handleScale: { axisPressedMouseMove: true },
    });
    const pos = token("--pos", "#0f9d58");
    const neg = token("--neg", "#e0393e");
    const up = data.bars[data.bars.length - 1].c >= data.bars[0].c;
    const lineColor = up ? pos : neg;
    let main;
    if (candles) {
      main = c.addCandlestickSeries({
        upColor: pos,
        downColor: neg,
        borderUpColor: pos,
        borderDownColor: neg,
        wickUpColor: pos,
        wickDownColor: neg,
      });
      main.setData(data.bars.map((b) => ({ time: b.d, open: b.o, high: b.h, low: b.l, close: b.c })));
    } else {
      // the brokerage view: a close line with a soft fill in the move's colour
      const hex = (h, a) => {
        const m = h.replace("#", "");
        const n = parseInt(m.length === 3 ? m.split("").map((x) => x + x).join("") : m, 16);
        return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
      };
      main = c.addAreaSeries({
        lineColor,
        topColor: hex(lineColor, 0.28),
        bottomColor: hex(lineColor, 0.02),
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
      });
      main.setData(data.bars.map((b) => ({ time: b.d, value: b.c })));
    }
    const vol = c.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
      color: token("--border", "#e6e8ef"),
    });
    c.priceScale("vol").applyOptions({ scaleMargins: { top: 0.86, bottom: 0 } });
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
      main.setMarkers(all);
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
  }, [data, markers, candles, themeTick]);

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
            {RANGES.map((r) => (
              <button key={r[0]} aria-pressed={range[0] === r[0]} onClick={() => setRange(r)}>
                {r[0]}
              </button>
            ))}
          </div>
          <button className="btn-quiet" aria-pressed={candles} onClick={() => setCandles((v) => !v)}>
            {candles ? "Line" : "Candles"}
          </button>
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
              {range[0]} change{" "}
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
          <div ref={box} className="chartbox" role="img" aria-label={`${symbol} daily ${candles ? "candles" : "closes"}, ${range[0]}`} />
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
