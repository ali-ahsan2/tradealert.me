import React, { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { navigate } from "./../main.jsx";
import { currentStyle, STYLES } from "../components/theme.js";
import "./landing.css";

// Source for every figure below: test_results.md (Fast Mover backtest, run 2026-09-11).
const GROUPS = [
  { key: "random", label: "Random trading days", sub: "no earnings within 6 days", hits: 85, n: 232, pct: 36.6 },
  { key: "earnings", label: "All earnings events", sub: "27 tickers, about two years", hits: 112, n: 191, pct: 58.6 },
  { key: "filtered", label: "Everything Fast Mover flagged", sub: "8 tickers, 32 events", hits: 26, n: 32, pct: 81.2 },
];

const TICKERS = [
  ["INOD", 8, 6],
  ["AEHR", 7, 7],
  ["BKSY", 5, 3],
  ["SEZL", 4, 4],
  ["TSSI", 3, 3],
  ["PDYN", 3, 1],
  ["DUOT", 1, 1],
  ["OUST", 1, 1],
];

const HOW = [
  {
    n: "01",
    title: "Reads public data",
    body: "Filings, prices, news on a fixed schedule. No hand-entry.",
  },
  {
    n: "02",
    title: "Asks the questions",
    body: "The analyst's questions, checked against the data.",
  },
  {
    n: "03",
    title: "Scores every ticker",
    body: "0 to 100 every run. Thin data pulls toward neutral.",
  },
  {
    n: "04",
    title: "Flags moves early",
    body: "Strong scores hit your inbox before the window opens.",
  },
];

const COPY = {
  contemporary: {
    heroTitle: "Get in before the big move.",
    slides: [
      "The big moves a stock makes are usually decided in the first hours after a report lands.",
      "Fast Mover reads those reports on a fixed schedule and scores every covered ticker out of 100.",
      "The strong scores reach your inbox before the event window opens.",
    ],
    cta: "Open the Fast Mover board",
    more: "How we score it",
    howH2: "An algorithm that asks the right questions.",
    howSub: "Fast Mover checks every ticker against the same standard on every run. A ticker clears every check or it earns no strong score. No exceptions to flatter the numbers.",
    spreadH2: "The record: 26 hits from 8 tickers.",
    spreadSub: "AEHR clears the screen seven times and moves all seven. PDYN clears it three times and moves once. No single ticker carries the result.",
    note: "The largest move in the sample is INOD after its 2026-05-07 report, on 17.4x volume, screen cleared. The screen raises the odds of a move, not its size.",
    limitsH2: "The score lands before the move.",
    limitsSub: "Every clear-screen event is scored from filings and market data already on file when the alert goes out. Nothing is added after the fact.",
    l1t: "Read it first",
    l1b: "Fast Mover sends the score before the event window opens. The move has not happened when you read it.",
    l2t: "Follows every alert",
    l2b: "26 of 32 clear-screen events move within a week of the alert going out. An 81.2% hit rate against a 20-day, 3x-volume bar.",
    l3t: "The record is the record",
    l3b: "No filing, no price bar, and no score is added or changed after the fact. What goes out is exactly what you see.",
    limitsFoot: "Straight limits: the screen does not call direction, no trades are simulated, and 32 events is a small deck.",
    stratsH2: "One engine runs every screen.",
    stratsSub: "Fast Mover ships signals today. Every other screen runs the same ranks and shares the same scoring, and goes live as its own backtest clears.",
    fmLead: "Public data, one question: which tickers are built for a big move, and when. Strong scores reach your inbox before the window opens.",
    provHead: "Preview screens, same engine, same inputs.",
    flowH2: "From data to inbox",
    closeH2: "Read the board free before you pay for it.",
  },
  brutalist: {
    heroTitle: "CALLED BEFORE IT MOVES.",
    slides: [
      "A stock's big moves are decided in the first hours after the report lands.",
      "Fast Mover reads the report on schedule and scores every covered ticker out of 100.",
      "Strong scores hit your inbox before the window opens.",
    ],
    cta: "OPEN THE BOARD",
    more: "SEE THE TEST",
    howH2: "ONE STANDARD. NO EXCEPTIONS.",
    howSub: "Every ticker clears the same checks on every run or it earns no strong score. No special cases to keep the numbers looking good.",
    spreadH2: "THE RECORD: 26 HITS FROM 8 TICKERS.",
    spreadSub: "AEHR clears the screen seven times and moves all seven. PDYN clears it three times and moves once. No single ticker carries the result.",
    note: "Biggest move in the sample: INOD after its 2026-05-07 report, on 17.4x volume, screen cleared.",
    limitsH2: "THE SCORE LANDS BEFORE THE WINDOW OPENS.",
    limitsSub: "Scores are cut from filings and market data already on file when each alert goes out. Nothing is added afterwards.",
    l1t: "READ IT FIRST",
    l1b: "The score hits your inbox before the window opens. At the moment you read it the move has not happened.",
    l2t: "FOLLOWS EVERY ALERT",
    l2b: "26 of 32 clear screens move inside a week. An 81.2% hit rate against a 20-day, 3x-volume bar.",
    l3t: "NO RETROFITS",
    l3b: "No filing, no price bar, and no score is touched after the fact. What goes out is what you see.",
    limitsFoot: "LIMITS: NO DIRECTION CALL. NO SIMULATED TRADES. 32 EVENTS IS A SMALL DECK.",
    stratsH2: "ONE ENGINE RUNS EVERY SCREEN.",
    stratsSub: "Fast Mover ships signals today. Every preview screen runs the same ranks and the same scoring.",
    fmLead: "Public data, one question: which tickers are built for a big move, and when. Strong scores reach your inbox before the window opens.",
    provHead: "PREVIEW SCREENS. SAME ENGINE.",
    flowH2: "FROM DATA TO INBOX",
    closeH2: "READ THE BOARD BEFORE YOU PAY.",
  },
};

function go(to) {
  return (e) => {
    e.preventDefault();
    navigate(to);
  };
}

// A callback ref rather than a query on mount, so sections that render only
// after their API data arrives still get observed.
function useReveal() {
  const ioRef = useRef(null);
  useEffect(() => () => ioRef.current && ioRef.current.disconnect(), []);
  return useCallback((el) => {
    if (!el || el.classList.contains("is-in")) return;
    if (!("IntersectionObserver" in window)) {
      el.classList.add("is-in");
      return;
    }
    if (!ioRef.current) {
      ioRef.current = new IntersectionObserver(
        (entries) => {
          entries.forEach((e) => {
            if (e.isIntersecting) {
              e.target.classList.add("is-in");
              ioRef.current.unobserve(e.target);
            }
          });
        },
        { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
      );
    }
    ioRef.current.observe(el);
  }, []);
}

function EvidencePanel({ reveal }) {
  const ref = useRef(null);
  return (
    <figure
      className="ld-panel"
      ref={(el) => {
        ref.current = el;
        reveal(el);
      }}
      data-reveal
    >
      <figcaption className="ld-panel-head">
        <span>Hit rate inside the event window</span>
        <span className="mono">2-year test · 32 events</span>
      </figcaption>
      <div className="ld-panel-big">
        <span className="ld-num">81.2<small>%</small></span>
        <span className="ld-panel-bigsub">
          of the tickers we flagged moved hard.
          <br />
          <span className="mono">26 of 32</span>
        </span>
      </div>
      <ol className="ld-bars">
        {GROUPS.map((g, i) => (
          <li key={g.key} className={`ld-bar ld-bar-${g.key}`} style={{ "--i": i, "--w": g.pct / 100 }}>
            <div className="ld-bar-label">
              <span>{g.label}</span>
              <span className="ld-bar-sub">{g.sub}</span>
            </div>
            <div className="ld-bar-track" aria-hidden="true">
              <span className="ld-bar-fill" />
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
        A hit means the ticker moved 20% or more, or traded at 3x its normal volume,
        between 2 trading days before the signal and 5 after it. The screen is
        measured on that, and so is this page.
      </p>
    </figure>
  );
}

export default function Landing() {
  const [strategies, setStrategies] = useState(null);
  const [industries, setIndustries] = useState(null);
  const [run, setRun] = useState(null);
  const [tiers, setTiers] = useState(null);
  const [slide, setSlide] = useState(0);
  const [styleKey, setStyleKey] = useState(currentStyle());

  const st = STYLES.find((s) => s.key === styleKey) || STYLES[0];
  const copy = COPY[st.copy] || COPY.contemporary;
  const slides = copy.slides;

  useEffect(() => {
    const h = () => setStyleKey(currentStyle());
    document.addEventListener("ta-theme", h);
    return () => document.removeEventListener("ta-theme", h);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setSlide((k) => (k + 1) % slides.length), 5500);
    return () => clearInterval(t);
  }, [slide, slides.length]);

  useEffect(() => {
    api("/strategies").then((d) => setStrategies(d.strategies)).catch(() => setStrategies(null));
    api("/industries").then((d) => setIndustries(d.industries)).catch(() => setIndustries(null));
    api("/runs/latest").then(setRun).catch(() => setRun(null));
    api("/entitlements").then((d) => setTiers(d.tiers)).catch(() => setTiers(null));
  }, []);

  const reveal = useReveal();

  const provisional = strategies ? strategies.filter((s) => s.key !== "fast_mover") : [];
  const fm = strategies && strategies.find((s) => s.key === "fast_mover");
  const universeTotal = industries ? industries.reduce((a, i) => a + (i.universe_count || 0), 0) : null;
  const maxCount = industries ? Math.max(...industries.map((i) => i.universe_count || 0)) : 1;
  const paid = tiers ? tiers.filter((t) => t.price_monthly_cents > 0) : [];
  const free = tiers && tiers.find((t) => t.price_monthly_cents === 0);
  const dollars = (c) => `$${Math.round(c / 100)}`;
  const tierWith = (ch) => paid.find((t) => t.channels.includes(ch));

  return (
    <main className="ld">
      <section className="ld-hero">
        <div className="ld-grid" aria-hidden="true" />
        <div className="ld-hero-copy">
          <h1 className="ld-h1 ld-rise" style={{ "--d": 0 }}>
            {copy.heroTitle}
          </h1>
          <div className="ld-slide ld-rise" style={{ "--d": 1 }}>
            {slides.map((s, k) => (
              <p
                key={k}
                className={`ld-slip ${k === slide ? "on" : ""}`}
                aria-hidden={k !== slide}
              >
                {s}
              </p>
            ))}
            <div className="ld-dots" role="tablist" aria-label="What Fast Mover does">
              {slides.map((_, k) => (
                <button
                  key={k}
                  role="tab"
                  aria-selected={k === slide}
                  aria-label={`Message ${k + 1} of ${slides.length}`}
                  className={k === slide ? "on" : ""}
                  onClick={() => setSlide(k)}
                />
              ))}
            </div>
          </div>
          <div className="ld-actions ld-rise" style={{ "--d": 3 }}>
            <a className="ld-btn" href="/board" onClick={go("/board")}>
              {copy.cta}
              <span className="ld-arrow" aria-hidden="true">→</span>
            </a>
            <a className="ld-link" href="#limits">
              {copy.more}
            </a>
          </div>
          {run && (
            <p className="ld-age mono ld-rise" style={{ "--d": 4 }}>
              <span className="ld-dot" aria-hidden="true" />
              Board as of {new Date(run.as_of).toUTCString().slice(5, 16)} · {run.universe_active} tickers scored
            </p>
          )}
        </div>
        <EvidencePanel reveal={reveal} />
      </section>

      <section className="ld-how" ref={reveal} data-reveal>
        <header className="ld-sechead">
          <h2 className="ld-h2">{copy.howH2}</h2>
          <p className="ld-sub">{copy.howSub}</p>
        </header>
        <ol className="ld-how-grid">
          {HOW.map((h, i) => (
            <li key={h.n} style={{ "--i": i }}>
              <span className="ld-how-n mono">{h.n}</span>
              <h3>{h.title}</h3>
              <p>{h.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="ld-spread" ref={reveal} data-reveal>
        <div className="ld-spread-copy">
          <h2 className="ld-h2">{copy.spreadH2}</h2>
          <p className="ld-sub">{copy.spreadSub}</p>
          <div className="ld-note">
            <span className="ld-note-num mono">+123.2%</span>
            <p>{copy.note}</p>
          </div>
        </div>
        <div className="ld-matrix" role="table" aria-label="Screen-clearing events by ticker">
          <div className="ld-matrix-legend" aria-hidden="true">
            <span><i className="ld-sq hit" /> hit</span>
            <span><i className="ld-sq" /> miss</span>
          </div>
          {TICKERS.map(([t, n, h], row) => (
            <div className="ld-mrow" role="row" key={t} style={{ "--r": row }}>
              <span className="ld-mt mono" role="cell">{t}</span>
              <span className="ld-msq" role="cell" aria-label={`${h} hits of ${n} events`}>
                {Array.from({ length: n }, (_, k) => (
                  <i key={k} className={`ld-sq ${k < h ? "hit" : ""}`} style={{ "--k": k }} />
                ))}
              </span>
              <span className="ld-mc mono" role="cell">
                {h}/{n}
              </span>
            </div>
          ))}
          <div className="ld-mrow ld-mtotal" role="row">
            <span className="ld-mt mono" role="cell">Total</span>
            <span role="cell" />
            <span className="ld-mc mono" role="cell">26/32</span>
          </div>
        </div>
      </section>

      <section className="ld-limits" id="limits" ref={reveal} data-reveal>
        <div className="ld-limits-head">
          <h2 className="ld-h2">{copy.limitsH2}</h2>
          <p className="ld-sub">{copy.limitsSub}</p>
        </div>
        <ol className="ld-limit-list">
          <li>
            <span className="ld-limit-n mono">01</span>
            <h3>{copy.l1t}</h3>
            <p>{copy.l1b}</p>
          </li>
          <li>
            <span className="ld-limit-n mono">02</span>
            <h3>{copy.l2t}</h3>
            <p>{copy.l2b}</p>
          </li>
          <li>
            <span className="ld-limit-n mono">03</span>
            <h3>{copy.l3t}</h3>
            <p>{copy.l3b}</p>
          </li>
        </ol>
        <p className="ld-limits-foot mono">{copy.limitsFoot}</p>
      </section>

      <section className="ld-strats" ref={reveal} data-reveal>
        <header className="ld-sechead">
          <h2 className="ld-h2">{copy.stratsH2}</h2>
          <p className="ld-sub">{copy.stratsSub}</p>
        </header>
        <div className="ld-strat-grid">
          <article className="ld-fm">
            <div className="ld-fm-top">
              <span className="ld-mono-mark mono">FM</span>
            </div>
            <h3>Fast Mover</h3>
            <p>{copy.fmLead}</p>
            <dl className="ld-fm-stats">
              <div>
                <dt>Cleared events</dt>
                <dd className="mono">{fm ? fm.resolved_outcomes_count : 32}</dd>
              </div>
              <div>
                <dt>Hit rate</dt>
                <dd className="mono">81.2%</dd>
              </div>
              <div>
                <dt>Sends</dt>
                <dd>Signals</dd>
              </div>
            </dl>
          </article>
          <div className="ld-prov">
            <p className="ld-prov-head">{copy.provHead}</p>
            <ul>
              {provisional.length ? provisional.map((s) => (
                <li key={s.key}>
                  <span className="ld-mono-mark mono">{s.monogram}</span>
                  <span className="ld-prov-name">
                    <b>{s.label}</b>
                  </span>
                  <span className="ld-prov-chip mono">Preview</span>
                </li>
              )) : (
                <li><span className="ld-prov-name"><b>Loading…</b></span></li>
              )}
            </ul>
          </div>
        </div>
      </section>

      <section className="ld-flow" ref={reveal} data-reveal>
        <h2 className="ld-h2">{copy.flowH2}</h2>
        <ol className="ld-steps">
          <li style={{ "--i": 0 }}>
            <span className="ld-step-n mono">01</span>
            <h3>Collect</h3>
            <p>
              Public filings, market data, and news schedules, gathered on fixed intervals from
              primary sources.
            </p>
          </li>
          <li style={{ "--i": 1 }}>
            <span className="ld-step-n mono">02</span>
            <h3>Score</h3>
            <p>
              Every covered ticker gets a 0 to 100 score each run. Missing inputs pull the score toward
              neutral so two data points cannot produce an extreme number.
            </p>
          </li>
          <li style={{ "--i": 2 }}>
            <span className="ld-step-n mono">03</span>
            <h3>Alert</h3>
            <p>
              Rules you set yourself: a price move, a volume spike, a new filing, an insider trade.
              Check the trigger against the source before you act.
            </p>
          </li>
          <li style={{ "--i": 3 }}>
            <span className="ld-step-n mono">04</span>
            <h3>Deliver</h3>
            <p>
              {tiers && tierWith("push") && tierWith("sms") && tierWith("webhook")
                ? `Email on every plan. Web push from ${dollars(tierWith("push").price_monthly_cents)}, SMS from ${dollars(
                    tierWith("sms").price_monthly_cents
                  )}, a signed webhook at ${dollars(tierWith("webhook").price_monthly_cents)} a month.`
                : "Email on every plan. Web push, SMS and a signed webhook on paid plans."}
            </p>
          </li>
        </ol>
      </section>

      <section className="ld-universe" ref={reveal} data-reveal>
          <header className="ld-sechead">
            <h2 className="ld-h2">
              {industries ? `${universeTotal} tickers in ${industries.length} industries` : "The tickers we cover"}
            </h2>
            <p className="ld-sub">
              Each industry runs against a sector benchmark. You follow industries; the board shows
              the top tickers in each.
            </p>
          </header>
          <ul className="ld-ind">
            {[...(industries || [])]
              .sort((a, b) => b.universe_count - a.universe_count)
              .map((i, k) => (
                <li key={i.key} style={{ "--w": i.universe_count / maxCount, "--i": k }} title={i.description}>
                  <span className="ld-ind-name">{i.label}</span>
                  <span className="ld-ind-etf mono">{i.benchmark_etf}</span>
                  <span className="ld-ind-bar" aria-hidden="true">
                    <span />
                  </span>
                  <span className="ld-ind-n mono">{i.universe_count}</span>
                </li>
              ))}
          </ul>
        </section>

      <section className="ld-close" ref={reveal} data-reveal>
        <h2 className="ld-close-h">{copy.closeH2}</h2>
        <p className="ld-sub">
          {free && paid.length
            ? `The free plan covers the top ${free.names_shown_limit} tickers in ${free.industries_limit} industry, by email. Paid plans run ${dollars(
                paid[0].price_monthly_cents
              )} to ${dollars(paid[paid.length - 1].price_monthly_cents)} a month and go up to the top ${
                paid[paid.length - 1].names_shown_limit
              } tickers in every industry.`
            : "The free plan covers the top tickers in one industry, by email."}
        </p>
        <div className="ld-actions">
          <a className="ld-btn" href="/signup" onClick={go("/signup")}>
            Create a free account
            <span className="ld-arrow" aria-hidden="true">→</span>
          </a>
          <a className="ld-link" href="/pricing" onClick={go("/pricing")}>
            Compare plans
          </a>
        </div>
      </section>
    </main>
  );
}