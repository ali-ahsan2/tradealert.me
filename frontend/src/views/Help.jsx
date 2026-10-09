import React, { useEffect, useMemo, useState } from "react";
import { Link } from "../lib/router.jsx";
import { useMe } from "../lib/me.jsx";
import { DEFAULT_TRIGGERS, GLOSSARY, TRIGGER_PLAIN } from "../lib/glossary.js";
import { MODES, useMode } from "../lib/mode.js";
import { EVIDENCE } from "../lib/evidence.js";
import { alertsLabel, industriesLabel, plural } from "../lib/fmt.js";
import { KeyValue, Steps } from "../components/ui.jsx";
import { restartTour } from "../components/Tour.jsx";
import "./help.css";

// /help: how the product works in five steps, whether any of it is advice
// (no), and the glossary as cards, one per term, each addressable as
// /help#<key> so an Explain popover anywhere in the app can deep-link here.
// Every definition comes from lib/glossary.js; the only performance figures
// are the EVIDENCE values, quoted as stored.

// Every GLOSSARY key belongs to one group; anything unassigned falls into
// "Other terms", which should stay empty.
const GROUPS = [
  {
    id: "scores",
    title: "Scores and bands",
    keys: [
      "score", "band", "strong", "elevated", "neutral", "weak", "excluded", "coverage", "tilde",
      "shrinkage", "hard_filter", "haircut", "delta_run", "run", "strategy", "fast_mover",
      "calibrated", "provisional", "signal", "candidate", "lane", "lane_early", "lane_event", "group",
    ],
  },
  {
    id: "inputs",
    title: "Inputs",
    keys: [
      "catalyst", "short_interest", "borrow_fee", "float", "days_to_cover", "volume_x",
      "market_cap", "run3m", "off_high", "assumed", "judgment",
    ],
  },
  { id: "screens", title: "Reading the screens", keys: ["age", "benchmark", "rebased"] },
  { id: "alerts", title: "Alerts and watching", keys: ["alert", "trigger", "pin", "digest", "rate"] },
  { id: "plans", title: "Plans and limits", keys: ["industry", "universe", "names_shown"] },
];

const HOW = [
  <>
    <b>We watch your industries each morning.</b> One run scores every stock in the industries you follow, and every figure on
    screen is stamped with the run it came from.
  </>,
  <>
    <b>We score every name on each strategy.</b> A score is a 0 to 100 fit to the strategy's setup on that run, grouped into a band word
    you can read at a glance.
  </>,
  <>
    <b>We explain the number in plain words.</b> Each name opens with what its score is, which inputs drove it and which inputs had no
    data.
  </>,
  <>
    <b>We alert you on facts that printed.</b> A borrow fee that doubled, volume at three times normal, a dated catalyst inside the window:
    every alert names the fact that fired it.
  </>,
  <>
    <b>You decide.</b> Nothing here is a recommendation; the product ranks names for a human to review.
  </>,
];

// The term is whatever follows the last "#": "#coverage" in production and
// "#/help#coverage" under the hosted preview's hash router.
function currentHash() {
  const raw = window.location.hash || "";
  const h = raw.slice(raw.lastIndexOf("#") + 1);
  try {
    return decodeURIComponent(h);
  } catch {
    return h;
  }
}

function limitWord(n, all = "all") {
  return n == null ? null : n >= 999 ? all : String(n);
}

function TermCard({ k, active }) {
  const g = GLOSSARY[k];
  if (!g) return null;
  const see = (g.see || []).filter((s) => GLOSSARY[s]);
  return (
    <article className={`help-term ${active ? "is-target" : ""}`} id={k}>
      <h3>{g.term}</h3>
      <p>{g.short}</p>
      {g.long && g.long !== g.short && <p>{g.long}</p>}
      {see.length > 0 && (
        <p className="help-see">
          See also{" "}
          {see.map((s, i) => (
            <React.Fragment key={s}>
              {i > 0 ? ", " : ""}
              <a href={`#${s}`}>{GLOSSARY[s].term}</a>
            </React.Fragment>
          ))}
        </p>
      )}
    </article>
  );
}

function ModeCard() {
  const { mode, setMode } = useMode();
  const label = (MODES.find(([k]) => k === mode) || MODES[0])[1];
  return (
    <article className="help-term" id="mode">
      <h3>Simple and Full mode</h3>
      <p>
        Simple shows plain labels, the columns a newcomer needs and explanations inline. Full shows every column and control. Nothing is
        removed in either; the choice is saved in this browser.
      </p>
      <div className="seg modeseg" role="group" aria-label="Mode">
        {MODES.map(([k, l]) => (
          <button key={k} type="button" aria-pressed={mode === k} onClick={() => setMode(k)}>
            {l}
          </button>
        ))}
      </div>
      <p className="mode-note">You are in {label} mode.</p>
    </article>
  );
}

function TriggersCard() {
  const defaults = DEFAULT_TRIGGERS.map((k) => (TRIGGER_PLAIN[k] ? TRIGGER_PLAIN[k][0].toLowerCase() : k));
  return (
    <article className="help-term" id="triggers">
      <h3>The triggers, in plain words</h3>
      <p>Notify me turns on three with one tap: {defaults.join(", ")}. The rest can be added on a name's alerts page.</p>
      <ul>
        {Object.entries(TRIGGER_PLAIN).map(([k, [label, when]]) => (
          <li key={k}>
            <b>{label}</b>: we tell you when {when}.
          </li>
        ))}
      </ul>
    </article>
  );
}

function EvidenceCard() {
  return (
    <article className="help-term" id="evidence">
      <h3>The evidence</h3>
      <p>
        Fast Mover is the one calibrated strategy. On {EVIDENCE.events} events across {EVIDENCE.tickers} names, the names that cleared every
        hard filter moved {EVIDENCE.hitRate}% of the time ({EVIDENCE.hits} of {EVIDENCE.events}), against {EVIDENCE.earningsRate}% for
        earnings events generally and {EVIDENCE.randomRate}% on a random day. A move is {EVIDENCE.hitDefinition}, measured from{" "}
        {EVIDENCE.window}.
      </p>
      <ul>
        <li>It measures whether a large move happened, not its direction.</li>
        <li>No trades are simulated and no return is claimed.</li>
        <li>{EVIDENCE.events} events is a small sample across a limited set of regimes.</li>
      </ul>
      <p className="help-see">
        <Link to="/strategies">The full record, strategy by strategy</Link>
      </p>
    </article>
  );
}

function PlanCard({ me }) {
  const t = me && me.tier;
  if (!t) {
    return (
      <article className="help-term" id="your-plan">
        <h3>Your plan</h3>
        <p>Sign in to see what your plan watches for you: how many industries, how many names per list, how many pins and alerts.</p>
      </article>
    );
  }
  return (
    <article className="help-term" id="your-plan">
      <h3>Your plan: {t.label}</h3>
      <p>What this plan watches and tells you. Counts above a limit are totals, not more tickers.</p>
      <KeyValue
        items={[
          ["Industries followed", industriesLabel(t.industries_limit)],
          ["Names shown per list", limitWord(t.names_shown_limit)],
          ["Pinned names", limitWord(t.picks_limit, "unlimited")],
          ["Alerts", t.alerts_limit == null ? "unlimited" : alertsLabel(t.alerts_limit)],
        ]}
      />
      <p className="help-see">
        <Link to="/pricing">What each plan tells you</Link>
      </p>
    </article>
  );
}

export default function Help() {
  const { me } = useMe();
  const [active, setActive] = useState(currentHash);

  // The glossary is static, so a deep link can scroll the moment we mount.
  // Our router pushes state without a hash scroll, and :target does not
  // follow pushState everywhere, so the highlight is kept in state too.
  useEffect(() => {
    const go = () => {
      const h = currentHash();
      setActive(h);
      if (!h) return;
      const el = document.getElementById(h);
      if (el) el.scrollIntoView({ block: "start" });
    };
    go();
    window.addEventListener("hashchange", go);
    window.addEventListener("popstate", go);
    return () => {
      window.removeEventListener("hashchange", go);
      window.removeEventListener("popstate", go);
    };
  }, []);

  const groups = useMemo(() => {
    const assigned = new Set(GROUPS.flatMap((g) => g.keys));
    const rest = Object.keys(GLOSSARY).filter((k) => !assigned.has(k));
    const out = GROUPS.map((g) => ({ ...g, keys: g.keys.filter((k) => GLOSSARY[k]) }));
    if (rest.length) out.push({ id: "more", title: "Other terms", keys: rest });
    return out;
  }, []);

  const following = me && me.industries_following_count != null ? me.industries_following_count : null;

  return (
    <div className="wrap help">
      <div className="pagehead">
        <div>
          <h1>How tradealert works</h1>
        </div>
      </div>
      <p className="utility">
        {me && me.tier && following != null ? (
          <>
            You follow <b>{plural(following, "industry", "industries")}</b> on the <b>{me.tier.label}</b> plan.{" "}
          </>
        ) : null}
        This page says what every word on your screens means, what we watch for you, and what we never claim.
      </p>

      <nav className="help-toc" aria-label="Sections">
        <a href="#how">How it works</a>
        <a href="#advice">Is this advice?</a>
        {groups.map((g) => (
          <a key={g.id} href={`#${g.id}`}>
            {g.title}
          </a>
        ))}
        <a href="#mode">Simple and Full</a>
      </nav>

      <h2 id="how">How it works</h2>
      <div className="help-how">
        <Steps items={HOW} />
      </div>
      <div className="help-actions">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => restartTour()}>
          Replay the welcome tour
        </button>
        <Link to="/strategies" className="btn btn-secondary btn-sm">
          Strategies and evidence
        </Link>
      </div>

      <h2 id="advice">Is this advice?</h2>
      <p className="help-lead">
        No. Everything on a screen is a recorded fact, stated with its source and date: a score from a named run, a short-interest
        figure from a FINRA print, a catalyst from a filing or a company calendar. The product ranks and explains; it does not
        recommend a trade and it makes no prediction about price. When a number is approximate it carries a ~, and when a strategy has
        not yet been measured against outcomes its output is called a candidate, not a signal.
      </p>

      {groups.map((g) => (
        <section key={g.id} aria-labelledby={`h-${g.id}`}>
          <h2 id={g.id}>
            <span id={`h-${g.id}`}>{g.title}</span>
          </h2>
          <div className="help-grid">
            {g.keys.map((k) => (
              <TermCard key={k} k={k} active={active === k} />
            ))}
            {g.id === "scores" && <EvidenceCard />}
            {g.id === "alerts" && <TriggersCard />}
            {g.id === "plans" && <PlanCard me={me} />}
            {g.id === "screens" && <ModeCard />}
          </div>
        </section>
      ))}

      <p className="footnote">
        Research and information only. Scores are machine output ranked for a human to review; every figure carries its source date.
      </p>
    </div>
  );
}
