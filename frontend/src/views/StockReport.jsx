import React, { useEffect, useState } from "react";
import { api, fmtMoney } from "../api.js";
import { navigate } from "../main.jsx";
import SearchBar from "../components/SearchBar.jsx";
import ScoreBadge from "../components/ScoreBadge.jsx";
import Pin from "../components/Pin.jsx";

const BAND_LABEL = {
  strong: "top of the range on this run",
  elevated: "above the strategy's typical range",
  neutral: "within the typical range; no signal",
  weak: "below typical range",
  excluded: "failed a hard filter or carries a disqualifying haircut",
};

export default function StockReport({ symbol }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let alive = true;
    api(`/stock/${encodeURIComponent(symbol)}`)
      .then((x) => alive && setD(x))
      .catch((e) => alive && setErr(e.detail || "not found"));
    return () => {
      alive = false;
    };
  }, [symbol]);

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
  const hf = (s && s.hard_filters) || [];

  return (
    <div className="wrap">
      <header>
        <h1>
          {d.symbol}
          <Pin symbol={d.symbol} />
          <span className="sub">{d.theme}</span>
        </h1>
        <div className="meta">
          {d.industry.label} · benchmark {d.industry.benchmark_etf} · group{" "}
          {d.group} · lane {d.lane || "—"}
        </div>
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
                  Fast Mover · calibrated · cutoffs strong 72 · elevated 52 ·
                  neutral 40
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
                : "No scored run for this name yet."}
            </div>
            <div className="rule" />
            {s && (
              <div className="complist">
                {s.components.map((c) => (
                  <div className="comp" key={c.key}>
                    <div className="lbl">
                      {c.label}
                      {c.val ? (
                        <span className="val"> · {c.val}</span>
                      ) : null}
                    </div>
                    <div className="track">
                      <div
                        className={`fill ${
                          c.score >= 0.65 ? "hi" : c.score < 0.35 ? "lo" : ""
                        }`}
                        style={{ width: `${Math.round(c.score * 100)}%` }}
                      />
                    </div>
                    <div className="w">
                      {c.score.toFixed(2)} ×{c.weight}
                    </div>
                  </div>
                ))}
              </div>
            )}
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
            {hf.length > 0 && (
              <section className="hardfilters">
                <h3>Hard filters (Fast Mover)</h3>
                {hf.map((h) => (
                  <div className="hf" key={h.key}>
                    <span className={h.pass ? "ok" : "fail"}>
                      {h.pass ? "PASS" : "FAIL"}
                    </span>
                    <span>
                      {h.label}: <span className="mono">{h.value}</span>
                    </span>
                  </div>
                ))}
              </section>
            )}
            {d.thesis && (
              <section className="opnote">
                <div className="lab">Operator note</div>
                <p>{d.thesis}</p>
              </section>
            )}
          </section>
        </div>

        <aside className="sidebar">
          <h3>Data</h3>
          {snaps.length === 0 ? (
            <div className="aside-note">
              No market snapshot on file for this name in the sandbox seed.
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
          <div className="kv">
            <span className="k">hook</span>
            <span className="v" style={{ textAlign: "right", fontSize: "var(--fs-xs)" }}>
              {d.hook || "—"}
            </span>
          </div>
          {s && (
            <>
              <div className="kv">
                <span className="k">components</span>
                <span className="v">
                  {s.components_present}/{s.components_total}
                </span>
              </div>
              {s.delta_1d != null && (
                <div className="kv">
                  <span className="k">Δ vs prior run</span>
                  <span className="v">{s.delta_1d.toFixed(1)}</span>
                </div>
              )}
            </>
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