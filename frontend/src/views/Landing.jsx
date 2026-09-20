import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { navigate } from "./../main.jsx";

export default function Landing() {
  const [strategies, setStrategies] = useState(null);
  const [industries, setIndustries] = useState(null);
  const [run, setRun] = useState(null);

  useEffect(() => {
    api("/strategies").then((d) => setStrategies(d.strategies)).catch(() => setStrategies(null));
    api("/industries").then((d) => setIndustries(d.industries)).catch(() => setIndustries(null));
    api("/runs/latest").then(setRun).catch(() => setRun(null));
  }, []);

  return (
    <div className="hero">
      <h1>
        A <em>dated catalyst</em>, a tight float, and a short squeeze that has
        not happened yet.
      </h1>
      <p className="lede">
        tradealert.me runs five filter-driven strategies against a universe of{" "}
        <b>{industries ? "400+ instrumented names" : "small-cap names"}</b> and
        publishes a scored, banded board each cycle. Fast Mover is the only
        calibrated strategy: <b>81.2% hit rate on 32 filter-passing events</b>.{" "}
      </p>
      <div className="wrap" style={{ paddingLeft: 0, paddingRight: 0 }}>
        <div className="pagehead" style={{ justifyContent: "flex-start" }}>
          <a
            className="btn btn-primary cta"
            href="/board"
            onClick={(e) => {
              e.preventDefault();
              navigate("/board");
            }}
          >
            Open the Fast Mover board
          </a>
        </div>
      </div>
      <div className="section" style={{ marginTop: "var(--s-5)" }}>
        <h2>Strategies</h2>
        <div className="stratgrid">
          {(strategies || []).map((s) => (
            <div
              key={s.key}
              className={`strat ${s.calibrated ? "" : "provisional"}`}
            >
              <div className="name">
                <span className="mono">{s.monogram}</span>
                {s.label}
                {!s.calibrated && <span className="chip">Provisional</span>}
              </div>
              <p className="desc">{s.description}</p>
              <p className="st">
                {s.calibrated ? (
                  <span className="cal">
                    Calibrated · {s.resolved_outcomes_count} resolved outcomes ·
                    cutoffs strong ≥{s.band_cutoffs?.strong}
                  </span>
                ) : (
                  <span className="pro">
                    Provisional — weights pending resolved outcomes
                  </span>
                )}
              </p>
            </div>
          ))}
        </div>
      </div>
      <div className="section" style={{ marginTop: "var(--s-5)" }}>
        <h2>Industries</h2>
        <p style={{ color: "var(--ink-muted)", fontSize: "var(--fs-sm)" }}>
          {industries
            ? industries.map((i) => `${i.label} (${i.benchmark_etf})`).join(" · ")
            : "…"}
        </p>
      </div>
      {run && (
        <p className="st" style={{ color: "var(--ink-faint)", fontSize: "var(--fs-sm)" }}>
          Board as of {new Date(run.as_of).toUTCString().slice(0, 16)} UTC ·{" "}
          {run.universe_active} active names.
        </p>
      )}
    </div>
  );
}