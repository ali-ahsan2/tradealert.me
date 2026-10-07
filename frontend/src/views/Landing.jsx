import React, { useEffect, useState } from "react";
import { api, cached } from "../api.js";
import { Link } from "../lib/router.jsx";
import { useMe } from "../lib/me.jsx";
import { alertsLabel, dollars, industriesLabel, shortDate } from "../lib/fmt.js";
import { EVIDENCE, GROUPS, TICKER_RECORD } from "../lib/evidence.js";
import { Monogram, StatusChip } from "../components/ui.jsx";
import "./landing.css";

// One page. What the platform does, the one body of evidence it has
// (including what that evidence does not prove), the five strategies, the
// universe, and the plans. No testimonials, no urgency, no illustration.

const HOW = [
  ["Reads public data", "Filings, prices and news on a fixed schedule from primary sources. No hand entry."],
  ["Applies the same checks to every name", "Hard filters first. A name clears every one or earns no strong score."],
  ["Scores what passes, 0 to 100", "Missing inputs pull the score toward neutral, so thin data can't produce an extreme number."],
  ["Shows its working", "Every score carries its coverage, its source dates and the exact filter results."],
];

export default function Landing() {
  const { me } = useMe();
  const [strategies, setStrategies] = useState(null);
  const [industries, setIndustries] = useState(null);
  const [run, setRun] = useState(null);
  const [tiers, setTiers] = useState(null);

  useEffect(() => {
    cached("/strategies").then((d) => setStrategies(d.strategies)).catch(() => setStrategies([]));
    cached("/industries").then((d) => setIndustries(d.industries)).catch(() => setIndustries([]));
    api("/runs/latest").then(setRun).catch(() => setRun(null));
    cached("/entitlements").then((d) => setTiers(d.tiers)).catch(() => setTiers(null));
  }, []);

  const fm = strategies && strategies.find((s) => s.key === "fast_mover");
  const provisional = strategies ? strategies.filter((s) => !s.calibrated) : [];
  const universeTotal = industries ? industries.reduce((a, i) => a + (i.universe_count || 0), 0) : null;
  const maxCount = industries && industries.length ? Math.max(...industries.map((i) => i.universe_count || 0)) : 1;
  const sortedTiers = tiers ? [...tiers].sort((a, b) => a.price_monthly_cents - b.price_monthly_cents) : [];
  const free = sortedTiers.find((t) => t.price_monthly_cents === 0);
  const primary = me ? ["/board", "Open your Board"] : ["/signup", "Start free"];

  return (
    <div className="ld">
      <section className="ld-hero">
        <div className="ld-hero-copy">
          <p className="eyebrow">Ranked small-cap research, with its working shown</p>
          <h1>Know which names are built to move before their next event.</h1>
          <p className="ld-lede">
            Fast Mover reads filings and market data on a schedule, runs every covered name through
            the same hard filters, and ranks what passes. On real data, <b>{EVIDENCE.hits} of {EVIDENCE.events}</b>{" "}
            names that cleared the screen moved 20% or traded 3x volume inside the event window.
          </p>
          <div className="ld-actions">
            <Link to={primary[0]} className="btn btn-primary btn-lg">
              {primary[1]}
            </Link>
            <Link to="/pricing" className="btn btn-secondary btn-lg">
              Compare plans
            </Link>
          </div>
          <p className="ld-age mono">
            {run
              ? `Latest run ${shortDate(run.as_of)} · ${run.universe_active} names scored`
              : "Scores regenerate on a daily run"}
            {free ? ` · Free covers the top ${free.names_shown_limit} in one industry` : ""}
          </p>
        </div>
        <figure className="card ld-panel">
          <figcaption className="ld-panel-head">
            <span>Hit rate inside the event window</span>
            <span className="mono muted">2-year test · {EVIDENCE.events} events</span>
          </figcaption>
          <div className="ld-panel-big">
            <span className="ld-num mono">
              {EVIDENCE.hitRate}
              <small>%</small>
            </span>
            <span className="ld-panel-bigsub">
              of names that cleared the screen moved hard.
              <br />
              <span className="mono">
                {EVIDENCE.hits} of {EVIDENCE.events}
              </span>
            </span>
          </div>
          <ol className="ld-bars">
            {GROUPS.map((g) => (
              <li key={g.key} className={`ld-bar ${g.key === "filtered" ? "hi" : ""}`}>
                <div className="ld-bar-label">
                  <span>{g.label}</span>
                  <span className="ld-bar-sub">{g.sub}</span>
                </div>
                <div className="ld-bar-track" aria-hidden="true">
                  <span className="ld-bar-fill" style={{ width: `${g.pct}%` }} />
                </div>
                <div className="ld-bar-val mono">
                  <b>{g.pct.toFixed(1)}%</b>
                  <span>
                    {g.hits}/{g.n}
                  </span>
                </div>
              </li>
            ))}
          </ol>
          <p className="ld-panel-foot">
            A hit is {EVIDENCE.hitDefinition}, measured from {EVIDENCE.window}. The screen is judged
            on that, and so is this page.
          </p>
        </figure>
      </section>

      <section className="ld-section">
        <header className="ld-sechead">
          <h2>One standard, applied to every name on every run.</h2>
          <p className="ld-sub">
            There are no exceptions to flatter the numbers. If a filter fails, the report says so in
            a word, next to the figure that failed it.
          </p>
        </header>
        <ol className="ld-how">
          {HOW.map(([t, b], i) => (
            <li key={t}>
              <span className="ld-n mono">0{i + 1}</span>
              <h3>{t}</h3>
              <p>{b}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="ld-section ld-record">
        <div>
          <header className="ld-sechead">
            <h2>
              The record: {EVIDENCE.hits} hits from {EVIDENCE.tickers} names.
            </h2>
            <p className="ld-sub">
              AEHR cleared the screen seven times and moved all seven. PDYN cleared it three times and
              moved once. No single name carries the result, and the misses are shown at the same
              weight as the hits.
            </p>
          </header>
          <div className="card card-sunken ld-limits">
            <h3>What the test does not prove</h3>
            <ul>
              <li>It measures whether a large move happened, not its direction.</li>
              <li>No trades are simulated and no profit is claimed.</li>
              <li>{EVIDENCE.events} events over roughly two years of regimes is a small sample.</li>
              <li>Four of the five strategies have not been tested at all yet.</li>
            </ul>
          </div>
        </div>
        <div className="card ld-matrix" role="table" aria-label="Screen-clearing events by name">
          <div className="ld-matrix-legend" aria-hidden="true">
            <span>
              <i className="ld-sq hit" /> hit
            </span>
            <span>
              <i className="ld-sq" /> miss
            </span>
          </div>
          {TICKER_RECORD.map(([t, n, h]) => (
            <div className="ld-mrow" role="row" key={t}>
              <span className="ld-mt mono" role="cell">
                {t}
              </span>
              <span className="ld-msq" role="cell" aria-label={`${h} hits of ${n} events`}>
                {Array.from({ length: n }, (_, k) => (
                  <i key={k} className={`ld-sq ${k < h ? "hit" : ""}`} />
                ))}
              </span>
              <span className="ld-mc mono" role="cell">
                {h}/{n}
              </span>
            </div>
          ))}
          <div className="ld-mrow ld-mtotal" role="row">
            <span className="ld-mt mono" role="cell">
              Total
            </span>
            <span role="cell" />
            <span className="ld-mc mono" role="cell">
              {EVIDENCE.hits}/{EVIDENCE.events}
            </span>
          </div>
        </div>
      </section>

      <section className="ld-section">
        <header className="ld-sechead">
          <h2>One engine, five lenses. One of them is calibrated.</h2>
          <p className="ld-sub">
            Every strategy declares its own components and runs through the same scoring math. Only
            Fast Mover has the resolved outcomes to back its weights; the others are labelled
            provisional everywhere they appear, and produce candidates rather than signals.
          </p>
        </header>
        <div className="ld-strats">
          <article className="card ld-fm">
            <div className="row">
              <Monogram>FM</Monogram>
              <h3>Fast Mover</h3>
              <StatusChip calibrated />
            </div>
            <p className="muted">
              Floating supply, crowding, and a dated catalyst. Hard filters on market cap, float,
              short interest, revenue growth and catalyst timing are the evidenced claim; the
              scorecard ranks what passes.
            </p>
            <dl className="ld-stats">
              <div>
                <dt>Resolved outcomes</dt>
                <dd className="mono">{fm ? fm.resolved_outcomes_count : EVIDENCE.events}</dd>
              </div>
              <div>
                <dt>Hit rate</dt>
                <dd className="mono">{EVIDENCE.hitRate}%</dd>
              </div>
              <div>
                <dt>Produces</dt>
                <dd>Signals</dd>
              </div>
            </dl>
          </article>
          <div className="card card-sunken ld-prov">
            <p className="eyebrow">Provisional strategies · weights not yet backed by outcomes</p>
            <ul>
              {(provisional.length
                ? provisional
                : [
                    { key: "market_shift", label: "Market Shift", monogram: "MS" },
                    { key: "geopolitics", label: "GeoPolitics", monogram: "GP" },
                    { key: "industry_restructure", label: "Industry Restructure", monogram: "IR" },
                    { key: "monetary_shifts", label: "Monetary Shifts", monogram: "MN" },
                  ]
              ).map((s) => (
                <li key={s.key}>
                  <Monogram>{s.monogram}</Monogram>
                  <b>{s.label}</b>
                  <span className="mono muted">{s.resolved_outcomes_count ?? 0}/{EVIDENCE.calibrationThreshold} outcomes</span>
                </li>
              ))}
            </ul>
            <p className="xs faint">
              Each becomes calibrated only after {EVIDENCE.calibrationThreshold} resolved outcomes and a human review
              of the weights. That event is dated and shown on every report.
            </p>
          </div>
        </div>
      </section>

      <section className="ld-section">
        <header className="ld-sechead">
          <h2>{industries && industries.length ? `${universeTotal} names in ${industries.length} industries.` : "The names we cover."}</h2>
          <p className="ld-sub">
            You follow industries; the Board shows the top names in each, scored against a sector
            benchmark. Pin a name to keep it in view and in your weekly digest.
          </p>
        </header>
        <ul className="ld-ind">
          {[...(industries || [])]
            .sort((a, b) => b.universe_count - a.universe_count)
            .map((i) => (
              <li key={i.key} title={i.description}>
                <span className="ld-ind-name">{i.label}</span>
                <span className="mono faint">{i.benchmark_etf}</span>
                <span className="ld-ind-bar" aria-hidden="true">
                  <span style={{ width: `${Math.round((i.universe_count / maxCount) * 100)}%` }} />
                </span>
                <span className="mono">{i.universe_count}</span>
              </li>
            ))}
        </ul>
      </section>

      {sortedTiers.length > 0 && (
        <section className="ld-section">
          <header className="ld-sechead">
            <h2>Same scores on every plan. Plans differ in reach.</h2>
            <p className="ld-sub">
              Nobody gets a better number. Paid plans follow more industries, show more names, pin
              more, and add delivery channels.
            </p>
          </header>
          <div className="ld-plans">
            {sortedTiers.map((t) => (
              <div key={t.key} className={`card ld-plan ${t.key === "pro" ? "popular" : ""}`}>
                <div className="ld-plan-top">
                  <b>{t.label}</b>
                  <span className="mono">{t.price_monthly_cents === 0 ? "$0" : `${dollars(t.price_monthly_cents)}/mo`}</span>
                </div>
                <ul>
                  <li>{industriesLabel(t.industries_limit)}</li>
                  <li>top {t.names_shown_limit} names each</li>
                  <li>{t.picks_limit} pinned</li>
                  <li>{alertsLabel(t.alerts_limit)}</li>
                </ul>
              </div>
            ))}
          </div>
          <p className="small muted">
            <Link to="/pricing">Full comparison, including delivery channels and what happens on a downgrade →</Link>
          </p>
        </section>
      )}

      <section className="ld-close">
        <h2>Read the Board free before you pay for it.</h2>
        <p className="ld-sub">
          {free
            ? `Free covers the top ${free.names_shown_limit} names in one industry and a weekly digest. No card needed; verification only gates delivery, never browsing.`
            : "No card needed; verification only gates delivery, never browsing."}
        </p>
        <div className="ld-actions">
          <Link to={primary[0]} className="btn btn-primary btn-lg">
            {primary[1]}
          </Link>
          <Link to="/pricing" className="btn btn-secondary btn-lg">
            Compare plans
          </Link>
        </div>
      </section>
    </div>
  );
}
