import React, { useEffect, useMemo, useState } from "react";
import "./landing.css";
import { api, cached } from "../api.js";
import { Link } from "../lib/router.jsx";
import { useMe } from "../lib/me.jsx";
import { age, dateTime, dollars, plural, shortDate } from "../lib/fmt.js";
import { EVIDENCE, GROUPS, TICKER_RECORD } from "../lib/evidence.js";
import Icon from "../components/Icons.jsx";

// The landing page sells (DESIGN_V4.md §2.7): one claim, one live visual
// built from public data, one action. Every number is real and sourced.
// No name a plan would hide is shown; the only tickers are the ones the
// published backtest record already names.

const BANDS = ["strong", "elevated", "neutral", "weak", "excluded"];

function LiveRun({ run, industries }) {
  const dist = (run && run.bands) || {};
  const total = BANDS.reduce((a, b) => a + (dist[b] || 0), 0);
  const a = run ? age(run.as_of) : null;
  const universe = industries ? industries.reduce((s, i) => s + (i.universe_count || 0), 0) : null;
  return (
    <div className="ld-device" aria-label="Today's run, live">
      <div className="ld-device-bar">
        <span className="ld-dot" />
        <span className="ld-dot" />
        <span className="ld-dot" />
        <span className="ld-device-title">Today's run</span>
        {a && <span className={`agechip ${a.cls}`}>{a.label}</span>}
      </div>
      <div className="ld-device-body">
        <div className="ld-big">
          <span className="ld-big-num">{total || universe || "—"}</span>
          <span className="ld-big-lab">names scored{run ? ` · ${shortDate(run.as_of)}` : ""}</span>
        </div>
        {total > 0 && (
          <>
            <div className="dist ld-dist" aria-hidden="true">
              {BANDS.map((b) => (dist[b] ? <span key={b} className={b} style={{ width: `${(dist[b] / total) * 100}%` }} /> : null))}
            </div>
            <ul className="ld-bands">
              {BANDS.filter((b) => dist[b]).map((b) => (
                <li key={b}>
                  <span className={`badge compact ${b}`}>
                    <span className="word">{b}</span>
                  </span>
                  <span className="ld-band-n">{dist[b]}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {industries && industries.length > 0 && (
          <div className="ld-inds">
            {industries.slice(0, 6).map((i) => (
              <span key={i.key} className="ld-ind">
                {i.label} <b>{i.universe_count}</b>
              </span>
            ))}
            {industries.length > 6 && <span className="ld-ind faint">+{industries.length - 6} more</span>}
          </div>
        )}
        <p className="ld-device-foot">Names and scores are shown after you sign in and choose an industry. The counts above are live.</p>
      </div>
    </div>
  );
}

function Proof() {
  const filtered = GROUPS.find((g) => g.key === "filtered");
  const earnings = GROUPS.find((g) => g.key === "earnings");
  const random = GROUPS.find((g) => g.key === "random");
  return (
    <section className="ld-proof" aria-labelledby="proof-h">
      <div className="ld-proof-head">
        <h2 id="proof-h">The screen is the evidence.</h2>
        <p className="ld-sub">
          On real data, names that cleared Fast Mover's hard filters moved {EVIDENCE.hitRate}% of the time inside the event window. Earnings events in
          general moved {EVIDENCE.earningsRate}%. A random day, {EVIDENCE.randomRate}%.
        </p>
      </div>
      <div className="ld-proofgrid">
        {[filtered, earnings, random].map((g) => (
          <div className={`ld-proofcard ${g.key === "filtered" ? "hi" : ""}`} key={g.key}>
            <div className="ld-proof-num">{g.pct}%</div>
            <div className="ld-proof-lab">{g.label}</div>
            <div className="ld-proof-bar" aria-hidden="true">
              <span style={{ width: `${g.pct}%` }} />
            </div>
            <div className="ld-proof-sub">
              {g.hits} of {g.n} moved · {g.sub}
            </div>
          </div>
        ))}
      </div>
      <p className="ld-foot">
        A move is {EVIDENCE.hitDefinition}, measured over {EVIDENCE.window}. Movement, not direction or profit. Full record on the{" "}
        <Link to="/strategies/fast_mover">evidence page</Link>.
      </p>
    </section>
  );
}

function Benefits() {
  const items = [
    {
      icon: "board",
      title: "A ranked board, every morning",
      body: "Every covered name runs through the same hard filters and scorecard. You get the top of the list, with the working shown: what had data, what was missing, what passed.",
    },
    {
      icon: "alerts",
      title: "Alerts on facts, not opinions",
      body: "A borrow fee doubling. Short interest crossing 15%. Volume at 3x. A dated catalyst. An S-3 shelf. Impersonal triggers that fire on a print, by email, push or SMS.",
    },
    {
      icon: "calendar",
      title: "Know what's coming, and what happened",
      body: "A calendar of dated events for your names with the score beside each, and the measured move after past events. Nothing predicted; everything measured.",
    },
  ];
  return (
    <section className="ld-benefits" aria-label="What you get">
      {items.map((it) => (
        <div className="ld-benefit" key={it.title}>
          <span className="ld-benefit-icon">
            <Icon name={it.icon} size={22} />
          </span>
          <h3>{it.title}</h3>
          <p>{it.body}</p>
        </div>
      ))}
    </section>
  );
}

function Tour() {
  const screens = [
    {
      title: "Board",
      sub: "Ranked names in the industries you follow, with coverage and the change since the last run.",
      body: (
        <ul className="ld-mock-rows">
          {[["strong", 78, "+14"], ["elevated", 59, "+1"], ["elevated", 57, "0"], ["neutral", 51, "−3"]].map(([b, v, dlt], i) => (
            <li key={i}>
              <span className="ld-mock-rank">{i + 1}</span>
              <span className="ld-mock-sym" />
              <span className={`badge compact ${b}`}>
                <span className="word">{b}</span>
                <span className="num">{v}</span>
              </span>
              <span className="ld-mock-spark" aria-hidden="true">
                <svg viewBox="0 0 60 20" preserveAspectRatio="none">
                  <path d={i % 2 ? "M0,14 L12,10 L24,16 L36,8 L48,11 L60,4" : "M0,6 L12,10 L24,5 L36,12 L48,9 L60,15"} fill="none" stroke="currentColor" strokeWidth="1.6" />
                </svg>
              </span>
              <span className={`ld-mock-delta ${dlt.startsWith("+") ? "pos" : dlt.startsWith("−") ? "neg" : ""}`}>{dlt}</span>
            </li>
          ))}
        </ul>
      ),
    },
    {
      title: "Report",
      sub: "One name, every input: the price with its events marked, the hard filters with the actual figure against each rule, and the score breakdown.",
      body: (
        <div className="ld-mock-report">
          <div className="ld-mock-price">
            <span className="ld-mock-sym wide" />
            <span className="ld-mock-big">$64.90</span>
            <span className="move pos">+3.6%</span>
          </div>
          <svg className="ld-mock-chart" viewBox="0 0 300 80" preserveAspectRatio="none" aria-hidden="true">
            <path d="M0,60 L30,52 L60,58 L90,40 L120,46 L150,30 L180,36 L210,22 L240,28 L270,18 L300,12 L300,80 L0,80 Z" fill="var(--pos)" opacity="0.12" />
            <path d="M0,60 L30,52 L60,58 L90,40 L120,46 L150,30 L180,36 L210,22 L240,28 L270,18 L300,12" fill="none" stroke="var(--pos)" strokeWidth="2" />
          </svg>
          <ul className="ld-mock-filters">
            {[["$300M–$3B market cap", "PASS"], ["Float < 50M shares", "PASS"], ["Short interest > 10%", "PASS"], ["Growth > 40% y/y", "FAIL"]].map(([k, v]) => (
              <li key={k}>
                <span>{k}</span>
                <span className={`verdict ${v === "PASS" ? "pass" : "fail"}`}>{v}</span>
              </li>
            ))}
          </ul>
        </div>
      ),
    },
    {
      title: "Alerts",
      sub: "Impersonal triggers on the names you can see, delivered where you read them, each one a sentence you can verify.",
      body: (
        <ul className="ld-mock-alerts">
          {[["Borrow fee 2x+", "Borrow fee 2.4x its 5-session average"], ["Volume at 3x+", "3.6x the 20-day average by midday"], ["Catalyst dated", "Earnings call dated inside the look-ahead"]].map(([t, d]) => (
            <li key={t}>
              <span className="chip chip-plain">{t}</span>
              <span className="ld-mock-sym" />
              <span className="ld-mock-text">{d}</span>
            </li>
          ))}
        </ul>
      ),
    },
  ];
  return (
    <section className="ld-tour" aria-labelledby="tour-h">
      <h2 id="tour-h">Three screens you'll live in.</h2>
      <p className="ld-sub">Illustrations of the layout. Names appear once you sign in; the figures are examples.</p>
      <div className="ld-tourgrid">
        {screens.map((sc) => (
          <figure className="ld-screen" key={sc.title}>
            <div className="ld-screen-frame">
              <div className="ld-screen-head">{sc.title}</div>
              {sc.body}
            </div>
            <figcaption>
              <b>{sc.title}.</b> {sc.sub}
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

function Plans({ tiers }) {
  if (!tiers) return null;
  const sorted = [...tiers].sort((a, b) => a.price_monthly_cents - b.price_monthly_cents);
  const free = sorted.find((t) => t.price_monthly_cents === 0);
  const pro = sorted.find((t) => t.key === "pro") || sorted[sorted.length - 2];
  if (!free || !pro) return null;
  const line = (t) => [
    t.industries_limit >= 999 ? "All industries" : plural(t.industries_limit, "industry", "industries"),
    `Top ${t.names_shown_limit} per board`,
    plural(t.picks_limit, "pinned name"),
    t.alerts_limit === 0 ? "Weekly digest" : t.alerts_limit == null ? "Unlimited alerts" : plural(t.alerts_limit, "alert"),
  ];
  return (
    <section className="ld-plans" aria-labelledby="plans-h">
      <h2 id="plans-h">Start free. Upgrade when the board earns it.</h2>
      <div className="ld-plangrid">
        <div className="ld-plan">
          <div className="ld-plan-name">{free.label}</div>
          <div className="ld-plan-price">$0</div>
          <ul>
            {line(free).map((l) => (
              <li key={l}>
                <Icon name="check" size={16} /> {l}
              </li>
            ))}
          </ul>
          <Link to="/signup" className="btn btn-secondary btn-block">
            Start free
          </Link>
        </div>
        <div className="ld-plan hi">
          <div className="ld-plan-name">{pro.label}</div>
          <div className="ld-plan-price">
            {dollars(pro.price_monthly_cents)}
            <span>/mo</span>
          </div>
          <ul>
            {line(pro).map((l) => (
              <li key={l}>
                <Icon name="check" size={16} /> {l}
              </li>
            ))}
          </ul>
          <Link to="/pricing" className="btn btn-primary btn-block">
            See all plans
          </Link>
        </div>
      </div>
    </section>
  );
}

export default function Landing() {
  const { me } = useMe();
  const [run, setRun] = useState(null);
  const [industries, setIndustries] = useState(null);
  const [tiers, setTiers] = useState(null);
  useEffect(() => {
    api("/runs/latest").then(setRun).catch(() => setRun(null));
    cached("/industries").then((d) => setIndustries(d.industries)).catch(() => setIndustries([]));
    cached("/entitlements").then((d) => setTiers(d.tiers)).catch(() => setTiers(null));
  }, []);
  const primary = me ? ["/overview", "Open your home"] : ["/signup", "Start free"];
  const record = useMemo(() => TICKER_RECORD.slice(0, 8), []);

  return (
    <div className="ld">
      <section className="ld-hero">
        <div className="ld-hero-copy">
          <p className="eyebrow">Small-cap research, ranked daily</p>
          <h1>Know which names are built to move before their next event.</h1>
          <p className="ld-lede">
            Public filings and market data, run through the same hard filters every day, ranked into a board you can read in a minute.{" "}
            <b>
              {EVIDENCE.hits} of {EVIDENCE.events}
            </b>{" "}
            names that cleared the screen moved 20% or traded 3x volume.
          </p>
          <div className="ld-actions">
            <Link to={primary[0]} className="btn btn-primary btn-lg">
              {primary[1]} <Icon name="arrow" size={18} />
            </Link>
            <Link to="/strategies/fast_mover" className="btn btn-quiet btn-lg">
              See the evidence
            </Link>
          </div>
          <ul className="ld-ticks">
            <li>
              <Icon name="check" size={16} /> Free plan, no card
            </li>
            <li>
              <Icon name="check" size={16} /> Every score shows its working
            </li>
            <li>
              <Icon name="check" size={16} /> Cancel any time
            </li>
          </ul>
        </div>
        <div className="ld-hero-visual">
          <LiveRun run={run} industries={industries} />
        </div>
      </section>

      <Proof />
      <Benefits />
      <Tour />

      <section className="ld-record" aria-labelledby="rec-h">
        <div className="ld-rechead">
          <h2 id="rec-h">Every tested name, on the record.</h2>
          <p className="ld-sub">
            The {EVIDENCE.tickers} names that cleared the screen in the backtest and how many of their events moved. Published as tested; nothing
            cherry-picked.
          </p>
        </div>
        <div className="ld-recgrid">
          {record.map(([t, n, h]) => (
            <div className="ld-rec" key={t}>
              <span className="ld-rec-sym">{t}</span>
              <span className="ld-rec-bar" aria-hidden="true">
                {Array.from({ length: n }, (_, i) => (
                  <i key={i} className={i < h ? "hit" : ""} />
                ))}
              </span>
              <span className="ld-rec-n">
                {h} of {n}
              </span>
            </div>
          ))}
        </div>
      </section>

      <Plans tiers={tiers} />

      <section className="ld-cta">
        <h2>Your first board is a minute away.</h2>
        <p className="ld-sub">Pick an industry, see today's ranked names, pin the ones worth a second look.</p>
        <Link to={primary[0]} className="btn btn-primary btn-lg">
          {primary[1]} <Icon name="arrow" size={18} />
        </Link>
        {run && <p className="ld-age">Latest run {dateTime(run.as_of)}</p>}
      </section>

      <p className="ld-legal">
        Research and information only. Scores are machine output ranked for a human to review; nothing here is a recommendation to buy or sell any
        security. Past movement after a screen is not a forecast of future movement.
      </p>
    </div>
  );
}
