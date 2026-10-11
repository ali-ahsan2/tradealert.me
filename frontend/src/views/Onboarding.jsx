import React, { useEffect, useMemo, useRef, useState } from "react";
import { api, cached, toast } from "../api.js";
import { Link, navigate } from "../lib/router.jsx";
import { hasChannel, useMe } from "../lib/me.jsx";
import { alertsLabel, industriesLabel, plural, tzGuess, tzList } from "../lib/fmt.js";
import { useMode } from "../lib/mode.js";
import { DEFAULT_TRIGGERS, GLOSSARY, TRIGGER_PLAIN } from "../lib/glossary.js";
import { verdict } from "../lib/plain.js";
import { fetchPulse, tallySentence } from "../lib/record.js";
import { openUpgrade } from "../lib/upgrade.js";
import Explain, { Term } from "../components/Explain.jsx";
import NotifyButton from "../components/NotifyButton.jsx";
import ScoreBadge from "../components/ScoreBadge.jsx";
import Pin from "../components/Pin.jsx";
import { Empty, ErrorCard, Notice, Skeleton } from "../components/ui.jsx";
import "./help.css";

// First run (DESIGN_V5 §4, step 3), three screens: pick an industry with its
// month in numbers, learn the three words every screen uses, pin one name
// and turn on alerts in one tap. Everything shown is live: the industries
// and their counts come from the API, each industry's month from the public
// pulse (counts only, no tickers), the example and the names from the board
// for the industry just chosen, clamped by the plan exactly as the Board
// is. Delivery preferences (timezone, channels) live in a small accordion
// on the last step so nothing the old flow saved is lost. A plan limit
// opens the upgrade sheet in place; nothing here links out to the plans
// page for a prompt.

const STEPS = ["Pick an industry", "Three words you'll see everywhere", "Pin one name and turn on alerts"];
// A newcomer pins one name from a handful, not a whole board. The plan's
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

// The footer sticks above the bottom bar, so without room after it the last
// cards of a step can never scroll clear of it. It reports its height and
// the step pads its end by the same amount.
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

// One obvious tap on a name: pin it, then arm the three default triggers.
// The pin is one POST; the arming is NotifyButton's own flow (the shared
// rule cache and the verify / plan / quota cards every other screen shows),
// started by tapping the button it renders once the name is pinned. A name
// already pinned shows the pair as state: the labelled Pin and the Notify
// button, exactly as the Board does.
function PinNotify({ symbol, pinned, onPin }) {
  const [busy, setBusy] = useState(false);
  const [armNext, setArmNext] = useState(false);
  const notifyRef = useRef(null);
  const plainList = DEFAULT_TRIGGERS.map((k) => (TRIGGER_PLAIN[k] ? TRIGGER_PLAIN[k][0].toLowerCase() : k));

  useEffect(() => {
    if (!armNext || !pinned) return;
    setArmNext(false);
    const b = notifyRef.current && notifyRef.current.querySelector("button");
    // only the untouched state arms; "Notifying" and "Manage alerts" navigate
    if (b && b.getAttribute("aria-pressed") !== "true" && !/manage/i.test(b.textContent || "")) b.click();
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
        toast(err.detail || "Your plan's pick limit is reached.");
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
        title={`Pin ${symbol} to your watchlist and tell me when it has a ${plainList.join(", a ")}.`}
      >
        <Bell />
        <span>{busy ? "Pinning…" : "Pin and notify me"}</span>
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

export default function Onboarding() {
  const { me, refresh } = useMe();
  const { full } = useMode();
  const [step, setStep] = useState(1);
  const [footH, setFootH] = useState(0);
  const [ind, setInd] = useState(null);
  const [picked, setPicked] = useState([]);
  const [limit, setLimit] = useState(1);
  const [tiers, setTiers] = useState(null);
  const [err, setErr] = useState(null);
  const [tz, setTz] = useState(tzGuess());
  const [push, setPush] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shape, setShape] = useState({}); // industry key -> overview aggregates
  const [pulse, setPulse] = useState(null); // null loading, false failed, else the body
  const [focus, setFocus] = useState(null); // industry the examples come from
  const [board, setBoard] = useState(null); // {rows, strategy} or null while loading
  const [boardFor, setBoardFor] = useState("");
  const [pins, setPins] = useState(() => new Set());
  const [hooks, setHooks] = useState({}); // symbol -> hook text from its dossier
  const shapeReq = useRef(0);
  const headRef = useRef(null);
  const firstStep = useRef(true);

  // Live shape of each followed industry (names scored, how the bands fell)
  // from the overview. Best effort: no run yet means no counts, not an error.
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
    // the universe's month: alerts fired and what moved after, per industry;
    // public, cached server-side, and never a ticker
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

  // The board for steps 2 and 3, fetched once per set of followed industries.
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
  const example = rows[0] || null;

  const pulseInd = useMemo(() => {
    const m = {};
    ((pulse && pulse.industries) || []).forEach((x) => {
      m[x.key] = x;
    });
    return m;
  }, [pulse]);
  const pulseFor = (k) => (k ? pulseInd[k] : undefined);
  const days = (pulse && pulse.days) || 30;

  // The one-line "why" is the name's hook. Board rows do not carry it yet,
  // so fetch it from each shown dossier, best effort, and fall back to the
  // plain verdict built from the row's own recorded fields.
  useEffect(() => {
    if (step !== 3 || rows.length === 0) return undefined;
    const want = rows.filter((r) => !r.hook && hooks[r.symbol] === undefined).map((r) => r.symbol);
    if (want.length === 0) return undefined;
    let alive = true;
    Promise.allSettled(want.map((s) => api(`/stock/${encodeURIComponent(s)}`).then((d) => [s, (d && d.hook) || ""]))).then((res) => {
      if (!alive) return;
      const add = {};
      res.forEach((r, i) => {
        add[want[i]] = r.status === "fulfilled" ? r.value[1] : "";
      });
      setHooks((h) => ({ ...h, ...add }));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, rows]);

  const toggle = async (key) => {
    const isOn = picked.includes(key);
    try {
      if (isOn) {
        await api(`/me/industries/${key}`, { method: "DELETE" });
        const next = picked.filter((k) => k !== key);
        setPicked(next);
        if (focus === key) setFocus(next[0] || null);
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

  // Home opens on the first brief; the welcome flag asks it to say so.
  const finish = async () => {
    setBusy(true);
    try {
      await api("/me/settings", { method: "PATCH", json: { timezone: tz, ...(hasChannel(me, "push") ? { channel_push: push } : {}) } });
      await refresh();
      navigate("/overview?welcome=1");
    } catch (e) {
      toast(e.detail || "Couldn't save delivery settings.");
      setBusy(false);
    }
  };

  const onPin = (sym, on) =>
    setPins((p) => {
      const n = new Set(p);
      if (on) n.add(sym);
      else n.delete(sym);
      return n;
    });

  const why = (r) => {
    const hook = (r.hook || hooks[r.symbol] || "").trim();
    if (hook) return hook;
    return verdict(r, board && board.strategy, r.symbol).headline;
  };

  const byPrice = tiers && [...tiers].sort((a, b) => a.price_monthly_cents - b.price_monthly_cents);
  const nextTier = byPrice && byPrice.find((t) => t.industries_limit > limit);
  // the cheapest plan that arms alerts at all, for a plan that arms none
  const alertTier = byPrice && byPrice.find((t) => t.alerts_limit !== 0);
  const tier = me && me.tier;
  const atLimit = limit < 999 && picked.length >= limit;
  // the three words appear on the cards only once a run has counts to show
  const anyShape = Object.values(shape).some((s) => s && s.scored != null);
  const stepStyle = footH ? { paddingBottom: footH } : undefined;
  const defaults = DEFAULT_TRIGGERS.map((k) => (TRIGGER_PLAIN[k] ? TRIGGER_PLAIN[k][0].toLowerCase() : k));

  if (err) {
    return (
      <div className="wrap wrap-narrow">
        <ErrorCard error={err} title="Couldn't load onboarding." onRetry={() => window.location.reload()} />
      </div>
    );
  }

  const preferences = (
    <details className="acc ob-pref" open={full}>
      <summary>
        Preferences <span className="sum-note">timezone and delivery</span>
      </summary>
      <div className="acc-body">
        <div className="field">
          <label htmlFor="ob-tz">Timezone</label>
          <select id="ob-tz" value={tz} onChange={(e) => setTz(e.target.value)}>
            {[tz, ...tzList().filter((z) => z !== tz)].map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
          <span className="help">Detected from your browser. Digests send Monday morning in this zone.</span>
        </div>
        <p className="muted small" style={{ margin: "var(--s-3) 0 var(--s-2)" }}>
          Where alerts and digests reach you. Email is always on; other channels come with paid plans.
        </p>
        <label className="check">
          <input type="checkbox" checked disabled />
          <span>
            Email
            <span className="lock-note">Required · {me ? me.email : ""}</span>
          </span>
        </label>
        <label className={`check ${hasChannel(me, "push") ? "" : "locked"}`}>
          <input type="checkbox" checked={push} disabled={!hasChannel(me, "push")} onChange={(e) => setPush(e.target.checked)} />
          <span>
            Web push
            {!hasChannel(me, "push") && (
              <span className="lock-note">
                Basic and above · <Link to="/pricing">See plans</Link>
              </span>
            )}
          </span>
        </label>
        <label className={`check ${hasChannel(me, "sms") ? "" : "locked"}`}>
          <input type="checkbox" disabled />
          <span>
            SMS
            <span className="lock-note">
              {hasChannel(me, "sms") ? (
                "Add a phone number in your account to turn this on."
              ) : (
                <>
                  Pro and above · <Link to="/pricing">See plans</Link>
                </>
              )}
            </span>
          </span>
        </label>
      </div>
    </details>
  );

  // Step utilities: one sentence each, from the pulse, the overview and the
  // plan's own limits. A figure that has not arrived is left out, never
  // estimated.
  const t1 = pulse && pulse.alerts;
  const utility1 = t1 ? (
    <>
      Across every industry in the last {days} days, {tallyLower(t1)} Your plan follows <b>{industriesLabel(limit)}</b>
      {limit < 999 ? " at a time" : ""}.
    </>
  ) : (
    <>
      Your plan follows <b>{industriesLabel(limit)}</b>
      {limit < 999 ? " at a time" : ""}; every name inside is <Explain term="score">scored</Explain> each morning.
    </>
  );

  const t2 = pulseFor(focus);
  const s2 = shape[focus];
  const d2 = (s2 && s2.distribution) || {};
  const utility2 = (
    <>
      {t2 ? (
        <>
          In <b>{focusLabel}</b> over the last {days} days, {tallyLower(t2)}
        </>
      ) : pulse ? (
        <>
          No alerts fired in <b>{focusLabel}</b> in the last {days} days.
        </>
      ) : null}
      {s2 && s2.scored != null ? (
        <>
          {" "}
          On the latest <Explain term="run">run</Explain>, <b>{s2.scored}</b> names were <Explain term="score">scored</Explain> there: <b>{d2.strong || 0}</b>{" "}
          <Explain term="strong">strong</Explain>, <b>{d2.elevated || 0}</b> <Explain term="elevated">elevated</Explain>.
        </>
      ) : !t2 && !pulse ? (
        <>
          Your plan follows <b>{industriesLabel(limit)}</b>; the example below is the top-scored name in {focusLabel || "your industry"} on the latest run.
        </>
      ) : null}
    </>
  );

  const utility3 = (
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
          Your plan pins <b>{plural(tier.picks_limit, "name")}</b> and arms <b>{alertsLabel(tier.alerts_limit)}</b>
          {tier.alerts_limit === 0 && alertTier ? (
            <>
              ; {alertTier.label} arms {alertsLabel(alertTier.alerts_limit)} over {(alertTier.channels || ["email"]).join(" and ")}
            </>
          ) : null}
          .
        </>
      ) : (
        <>
          These are the top-scored names in {focusLabel || "your industry"} on the latest <Explain term="run">run</Explain>.
        </>
      )}
    </>
  );

  return (
    <div className="wrap wrap-narrow">
      <Progress step={step} />

      {me && !me.verified && (
        <Notice tone="info">
          We sent a verification link to <b>{me.email}</b>. Your Home works now; alerts and digests start once it's clicked.
        </Notice>
      )}

      {step === 1 && (
        <div className="ob-step page-enter" style={stepStyle}>
          <div className="ob-head">
            <h1 ref={headRef} tabIndex={-1}>
              Pick an industry
            </h1>
            <p className="utility">{utility1}</p>
            <p className="muted">Start with one you already follow in the news; you can change it any time. Each card shows its last {days} days.</p>
            {anyShape && (
              <p className="hint ob-hint">
                “Scored” means rated this morning; strong and elevated are the two top bands. The next step explains them.
              </p>
            )}
          </div>
          {!ind ? (
            <Skeleton rows={5} height={88} />
          ) : (
            <div className="indgrid">
              {ind.map((i) => {
                const on = picked.includes(i.key);
                const s = shape[i.key];
                const dist = (s && s.distribution) || {};
                const p = pulseFor(i.key);
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
                      {i.benchmark_etf && (
                        <span className="etf">
                          <Explain term="benchmark">benchmark</Explain> <span className="etf-code">{i.benchmark_etf}</span>
                        </span>
                      )}
                    </b>
                    {i.description && <span className="desc">{i.description}</span>}
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
                    {p && (
                      <span className="ind-pulse">
                        <span className="n">{p.fired}</span> {p.fired === 1 ? "alert" : "alerts"} fired ·{" "}
                        {p.measured ? (
                          <>
                            <span className="n">{p.moved_10}</span> moved 10%+ after
                          </>
                        ) : (
                          "five-session windows still open"
                        )}
                      </span>
                    )}
                    {blocked && (
                      <span className="ind-lock">
                        {canUpgrade ? (
                          <>
                            Your plan follows {industriesLabel(limit)}; see what {nextTier.label} would watch
                          </>
                        ) : (
                          <>Your plan follows {industriesLabel(limit)}.</>
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
                selected
                {atLimit && nextTier && (
                  <>
                    {" "}
                    · {nextTier.label} follows {industriesLabel(nextTier.industries_limit)}.
                  </>
                )}
              </span>
              {atLimit && nextTier && (
                <button type="button" className="btn-quiet" onClick={() => openUpgrade("industries")}>
                  See what {nextTier.label} would watch
                </button>
              )}
            </span>
            <span className="row">
              <Link to="/overview" className="btn-quiet ob-skip">
                Skip for now
              </Link>
              <button type="button" className="btn btn-primary" disabled={picked.length === 0} onClick={() => setStep(2)}>
                Continue
              </button>
            </span>
          </StickyFoot>
        </div>
      )}

      {step === 2 && (
        <div className="ob-step page-enter" style={stepStyle}>
          <div className="ob-head">
            <h1 ref={headRef} tabIndex={-1}>
              Three words you'll see everywhere
            </h1>
            <p className="utility">{utility2}</p>
            <p className="muted">Every screen uses them the same way. Anywhere in the app, tap an underlined word for its meaning.</p>
          </div>
          <div className="wordgrid">
            <section className="obword" aria-labelledby="w-score">
              <h2 id="w-score">{GLOSSARY.score.term}</h2>
              <p>{GLOSSARY.score.short}</p>
              <p>
                Two things decide how much to trust it: <Term k="coverage" /> and <Term k="shrinkage" />.
              </p>
            </section>
            <section className="obword" aria-labelledby="w-band">
              <h2 id="w-band">{GLOSSARY.band.term}</h2>
              <p>{GLOSSARY.band.short}</p>
              <p>
                In order: <Term k="strong" />, <Term k="elevated" />, <Term k="neutral" />, <Term k="weak" />, <Term k="excluded" />.
              </p>
            </section>
            <section className="obword" aria-labelledby="w-alert">
              <h2 id="w-alert">{GLOSSARY.alert.term}</h2>
              <p>{GLOSSARY.alert.short}</p>
              <p>
                “Pin and notify me” keeps a name in view and turns on three <Term k="trigger">triggers</Term> over email with one tap: {defaults.join(", ")}.
              </p>
            </section>
          </div>
          {board === null && picked.length > 0 && <Skeleton rows={1} height={56} />}
          {example && (
            <div className="example" aria-label={`Example from ${focusLabel}`}>
              <span>Today in {focusLabel}:</span>
              <Link className="sym" to={`/stock/${example.symbol}`}>
                {example.symbol}
              </Link>
              <ScoreBadge
                band={example.band}
                value={example.value}
                present={example.components_present}
                total={example.components_total}
                size="full"
                strategy={board.strategy}
              />
              <span>{verdict(example, board.strategy, example.symbol).headline}</span>
            </div>
          )}
          <StickyFoot onHeight={setFootH}>
            <button type="button" className="btn-quiet" onClick={() => setStep(1)}>
              ← Back
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setStep(3)}>
              Continue
            </button>
          </StickyFoot>
        </div>
      )}

      {step === 3 && (
        <div className="ob-step page-enter" style={stepStyle}>
          <div className="ob-head">
            <h1 ref={headRef} tabIndex={-1}>
              Pin one name and turn on alerts
            </h1>
            <p className="utility">{utility3}</p>
            <p className="muted">
              A pinned name stays on your Home and in your digest; alerts email you when a fact prints on it. Nothing here is a recommendation: these
              are the top-scored names in {focusLabel || "your industry"} on the latest run.
            </p>
            {!full && <p className="hint ob-hint">Your timezone and where alerts reach you are further down this step, under Preferences.</p>}
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
              title={`No scored names in ${focusLabel || "this industry"} yet.`}
              steps={[
                "Finish; your Home opens now and fills in after the next morning run.",
                "Pin names from the Board once scores land.",
                "Tap Notify me on any name to be emailed when a fact prints.",
              ]}
            >
              Scores appear after the first run completes; the engine runs each morning.
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
                    <PinNotify symbol={r.symbol} pinned={pins.has(r.symbol)} onPin={onPin} />
                    <Link to={`/stock/${r.symbol}`} className="btn-quiet">
                      Why →
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {preferences}
          <StickyFoot onHeight={setFootH}>
            <button type="button" className="btn-quiet" onClick={() => setStep(2)}>
              ← Back
            </button>
            <span className="row">
              <button type="button" className="btn-quiet ob-skip" disabled={busy} onClick={finish}>
                Skip for now
              </button>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={finish}>
                {busy ? "Saving…" : "Open my Home"}
              </button>
            </span>
          </StickyFoot>
        </div>
      )}
    </div>
  );
}
