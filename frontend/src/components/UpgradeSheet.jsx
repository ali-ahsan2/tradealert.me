import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, getToken, toast } from "../api.js";
import { Link, navigate } from "../lib/router.jsx";
import { useMe } from "../lib/me.jsx";
import { UPGRADE_EVENT } from "../lib/upgrade.js";
import { beyondSentence, fetchRecord } from "../lib/record.js";
import { dollars, plural } from "../lib/fmt.js";
import { CTA } from "../lib/plain.js";
import { Skeleton } from "./ui.jsx";
import FinePrint from "./FinePrint.jsx";
import "./upgrade.css";

// The upgrade sheet (DESIGN_V5 §4.6, §5). Mounted once in the shell; any
// screen opens it with openUpgrade(reason, ctx) and it rises in place. The
// title states the plan fact that stopped the viewer, in their own numbers;
// one sentence says what the next plan would have done with those numbers;
// the plans above theirs follow, one of them preselected; one button goes
// to checkout. Never more than two sentences of pitch, never a ticker the
// plan does not entitle them to, never a return. The plans page stays for
// side-by-side comparison. Downgrades are not offered here at all.

const CHANNEL_LABEL = { email: "email", push: "web push", sms: "SMS", webhook: "signed webhook" };

const unlimited = (n) => n == null || n >= 999;
const lim = (n) => (unlimited(n) ? Infinity : n);
const industriesWord = (n) => (unlimited(n) ? "every industry" : plural(n, "industry", "industries"));
const alertsWord = (n) => (n === 0 ? "no alerts" : unlimited(n) ? "unlimited alerts" : plural(n, "alert"));
const pinsWord = (n) => (unlimited(n) ? "any number of names watched" : `${plural(n, "name")} watched`);
const channelNames = (cs) => (cs || []).map((c) => CHANNEL_LABEL[c] || c);
const andList = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs[0] || "");
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// One line per plan, from its own limits: what it watches and how it tells you.
function whatLine(t) {
  return `Watches ${industriesWord(t.industries_limit)} · top ${t.names_shown_limit} names each · ${pinsWord(t.picks_limit)} · ${alertsWord(t.alerts_limit)} · ${channelNames(t.channels).join(", ")}`;
}

// Whether a plan above the current one actually answers the reason the
// sheet opened for. The ladder is monotonic, so this is usually the next
// tier up; it is not when, say, SMS or a sixth industry starts further up.
function resolves(t, cur, reason, ctx, record, usage) {
  if (!cur) return true;
  switch (reason) {
    case "alerts":
      return lim(t.alerts_limit) > lim(cur.alerts_limit) && lim(t.alerts_limit) > ((usage && usage.alerts_used) || 0);
    case "picks":
      return lim(t.picks_limit) > lim(cur.picks_limit);
    case "industries":
      return lim(t.industries_limit) > lim(cur.industries_limit);
    case "names":
      return lim(t.names_shown_limit) > lim(cur.names_shown_limit);
    case "beyond": {
      const followed = (usage && usage.industries_followed) || 0;
      const more = (record && record.beyond && record.beyond.summary && record.beyond.summary.industries) || 0;
      return lim(t.industries_limit) >= followed + more;
    }
    case "channels":
      return ctx.channel ? (t.channels || []).includes(ctx.channel) : true;
    default:
      return true;
  }
}

// "Web push starts on Basic; SMS on Pro." from the tiers' own channel lists.
function channelsTitle(ctx, cur, tiers) {
  const curPrice = cur ? cur.price_monthly_cents : 0;
  const firstWith = (c) => tiers.find((t) => t.price_monthly_cents > curPrice && (t.channels || []).includes(c));
  if (ctx.channel) {
    const t = firstWith(ctx.channel);
    return t ? `${cap(CHANNEL_LABEL[ctx.channel] || ctx.channel)} starts on ${t.label}.` : null;
  }
  const p = firstWith("push");
  const s = firstWith("sms");
  if (p && s) return p.key === s.key ? `Push and SMS start on ${p.label}.` : `Web push starts on ${p.label}; SMS on ${s.label}.`;
  if (s) return `SMS starts on ${s.label}.`;
  if (p) return `Web push starts on ${p.label}.`;
  return tiers.length ? null : "Push and SMS start on Pro.";
}

// The title: the viewer's own plan fact for the reason, nothing else.
function titleFor(reason, ctx, cur, usage, record, tiers) {
  const u = usage || {};
  if (cur) {
    if (reason === "alerts") {
      const n = cur.alerts_limit;
      if (n === 0) return "Your plan sends no alerts.";
      if (unlimited(n)) return "Your plan sends unlimited alerts.";
      if (u.alerts_used != null && u.alerts_used >= n) return `Your plan sends ${plural(n, "alert")}; you have used them.`;
      if (u.alerts_used != null) return `Your plan sends ${plural(n, "alert")}; you have used ${u.alerts_used}.`;
      return `Your plan sends ${plural(n, "alert")}.`;
    }
    if (reason === "picks") return `Your plan watches ${unlimited(cur.picks_limit) ? "any number of names" : plural(cur.picks_limit, "name")} for you.`;
    if (reason === "industries") return `Your plan watches ${industriesWord(cur.industries_limit)}.`;
    if (reason === "names") return `Your plan lists the top ${cur.names_shown_limit} names per industry.`;
  }
  if (reason === "beyond") {
    const s = beyondSentence(record && record.beyond);
    if (s) return s;
  }
  if (reason === "channels") {
    const s = channelsTitle(ctx, cur, tiers);
    if (s) return s;
  }
  if (cur) return `Your plan watches ${industriesWord(cur.industries_limit)} and sends ${alertsWord(cur.alerts_limit)}.`;
  return "Plans differ in how much we watch for you and how alerts reach you.";
}

// The lede: one sentence on what the selected plan would do, in the
// viewer's own counts. Names and alerts, never "more tickers".
function ledeFor(reason, ctx, cur, usage, record, t) {
  if (!t) return null;
  const u = usage || {};
  const L = t.label;
  const missed = record && record.missed;
  const beyond = record && record.beyond;
  switch (reason) {
    case "alerts": {
      if (missed && missed.summary && missed.summary.fired) {
        return `${L} sends ${alertsWord(t.alerts_limit)}; this month ${plural(missed.summary.fired, "alert")} fired on ${plural(missed.summary.names, "name")} in your industries you were not watching.`;
      }
      return `${L} sends ${alertsWord(t.alerts_limit)} on the names you choose, by ${andList(channelNames(t.channels))}.`;
    }
    case "picks": {
      const n = unlimited(t.picks_limit) ? "any number of names" : plural(t.picks_limit, "name");
      if (ctx.symbol) return `${L} watches ${n} for you, so ${ctx.symbol} would stay in view beside the ${u.picks_used != null ? plural(u.picks_used, "name") : "names"} you already watch.`;
      if (cur && u.picks_used != null) return `${L} watches ${n} for you; you watch ${u.picks_used} of ${cur.picks_limit}.`;
      return `${L} watches ${n} for you.`;
    }
    case "industries": {
      if (beyond && beyond.summary && beyond.summary.fired) {
        return `${L} watches ${industriesWord(t.industries_limit)}; this month ${plural(beyond.summary.fired, "alert")} fired across ${plural(beyond.summary.industries, "industry", "industries")} you don't follow.`;
      }
      if (cur && u.industries_followed != null) return `${L} watches ${industriesWord(t.industries_limit)}; you follow ${u.industries_followed} of ${cur.industries_limit}.`;
      return `${L} watches ${industriesWord(t.industries_limit)}.`;
    }
    case "names": {
      if (missed && missed.names_total > missed.names_shown) {
        return `${L} lists the top ${t.names_shown_limit} names per industry; this month alerts fired on ${plural(missed.names_total, "name")} in your industries and your plan listed ${missed.names_shown}.`;
      }
      return cur ? `${L} lists the top ${t.names_shown_limit} names per industry instead of the top ${cur.names_shown_limit}.` : `${L} lists the top ${t.names_shown_limit} names per industry.`;
    }
    case "beyond": {
      const s = beyond && beyond.summary;
      if (s && s.fired) {
        if (unlimited(t.industries_limit)) {
          return s.fired === 1 ? `${L} watches every industry, so that alert would have been in your industries.` : `${L} watches every industry, so all ${s.fired} of those alerts would have been in your industries.`;
        }
        return `${L} watches ${industriesWord(t.industries_limit)}; you follow ${u.industries_followed != null ? u.industries_followed : "yours"} and those alerts came from ${plural(s.industries, "industry", "industries")} more.`;
      }
      return `${L} watches ${industriesWord(t.industries_limit)}.`;
    }
    case "channels":
      return `${L} delivers the same alerts by ${andList(channelNames(t.channels))}.`;
    default:
      return `${L} watches ${industriesWord(t.industries_limit)}, lists the top ${t.names_shown_limit} names in each, watches ${unlimited(t.picks_limit) ? "any number of names" : plural(t.picks_limit, "name")} for you and sends ${alertsWord(t.alerts_limit)}.`;
  }
}

function CloseGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path d="M4 4l10 10M14 4L4 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export default function UpgradeSheet() {
  const { refresh } = useMe();
  const [open, setOpen] = useState(false);
  const [gen, setGen] = useState(0);
  const [ctx, setCtx] = useState({ reason: "general" });
  const [ent, setEnt] = useState(null);
  const [entErr, setEntErr] = useState(null);
  const [health, setHealth] = useState(null);
  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const box = useRef(null);
  const opener = useRef(null);
  const manual = useRef(false);

  const close = useCallback(() => setOpen(false), []);

  // openUpgrade(reason, ctx) from anywhere
  useEffect(() => {
    const onOpen = (e) => {
      setCtx({ reason: "general", ...((e && e.detail) || {}) });
      manual.current = false;
      setMsg("");
      setGen((n) => n + 1);
      setOpen(true);
    };
    window.addEventListener(UPGRADE_EVENT, onOpen);
    return () => window.removeEventListener(UPGRADE_EVENT, onOpen);
  }, []);

  // Fresh plans, billing state and record on each open; the previous
  // payload stays on screen while they load, so a reopen is instant.
  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    setLoading(true);
    setEntErr(null);
    const signedIn = Boolean(getToken());
    Promise.allSettled([api("/entitlements"), api("/billing/health"), signedIn ? fetchRecord(30) : Promise.resolve(null)]).then(([e, h, r]) => {
      if (!alive) return;
      if (e.status === "fulfilled") setEnt(e.value);
      else setEntErr(e.reason);
      setHealth(h.status === "fulfilled" ? h.value : null);
      if (r.status === "fulfilled") setRecord(r.value);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [open, gen]);

  // Focus trap, Escape and scroll lock, the way Modal does it; focus
  // returns to whatever opened the sheet.
  useEffect(() => {
    if (!open) return undefined;
    opener.current = document.activeElement;
    const el = box.current;
    if (el) el.focus();
    const focusables = () =>
      el ? Array.from(el.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter((n) => !n.disabled) : [];
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== "Tab") return;
      const f = focusables();
      if (f.length === 0) return;
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) {
        e.preventDefault();
        f[f.length - 1].focus();
      } else if (!e.shiftKey && i === f.length - 1) {
        e.preventDefault();
        f[0].focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      const o = opener.current;
      if (o && o.focus && document.contains(o)) o.focus();
    };
  }, [open, close]);

  const tiers = useMemo(() => (ent && ent.tiers ? [...ent.tiers].sort((a, b) => a.price_monthly_cents - b.price_monthly_cents) : []), [ent]);
  const current = ent ? ent.current : null;
  const usage = ent ? ent.usage : null;
  const curPrice = current ? current.price_monthly_cents : 0;
  // only the plans above the current one: the sheet never offers a move down
  const above = useMemo(() => tiers.filter((t) => t.price_monthly_cents > curPrice), [tiers, curPrice]);

  // Preselect the first plan up that answers the reason (usually the next
  // tier); a pick the viewer made by hand is left alone.
  useEffect(() => {
    if (!open || manual.current) return;
    if (!above.length) {
      setPicked(null);
      return;
    }
    const fit = above.find((t) => resolves(t, current, ctx.reason, ctx, record, usage)) || above[0];
    setPicked(fit.key);
  }, [open, gen, above, current, usage, record, ctx]);

  if (!open) return null;

  const reason = ctx.reason;
  const t = above.find((x) => x.key === picked) || null;
  const title = titleFor(reason, ctx, current, usage, record, tiers);
  const lede = ledeFor(reason, ctx, current, usage, record, t);
  const sandbox = Boolean(health && health.dev);
  const onTop = Boolean(ent && above.length === 0);

  const choose = async () => {
    if (!t) return;
    if (!getToken()) {
      close();
      navigate(`/signup?next=${encodeURIComponent("/pricing")}`);
      return;
    }
    setBusy(true);
    setMsg("");
    try {
      if (sandbox) {
        // no-payment tier change on a sandbox instance; the account moves now
        await api("/billing/dev/preview", { method: "POST", json: { tier_key: t.key } });
        toast(`Sandbox: moved to ${t.label}. Billing is disabled on this instance.`);
        refresh();
        window.dispatchEvent(new Event("plan:changed"));
        close();
      } else if (health && health.configured) {
        const { url } = await api("/billing/checkout", { method: "POST", json: { tier_key: t.key } });
        window.location.href = url;
        return;
      } else {
        setMsg("Billing is not set up on this instance yet, so your plan is unchanged.");
      }
    } catch (e) {
      if (e && e.status === 503) setMsg("Checkout is not available on this instance yet; your plan is unchanged.");
      else setMsg((e && e.detail) || "That didn't work; your plan is unchanged.");
    } finally {
      setBusy(false);
    }
  };

  return (
    // Clicks must not bubble past the sheet: it can open from inside a
    // clickable row, and the row must not navigate when the sheet is used.
    <div className="sheet-backdrop" onMouseDown={close} onClick={(e) => e.stopPropagation()}>
      <div
        className="sheet upsheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="upsheet-title"
        aria-busy={loading}
        ref={box}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button type="button" className="sheet-x" aria-label="Close" onClick={close}>
          <CloseGlyph />
        </button>
        <h2 id="upsheet-title">{title}</h2>
        {lede && <p className="lede">{lede}</p>}

        {loading && !ent && <Skeleton rows={2} height={60} className="sheet-sk" />}
        {entErr && !ent && (
          <p className="lede">
            Couldn't load the plans.{" "}
            <Link to="/pricing" onClick={close}>
              {CTA.SHOW_PLANS}
            </Link>
            .
          </p>
        )}

        {above.length > 0 && (
          <div className="plans" role="group" aria-label="Plans">
            {above.map((p) => (
              <button
                type="button"
                key={p.key}
                className="plan-row"
                aria-pressed={picked === p.key}
                onClick={() => {
                  manual.current = true;
                  setPicked(p.key);
                }}
              >
                <span className="pmain">
                  <span className="pname">{p.label}</span>
                  <span className="pwhat">{whatLine(p)}</span>
                </span>
                <span className="pprice">{dollars(p.price_monthly_cents)}/mo</span>
              </button>
            ))}
          </div>
        )}
        {onTop && <p className="lede">You are on the top plan; there is nothing above it to move to.</p>}

        <div className="acts">
          <button type="button" className="btn btn-primary" disabled={busy || !t} onClick={choose}>
            {busy ? "Opening…" : !getToken() && t ? CTA.START_ON(t.label) : sandbox ? CTA.SWITCH_NOW : CTA.CHECKOUT}
          </button>
          <Link to="/pricing" className="btn btn-secondary" onClick={close}>
            {CTA.SHOW_PLANS}
          </Link>
        </div>
        {msg && (
          <p className="sheet-msg" role="status">
            {msg}
          </p>
        )}
        <p className="fine">Ends any time; changes take effect at the end of the period.</p>
        <FinePrint short links={false} className="fine" />
      </div>
    </div>
  );
}
