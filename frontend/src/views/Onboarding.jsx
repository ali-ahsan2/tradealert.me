import React, { useEffect, useMemo, useRef, useState } from "react";
import { api, cached, toast } from "../api.js";
import { Link, navigate } from "../lib/router.jsx";
import { hasChannel, useMe } from "../lib/me.jsx";
import { industriesLabel, tzGuess, tzList } from "../lib/fmt.js";
import { DEFAULT_TRIGGERS, GLOSSARY, TRIGGER_PLAIN } from "../lib/glossary.js";
import { verdict } from "../lib/plain.js";
import { Term } from "../components/Explain.jsx";
import NotifyButton from "../components/NotifyButton.jsx";
import ScoreBadge from "../components/ScoreBadge.jsx";
import Pin from "../components/Pin.jsx";
import { Empty, ErrorCard, Notice, Skeleton } from "../components/ui.jsx";
import "./help.css";

// First run, three screens: pick an industry, learn the three words every
// screen uses, pin one name. Everything shown is live: the industries and
// their counts come from the API, the example and the names from the
// board for the industry just chosen, clamped by the plan exactly as the
// Board is. Delivery preferences (timezone, channels) live in a small
// accordion on the last step so nothing the old flow saved is lost.

const STEPS = ["Pick an industry", "Three words you'll see everywhere", "Pin one name"];
// A newcomer pins one name from a handful, not a whole board. The plan's
// names_shown_limit still clamps below this on the server.
const TOP = 5;

function Progress({ step }) {
  return (
    <div className="steps" aria-label={`Step ${step} of ${STEPS.length}: ${STEPS[step - 1]}`}>
      <span className="bar" aria-hidden="true">
        {STEPS.map((_, i) => (
          <span key={i} className={step >= i + 1 ? "on" : ""} />
        ))}
      </span>
      Step {step} of {STEPS.length}
    </div>
  );
}

export default function Onboarding() {
  const { me, refresh } = useMe();
  const [step, setStep] = useState(1);
  const [ind, setInd] = useState(null);
  const [picked, setPicked] = useState([]);
  const [limit, setLimit] = useState(1);
  const [tiers, setTiers] = useState(null);
  const [err, setErr] = useState(null);
  const [tz, setTz] = useState(tzGuess());
  const [push, setPush] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shape, setShape] = useState({}); // industry key -> overview aggregates
  const [focus, setFocus] = useState(null); // industry the examples come from
  const [board, setBoard] = useState(null); // {rows, strategy} or null while loading
  const [boardFor, setBoardFor] = useState("");
  const [pins, setPins] = useState(() => new Set());
  const [hooks, setHooks] = useState({}); // symbol -> hook text from its dossier
  const shapeReq = useRef(0);

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
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const finish = async () => {
    setBusy(true);
    try {
      await api("/me/settings", { method: "PATCH", json: { timezone: tz, ...(hasChannel(me, "push") ? { channel_push: push } : {}) } });
      await refresh();
      navigate("/overview");
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

  const nextTier =
    tiers &&
    [...tiers]
      .sort((a, b) => a.price_monthly_cents - b.price_monthly_cents)
      .find((t) => t.industries_limit > limit);
  const atLimit = limit < 999 && picked.length >= limit;
  const defaults = DEFAULT_TRIGGERS.map((k) => (TRIGGER_PLAIN[k] ? TRIGGER_PLAIN[k][0].toLowerCase() : k));

  if (err) {
    return (
      <div className="wrap wrap-narrow">
        <ErrorCard error={err} title="Couldn't load onboarding." onRetry={() => window.location.reload()} />
      </div>
    );
  }

  const preferences = (
    <details className="acc ob-pref">
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

  return (
    <div className="wrap wrap-narrow">
      <Progress step={step} />

      {me && !me.verified && (
        <Notice tone="info">
          We sent a verification link to <b>{me.email}</b>. Your Board works now; alerts and digests start once it's clicked.
        </Notice>
      )}

      {step === 1 && (
        <>
          <div className="ob-head">
            <h1>Pick an industry</h1>
            <p className="muted">
              Start with one you already follow in the news; you can change it any time. We score every name inside it each trading
              morning. Your plan follows {industriesLabel(limit)} at a time.
            </p>
          </div>
          {!ind ? (
            <Skeleton rows={5} height={88} />
          ) : (
            <div className="indgrid">
              {ind.map((i) => {
                const on = picked.includes(i.key);
                const s = shape[i.key];
                const dist = (s && s.distribution) || {};
                return (
                  <button key={i.key} type="button" className="indcard" aria-pressed={on} disabled={!on && atLimit} onClick={() => toggle(i.key)}>
                    <b>
                      {i.label}
                      <span className="etf">{i.benchmark_etf}</span>
                    </b>
                    {i.description && <span className="desc">{i.description}</span>}
                    <span className="facts">
                      <span>
                        <span className="n">{i.universe_count}</span> names
                      </span>
                      {s && s.scored != null && (
                        <span>
                          <span className="n">{s.scored}</span> scored
                        </span>
                      )}
                      {dist.strong > 0 && (
                        <span>
                          <span className="n">{dist.strong}</span> strong
                        </span>
                      )}
                      {dist.elevated > 0 && (
                        <span>
                          <span className="n">{dist.elevated}</span> elevated
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          <div className="sticky-foot">
            <span>
              <b>
                {picked.length} of {industriesLabel(limit)}
              </b>{" "}
              selected
              {atLimit && nextTier && (
                <>
                  {" "}
                  · Want another industry watched for you? {nextTier.label} follows {industriesLabel(nextTier.industries_limit)}.{" "}
                  <Link to="/pricing">See plans</Link>
                </>
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
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <div className="ob-head">
            <h1>Three words you'll see everywhere</h1>
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
                Notify me turns on three <Term k="trigger">triggers</Term> with one tap: {defaults.join(", ")}.
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
          <div className="sticky-foot">
            <button type="button" className="btn-quiet" onClick={() => setStep(1)}>
              ← Back
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setStep(3)}>
              Continue
            </button>
          </div>
        </>
      )}

      {step === 3 && (
        <>
          <div className="ob-head">
            <h1>Pin one name</h1>
            <p className="muted">
              A pinned name stays on your Home and in your digest. Turn on alerts and we email you when a fact prints on it. Nothing here
              is a recommendation: these are the top-scored names in {focusLabel || "your industry"} on the latest run.
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
              title={`No scored names in ${focusLabel || "this industry"} yet.`}
              steps={[
                "Finish; your Home opens now and fills in after the next morning run.",
                "Pin names from the Board once scores land.",
                "Tap Notify me on any name to be emailed when a fact prints.",
              ]}
            >
              Scores appear after the first daily run completes.
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
                    <Pin symbol={r.symbol} pinned={pins.has(r.symbol)} onChange={onPin} label />
                    <NotifyButton symbol={r.symbol} compact />
                    <Link to={`/stock/${r.symbol}`} className="btn-quiet">
                      Why →
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {preferences}
          <div className="sticky-foot">
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
          </div>
        </>
      )}
    </div>
  );
}
