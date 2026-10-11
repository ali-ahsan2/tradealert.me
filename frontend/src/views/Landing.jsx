import React, { useEffect, useRef, useState } from "react";
import "./landing.css";
import { api, cached } from "../api.js";
import { Link } from "../lib/router.jsx";
import { useMe } from "../lib/me.jsx";
import { alertsLabel, dateTime, dollars, industriesLabel, pct, plural, shortDate, tone } from "../lib/fmt.js";
import { EVIDENCE, GROUPS, TICKER_RECORD } from "../lib/evidence.js";
import { CTA, plainTriggerFromLabel, ratePct } from "../lib/plain.js";
import { HOME_ROWS } from "../lib/caps.js";
import { leadPhrase, tallySentence } from "../lib/record.js";
import { prefersReducedMotion, useCountUp, useReveal } from "../lib/motion.js";
import Icon from "../components/Icons.jsx";
import FinePrint from "../components/FinePrint.jsx";
import PulsePanel, { pulseStats, usePulse } from "../components/Pulse.jsx";

// Landing v6 (DESIGN_V6 §1, §2, §3; DESIGN_V5 §2 underneath): the three
// sentences, earned FOMO, visible lead, one action. Every number on this
// page is a recorded count or the backtest as published (read from
// /api/strategies, the static EVIDENCE only as a fallback), and every
// sentence states a fact with its date. The only tickers are the ones the
// published record already names (TICKER_RECORD); the pulse endpoint
// carries none and nothing here infers one. Red and green appear on price
// moves only; the pulse numbers are ink. Three items before "Show all".

// Public screenshots live in public/shots; BASE_URL keeps them resolving in
// the hosted preview, which is served from a relative base.
const SHOT = (name) => `${import.meta.env.BASE_URL}shots/${name}`;

// In-page anchors scroll in place and keep the URL as it is, so they work
// under both the history router and the preview's hash router.
function jump(e, id) {
  const el = document.getElementById(id);
  if (!el) return;
  e.preventDefault();
  el.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  if (typeof el.focus === "function") el.focus({ preventScroll: true });
}

// Whether an element is on screen right now (both directions). It starts
// true so the sticky bar never flashes before the first observation; without
// an IntersectionObserver it settles to false, so the bar simply stays.
function useOnScreen(ref) {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setOn(false);
      return undefined;
    }
    const io = new IntersectionObserver(([entry]) => setOn(Boolean(entry && entry.isIntersecting)), { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return on;
}

function primaryAction(me) {
  return me ? { to: "/home", label: CTA.OPEN_HOME } : { to: "/signup", label: CTA.START_FREE };
}

// The three sentences (DESIGN_V6 §1), restated in one line where a section
// closes on them.
const THREE = "It watches my industries. It tells me before the move is over. Measured, not predicted.";

/* 1. Hero ------------------------------------------------------------- */

function Hero({ me, pulse, run, industries, loading, ctaRef }) {
  const [panelRef, seen] = useReveal();
  const stats = pulseStats(pulse, run, industries);
  const showPanel = loading || stats.length > 0;
  const primary = primaryAction(me);
  return (
    <section className="ld-hero ld-dark" aria-labelledby="ld-h1">
      <div className={`ld-wrap ld-hero-grid ${showPanel ? "" : "solo"}`}>
        <div className="ld-hero-copy">
          <p className="ld-eyebrow">tradealert dot me: alerts, sent to me.</p>
          <h1 id="ld-h1">
            <span>It watches my industries.</span> <span>It tells me before the move is over.</span>
          </h1>
          <p className="ld-lede">
            <b className="ld-measured">Measured, not predicted.</b> Pick your industries. Every morning it rates every name in them and tells you the day a
            fact changes.
          </p>
          <div className="ld-actions" ref={ctaRef}>
            <Link to={primary.to} className="btn btn-primary btn-lg">
              {primary.label} <Icon name="arrow" size={18} />
            </Link>
            <a href="#record" className="btn btn-ghost btn-lg" onClick={(e) => jump(e, "record")}>
              {CTA.RECORD}
            </a>
          </div>
          <p className="ld-fine">Free plan, no card.</p>
          <FinePrint short links={false} className="ld-fine ld-fineprint" />
        </div>
        {showPanel && (
          <div ref={panelRef} className={`ld-hero-panel reveal ${seen ? "in" : ""}`}>
            <PulsePanel pulse={pulse} stats={stats} loading={loading} active={seen} onJump={jump} />
          </div>
        )}
      </div>
    </section>
  );
}

/* 2. What you'd have been told ---------------------------------------- */

const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six"];

// The section mounts only once the pulse is in, so useReveal observes a real
// element on its first run (the hook attaches on mount, not on data).
function Told({ pulse }) {
  return pulse ? <ToldBody pulse={pulse} /> : null;
}

function ToldBody({ pulse }) {
  const [ref, seen] = useReveal();
  const [all, setAll] = useState(false);
  const days = pulse.days || 30;
  const examples = (pulse.examples || []).filter((e) => e && e.max_5d != null);
  const shown = all ? examples : examples.slice(0, HOME_ROWS);
  const firedIn = (pulse.industries || []).filter((i) => i && i.fired > 0);
  const byIndustry = firedIn.slice(0, HOME_ROWS);
  const moreInd = firedIn.length - byIndustry.length;
  return (
    <section ref={ref} id="told" className={`ld-sec reveal ${seen ? "in" : ""}`} aria-labelledby="told-h">
      <div className="ld-wrap">
        <div className="ld-sec-head">
          <p className="ld-kicker">The last {days} days</p>
          <h2 id="told-h">What you'd have been told.</h2>
          <p className="ld-sub">An alert fired on a name in each industry. Here is what the price did in the five sessions after.</p>
        </div>

        {examples.length > 0 ? (
          <div className="ld-told">
            {shown.map((e, i) => {
              const lead = leadPhrase(e);
              return (
                <div className="rec-row ld-stagger" style={{ "--i": i }} key={`${e.industry_key || e.industry_label}-${e.trigger}-${e.date}-${i}`}>
                  <div className="rec-main">
                    <div className="rec-top">
                      <b className="ld-told-ind">{e.industry_label}</b>
                      <span className="ld-told-trig">{plainTriggerFromLabel(e.trigger)}</span>
                      <span className="when">{shortDate(e.date, "UTC")}</span>
                    </div>
                    {e.chg_5d != null && (
                      <p className="rec-say">
                        Closed the five-session window <span className={`move ${tone(e.chg_5d) || "flat"}`}>{pct(e.chg_5d)}</span>.
                      </p>
                    )}
                  </div>
                  <div className="rec-act ld-told-act">
                    <span className={`rec-num move ${tone(e.max_5d) || "flat"}`}>
                      {pct(e.max_5d)}
                      <small>at the high</small>
                    </span>
                    {lead && <span className={`lead-chip ${e.pending ? "open" : ""}`}>{lead}</span>}
                  </div>
                </div>
              );
            })}
            {examples.length > shown.length && (
              <button type="button" className="btn btn-ghost ld-more" onClick={() => setAll(true)}>
                {CTA.SHOW_ALL(examples.length)}
              </button>
            )}
          </div>
        ) : (
          <p className="ld-empty">
            No measured alert in the last {days} days moved 10% or more within five sessions. The counts above are the whole story so far.
          </p>
        )}

        {byIndustry.length > 0 && (
          <ul className="ld-inds" aria-label="Where alerts fired, by industry">
            {byIndustry.map((i) => (
              <li key={i.key || i.label}>
                <b>{i.label}</b> {plural(i.fired, "alert")}
                {i.measured > 0 ? ` · ${i.moved_10} moved 10%+` : ""}
              </li>
            ))}
            {moreInd > 0 && <li className="ld-inds-more">and {plural(moreInd, "more industry", "more industries")}</li>}
          </ul>
        )}

        <p className="ld-caption" id="method" tabIndex={-1}>
          {examples.length > 0 && `${WORDS[Math.min(examples.length, 6)]} of the measured alerts from the last ${days} days. Names are shown to subscribers. `}
          {pulse.method}
        </p>
      </div>
    </section>
  );
}

/* 3. How it works ----------------------------------------------------- */

const STEPS = [
  {
    n: "01",
    title: "Home, every morning",
    body: "Pick the industries you follow. Each morning it rates every name in them and Home opens with what changed, which alerts are waiting and which dates fall in the next two weeks.",
    detail: "Since yesterday: 46 of your 152 names changed rating, 3 alerts are waiting, 21 dated events in two weeks.",
    cite: "The opening line of Home, as it read on the morning shown.",
    shot: "home-desk.jpg",
    alt: "The Home screen on a desktop: one sentence summing up what changed since yesterday, three cards, and a What changed list in which each name shows its rating word, its score marked with a tilde, a Watch button and an Alert me button.",
    phone: "home-phone.jpg",
    phoneAlt: "The same Home on a phone, with the What changed list and bottom tabs for Home, Alerts, Watchlist and Explore.",
  },
  {
    n: "02",
    title: "Every number explained",
    body: "Open a name and the score is a sentence, not a verdict: where it sits on the scale, how much data it had, and what the missing data did to the number.",
    detail: "3 of 10 inputs had data, so read the number as rough. Missing data pulled it toward neutral, from 70 to 54.",
    cite: "How a report states how much data it had, as it read on the screen shown.",
    shot: "stock-desk.jpg",
    alt: "A name's report on a desktop: the price with its day and 30-day moves, a sentence stating the score against the strategy's typical range, two lines on how much data it had, an Elevated badge reading tilde 54, and a panel listing the data on file and the measured record.",
    phone: "stock-phone.jpg",
    phoneAlt: "The same kind of report on a phone: a Strong badge reading tilde 78 under the sentence that explains it, with Alerting me and Watching buttons.",
  },
  {
    n: "03",
    title: "Alerts on facts",
    body: "Watch a name and it messages you the day a fact changes: short interest crossing a line, the cost to borrow doubling, a date set, insiders buying. Each alert names the fact that fired it and how it reached you.",
    detail: "94 more fired across your industries on names you were not watching.",
    cite: "The Alerts screen counts what you were told and what you were not, as it read on the screen shown.",
    shot: "alerts-desk.jpg",
    alt: "The Alerts screen on a desktop: a line counting the alerts sent in the last year and how many more fired on names not watched, tabs for Told me, Alerting me and My record, and three alert cards that each state the fact that fired them, how long ago, and that they were sent by email.",
  },
];

function HowItWorks() {
  const [ref, seen] = useReveal();
  return (
    <section ref={ref} id="how" className={`ld-sec reveal ${seen ? "in" : ""}`} aria-labelledby="how-h">
      <div className="ld-wrap">
        <div className="ld-sec-head">
          <p className="ld-kicker">How it works</p>
          <h2 id="how-h">Three screens, every morning.</h2>
          <p className="ld-sub">Real screens from the product. The figures are from the morning each one was taken.</p>
        </div>
        <ol className="ld-steps">
          {STEPS.map((s) => (
            <li className="ld-step" key={s.n}>
              <div className="ld-step-copy">
                <span className="ld-step-n" aria-hidden="true">
                  {s.n}
                </span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
                <blockquote className="ld-detail">
                  <p>“{s.detail}”</p>
                  <cite>{s.cite}</cite>
                </blockquote>
              </div>
              <figure className="ld-shot">
                <img className="ld-shot-desk" src={SHOT(s.shot)} width="1280" height="800" loading="lazy" decoding="async" alt={s.alt} />
                {s.phone && <img className="ld-shot-phone" src={SHOT(s.phone)} width="390" height="844" loading="lazy" decoding="async" alt={s.phoneAlt} />}
              </figure>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* 4. The record ------------------------------------------------------- */

function GroupBar({ g, seen }) {
  const v = useCountUp(g.pct, { active: seen, duration: 1000, decimals: 1 });
  return (
    <div className={`ld-group ${g.key === "filtered" ? "hi" : ""}`}>
      <div className="ld-group-lab">
        <b>{g.label}</b>
        <span>{g.sub}</span>
      </div>
      <div className="ld-group-pct">
        <span aria-hidden="true">{Number(v).toFixed(1)}%</span>
        <span className="sr-only">{g.pct}%</span>
      </div>
      <div className="ld-bar" aria-hidden="true">
        <i style={{ width: seen ? `${g.pct}%` : 0 }} />
      </div>
      <div className="ld-group-n">
        {g.hits} of {g.n} moved
      </div>
    </div>
  );
}

// The published record, read from /api/strategies (plain.record_numbers on
// Fast Mover); the static EVIDENCE figures only until it answers or if it
// cannot. The per-name list is the backtest as published.
function Record({ record }) {
  const [ref, seen] = useReveal();
  const hits = record && record.hits != null ? record.hits : EVIDENCE.hits;
  const events = record && record.n != null ? record.n : EVIDENCE.events;
  const pctHit = events ? ratePct(hits, events) : EVIDENCE.hitRate;
  const groups = GROUPS.map((g) => (g.key === "filtered" ? { ...g, label: "Events that passed every must-pass rule", hits, n: events, pct: pctHit } : g));
  return (
    <section ref={ref} id="record" tabIndex={-1} className={`ld-sec reveal ${seen ? "in" : ""}`} aria-labelledby="rec-h">
      <div className="ld-wrap">
        <div className="ld-sec-head">
          <p className="ld-kicker">The backtest</p>
          <h2 id="rec-h">The record, as published.</h2>
          <p className="ld-sub">
            On real data, {hits} of {events} events that passed Fast Mover's must-pass rules went on to move inside the window. A move is{" "}
            {EVIDENCE.hitDefinition}, measured over {EVIDENCE.window}.
          </p>
        </div>

        <div className="ld-groups">
          {groups.map((g) => (
            <GroupBar g={g} seen={seen} key={g.key} />
          ))}
        </div>

        <details className="ld-recdetails">
          <summary>
            <h3>Every tested name, on the record.</h3>
            <span className="ld-sub">The {EVIDENCE.tickers} names that passed every rule and how many of their events moved. Published as tested.</span>
          </summary>
          <div className="ld-recgrid">
            {TICKER_RECORD.map(([t, n, h]) => (
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
        </details>

        <ol className="ld-caveats" aria-label="Three caveats">
          <li>
            <b>Small sample.</b> {events} events across {EVIDENCE.tickers} names, about two years of market conditions. Enough to publish, not enough to
            lean on.
          </li>
          <li>
            <b>Movement, not direction or profit.</b> A hit is a 20% move either way, or volume at 3x. The test says nothing about what a position would
            have returned.
          </li>
          <li>
            <b>One strategy with a measured record.</b> Fast Mover is the only one. Every other strategy has no measured record yet and says so on every
            screen.
          </li>
        </ol>
        <p className="ld-foot">
          Method, the event list and what the test does not prove: <Link to="/strategies/fast_mover">the evidence page</Link>.
        </p>
      </div>
    </section>
  );
}

/* 5. Who it is for ---------------------------------------------------- */

const WHO = [
  {
    title: "You already follow an industry.",
    body: "You know the names. What you lack is the morning: which of them changed, which filed, which has a date coming. Home is that morning, every day, in plain words.",
  },
  {
    title: "You want to be told, not to watch.",
    body: "Watch the names, choose the facts you care about, and get on with your day. When the cost to borrow doubles or short interest crosses a line, the message arrives the same day.",
  },
  {
    title: "You want the working shown.",
    body: "Every score says how much data it had and what the missing data did to it. Every alert names its fact. Every figure carries a source and a date you can check.",
  },
];

function WhoFor() {
  const [ref, seen] = useReveal();
  return (
    <section ref={ref} id="who" className={`ld-sec reveal ${seen ? "in" : ""}`} aria-labelledby="who-h">
      <div className="ld-wrap">
        <div className="ld-sec-head">
          <p className="ld-kicker">Who it is for</p>
          <h2 id="who-h">Three kinds of morning.</h2>
        </div>
        <div className="ld-who">
          {WHO.map((w) => (
            <article className="ld-who-card" key={w.title}>
              <h3>{w.title}</h3>
              <p>{w.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* 6. Plans ------------------------------------------------------------ */

const CHANNEL_LABEL = { email: "email", push: "web push", sms: "SMS", webhook: "signed webhook" };

function listWords(items) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

// "unlimited alerts · 5 industries · 20 names watched": the plan's facts, alerts first.
function factsLine(t) {
  return [alertsLabel(t.alerts_limit), industriesLabel(t.industries_limit), `${plural(t.picks_limit, "name")} watched`].join(" · ");
}

// One sentence per plan saying what you would be told, built from the plan's
// own limits. Utility first; the price is a number beside it.
function toldText(t) {
  const ind = t.industries_limit >= 999 ? "every industry" : plural(t.industries_limit, "industry", "industries");
  const names = `the top ${t.names_shown_limit} names explained`;
  const chans = (t.channels || []).map((c) => CHANNEL_LABEL[c] || c);
  const by = chans.length ? ` by ${listWords(chans)}` : "";
  if (t.alerts_limit === 0) return `Each morning you'd be told what changed across ${ind}, with ${names}. No alerts, so you check in yourself.`;
  const pins = t.picks_limit >= 999 ? "any name you watch" : plural(t.picks_limit, "watched name");
  return `Each morning you'd be told what changed across ${ind}, with ${names}. Alerts on ${alertsLabel(t.alerts_limit).replace(/ alerts?$/, "")} facts across ${pins} and you're messaged${by} the day a fact changes.`;
}

// Same shape as Told: wait for /entitlements (loaded or failed), then mount.
function Plans({ tiers, me }) {
  return tiers === undefined ? null : <PlansBody tiers={tiers} me={me} />;
}

function PlansBody({ tiers, me }) {
  const [ref, seen] = useReveal();
  const sorted = tiers ? [...tiers].sort((a, b) => a.price_monthly_cents - b.price_monthly_cents) : [];
  return (
    <section ref={ref} id="plans" className={`ld-sec reveal ${seen ? "in" : ""}`} aria-labelledby="plans-h">
      <div className="ld-wrap">
        <div className="ld-sec-head">
          <p className="ld-kicker">Plans</p>
          <h2 id="plans-h">Start free. Pay for coverage and delivery, not for different numbers.</h2>
          <p className="ld-sub">
            Every plan sees the same scores and the same reports. Plans differ only in how many industries you follow, how many names are watched for you,
            and how alerts reach you. A subscription buys coverage and delivery, not advice.
          </p>
        </div>
        {sorted.length > 0 ? (
          <div className="ld-plangrid">
            {sorted.map((t) => {
              const free = t.price_monthly_cents === 0;
              const to = me ? "/pricing" : free ? "/signup" : `/signup?next=${encodeURIComponent("/pricing")}`;
              const label = me ? CTA.SHOW_PLANS : free ? CTA.START_FREE : CTA.START_ON(t.label);
              // the viewer's own plan is the only one marked (DESIGN_V6 §1: no
              // "popular" without data)
              const mine = Boolean(me && me.tier && me.tier.key === t.key);
              return (
                <article className={`ld-plan ${mine ? "mine" : ""}`} key={t.key} aria-label={`${t.label} plan${mine ? ", your plan" : ""}`} aria-current={mine ? "true" : undefined}>
                  <div className="ld-plan-top">
                    <span className="ld-plan-name">{t.label}</span>
                    <span className="ld-plan-price">
                      {free ? "$0" : dollars(t.price_monthly_cents)}
                      {!free && <small>/mo</small>}
                    </span>
                  </div>
                  <p className="ld-plan-facts">{factsLine(t)}</p>
                  <p className="ld-plan-told">{toldText(t)}</p>
                  <ul className="ld-plan-list">
                    <li>Top {t.names_shown_limit} names per industry each morning</li>
                    <li>{(t.channels || []).length ? `Delivery by ${listWords((t.channels || []).map((c) => CHANNEL_LABEL[c] || c))}` : "Weekly digest by email"}</li>
                  </ul>
                  <Link to={to} className={`btn ${free && !me ? "btn-primary" : "btn-secondary"} btn-block`}>
                    {mine ? CTA.MY_PLAN : label}
                  </Link>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="ld-empty">
            Plans start free. <Link to="/pricing">{CTA.SHOW_PLANS}</Link>.
          </p>
        )}
      </div>
    </section>
  );
}

/* 7. FAQ -------------------------------------------------------------- */

const FAQ = [
  [
    "Is this advice?",
    "No. Everything here is a recorded fact with its source and its date: what a score was, what fired, what the price did after. Nothing on this site is a recommendation to buy or sell anything.",
  ],
  [
    "What is an alert?",
    "A message we send when a specific fact changes on a name you asked us to watch: the cost to borrow doubling, short interest crossing 10, 15 or 20% of the float, volume at three times normal, a date set, a filing to sell more shares, insiders buying. Each alert names the fact that fired it and how it reached you.",
  ],
  [
    "Why does a score have a ~?",
    "Thin data. Fewer than half of a strategy's inputs had data that morning, so the score is rough and the report says so: how many inputs had data, and how far the missing ones pulled the number toward neutral.",
  ],
  [
    "Can I cancel?",
    "Yes, any time, from My account. Access runs to the end of the period you have paid for, then the account returns to Free with your watched names and settings intact.",
  ],
];

function Faq() {
  const [ref, seen] = useReveal();
  return (
    <section ref={ref} id="faq" className={`ld-sec reveal ${seen ? "in" : ""}`} aria-labelledby="faq-h">
      <div className="ld-wrap">
        <div className="ld-sec-head">
          <p className="ld-kicker">Questions</p>
          <h2 id="faq-h">Four things people ask first.</h2>
        </div>
        <div className="faq ld-faq">
          {FAQ.map(([q, a]) => (
            <details key={q}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/* 8. Final call and the sticky bar ----------------------------------- */

function Final({ me, pulse, run, innerRef }) {
  const [ref, seen] = useReveal();
  const primary = primaryAction(me);
  const tally = pulse && pulse.alerts && pulse.alerts.fired > 0 ? tallySentence(pulse.alerts) : null;
  return (
    <section ref={ref} className={`ld-final ld-dark reveal ${seen ? "in" : ""}`} aria-labelledby="final-h">
      <div className="ld-wrap ld-final-inner" ref={innerRef}>
        <h2 id="final-h">{THREE}</h2>
        <p className="ld-final-sub">Pick an industry, read today's Home, and tell it which names to watch for you.</p>
        {tally && (
          <p className="ld-final-fact">
            Last {pulse.days || 30} days, every industry: {tally}
          </p>
        )}
        <Link to={primary.to} className="btn btn-primary btn-lg">
          {primary.label} <Icon name="arrow" size={18} />
        </Link>
        {run && run.as_of && <p className="ld-age">Last rated {dateTime(run.as_of)}</p>}
      </div>
    </section>
  );
}

function StickyCta({ hide }) {
  return (
    <div className={`ld-stick ${hide ? "hide" : ""}`} aria-hidden={hide ? "true" : undefined}>
      <span className="ld-stick-text">
        <b>Free plan</b>, no card
      </span>
      <Link to="/signup" className="btn btn-primary" tabIndex={hide ? -1 : undefined}>
        {CTA.START_FREE}
      </Link>
    </div>
  );
}

/* The page ------------------------------------------------------------ */

export default function Landing() {
  const { me, loading: meLoading } = useMe();
  const { pulse, loading: pulseLoading } = usePulse(30);
  // undefined = pending, null = failed, value = loaded
  const [run, setRun] = useState(undefined);
  const [industries, setIndustries] = useState(undefined);
  const [tiers, setTiers] = useState(undefined);
  // the published record as the API carries it; EVIDENCE is the fallback
  const [record, setRecord] = useState(null);
  useEffect(() => {
    let alive = true;
    api("/runs/latest")
      .then((d) => alive && setRun(d || null))
      .catch(() => alive && setRun(null));
    cached("/strategies")
      .then((d) => {
        if (!alive) return;
        const fm = ((d && d.strategies) || []).find((x) => x.key === "fast_mover");
        if (fm && fm.plain && fm.plain.record_numbers) setRecord(fm.plain.record_numbers);
      })
      .catch(() => {});
    cached("/industries")
      .then((d) => alive && setIndustries((d && d.industries) || []))
      .catch(() => alive && setIndustries(null));
    cached("/entitlements")
      .then((d) => alive && setTiers((d && d.tiers) || null))
      .catch(() => alive && setTiers(null));
    return () => {
      alive = false;
    };
  }, []);
  const loading = pulseLoading || (!pulse && (run === undefined || industries === undefined));

  const ctaRef = useRef(null);
  const finalRef = useRef(null);
  const heroCtaOnScreen = useOnScreen(ctaRef);
  const finalOnScreen = useOnScreen(finalRef);

  return (
    <div className="ld">
      <Hero me={me} pulse={pulse} run={run} industries={industries} loading={loading} ctaRef={ctaRef} />
      <Told pulse={pulse} />
      <HowItWorks />
      <Record record={record} />
      <WhoFor />
      <Plans tiers={tiers} me={me} />
      <Faq />
      <Final me={me} pulse={pulse} run={run} innerRef={finalRef} />
      <FinePrint className="ld-legal" />
      {!me && !meLoading && <StickyCta hide={heroCtaOnScreen || finalOnScreen} />}
    </div>
  );
}
