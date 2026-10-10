import React, { useEffect, useState } from "react";
import { api, cached, getToken } from "../api.js";
import { Link, navigate, useQuery } from "../lib/router.jsx";
import { alertsLabel, dollars, industriesLabel, plural } from "../lib/fmt.js";
import { EVIDENCE } from "../lib/evidence.js";
import { ErrorCard, Notice, Skeleton } from "../components/ui.jsx";

const CHANNEL_LABEL = { email: "email", push: "web push", sms: "SMS", webhook: "signed webhook" };

function deliveryText(t) {
  return t.channels.map((c) => CHANNEL_LABEL[c] || c).join(" · ");
}


// One sentence per plan saying what you would be told, built from the plan's
// own limits. Utility first; the price is a number next to it.
function utilityText(t) {
  const ind = t.industries_limit >= 999 ? "every industry" : `${t.industries_limit} ${t.industries_limit === 1 ? "industry" : "industries"}`;
  const names = `the top ${t.names_shown_limit} names each morning`;
  const pins = t.picks_limit >= 999 ? "unlimited pins" : `${t.picks_limit} ${t.picks_limit === 1 ? "pin" : "pins"}`;
  const alerts =
    t.alerts_limit === 0
      ? "no alerts, so you check in yourself"
      : t.alerts_limit == null || t.alerts_limit >= 999
        ? "unlimited alerts"
        : `${t.alerts_limit} ${t.alerts_limit === 1 ? "alert" : "alerts"}`;
  const chans = (t.channels || []).map((c) => CHANNEL_LABEL[c] || c);
  const how = t.alerts_limit === 0 ? "" : ` We tell you the same day a catalyst is dated, a borrow fee doubles or volume prints 3x on a name you watch${chans.length > 1 ? `, by ${chans.join(", ")}` : ""}.`;
  return `We watch ${ind} for you and explain ${names}, with ${pins} and ${alerts}.${how}`;
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
    if (!strats || !strats.length) return "Most strategies are provisional.";
    const prov = strats.filter((x) => !x.calibrated).length;
    if (prov === 0) return "Every strategy is calibrated.";
    return `${prov} of the ${strats.length} strategies ${prov === 1 ? "is" : "are"} provisional.`;
  })();

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

  if (err) {
    return (
      <div className="wrap wrap-narrow">
        <ErrorCard error={err} onRetry={() => setReload((n) => n + 1)} title="Couldn't load plans." />
      </div>
    );
  }
  if (!d) {
    return (
      <div className="wrap">
        <div className="pagehead">
          <h1>Plans</h1>
        </div>
        <Skeleton rows={6} height={48} />
      </div>
    );
  }

  const tiers = [...d.tiers].sort((a, b) => a.price_monthly_cents - b.price_monthly_cents);
  const currentKey = d.current && d.current.key;
  const currentPrice = d.current ? d.current.price_monthly_cents : 0;

  const choose = async (key) => {
    if (!getToken()) {
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
    const isCurrent = t.key === currentKey;
    if (isCurrent) return <span className="chip chip-cal">Your plan</span>;
    const up = t.price_monthly_cents > currentPrice;
    const label = !getToken()
      ? t.price_monthly_cents === 0
        ? "Start free"
        : `Start on ${t.label}`
      : up
        ? `Switch to ${t.label}`
        : `Move down to ${t.label}`;
    return (
      <button
        className={`btn ${up || !getToken() ? "btn-primary" : "btn-secondary"} btn-sm btn-block`}
        disabled={busy === t.key}
        onClick={() => choose(t.key)}
      >
        {busy === t.key ? "Opening…" : label}
      </button>
    );
  };

  const rows = [
    ["Price", (t) => (t.price_monthly_cents === 0 ? "$0" : `${dollars(t.price_monthly_cents)}/mo`)],
    ["Industries followed", (t) => industriesLabel(t.industries_limit)],
    ["Names shown per industry", (t) => `top ${t.names_shown_limit}`],
    ["Pinned names", (t) => plural(t.picks_limit, "pin")],
    ["Alerts", (t) => alertsLabel(t.alerts_limit)],
    ["Delivery", (t) => deliveryText(t)],
  ];

  return (
    <div className="wrap">
      <div className="pagehead">
        <div>
          <h1>Plans</h1>
          <div className="meta">
            Every plan sees the same scores and the same reports. Plans differ only in how much of the
            universe you follow, how many names you pin, and how alerts reach you.
          </div>
        </div>
      </div>

      {msg && <Notice tone="info">{msg}</Notice>}

      <div className="table-card plans-desktop">
        <table className="plans-table">
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">Feature</span>
              </th>
              {tiers.map((t) => (
                <th key={t.key} scope="col" className={`tcol ${t.key === "pro" ? "popular" : ""}`}>
                  <div className="tname">{t.label}</div>
                  <div className="tprice">
                    {t.price_monthly_cents === 0 ? "$0" : dollars(t.price_monthly_cents)}
                    <span className="per"> /month</span>
                  </div>
                  <p className="tutil">{utilityText(t)}</p>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, fn]) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                {tiers.map((t) => (
                  <td key={t.key} className={`tcol ${t.key === "pro" ? "popular" : ""}`}>
                    {fn(t)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td />
              {tiers.map((t) => (
                <td key={t.key} className={`tcol ${t.key === "pro" ? "popular" : ""}`}>
                  {action(t)}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="plans-cards plans-mobile">
        {tiers.map((t) => (
          <div key={t.key} className={`card plan ${t.key === "pro" ? "popular" : ""}`}>
            <div className="tname">{t.label}</div>
            <div className="tprice">
              {t.price_monthly_cents === 0 ? "$0" : dollars(t.price_monthly_cents)}
              <span className="per"> /month</span>
            </div>
            <p className="tutil">{utilityText(t)}</p>
            <dl>
              {rows.slice(1).map(([label, fn]) => (
                <React.Fragment key={label}>
                  <dt>{label}</dt>
                  <dd>{fn(t)}</dd>
                </React.Fragment>
              ))}
            </dl>
            {action(t)}
          </div>
        ))}
      </div>

      <div className="section">
        <h2>How visibility works</h2>
        <p className="section-lead">
          You see the top-ranked names in each industry you follow, plus any name you pin. Pinning a
          name widens what you can see; it never changes the report you get. A name outside your
          universe simply has no report page, the same as a name that doesn't exist.
        </p>
      </div>

      <div className="section card card-sunken">
        <h2>What the evidence does and does not say</h2>
        <p className="muted" style={{ maxWidth: "68ch", marginBottom: 0 }}>
          {provisionalLine} Fast Mover is the one that has been
          backtested: its hard filters hit on {EVIDENCE.hitRate}% of the {EVIDENCE.events} qualifying
          events tested ({EVIDENCE.hits} of {EVIDENCE.events}), against {EVIDENCE.earningsRate}% for
          earnings events generally and {EVIDENCE.randomRate}% on a random day. That sample is small
          and measures movement, not direction or profit.
        </p>
      </div>

      <div className="section faq">
        <h2>Questions</h2>
        <details>
          <summary>What happens when I move to a lower plan?</summary>
          <p>
            The change takes effect at the end of the billing period, never mid-cycle. Pinned names
            above the new limit stay saved but inactive, and re-activate if you move back up. Nothing
            you authored is deleted.
          </p>
        </details>
        <details>
          <summary>Why does a ticker show "No report available"?</summary>
          <p>
            Either it isn't covered, or it isn't in the industries you follow and you haven't pinned
            it. The page looks the same in both cases on purpose.
          </p>
        </details>
        <details>
          <summary>Do I need to verify my email to browse?</summary>
          <p>
            No. Verification gates delivery, not browsing: you can read your Board right after signing
            up, but alerts, digests and paid upgrades wait until the link in your inbox is clicked.
          </p>
        </details>
        <details>
          <summary>How does cancellation work?</summary>
          <p>
            Cancel any time from your account. Access continues to the end of the period you've paid
            for, then the account returns to Free with your pins and settings intact.
          </p>
        </details>
        <details>
          <summary>Is a strong score a recommendation?</summary>
          <p>
            No. A score ranks names for a human to review. Bands and numbers describe where a name
            sits on a fixed scale; they are not a probability of success and never a call on
            direction.
          </p>
        </details>
      </div>

      {health && health.dev && (
        <p className="footnote">
          Sandbox instance: choosing a plan moves your account directly. Live checkout activates once
          Stripe keys are configured.
        </p>
      )}
      {!getToken() && (
        <p className="footnote">
          Already have an account? <Link to="/login?next=%2Fpricing">Log in</Link> to change your plan.
        </p>
      )}
    </div>
  );
}
