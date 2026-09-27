import React, { useEffect, useState } from "react";
import { api, fmtMoney, getToken } from "../api.js";
import { navigate } from "../main.jsx";
import SearchBar from "../components/SearchBar.jsx";
import ScoreBadge from "../components/ScoreBadge.jsx";
import Pin from "../components/Pin.jsx";

const toast = (msg) => window.dispatchEvent(new CustomEvent("toast", { detail: msg }));

const BAND_LABEL = {
  strong: "top of the range on this run",
  elevated: "above the strategy's typical range",
  neutral: "within the typical range; no signal",
  weak: "below typical range",
  excluded: "carries a disqualifying penalty",
};

export default function StockReport({ symbol }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [cap, setCap] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pinKey, setPinKey] = useState(0);

  useEffect(() => {
    let alive = true;
    api(`/stock/${encodeURIComponent(symbol)}`)
      .then((x) => alive && setD(x))
      .catch((e) => alive && setErr(e.detail || "not found"));
    return () => {
      alive = false;
    };
  }, [symbol]);

  useEffect(() => {
    if (!getToken()) return;
    let alive = true;
    Promise.all([api("/entitlements"), api("/me/picks")])
      .then(([ent, picks]) => {
        if (!alive) return;
        const limit = (ent.current && ent.current.picks_limit) || 999;
        setCap({
          limit,
          used: ent.usage ? ent.usage.picks_used : 0,
          pinned: (picks.picks || []).map((p) => p.symbol.toUpperCase()),
        });
      })
      .catch(() => setCap(null));
    return () => {
      alive = false;
    };
  }, [symbol, pinKey]);

  const swap = async () => {
    setBusy(true);
    try {
      const r = await api("/me/picks/swap", { method: "POST", json: { symbol: d.symbol } });
      if (r.dropped) toast(`Dropped ${r.dropped} and pinned ${d.symbol}.`);
      else toast(`Pinned ${d.symbol}.`);
      setPinKey((k) => k + 1);
    } catch (e2) {
      toast(e2.detail || String(e2.message || e2));
    } finally {
      setBusy(false);
    }
  };

  if (err) {
    return (
      <div className="wrap">
        <div className="pagehead">
          <h1>{symbol.toUpperCase()}</h1>
        </div>
        <div className="table-card empty">
          <p>{err}</p>
          <p style={{ marginTop: "var(--s-3)" }}>
            <SearchBar />
          </p>
        </div>
      </div>
    );
  }
  if (!d) {
    return (
      <div className="wrap">
        <div className="pagehead">
          <h1>{symbol.toUpperCase()}</h1>
        </div>
        <div className="table-card empty">Loading…</div>
      </div>
    );
  }

  const s = d.score;
  const thin = s && s.components_present < s.components_total * 0.5;
  const snaps = Object.entries(d.snapshot || {});
  const pinned = cap && cap.pinned.includes(d.symbol);
  const atCap = cap && cap.used >= cap.limit && !pinned;

  return (
    <div className="wrap">
      <header>
        <h1>
          {d.symbol}
          <Pin key={pinKey} symbol={d.symbol} />
          <span className="sub">{d.theme}</span>
        </h1>
        <div className="meta">
          {d.industry.label} · benchmark {d.industry.benchmark_etf} · group{" "}
          {d.group}
        </div>
        {atCap && (
          <p className="meta" style={{ marginTop: "var(--s-2)", marginBottom: 0 }}>
            <button
              className="btn btn-quiet"
              disabled={busy}
              onClick={swap}
              title="Drops your oldest watchlist pick to make room"
            >
              Watchlist full ({cap.used}/{cap.limit}) — replace your oldest pin with{" "}
              {d.symbol}
            </button>
          </p>
        )}
      </header>

      <div className="report">
        <div className="report-main">
          <section className="scoreblock">
            <div className="row1">
              <ScoreBadge
                size="full"
                band={s ? s.band : "excluded"}
                value={s ? s.value : null}
                present={s ? s.components_present : null}
                total={s ? s.components_total : null}
              />
              <div>
                <div className="strat">
                  Fast Mover · calibrated on cleared events
                </div>
              </div>
            </div>
            <div className="row2">
              {s
                ? `${s.value.toFixed(1)}/100 · coverage ${s.components_present}/${
                    s.components_total
                  } components (${
                    Math.round(
                      (s.components_present / s.components_total) * 100
                    )
                  }%)${
                    s.shrinkage_applied
                      ? ` · uncertainty shrinkage −${Math.abs(
                          s.shrinkage_applied
                        ).toFixed(1)} from ${s.shrinkage_from?.toFixed(0)}`
                      : ""
                  } · ${BAND_LABEL[s.band] || ""}`
                : "No scored run for this ticker yet."}
            </div>
            <div className="rule" />
            {s && s.haircuts.length > 0 && (
              <section className="haircuts">
                <h3>Haircuts and penalties</h3>
                <ul style={{ margin: 0, paddingLeft: "1.2em" }}>
                  {s.haircuts.map((h, i) => (
                    <li key={i}>
                      −{h.points} · {h.label}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </section>
        </div>

        <aside className="sidebar">
          <h3>Data</h3>
          {snaps.length === 0 ? (
            <div className="aside-note">
              No market snapshot on file for this ticker in the sandbox seed.
              Figures above come from the operator&rsquo;s research pass.
            </div>
          ) : (
            snaps.map(([k, v]) => (
              <div className="kv" key={k}>
                <span className="k">{k}</span>
                <span className="v">
                  {typeof v.value === "number"
                    ? k === "cap_usd_m"
                      ? fmtMoney(v.value)
                      : v.value
                    : v.value}
                </span>
              </div>
            ))
          )}
          {s && s.delta_1d != null && (
            <div className="kv">
              <span className="k">Δ vs prior run</span>
              <span className="v">{s.delta_1d.toFixed(1)}</span>
            </div>
          )}
          <div className="aside-note">
            Machine scores rank; the operator decides. Nothing here is a
            recommendation to buy or sell.
          </div>
        </aside>
      </div>
    </div>
  );
}