import React, { useEffect, useMemo, useRef, useState } from "react";
import { api, cached, toast } from "../api.js";
import { Link, navigate, safeNext, useQuery } from "../lib/router.jsx";
import { useMe } from "../lib/me.jsx";
import { alertsLabel, industriesLabel, plural, tzGuess } from "../lib/fmt.js";
import { useMode } from "../lib/mode.js";
import { DEFAULT_TRIGGERS, TRIGGER_PLAIN } from "../lib/glossary.js";
import { CTA, firesSentence, list, verdict } from "../lib/plain.js";
import { fetchPulse, tallySentence } from "../lib/record.js";
import { openUpgrade } from "../lib/upgrade.js";
import Explain from "../components/Explain.jsx";
import NotifyButton from "../components/NotifyButton.jsx";
import ScoreBadge from "../components/ScoreBadge.jsx";
import Pin from "../components/Pin.jsx";
import FinePrint from "../components/FinePrint.jsx";
import { Empty, ErrorCard, Notice, Skeleton } from "../components/ui.jsx";
import "./help.css";

// First run (DESIGN_V6 §3, step 4), two screens in the bare layout, one
// action each: pick what I should watch, then tell me when something
// happens. Everything shown is live: the industries and their plain words
// come from the API, each industry's month from the public pulse (counts
// only, no tickers), the names from the board for the industry just chosen,
// clamped by the plan exactly as Explore is. An industry card is its label,
// one line of what is in it and the measured month (DESIGN_V6 §3, §7); the
// benchmark and the rating counts sit behind More detail. Timezone and channels live in Account. A plan limit
// opens the upgrade sheet in place. Every exit goes through finish(): `next`
// if the visitor arrived with one, else Home with the welcome flag.

const STEPS = ["Pick what I should watch", "Tell me when something happens"];
// A newcomer watches one name from a handful, not a whole board. The plan's
// names_shown_limit still clamps below this on the server.
const TOP = 5;

function Progress({ step }) {
  return (
    <div className="steps ob-steps" aria-label={`Step ${step} of ${STEPS.length}: ${STEPS[step - 1]}`}>
      <span className="bar" aria-hidden="true">
        {STEPS.map((_, i) => (
          <span key={i} className={step >= i + 1 ? "on" : ""} />
        ))}
      </span>
      <span>
        Step {step} of {STEPS.length}
      </span>
    </div>
  );
}

// The footer sticks to the bottom of the viewport, so without room after it
// the last cards of a step can never scroll clear of it. It reports its
// height and the step pads its end by the same amount.
function StickyFoot({ children, onHeight }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !onHeight) return undefined;
    const report = () => onHeight(Math.ceil(el.getBoundingClientRect().height));
    report();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [onHeight]);
  return (
    <div className="sticky-foot" ref={ref}>
      {children}
    </div>
  );
}

function Bell() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M8 1.8a3.9 3.9 0 0 0-3.9 3.9v2.6L2.8 10.6h10.4l-1.3-2.3V5.7A3.9 3.9 0 0 0 8 1.8zM6.4 12.2a1.6 1.6 0 0 0 3.2 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// POST /api/me/verify/resend (DESIGN_V6 §10, rate-limited). Until the
// endpoint ships a 404 is answered in words, never as a crash.
function ResendVerify() {
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      await api("/me/verify/resend", { method: "POST", json: {} });
      toast("Sent. Check your inbox for the new link.");
    } catch (e) {
      toast(e.status === 404 || e.status === 405 ? "Resending isn't available yet. The first email still works for a day." : e.detail || "Couldn't resend. Try again in a minute.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" className="btn btn-secondary btn-sm resend-btn" disabled={busy} onClick={send}>
      {busy ? "Sending…" : "Resend the email"}
    </button>
  );
}

// One obvious tap on a name: pin it, then arm the three default triggers.
// The pin is one POST; the arming is NotifyButton's own flow (the shared
// rule cache and the verify / plan / quota cards every other screen shows),
// started by tapping the button it renders once the name is pinned. A name
// already watched shows the pair as state: the labelled Pin and the Notify
// button, exactly as Explore does.
function WatchForMe({ symbol, pinned, onPin }) {
  const [busy, setBusy] = useState(false);
  const [armNext, setArmNext] = useState(false);
  const notifyRef = useRef(null);
  const plainList = DEFAULT_TRIGGERS.map((k) => (TRIGGER_PLAIN[k] ? TRIGGER_PLAIN[k][0].toLowerCase() : k));

  useEffect(() => {
    if (!armNext || !pinned) return;
    setArmNext(false);
    const b = notifyRef.current && notifyRef.current.querySelector("button");
    // only the untouched state turns alerts on; "Alerting me" navigates
    if (b && b.getAttribute("aria-pressed") !== "true") b.click();
  }, [armNext, pinned]);

  const go = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/me/picks", { method: "POST", json: { symbol } });
      onPin(symbol, true);
      setArmNext(true);
    } catch (err) {
      if (err.status === 403) {
        toast(err.detail || "Your plan's limit on watched names is reached.");
        openUpgrade("picks", { symbol });
      } else toast(err.detail || "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!pinned) {
    return (
      <button
        type="button"
        className="btn btn-primary pn-btn"
        disabled={busy}
        onClick={go}
        title={`Keep ${symbol} on my watchlist and tell me the day a fact changes on it: ${list(plainList)}.`}
      >
        <Bell />
        <span>{busy ? "One moment…" : CTA.WATCH_FOR_ME}</span>
      </button>
    );
  }
  return (
    <>
      <Pin symbol={symbol} pinned onChange={onPin} label />
      <span className="pn-notify" ref={notifyRef}>
        <NotifyButton symbol={symbol} compact />
      </span>
    </>
  );
}

// tallySentence mid-sentence: "No alerts fired…" loses its capital.
function tallyLower(t) {
  const s = tallySentence(t);
  return s.charAt(0) === "N" ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

// The industry's month, in numbers: counts, never tickers. "12 alerts fired
// here in the last 30 days; 2 moved 10%+." What tends to fire is said only
// once ten alerts have fired (firesSentence).
function PulseLine({ p, pulse, days }) {
  if (pulse === null && !p) return null; // still loading: no figure is guessed
  if (!p || !p.fired) return <span className="ind-pulse">No alerts fired here in the last {days} days.</span>;
  return (
    <>
      <span className="ind-pulse">
        <span className="n">{p.fired}</span> {p.fired === 1 ? "alert" : "alerts"} fired here in the last {p.days || days} days;{" "}
        {p.measured ? (
          <>
            <span className="n">{p.moved_10}</span> moved 10%+.
          </>
        ) : (
          "five-session windows still open."
        )}
      </span>
      {p.fired >= 10 && <span className="ind-fires">{firesSentence(p)}</span>}
    </>
  );
}

export default function Onboarding() {
  const { me, refresh } = useMe();
  const { full } = useMode();
  const q = useQuery();
  const next = safeNext(q.get("next"));
  const [step, setStep] = useState(1);
  const [footH, setFootH] = useState(0);
  const [ind, setInd] = useState(null);
  const [picked, setPicked] = useState([]);
  const [limit, setLimit] = useState(1);
  const [tiers, setTiers] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [shape, setShape] = useState({}); // industry key -> overview aggregates (More detail)
  const [pulse, setPulse] = useState(null); // null loading, false failed, else the body
  const [focus, setFocus] = useState(null); // industry the names come from
  const [board, setBoard] = useState(null); // {rows, strategy} or null while loading
  const [boardFor, setBoardFor] = useState("");
  const [pins, setPins] = useState(() => new Set());
  const shapeReq = useRef(0);
  const headRef = useRef(null);
  const firstStep = useRef(true);

  // Live shape of each followed industry (names scored, how the bands fell)
  // from the overview; shown in More detail only. Best effort.
  const loadShape = () => {
    const n = ++shapeReq.current;
    api("/overview")
      .then((d) => {
        if (n !== shapeReq.current) return;
        const m = {};
        (d.industries || []).forEach((x) => {
          m[x.key] = x;
        });
        setShape(m);
      })
      .catch(() => {});
  };

  useEffect(() => {
    let alive = true;
    Promise.all([cached("/industries"), api("/me/industries"), api("/entitlements")])
      .then(([i, f, e]) => {
        if (!alive) return;
        setInd(i.industries);
        const keys = f.industries.map((x) => x.key);
        setPicked(keys);
        setFocus(keys[0] || null);
        setLimit(e.current ? e.current.industries_limit : 1);
        setTiers(e.tiers);
      })
      .catch((e) => alive && setErr(e));
    loadShape();
    api("/me/picks")
      .then((d) => alive && setPins(new Set(d.picks.map((p) => p.symbol))))
      .catch(() => {});
    fetchPulse(30)
      .then((d) => alive && setPulse(d))
      .catch(() => alive && setPulse(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Each step opens at the top with its title focused, so a phone that was
  // scrolled to the sticky footer does not land mid-step.
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    window.scrollTo({ top: 0 });
    if (headRef.current) headRef.current.focus({ preventScroll: true });
  }, [step]);

  // The board for step 2, fetched once per set of followed industries.
  useEffect(() => {
    if (step < 2) return undefined;
    const key = picked.join(",");
    if (board && boardFor === key) return undefined;
    let alive = true;
    setBoard(null);
    api("/board")
      .then((d) => alive && setBoard(d))
      .catch(() => alive && setBoard({ rows: [], strategy: null }))
      .finally(() => alive && setBoardFor(key));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, picked]);

  const focusLabel = (ind || []).find((i) => i.key === focus)?.label || "";
  const rows = useMemo(() => {
    if (!board) return [];
    const all = board.rows || [];
    const mine = focus ? all.filter((r) => r.industry && r.industry.key === focus) : all;
    return [...mine].sort((a, b) => b.value - a.value).slice(0, TOP);
  }, [board, focus]);

  const pulseInd = useMemo(() => {
    const m = {};
    ((pulse && pulse.industries) || []).forEach((x) => {
      m[x.key] = x;
    });
    return m;
  }, [pulse]);
  const pulseFor = (k) => (k ? pulseInd[k] : undefined);
  const days = (pulse && pulse.days) || 30;

  const toggle = async (key) => {
    const isOn = picked.includes(key);
    try {
      if (isOn) {
        await api(`/me/industries/${key}`, { method: "DELETE" });
        const rest = picked.filter((k) => k !== key);
        setPicked(rest);
        if (focus === key) setFocus(rest[0] || null);
      } else {
        if (limit < 999 && picked.length >= limit) return;
        await api("/me/industries", { method: "POST", json: { key } });
        setPicked([...picked, key]);
        setFocus(key);
      }
      loadShape();
    } catch (e) {
      toast(e.detail || "Couldn't update that industry.");
    }
  };

  // Every exit: the browser's zone is saved so the digest lands in the
  // morning (changeable in Account), the account is re-read, and the
  // visitor goes where they were headed, else Home with the welcome flag.
  const finish = async () => {
    setBusy(true);
    try {
      await api("/me/settings", { method: "PATCH", json: { timezone: tzGuess() } }).catch(() => {});
      await refresh();
    } finally {
      navigate(next || "/home?welcome=1");
    }
  };

  const onPin = (sym, on) =>
    setPins((p) => {
      const n = new Set(p);
      if (on) n.add(sym);
      else n.delete(sym);
      return n;
    });

  // The one-line "why" is the plain verdict built from the row's own
  // recorded fields; the operator's hook is Lab material (DESIGN_V5 §2).
  const why = (r) => verdict(r, board && board.strategy, r.symbol).headline;

  const byPrice = tiers && [...tiers].sort((a, b) => a.price_monthly_cents - b.price_monthly_cents);
  const nextTier = byPrice && byPrice.find((t) => t.industries_limit > limit);
  // the cheapest plan that arms alerts at all, for a plan that arms none
  const alertTier = byPrice && byPrice.find((t) => t.alerts_limit !== 0);
  const tier = me && me.tier;
  const atLimit = limit < 999 && picked.length >= limit;
  const stepStyle = footH ? { paddingBottom: footH } : undefined;
  const defaults = DEFAULT_TRIGGERS.map((k) => (TRIGGER_PLAIN[k] ? TRIGGER_PLAIN[k][0].toLowerCase() : k));

  if (err) {
    return (
      <div className="wrap wrap-narrow">
        <ErrorCard error={err} title="Couldn't load the first run." onRetry={() => window.location.reload()} />
      </div>
    );
  }

  // Step utilities: one sentence each, from the pulse and the plan's own
  // limits. A figure that has not arrived is left out, never estimated.
  const t1 = pulse && pulse.alerts;
  const utility1 = t1 ? (
    <>
      {t1.fired ? (
        <>
          Last {days} days: <b>{plural(t1.fired, "alert")}</b> fired on {plural(t1.names, "name")}; <b>{t1.moved_10 || 0}</b> moved 10%+.
        </>
      ) : (
        <>No alerts fired in the last {days} days.</>
      )}{" "}
      Your plan watches <b>{industriesLabel(limit)}</b>
      {limit < 999 ? " at a time" : ""}.
    </>
  ) : (
    <>
      Your plan watches <b>{industriesLabel(limit)}</b>
      {limit < 999 ? " at a time" : ""}; every name inside is <Explain term="score">scored</Explain> each morning.
    </>
  );

  const t2 = pulseFor(focus);
  const utility2 = (
    <>
      {t2 ? (
        <>
          In <b>{focusLabel}</b> over the last {days} days, {tallyLower(t2)}{" "}
        </>
      ) : pulse ? (
        <>
          No alerts fired in <b>{focusLabel}</b> in the last {days} days.{" "}
        </>
      ) : null}
      {tier && tier.picks_limit != null ? (
        <>
          Your plan watches <b>{plural(tier.picks_limit, "name")}</b> for you and sends <b>{alertsLabel(tier.alerts_limit)}</b>
          {tier.alerts_limit === 0 && alertTier ? (
            <>
              ; {alertTier.label} sends {alertsLabel(alertTier.alerts_limit)} over {(alertTier.channels || ["email"]).join(" and ")}
            </>
          ) : null}
          .
        </>
      ) : (
        <>These are the top-rated names in {focusLabel || "your industry"} this morning.</>
      )}
    </>
  );

  return (
    <div className="wrap wrap-narrow onboarding">
      <Progress step={step} />

      {me && !me.verified && (
        <Notice tone="info" className="ob-verify">
          <span>
            We sent a verification link to <b>{me.email}</b>. Your Home works now; alerts and digests start once it's clicked.
          </span>{" "}
          <ResendVerify />
        </Notice>
      )}

      {step === 1 && (
        <div className="ob-step page-enter" style={stepStyle}>
          <div className="ob-head">
            <h1 ref={headRef} tabIndex={-1}>
              Pick what I should watch
            </h1>
            <p className="utility">{utility1}</p>
            <p className="muted">Start with one you already follow. You can change it any time.</p>
          </div>
          {!ind ? (
            <Skeleton rows={5} height={88} />
          ) : (
            <div className="indgrid">
              {ind.map((i) => {
                const on = picked.includes(i.key);
                const s = shape[i.key];
                const dist = (s && s.distribution) || {};
                const p = i.month && i.month.fired != null ? i.month : pulseFor(i.key);
                const oneLine = (i.plain && i.plain.what_is_in_it) || i.description;
                // beyond the plan's limit the card opens the upgrade sheet in
                // place instead of toggling; with no bigger plan it is inert
                const blocked = !on && atLimit;
                const canUpgrade = blocked && Boolean(nextTier);
                const disabled = blocked && !canUpgrade;
                const act = () => {
                  if (disabled) return;
                  if (blocked) openUpgrade("industries", { key: i.key, label: i.label });
                  else toggle(i.key);
                };
                // a div with the button role, not a button: the explainers
                // inside are buttons of their own and a button cannot hold one
                return (
                  <div
                    key={i.key}
                    role="button"
                    tabIndex={disabled ? -1 : 0}
                    className={`indcard ${blocked ? "locked" : ""}`}
                    aria-pressed={on}
                    aria-disabled={disabled || undefined}
                    title={i.plain && i.plain.why_it_moves ? i.plain.why_it_moves : undefined}
                    onClick={act}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return;
                      if (e.key !== "Enter" && e.key !== " ") return;
                      e.preventDefault();
                      act();
                    }}
                  >
                    <b>
                      {i.label}
                      {full && i.benchmark_etf && (
                        <span className="etf">
                          <Explain term="benchmark">benchmark</Explain> <span className="etf-code">{i.benchmark_etf}</span>
                        </span>
                      )}
                    </b>
                    {oneLine && <span className="desc">{oneLine}</span>}
                    <PulseLine p={p} pulse={pulse} days={days} />
                    {full && (
                      <span className="facts">
                        <span>
                          <span className="n">{i.universe_count}</span> names
                        </span>
                        {s && s.scored != null && (
                          <span>
                            <span className="n">{s.scored}</span> <Explain term="score">scored</Explain>
                          </span>
                        )}
                        {dist.strong > 0 && (
                          <span>
                            <span className="n">{dist.strong}</span> <Explain term="strong">strong</Explain>
                          </span>
                        )}
                        {dist.elevated > 0 && (
                          <span>
                            <span className="n">{dist.elevated}</span> <Explain term="elevated">elevated</Explain>
                          </span>
                        )}
                      </span>
                    )}
                    {blocked && (
                      <span className="ind-lock">
                        {canUpgrade ? (
                          <>
                            Your plan watches {industriesLabel(limit)}; {nextTier.label} watches {industriesLabel(nextTier.industries_limit)}. {CTA.NEXT_PLAN}
                          </>
                        ) : (
                          <>Your plan watches {industriesLabel(limit)}.</>
                        )}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <StickyFoot onHeight={setFootH}>
            <span className="ob-foot-left">
              <span>
                <b>
                  {picked.length} of {industriesLabel(limit)}
                </b>{" "}
                picked
                {atLimit && nextTier && (
                  <>
                    {" "}
                    · {nextTier.label} watches {industriesLabel(nextTier.industries_limit)}.
                  </>
                )}
              </span>
              {atLimit && nextTier && (
                <button type="button" className="btn-quiet" onClick={() => openUpgrade("industries")}>
                  {CTA.NEXT_PLAN}
                </button>
              )}
            </span>
            <span className="row">
              <button type="button" className="btn-quiet ob-skip" disabled={busy} onClick={finish}>
                Skip for now
              </button>
              <button type="button" className="btn btn-primary" disabled={picked.length === 0} onClick={() => setStep(2)}>
                Watch these for me
              </button>
            </span>
            <FinePrint short links={false} className="ob-fine" />
          </StickyFoot>
        </div>
      )}

      {step === 2 && (
        <div className="ob-step page-enter" style={stepStyle}>
          <div className="ob-head">
            <h1 ref={headRef} tabIndex={-1}>
              Tell me when something happens
            </h1>
            <p className="utility">{utility2}</p>
            <p className="muted">
              Watch a name and you are told the day a fact prints on it: {defaults.join(", ")}. These are the top-rated names in{" "}
              {focusLabel || "your industry"} this morning, not a recommendation.
            </p>
          </div>
          {picked.length > 1 && (
            <div className="seg ob-seg" role="group" aria-label="Industry">
              {picked.map((k) => (
                <button key={k} type="button" aria-pressed={focus === k} onClick={() => setFocus(k)}>
                  {(ind || []).find((i) => i.key === k)?.label || k}
                </button>
              ))}
            </div>
          )}
          {board === null ? (
            <Skeleton rows={3} height={120} />
          ) : rows.length === 0 ? (
            <Empty
              icon="board"
              title={`No rated names in ${focusLabel || "this industry"} yet.`}
              steps={[
                "Open my Home; it fills in after the next morning's scoring.",
                "Watch names from Explore once the ratings land.",
                "Tap Alert me on any name to be emailed when a fact prints.",
              ]}
            >
              Ratings appear after the first morning's scoring.
            </Empty>
          ) : (
            <ul className="picklist">
              {rows.map((r) => (
                <li className="pick" key={r.symbol}>
                  <div className="pick-top">
                    <Link className="sym" to={`/stock/${r.symbol}`}>
                      {r.symbol}
                    </Link>
                    <span className="theme" title={r.theme}>
                      {r.theme}
                    </span>
                    <ScoreBadge band={r.band} value={r.value} present={r.components_present} total={r.components_total} strategy={board.strategy} />
                  </div>
                  <p className="pick-why">{why(r)}</p>
                  <div className="pick-act">
                    <WatchForMe symbol={r.symbol} pinned={pins.has(r.symbol)} onPin={onPin} />
                    <Link to={`/stock/${r.symbol}`} className="btn-quiet">
                      Tell me why →
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="muted small ob-tz">
            Your weekly brief arrives in your morning ({tzGuess()}); change the zone and where alerts reach you in <Link to="/settings">My account</Link>.
          </p>
          <StickyFoot onHeight={setFootH}>
            <button type="button" className="btn-quiet" onClick={() => setStep(1)}>
              ← Back
            </button>
            <span className="row">
              <button type="button" className="linkbtn ob-skip" disabled={busy} onClick={finish}>
                Skip for now
              </button>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={finish}>
                {busy ? "One moment…" : CTA.OPEN_HOME}
              </button>
            </span>
            <FinePrint short links={false} className="ob-fine" />
          </StickyFoot>
        </div>
      )}
    </div>
  );
}
