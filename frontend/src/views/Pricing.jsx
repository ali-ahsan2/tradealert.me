import React, { useEffect, useState } from "react";
import { api, getToken } from "../api.js";
import { navigate } from "../main.jsx";

const CHANNEL_LABEL = {
  email: "Email",
  push: "Push",
  sms: "SMS",
  webhook: "Webhook",
};

export default function Pricing({ notice }) {
  const [d, setD] = useState(null);
  const [health, setHealth] = useState(null);
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(notice || "");

  useEffect(() => {
    api("/entitlements")
      .then(setD)
      .catch(() => setD(null));
    api("/billing/health")
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  if (!d) return <div className="wrap"><div className="table-card empty">Loading…</div></div>;

  const currentKey = d.current?.key;

  const choose = async (key) => {
    if (!getToken()) {
      navigate("/login");
      return;
    }
    if (key === currentKey) return;
    setBusy(key);
    setMsg("");
    try {
      if (health && health.dev) {
        await api("/billing/dev/preview", { method: "POST", json: { tier_key: key } });
        setMsg(`Sandbox preview: moved to ${key}. Billing is disabled here; live checkout activates when Stripe keys are set.`);
      } else if (health && health.configured) {
        const { url } = await api("/billing/checkout", { method: "POST", json: { tier_key: key } });
        window.location.href = url;
        return;
      } else {
        setMsg("Billing is not configured on this instance. Ask the operator to set STRIPE_SECRET_KEY.");
      }
    } catch (e) {
      setMsg(e.detail || String(e.message));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="wrap">
      <div className="pagehead">
        <h1>Plans</h1>
        <div className="meta">Board scope, watchlist size, alert volume, and channels.</div>
      </div>
      {msg && <p className="note" role="status">{msg}</p>}
      <div className="tiergrid">
        {d.tiers.map((t) => {
          const isCurrent = t.key === currentKey;
          return (
            <div key={t.key} className={`tier ${isCurrent ? "current" : ""}`}>
              <div className="tname">{t.label}</div>
              <div className="tprice">
                {t.price_monthly_cents === 0
                  ? "$0"
                  : `$${(t.price_monthly_cents / 100).toFixed(0)}`}
                <span className="per">/month</span>
              </div>
              <ul className="tfeats">
                <li>{t.industries_limit >= 999 ? "All industries" : `${t.industries_limit} industr${t.industries_limit === 1 ? "y" : "ies"}`}</li>
                <li>{t.names_shown_limit} tickers on the board</li>
                <li>{t.picks_limit} pinned</li>
                <li>{t.alerts_limit === 0 ? "No alerts" : t.alerts_limit == null ? "Unlimited alerts" : `${t.alerts_limit} alerts`}</li>
                <li>Channels {t.channels.map((c) => CHANNEL_LABEL[c] || c).join(" · ")}</li>
              </ul>
              {isCurrent ? (
                <span className="tag">Current plan</span>
              ) : (
                <button
                  className="btn btn-primary"
                  disabled={busy === t.key}
                  onClick={() => choose(t.key)}
                  style={{ width: "100%" }}
                >
                  {busy === t.key ? "…" : getToken() ? "Choose" : "Sign in to choose"}
                </button>
              )}
            </div>
          );
        })}
      </div>
      <p className="st" style={{ color: "var(--ink-faint)", fontSize: "var(--fs-sm)" }}>
        Revenue-grade checkout activates at deploy when Stripe keys are set; until then the
        sandbox preview moves your plan directly.
      </p>
    </div>
  );
}