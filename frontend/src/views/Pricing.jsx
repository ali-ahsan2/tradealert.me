import React, { useEffect, useState } from "react";
import { api, cached, getToken } from "../api.js";
import { Link, navigate, useQuery } from "../lib/router.jsx";
import { alertsLabel, dollars, industriesLabel, plural } from "../lib/fmt.js";
import { EVIDENCE } from "../lib/evidence.js";
import { beyondSentence, fetchRecord } from "../lib/record.js";
import { ErrorCard, Notice, Skeleton } from "../components/ui.jsx";
import FinePrint from "../components/FinePrint.jsx";

// Plans in the public voice (DESIGN_V6 §3, §6): one card per plan, each
// leading with its one-sentence promise and the price, six facts as a short
// list, one button. The same cards at every width; no matrix table. A plan
// is described by what it watches and delivers; the numbers are the same on
// every plan and nothing here is advice.

const CHANNEL_LABEL = { email: "email", push: "web push", sms: "SMS", webhook: "signed webhook" };

function deliveryText(t) {
  return t.channels.map((c) => CHANNEL_LABEL[c] || c).join(" · ");
}

function industriesWord(t) {
  return t.industries_limit >= 999 ? "every industry" : plural(t.industries_limit, "industry", "industries");
}

function picksWord(t) {
  return t.picks_limit == null || t.picks_limit >= 999 ? "unlimited" : plural(t.picks_limit, "name");
}

// One sentence, 14 words or fewer, built from the plan's own limits.
function promise(t) {
  const ind = industriesWord(t);
  if (t.alerts_limit === 0) return `Watches ${ind} for you each morning; you check in yourself.`;
  const on = t.picks_limit == null || t.picks_limit >= 999 ? "any name you pick" : `${plural(t.picks_limit, "name")} you pick`;
  return `Watches ${ind}; tells you the day a fact changes on ${on}.`;
}

function priceText(t) {
  return t.price_monthly_cents === 0 ? "$0" : `${dollars(t.price_monthly_cents)}/month`;
}

export default function Pricing() {
  // Counted from the live strategy list so the sentence cannot go stale at a
  // calibration event (PRODUCT_DESIGN §3.6).
  const [strats, setStrats] = useState(null);
  useEffect(() => {
    let alive = true;
    cached("/strategies").then((d) => alive && setStrats(d.strategies || [])).catch(() => alive && setStrats([]));
    return () => {
      alive = false;
    };
  }, []);
  const provisionalLine = (() => {
    if (!strats || !strats.length) return "Most strategies have no measured record yet.";
    const prov = strats.filter((x) => !x.calibrated).length;
    if (prov === 0) return "Every strategy has a measured record.";
    return `${prov} of the ${strats.length} strategies ${prov === 1 ? "has" : "have"} no measured record yet (provisional).`;
  })();

  // The viewer's own record frames the comparison (DESIGN_V5 §4.6): what
  // fired beyond the industries they follow, as counts, never tickers.
  // Visitors get nothing here; the plans speak for themselves.
  const [rec, setRec] = useState(null);
  useEffect(() => {
    if (!getToken()) return undefined;
    let alive = true;
    fetchRecord(30)
      .then((x) => alive && setRec(x))
      .catch(() => alive && setRec(null));
    return () => {
      alive = false;
    };
  }, []);
  const beyondLine = rec && getToken() ? beyondSentence(rec.beyond) : null;

  const q = useQuery();
  const [d, setD] = useState(null);
  const [health, setHealth] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(q.get("billing") === "cancel" ? "Checkout was cancelled. Your plan is unchanged." : "");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    api("/entitlements")
      .then((x) => alive && setD(x))
      .catch((e) => alive && setErr(e));
    api("/billing/health")
      .then((h) => alive && setHealth(h))
      .catch(() => alive && setHealth(null));
    return () => {
      alive = false;
    };
  }, [reload]);

  const signedIn = Boolean(getToken());
  const title = signedIn ? "My plan" : "Plans";

  if (err) {
    return (
      <div className="wrap wrap-narrow">
        <ErrorCard error={err} onRetry={() => setReload((n) => n + 1)} title="Couldn't load plans." />
      </div>
    );
  }
  if (!d) {
    return (
      <div className="wrap plans">
        <div className="pagehead">
          <h1>{title}</h1>
        </div>
        <Skeleton rows={4} height={240} />
      </div>
    );
  }

  const tiers = [...d.tiers].sort((a, b) => a.price_monthly_cents - b.price_monthly_cents);
  const currentKey = d.current && d.current.key;
  const currentPrice = d.current ? d.current.price_monthly_cents : 0;

  const choose = async (key) => {
    if (!signedIn) {
      navigate(`/signup?next=${encodeURIComponent("/pricing")}`);
      return;
    }
    if (key === currentKey) return;
    setBusy(key);
    setMsg("");
    try {
      if (health && health.dev) {
        await api("/billing/dev/preview", { method: "POST", json: { tier_key: key } });
        setMsg(`Sandbox: moved to ${key}. Billing is disabled on this instance; live checkout activates when Stripe keys are set.`);
        navigate("/settings?billing=success");
      } else if (health && health.configured) {
        const { url } = await api("/billing/checkout", { method: "POST", json: { tier_key: key } });
        window.location.href = url;
        return;
      } else {
        setMsg("Billing is not configured on this instance yet.");
      }
    } catch (e) {
      setMsg(e.detail || String(e.message));
    } finally {
      setBusy(null);
    }
  };

  const action = (t) => {
    const isCurrent = signedIn && t.key === currentKey;
    if (isCurrent) return <span className="chip chip-cal plan-current">My plan</span>;
    const up = t.price_monthly_cents > currentPrice;
    const label = !signedIn ? (t.price_monthly_cents === 0 ? "Start free" : `Start on ${t.label}`) : up ? `Switch me to ${t.label}` : `Move me down to ${t.label}`;
    return (
      <button className={`btn ${up || !signedIn ? "btn-primary" : "btn-secondary"} btn-block`} disabled={busy === t.key} onClick={() => choose(t.key)}>
        {busy === t.key ? "Opening…" : label}
      </button>
    );
  };

  const facts = (t) => [
    ["Price", priceText(t)],
    ["Industries watched", industriesLabel(t.industries_limit)],
    ["Names shown per industry", `top ${t.names_shown_limit}`],
    ["Names watched for you", picksWord(t)],
    ["Alerts", alertsLabel(t.alerts_limit)],
    ["Delivery", deliveryText(t)],
  ];

  return (
    <div className="wrap plans">
      <div className="pagehead plans-head">
        <div>
          <h1>{title}</h1>
          <p className="utility">
            Every plan watches your industries each morning and tells you the day a fact changes. Pay for <b>coverage and delivery</b>, not for
            different numbers.
          </p>
          {beyondLine && (
            <p className="utility plans-beyond">
              In the last {rec.days} days, {beyondLine}
            </p>
          )}
        </div>
      </div>

      {msg && <Notice tone="info">{msg}</Notice>}

      <div className="plans-cards">
        {tiers.map((t) => {
          const isCurrent = signedIn && t.key === currentKey;
          return (
            <div key={t.key} className={`card plan ${isCurrent ? "current" : ""}`} aria-current={isCurrent ? "true" : undefined}>
              <div className="tname">{t.label}</div>
              <p className="tpromise">{promise(t)}</p>
              <div className="tprice">
                {t.price_monthly_cents === 0 ? "$0" : dollars(t.price_monthly_cents)}
                <span className="per"> {t.price_monthly_cents === 0 ? "forever" : "/ month"}</span>
              </div>
              <ul className="tfacts">
                {facts(t).map(([label, value]) => (
                  <li key={label}>
                    <span className="k">{label}</span>
                    <span className="v">{value}</span>
                  </li>
                ))}
              </ul>
              {action(t)}
            </div>
          );
        })}
      </div>
      <p className="plans-fine">A subscription buys coverage and delivery, not advice.</p>

      <div className="section">
        <h2>What a plan changes</h2>
        <p className="section-lead">
          You see the top-rated names in each industry you follow, plus any name you ask it to watch. Watching a name widens what you can see; it
          never changes the report you get. A name outside your universe simply has no report page, the same as a name that doesn't exist.
        </p>
      </div>

      <div className="section card card-sunken">
        <h2>What the record does and does not say</h2>
        <p className="muted" style={{ maxWidth: "68ch", marginBottom: 0 }}>
          {provisionalLine} Fast Mover is the one with a measured record: its must-pass rules hit on {EVIDENCE.hitRate}% of the {EVIDENCE.events}{" "}
          qualifying events tested ({EVIDENCE.hits} of {EVIDENCE.events}), against {EVIDENCE.earningsRate}% for earnings events generally and{" "}
          {EVIDENCE.randomRate}% on a random day. That sample is small and measures movement, not direction or profit.
        </p>
      </div>

      <div className="section faq">
        <h2>Questions</h2>
        <details>
          <summary>What happens when I move to a lower plan?</summary>
          <p>
            The change takes effect at the end of the billing period, never mid-cycle. Watched names above the new limit stay saved but inactive, and
            re-activate if you move back up. Nothing you authored is deleted.
          </p>
        </details>
        <details>
          <summary>Why does a ticker show "No report available"?</summary>
          <p>
            Either it isn't covered, or it isn't in the industries you follow and you haven't asked for it to be watched. The page looks the same in
            both cases on purpose.
          </p>
        </details>
        <details>
          <summary>Do I need to verify my email to browse?</summary>
          <p>
            No. Verification gates delivery, not browsing: your Home works right after signing up, but alerts, digests and paid upgrades wait until
            the link in your inbox is clicked.
          </p>
        </details>
        <details>
          <summary>How does cancellation work?</summary>
          <p>
            Cancel any time from your account. Access continues to the end of the period you've paid for, then the account returns to Free with your
            watched names and settings intact.
          </p>
        </details>
        <details>
          <summary>Is a strong rating a recommendation?</summary>
          <p>
            No. A rating ranks names for a human to review. The rating word and the number describe where a name sits on a fixed scale; they are not
            a probability of success and never a call on direction.
          </p>
        </details>
      </div>

      {health && health.dev && (
        <p className="footnote">Sandbox instance: choosing a plan moves your account directly. Live checkout activates once Stripe keys are configured.</p>
      )}
      {!signedIn && (
        <p className="footnote">
          Already have an account? <Link to="/login?next=%2Fpricing">Log in</Link> to change your plan.
        </p>
      )}
      <FinePrint className="plans-fineprint" />
    </div>
  );
}
