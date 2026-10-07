import React, { useEffect, useState } from "react";
import { api, cached, toast } from "../api.js";
import { Link, navigate } from "../lib/router.jsx";
import { hasChannel, useMe } from "../lib/me.jsx";
import { industriesLabel, tzGuess, tzList } from "../lib/fmt.js";
import { ErrorCard, Notice, Skeleton } from "../components/ui.jsx";

// Two steps, one page, no reload between them. Only what has no sane
// default is asked: which industries, and where delivery should go.
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

  useEffect(() => {
    let alive = true;
    Promise.all([cached("/industries"), api("/me/industries"), api("/entitlements")])
      .then(([i, f, e]) => {
        if (!alive) return;
        setInd(i.industries);
        setPicked(f.industries.map((x) => x.key));
        setLimit(e.current ? e.current.industries_limit : 1);
        setTiers(e.tiers);
      })
      .catch((e) => alive && setErr(e));
    return () => {
      alive = false;
    };
  }, []);

  const toggle = async (key) => {
    const isOn = picked.includes(key);
    try {
      if (isOn) {
        await api(`/me/industries/${key}`, { method: "DELETE" });
        setPicked(picked.filter((k) => k !== key));
      } else {
        if (limit < 999 && picked.length >= limit) return;
        await api("/me/industries", { method: "POST", json: { key } });
        setPicked([...picked, key]);
      }
    } catch (e) {
      toast(e.detail || "Couldn't update that industry.");
    }
  };

  const finish = async () => {
    setBusy(true);
    try {
      await api("/me/settings", { method: "PATCH", json: { timezone: tz, ...(hasChannel(me, "push") ? { channel_push: push } : {}) } });
      await refresh();
      navigate("/board?first_run=1");
    } catch (e) {
      toast(e.detail || "Couldn't save delivery settings.");
      setBusy(false);
    }
  };

  const nextTier =
    tiers &&
    [...tiers]
      .sort((a, b) => a.price_monthly_cents - b.price_monthly_cents)
      .find((t) => t.industries_limit > limit);
  const atLimit = limit < 999 && picked.length >= limit;

  if (err) {
    return (
      <div className="wrap wrap-narrow">
        <ErrorCard error={err} title="Couldn't load onboarding." onRetry={() => window.location.reload()} />
      </div>
    );
  }

  return (
    <div className="wrap wrap-narrow">
      <div className="steps" aria-label={`Step ${step} of 2`}>
        <span className="bar" aria-hidden="true">
          <span className={step >= 1 ? "on" : ""} />
          <span className={step >= 2 ? "on" : ""} />
        </span>
        Step {step} of 2
      </div>

      {me && !me.verified && (
        <Notice tone="info">
          We sent a verification link to <b>{me.email}</b>. Your Board works now; alerts and digests
          start once it's clicked.
        </Notice>
      )}

      {step === 1 && (
        <>
          <h1 style={{ fontSize: "var(--fs-lg)" }}>Which industries should your Board cover?</h1>
          <p className="muted">
            The Board shows the top names in each industry you follow. You can change this any time in
            your account.
          </p>
          {!ind ? (
            <Skeleton rows={5} height={72} />
          ) : (
            <div className="indgrid">
              {ind.map((i) => {
                const on = picked.includes(i.key);
                return (
                  <button
                    key={i.key}
                    className="indcard"
                    aria-pressed={on}
                    disabled={!on && atLimit}
                    onClick={() => toggle(i.key)}
                  >
                    <b>
                      {i.label}
                      <span className="etf">{i.benchmark_etf}</span>
                    </b>
                    <span className="desc">{i.description}</span>
                    <span className="desc">{i.universe_count} names</span>
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
                  · {nextTier.label} follows {industriesLabel(nextTier.industries_limit)}.{" "}
                  <Link to="/pricing">See plans</Link>
                </>
              )}
            </span>
            <span className="row">
              <Link to="/board" className="btn-quiet">
                Skip for now
              </Link>
              <button className="btn btn-primary" disabled={picked.length === 0} onClick={() => setStep(2)}>
                Continue
              </button>
            </span>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <h1 style={{ fontSize: "var(--fs-lg)" }}>Where should alerts and digests reach you?</h1>
          <p className="muted">Email is always on. Other channels unlock with paid plans.</p>
          <div className="card">
            <label className="check">
              <input type="checkbox" checked disabled />
              <span>
                Email
                <span className="lock-note">Required · {me ? me.email : ""}</span>
              </span>
            </label>
            <label className={`check ${hasChannel(me, "push") ? "" : "locked"}`}>
              <input
                type="checkbox"
                checked={push}
                disabled={!hasChannel(me, "push")}
                onChange={(e) => setPush(e.target.checked)}
              />
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
                  {hasChannel(me, "sms") ? "Add a phone number in your account to turn this on." : (
                    <>
                      Pro and above · <Link to="/pricing">See plans</Link>
                    </>
                  )}
                </span>
              </span>
            </label>
            <div className="field" style={{ marginTop: "var(--s-3)" }}>
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
          </div>
          <div className="sticky-foot">
            <button className="btn-quiet" onClick={() => setStep(1)}>
              ← Back
            </button>
            <button className="btn btn-primary" disabled={busy} onClick={finish}>
              {busy ? "Saving…" : "Open my Board"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
