import React, { useEffect, useState } from "react";
import { api, toast } from "../api.js";
import { Link, navigate } from "../lib/router.jsx";
import { useMe } from "../lib/me.jsx";
import { DEFAULT_TRIGGERS, TRIGGER_PLAIN } from "../lib/glossary.js";
import { Modal } from "./ui.jsx";

// One tap to be told about a name. Arms the three default triggers over
// email, the facts a newcomer most wants to hear about. Every refusal from
// the API (unverified email, a plan with no alerts, a plan at its quota)
// opens a short card that says what we would watch and the way out, in
// that order; the price is never the first sentence. Rules are shared
// across every button on the page through one cached request.

let rulesCache = { t: 0, p: null };
const TTL = 30000;

export function loadRules(force = false) {
  const now = Date.now();
  if (!force && rulesCache.p && now - rulesCache.t < TTL) return rulesCache.p;
  rulesCache = { t: now, p: api("/me/alerts/rules").then((d) => d.rules || []).catch(() => []) };
  return rulesCache.p;
}

export function invalidateRules() {
  rulesCache = { t: 0, p: null };
  window.dispatchEvent(new Event("alerts:rules"));
}

export function useRulesFor(symbol, enabled = true) {
  const [rules, setRules] = useState(null);
  useEffect(() => {
    if (!enabled || !symbol) return undefined;
    let alive = true;
    const load = () => loadRules().then((rs) => alive && setRules(rs.filter((r) => r.symbol === symbol)));
    load();
    window.addEventListener("alerts:rules", load);
    return () => {
      alive = false;
      window.removeEventListener("alerts:rules", load);
    };
  }, [symbol, enabled]);
  return rules;
}

function Bell({ on }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M8 1.8a3.9 3.9 0 0 0-3.9 3.9v2.6L2.8 10.6h10.4l-1.3-2.3V5.7A3.9 3.9 0 0 0 8 1.8zM6.4 12.2a1.6 1.6 0 0 0 3.2 0"
        fill={on ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function NotifyButton({ symbol, triggers = DEFAULT_TRIGGERS, label = "Notify me", onLabel = "Notifying", compact = false, className = "" }) {
  const { me } = useMe();
  const rules = useRulesFor(symbol, Boolean(me));
  const [busy, setBusy] = useState(false);
  const [card, setCard] = useState(null); // {kind, message}
  const armedKeys = new Set((rules || []).map((r) => r.trigger_key));
  const on = rules ? triggers.every((k) => armedKeys.has(k)) : false;
  const anyArmed = armedKeys.size > 0;
  const limit = me && me.tier ? me.tier.alerts_limit : null;
  const plainList = triggers.map((k) => (TRIGGER_PLAIN[k] ? TRIGGER_PLAIN[k][0].toLowerCase() : k));

  const arm = async (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (!me) return navigate(`/signup?next=${encodeURIComponent(`/stock/${symbol}`)}`);
    if (on || (anyArmed && rules)) return navigate(`/alerts?symbol=${encodeURIComponent(symbol)}`);
    if (!me.verified) return setCard({ kind: "verify" });
    if (limit === 0) return setCard({ kind: "plan" });
    setBusy(true);
    let armed = 0;
    try {
      for (const k of triggers) {
        if (armedKeys.has(k)) continue;
        // sequential on purpose: the quota is checked server-side per rule
        // eslint-disable-next-line no-await-in-loop
        await api("/me/alerts/rules", { method: "POST", json: { symbol, trigger_key: k, channels: ["email"] } });
        armed += 1;
      }
      toast(`Watching ${symbol}. We'll email you on ${plainList.length} triggers.`);
    } catch (err) {
      if (err.status === 403 && /verify/i.test(err.detail || "")) setCard({ kind: "verify" });
      else if (err.status === 403) setCard({ kind: "quota", message: err.detail, armed });
      else toast(err.detail || "That didn't work. Try again.");
    } finally {
      setBusy(false);
      invalidateRules();
    }
  };

  const cls = `btn ${on ? "btn-secondary" : "btn-primary"} btn-notify ${on ? "on" : ""} ${compact ? "btn-sm" : ""} ${className}`;
  const text = on ? onLabel : anyArmed && rules ? "Manage alerts" : label;
  const title = on
    ? `Alerts on for ${symbol}: ${plainList.join(", ")}. Tap to manage.`
    : `Tell me when ${symbol} has a ${plainList.join(", a ")}.`;

  return (
    <>
      <button type="button" className={cls} aria-pressed={on} title={title} disabled={busy} onClick={arm}>
        <Bell on={on} />
        <span>{busy ? "Setting up…" : text}</span>
      </button>
      {card && card.kind === "verify" && (
        <Modal
          title="Verify your email first"
          onClose={() => setCard(null)}
          actions={
            <Link to="/settings" className="btn btn-primary" onClick={() => setCard(null)}>
              Open account settings
            </Link>
          }
        >
          <p>
            We would watch {symbol} for a {plainList.join(", a ")} and email you the moment one prints. Alerts only go to a verified address.
          </p>
          <p className="muted">Open the link we sent when you signed up, or request a new one from account settings.</p>
        </Modal>
      )}
      {card && card.kind === "plan" && (
        <Modal
          title={`Alerts on ${symbol}`}
          onClose={() => setCard(null)}
          actions={
            <>
              <Link to="/watchlist" className="btn btn-secondary" onClick={() => setCard(null)}>
                Pin it instead
              </Link>
              <Link to="/pricing" className="btn btn-primary" onClick={() => setCard(null)}>
                See plans
              </Link>
            </>
          }
        >
          <p>
            Alerts start on the Basic plan. We would watch {symbol} for a {plainList.join(", a ")} and email you when one prints, with the fact that fired it.
          </p>
          <p className="muted">On the free plan you can pin the name and it stays in view on your Home and Watchlist.</p>
        </Modal>
      )}
      {card && card.kind === "quota" && (
        <Modal
          title="Alert limit reached"
          onClose={() => setCard(null)}
          actions={
            <>
              <Link to="/alerts" className="btn btn-secondary" onClick={() => setCard(null)}>
                Manage alerts
              </Link>
              <Link to="/pricing" className="btn btn-primary" onClick={() => setCard(null)}>
                See plans
              </Link>
            </>
          }
        >
          <p>{card.message || "Your plan's alert limit is reached."}</p>
          {card.armed > 0 && <p className="muted">{card.armed} of {triggers.length} triggers were armed on {symbol} before the limit.</p>}
          <p className="muted">Disarm an alert you no longer need, or move to a plan with more.</p>
        </Modal>
      )}
    </>
  );
}
