import React, { useEffect, useRef, useState } from "react";
import { api, toast } from "../api.js";
import { Link, navigate } from "../lib/router.jsx";
import { useMe } from "../lib/me.jsx";
import { openUpgrade } from "../lib/upgrade.js";
import { DEFAULT_TRIGGERS, TRIGGER_PLAIN } from "../lib/glossary.js";
import { CTA } from "../lib/plain.js";
import { Modal } from "./ui.jsx";

// One tap to be told about a name ("Alert me"). Turns on the three default
// facts over email, the ones a newcomer most wants to hear about. The bell
// fills the moment it is tapped (DESIGN_V5 §5) and goes back, with a card or
// a toast that names the way out, if the API refuses. Once any alert is on
// for the name the button reads "Alerting me" and opens the name's alerts;
// `manage` renders that state as the quiet "My alerts" link the Alerts
// screen uses beside its own list (DESIGN_V6 §2 vocabulary, lib/plain CTA). Every refusal (unverified
// email, a plan with no alerts, a plan at its quota) opens a short card
// that says what we would watch and the way out, in that order; the price
// is never the first sentence, and the paid way out opens the upgrade
// sheet in place. Rules are shared across every button on the page through
// one cached request.

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

export default function NotifyButton({ symbol, triggers = DEFAULT_TRIGGERS, label = CTA.ALERT_ME, onLabel = CTA.ALERTING, manage = false, compact = false, className = "" }) {
  const { me } = useMe();
  const rules = useRulesFor(symbol, Boolean(me));
  const inflight = useRef(false);
  // optimistic: on from the tap until the shared rules confirm or refuse it
  const [assumed, setAssumed] = useState(false);
  const [card, setCard] = useState(null); // {kind, message}
  const armedKeys = new Set((rules || []).map((r) => r.trigger_key));
  const confirmed = rules ? triggers.every((k) => armedKeys.has(k)) : false;
  const on = confirmed || assumed;
  const anyArmed = armedKeys.size > 0;
  const limit = me && me.tier ? me.tier.alerts_limit : null;
  const plainList = triggers.map((k) => (TRIGGER_PLAIN[k] ? TRIGGER_PLAIN[k][0].toLowerCase() : k));

  useEffect(() => {
    if (confirmed) setAssumed(false);
  }, [confirmed]);

  const arm = async (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (!me) return navigate(`/signup?next=${encodeURIComponent(`/stock/${symbol}`)}`);
    if (inflight.current) return undefined;
    if (on || (anyArmed && rules)) return navigate(`/alerts?symbol=${encodeURIComponent(symbol)}`);
    if (!me.verified) return setCard({ kind: "verify" });
    if (limit === 0) return setCard({ kind: "plan" });
    inflight.current = true;
    setAssumed(true);
    let armed = 0;
    try {
      for (const k of triggers) {
        if (armedKeys.has(k)) continue;
        // sequential on purpose: the quota is checked server-side per rule
        // eslint-disable-next-line no-await-in-loop
        await api("/me/alerts/rules", { method: "POST", json: { symbol, trigger_key: k, channels: ["email"] } });
        armed += 1;
      }
      toast(`Alerts on for ${symbol}: we'll email you on ${plainList.length} facts.`);
    } catch (err) {
      // roll back to what the server holds; the shared rules reload below
      setAssumed(false);
      if (err.status === 403 && /verify/i.test(err.detail || "")) setCard({ kind: "verify" });
      else if (err.status === 403) setCard({ kind: "quota", message: err.detail, armed });
      else if (err.status === 0) toast(`Alerts on ${symbol} were not set: you appear to be offline. Check your connection and tap again.`);
      else toast(`${err.detail || `Couldn't set alerts on ${symbol}.`} Tap again to retry.`);
    } finally {
      inflight.current = false;
      invalidateRules();
    }
    return undefined;
  };

  // In a list the button is quiet (tinted) so forty rows do not shout; as a
  // dossier's primary action it is the filled accent.
  // any alert on for the name reads as "Alerting me"; the exact facts are in
  // the title and one tap away on the name's alerts
  const lit = on || (anyArmed && Boolean(rules));
  const cls = `btn ${lit || compact ? "btn-secondary" : "btn-primary"} btn-notify ${lit ? "on" : ""} ${compact ? "btn-sm" : ""} ${className}`;
  const text = lit ? (manage && !on ? CTA.MY_ALERTS : onLabel) : label;
  const armedPlain = [...armedKeys].map((k) => (TRIGGER_PLAIN[k] ? TRIGGER_PLAIN[k][0].toLowerCase() : k));
  const title = lit
    ? `Alerts on for ${symbol}: ${(on ? plainList : armedPlain).join(", ")}. Tap to change them.`
    : `Tell me when ${symbol} has a ${plainList.join(", a ")}.`;

  const seePlans = (reason) => {
    setCard(null);
    openUpgrade(reason, { symbol });
  };

  return (
    <>
      <button type="button" className={cls} aria-pressed={lit} title={title} onClick={arm}>
        <Bell on={lit} />
        <span>{text}</span>
      </button>
      {card && card.kind === "verify" && (
        <Modal
          title="Verify your email first"
          onClose={() => setCard(null)}
          actions={
            <Link to="/settings" className="btn btn-primary" onClick={() => setCard(null)}>
              Open my account
            </Link>
          }
        >
          <p>
            We would watch {symbol} for a {plainList.join(", a ")} and email you the moment one prints. Alerts only go to a verified address.
          </p>
          <p className="muted">Open the link we sent when you signed up, or request a new one from My account.</p>
        </Modal>
      )}
      {card && card.kind === "plan" && (
        <Modal
          title={`Alerts on ${symbol}`}
          onClose={() => setCard(null)}
          actions={
            <>
              <Link to="/watchlist" className="btn btn-secondary" onClick={() => setCard(null)}>
                Watch it for me instead
              </Link>
              <button type="button" className="btn btn-primary" onClick={() => seePlans("alerts")}>
                {CTA.PLANS_WITH_ALERTS}
              </button>
            </>
          }
        >
          <p>
            Alerts start on the Basic plan. We would watch {symbol} for a {plainList.join(", a ")} and email you when one prints, with the fact that fired it.
          </p>
          <p className="muted">On the free plan you can watch the name and it stays in view on your Home and My watchlist.</p>
        </Modal>
      )}
      {card && card.kind === "quota" && (
        <Modal
          title="Alert limit reached"
          onClose={() => setCard(null)}
          actions={
            <>
              <Link to="/alerts" className="btn btn-secondary" onClick={() => setCard(null)}>
                {CTA.MY_ALERTS}
              </Link>
              <button type="button" className="btn btn-primary" onClick={() => seePlans("alerts")}>
                {CTA.NEXT_PLAN}
              </button>
            </>
          }
        >
          <p>{card.message || "Your plan's alert limit is reached."}</p>
          {card.armed > 0 && <p className="muted">{card.armed} of {triggers.length} facts were turned on for {symbol} before the limit.</p>}
          <p className="muted">Turn off an alert you no longer need, or move to a plan that can watch this name as well.</p>
        </Modal>
      )}
    </>
  );
}
