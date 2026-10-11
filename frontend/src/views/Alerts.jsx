import React, { useEffect, useMemo, useRef, useState } from "react";
import { api, cached, toast } from "../api.js";
import { Link, navigate, useQuery } from "../lib/router.jsx";
import { hasChannel, useMe } from "../lib/me.jsx";
import { age, dateTime, dollars, pct, plural, rate, shortDate, signed, tone } from "../lib/fmt.js";
import { DILUTION_TRIGGERS, TRIGGERS } from "../lib/evidence.js";
import { DEFAULT_TRIGGERS, GLOSSARY } from "../lib/glossary.js";
import { CTA, triggerLabel, triggerSentence } from "../lib/plain.js";
import { HOME_ROWS } from "../lib/caps.js";
import { useMode } from "../lib/mode.js";
import { beyondSentence, fetchRecord, leadPhrase, movePhrase, tallySentence } from "../lib/record.js";
import { openUpgrade } from "../lib/upgrade.js";
import SearchBar from "../components/SearchBar.jsx";
import NotifyButton, { invalidateRules } from "../components/NotifyButton.jsx";
import Explain from "../components/Explain.jsx";
import ScreenHead from "../components/ScreenHead.jsx";
import FinePrint from "../components/FinePrint.jsx";
import { Empty, ErrorCard, Notice, Skeleton } from "../components/ui.jsx";
import "./tools.css";

// Alerts in plain words. An alert is a fact that printed on a name you asked
// us to watch; this screen lists those facts, lets you choose which facts to
// be told about, and shows what price did after each kind of fact, measured
// on daily bars and only as a rate once ten cases exist. Simple mode reads
// without any trading vocabulary; Full keeps every filter, channel control
// and column.

const CHANNELS = [
  ["email", "Email"],
  ["push", "Web push"],
  ["sms", "SMS"],
  ["webhook", "Webhook"],
];

// Fabricated placeholder for the Free-tier lock screen. Never a real name.
const SAMPLE_EVENTS = [
  {
    id: -1,
    symbol: "EXMPL",
    theme: "Example only",
    trigger_key: "borrow_fee_2x",
    trigger: "Borrow fee 2x+",
    detail: "Cost to borrow 2.4x its recent average (was 12.1%, now 29.4%)",
    fired_at: new Date(Date.now() - 36e5 * 5).toISOString(),
    channels: ["email"],
    read: true,
  },
  {
    id: -2,
    symbol: "EXMPL",
    theme: "Example only",
    trigger_key: "volume_3x",
    trigger: "Volume at 3x+",
    detail: "Volume 3.6x its normal day by midday",
    fired_at: new Date(Date.now() - 36e5 * 30).toISOString(),
    channels: ["email"],
    read: true,
  },
];

const EVENT_LIMIT = 100;
// Industry-wide events (names the subscriber was not watching) reveal this
// many at a time under the fold.
const OTHERS_PAGE = 20;

// An event was sent to this subscriber when a delivery exists for it; the
// rest fired across their industries on names they had not armed.
function wasSent(ev) {
  return Boolean(ev.channels && ev.channels.length);
}

// Put the cursor in the ticker field of the arm form.
function focusSymbol() {
  const el = document.getElementById("al-symbol");
  if (!el) return;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  el.focus({ preventScroll: true });
}

function buildQuery(params) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== "" && v != null && v !== false) qs.set(k, String(v));
  });
  const s = qs.toString();
  return s ? `?${s}` : "";
}

function windowWord(days) {
  if (days === 365) return "year";
  if (days === 730) return "two years";
  return `${days} days`;
}

// "this year" / "in 90 days": the window as a screen-head clause.
function windowClause(days) {
  if (days === 365) return "this year";
  if (days === 730) return "in two years";
  return `in ${days} days`;
}

function channelWord(k) {
  const c = CHANNELS.find((x) => x[0] === k);
  return c ? c[1].toLowerCase() : k;
}

// The event card: the trigger's plain label is the title, the fact the
// engine recorded is the body. Unread is a dot plus bold, never colour
// alone. A dilution filing carries a small warn-toned "red flag" chip; red
// and green stay reserved for price moves and PASS/FAIL. Full mode adds the
// raw trigger label, the theme and the delivery record.
const DILUTION_NOTE =
  "The company filed to sell more shares (an S-3 or 424B). More shares means each existing share is a smaller slice; the filing fires an alert.";

function PlainEvent({ ev, tz, onRead, full = false }) {
  const unread = ev.read === false;
  const a = age(ev.fired_at);
  const dilution = DILUTION_TRIGGERS.has(ev.trigger_key);
  const sent = wasSent(ev);
  const markRead = () => {
    if (!unread || !ev.id) return;
    api("/me/alerts/read", { method: "POST", json: { event_id: ev.id } })
      .then(() => onRead && onRead(ev.id))
      .catch(() => {});
  };
  return (
    <article className={`card alert tl-ev ${unread ? "unread" : ""}`}>
      <div className="r1">
        {unread && <span className="unread-dot" aria-label="Unread" />}
        <Link className="sym" to={`/stock/${ev.symbol}`} onClick={markRead}>
          {ev.symbol}
        </Link>
        <span className="tl-title">{full ? ev.trigger : triggerLabel(ev.trigger_key) || ev.trigger}</span>
        {dilution && (
          <Explain text={DILUTION_NOTE} title="Red flag: dilution filing" className="tl-xchip">
            <span className="chip tl-flag">Red flag</span>
          </Explain>
        )}
        <span className="when" title={dateTime(ev.fired_at, tz)}>
          {a ? `${a.label} ago` : shortDate(ev.fired_at, tz)}
        </span>
      </div>
      <div className={`r2 ${unread ? "bold" : ""}`}>{triggerSentence(ev.trigger_key, ev.symbol)}</div>
      {full && ev.detail && <div className="r3">{ev.detail}</div>}
      {full && (
        <div className="r3">
          {ev.theme ? `${ev.theme} · ` : ""}
          {sent
            ? `delivered by ${ev.channels.join(", ")}${ev.delivered_at ? ` · ${shortDate(ev.delivered_at, tz)}` : ""}`
            : "no rule armed on your account; shown because the name is in your industries"}
        </div>
      )}
      <div className="r4">
        <Link to={`/stock/${ev.symbol}`} onClick={markRead}>
          {CTA.REPORT} →
        </Link>
        {unread && (
          <button className="btn-quiet" onClick={markRead}>
            Mark read
          </button>
        )}
        {!sent && (
          <Link to={`/alerts?tab=armed&symbol=${encodeURIComponent(ev.symbol)}`} className="faint">
            {CTA.ALERT_ME_ON(ev.symbol)}
          </Link>
        )}
        {!full && (
          <span className="xs faint">
            {sent ? `sent to you by ${ev.channels.map(channelWord).join(", ")}` : `you were not watching ${ev.symbol}; shown because it is in your industries`}
          </span>
        )}
      </div>
    </article>
  );
}

// A link that opens the upgrade sheet in place instead of leaving for the
// plans page (DESIGN_V5 §4.6).
function PlanLink({ reason, ctx, children }) {
  return (
    <button type="button" className="tl-linkbtn" onClick={() => openUpgrade(reason, ctx)}>
      {children}
    </button>
  );
}

// The move after an alert; red and green on the price numbers only.
function MoveWords({ e }) {
  if (!e || e.max_5d == null) return <>{movePhrase(e)}</>;
  return (
    <>
      <span className={`num ${tone(e.max_5d)}`}>{pct(e.max_5d)}</span> at the high within five sessions
      {e.chg_5d != null && (
        <>
          , closed <span className={`num ${tone(e.chg_5d)}`}>{pct(e.chg_5d)}</span>
        </>
      )}
    </>
  );
}

// "You were told 1 session before LEU peaked +13.5%." The biggest measured
// move among the alerts delivered to this account; pct() carries the sign.
function toldLine(told) {
  if (!told || !told.summary || !told.summary.fired) return null;
  const best = (told.events || []).filter((e) => e.max_5d != null).sort((a, b) => b.max_5d - a.max_5d)[0];
  if (!best) return `You were told about ${plural(told.summary.fired, "alert")}; the five-session windows are still open.`;
  const lead = best.peak_after_sessions ? ` ${plural(best.peak_after_sessions, "session")} before` : "";
  return `You were told${lead} ${best.symbol} peaked ${pct(best.max_5d)}.`;
}

// The trigger in plain words where the glossary has them, else as recorded.
function plainTrigger(e, simple) {
  const l = triggerLabel(e.trigger_key);
  return simple && l !== e.trigger_key ? l : e.trigger;
}

// The subscriber's own record (DESIGN_V5 §3): what they were told and what
// followed, what fired on names in their universe while they were not
// watching (tickers clamped to the plan, the rest counted), and what fired
// beyond the industries they follow, as counts only. Every line is a
// recorded fact; the one button opens the upgrade sheet in place.
function RecordBlock({ rec, allIndTier, simple }) {
  if (rec === undefined) return <Skeleton rows={2} height={44} />;
  if (!rec) return null;
  const told = rec.told || { summary: null, events: [] };
  const missed = rec.missed || { summary: null, events: [] };
  const headline = toldLine(told) || `Nothing was sent to you in the last ${rec.days} days.`;
  const rows = [];
  const seen = new Set();
  const cap = simple ? HOME_ROWS : 5;
  for (const e of missed.events || []) {
    if (seen.has(e.symbol)) continue;
    seen.add(e.symbol);
    rows.push(e);
    if (rows.length === cap) break;
  }
  const hiddenNames = Math.max(0, (missed.names_total || 0) - (missed.names_shown || 0));
  const beyondLine = beyondSentence(rec.beyond);
  return (
    <section className="card tl-rec" aria-labelledby="rec-h">
      <div className="card-title">
        <h2 id="rec-h">My record</h2>
        <span className="muted small">last {rec.days} days</span>
      </div>
      <p className="tl-rec-h">{headline}</p>
      {told.summary && told.summary.fired > 0 && <p className="tl-rec-sub">{tallySentence(told.summary, { subject: "alerts you were told about" })}</p>}

      <h3 className="tl-rec-sec">Fired while you were not watching</h3>
      <p className="tl-rec-sub">{tallySentence(missed.summary)}</p>
      {rows.length > 0 && (
        <div className="tl-rec-rows">
          {rows.map((e) => {
            const lead = leadPhrase(e);
            return (
              <div className="rec-row" key={`${e.symbol}-${e.trigger_key}-${e.date}`}>
                <div className="rec-main">
                  <div className="rec-top">
                    <Link className="sym" to={`/stock/${e.symbol}`}>
                      {e.symbol}
                    </Link>
                    <span className="when">
                      {plainTrigger(e, simple)} · {shortDate(e.date)}
                    </span>
                    {lead && <span className={`lead-chip ${e.pending ? "open" : ""}`}>{lead}</span>}
                  </div>
                  <p className="rec-say">
                    <MoveWords e={e} />
                  </p>
                </div>
                <div className="rec-act">
                  <NotifyButton symbol={e.symbol} compact />
                </div>
              </div>
            );
          })}
        </div>
      )}
      {hiddenNames > 0 && (
        <p className="tl-rec-sub tl-rec-more">
          Alerts fired on {plural(hiddenNames, "more name")} than your plan lists. <PlanLink reason="names">Show me the rest</PlanLink>
        </p>
      )}
      {beyondLine && (
        <>
          <h3 className="tl-rec-sec">Beyond the industries you follow</h3>
          <p className="tl-rec-sub">{beyondLine}</p>
          <button type="button" className="btn-quiet tl-rec-btn" onClick={() => openUpgrade("beyond")}>
            See what {allIndTier ? allIndTier.label : "Investor"} watches
          </button>
        </>
      )}
      {rec.method && <p className="hint">{rec.method}</p>}
    </section>
  );
}

export default function Alerts() {
  const { me } = useMe();
  const { simple, full } = useMode();
  const q = useQuery();
  const fTrigger = q.get("trigger") || "";
  const fSymbol = (q.get("symbol") || "").toUpperCase();
  const fUnread = q.get("unread") === "1";
  const fDays = Number(q.get("days") || 365);
  const tabParam = q.get("tab");
  // "?symbol=XYZ" on its own is a request to set alerts up on XYZ (that is
  // what every Notify button links to); with a filter beside it, it narrows
  // the history instead.
  const tab =
    tabParam === "armed" || tabParam === "outcomes" || tabParam === "history"
      ? tabParam
      : fSymbol && !fUnread && !fTrigger
        ? "armed"
        : "history";
  const hasFilters = Boolean(fTrigger || fSymbol || fUnread);

  const [events, setEvents] = useState(null);
  const [rules, setRules] = useState(null);
  const [tiers, setTiers] = useState(null);
  const [picks, setPicks] = useState(null);
  const [err, setErr] = useState(null);
  const [reload, setReload] = useState(0);
  const [symbol, setSymbol] = useState(fSymbol);
  const [picked, setPicked] = useState(new Set(DEFAULT_TRIGGERS));
  const [channels, setChannels] = useState(["email"]);
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState(null); // {kind, text}
  const [outcomes, setOutcomes] = useState(null);
  const [outErr, setOutErr] = useState(null);
  // undefined while loading, null when it could not be loaded
  const [record, setRecord] = useState(undefined);
  // Simple shows three recent outcomes before "Show all" (DESIGN_V6 §7)
  const [allRecent, setAllRecent] = useState(false);
  const formRef = useRef(null);
  const oDays = [90, 365, 730].includes(Number(q.get("odays"))) ? Number(q.get("odays")) : 365;

  const locked = Boolean(me && me.tier && me.tier.alerts_limit === 0);
  const signedIn = Boolean(me);

  // The subscriber's own record: the top of "Your record" / Outcomes, and
  // the lead of the Free-plan lock screen.
  useEffect(() => {
    if (!signedIn || (tab !== "outcomes" && !locked)) return undefined;
    let alive = true;
    fetchRecord(90)
      .then((d) => alive && setRecord(d))
      .catch(() => alive && setRecord(null));
    return () => {
      alive = false;
    };
  }, [signedIn, tab, locked, reload]);

  useEffect(() => {
    if (tab !== "outcomes" || locked) return undefined;
    let alive = true;
    setOutcomes(null);
    setOutErr(null);
    api(`/alerts/outcomes?days=${oDays}`)
      .then((d) => alive && setOutcomes(d))
      .catch((e) => alive && setOutErr(e));
    return () => {
      alive = false;
    };
  }, [tab, oDays, locked, reload]);

  useEffect(() => {
    let alive = true;
    setErr(null);
    if (!locked) {
      setEvents(null);
      api(`/alert-events${buildQuery({ trigger: fTrigger, symbol: fSymbol, unread: fUnread ? 1 : "", days: fDays, limit: EVENT_LIMIT })}`)
        .then((d) => alive && setEvents(d.events))
        .catch((e) => alive && setErr(e));
      api("/me/alerts/rules")
        .then((d) => alive && setRules(d.rules))
        .catch(() => alive && setRules([]));
    }
    cached("/entitlements")
      .then((d) => alive && setTiers(d.tiers))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [reload, locked, fTrigger, fSymbol, fUnread, fDays]);

  // A Notify button elsewhere on this page (the empty state) arms through
  // the shared cache; pick the change up without a full reload.
  useEffect(() => {
    const refresh = () =>
      api("/me/alerts/rules")
        .then((d) => setRules(d.rules))
        .catch(() => {});
    window.addEventListener("alerts:rules", refresh);
    return () => window.removeEventListener("alerts:rules", refresh);
  }, []);

  // Only when the history is empty and unfiltered: the first pinned name is
  // the natural first alert.
  useEffect(() => {
    if (locked || hasFilters || !events || events.length > 0 || picks) return;
    api("/me/picks")
      .then((d) => setPicks(d.picks || []))
      .catch(() => setPicks([]));
  }, [locked, hasFilters, events, picks]);

  useEffect(() => setSymbol(fSymbol), [fSymbol]);

  // Arriving with a symbol: bring the form into view on a phone, where it
  // sits below the list; on a desktop it is already beside it.
  useEffect(() => {
    if (tab !== "armed" || !fSymbol || !formRef.current) return;
    const narrow = window.matchMedia && window.matchMedia("(max-width: 899px)").matches;
    formRef.current.scrollIntoView({ block: narrow ? "start" : "nearest", behavior: "smooth" });
  }, [tab, fSymbol]);

  // "Watch a name for me" in the header: switch to the arm tab, then put the cursor
  // in the ticker field once the form is on screen.
  const wantFocus = useRef(false);
  useEffect(() => {
    if (tab !== "armed" || !wantFocus.current) return;
    wantFocus.current = false;
    focusSymbol();
  }, [tab]);

  const setFilters = (next) => {
    const merged = { trigger: fTrigger, symbol: fSymbol, unread: fUnread ? 1 : "", days: fDays === 365 ? "" : fDays, ...next };
    // a symbol filter on the history must say so, or the address would read
    // as "set alerts up on this name"
    const tabOut = tab === "history" ? (merged.symbol ? "history" : "") : tab;
    navigate(`/alerts${buildQuery({ tab: tabOut, ...merged })}`, { replace: true });
  };
  const setTab = (t) => navigate(`/alerts${buildQuery({ tab: t === "history" ? "" : t, symbol: t === "armed" ? fSymbol : "" })}`, { replace: true });
  const watchAName = () => {
    setFormErr(null);
    if (tab === "armed") return focusSymbol();
    wantFocus.current = true;
    return setTab("armed");
  };

  const limit = me && me.tier ? me.tier.alerts_limit : null;
  const used = rules ? rules.length : 0;
  const remaining = limit == null ? Infinity : Math.max(0, limit - used);
  const atQuota = remaining === 0;
  const tz = me && me.settings ? me.settings.timezone : undefined;
  const unreadCount = useMemo(() => (events || []).filter((e) => e.read === false).length, [events]);
  // Alerts sent to this subscriber (a name they had armed) come first; the
  // rest fired across their industries on names they were not watching.
  const sent = useMemo(() => (events || []).filter(wasSent), [events]);
  const others = useMemo(() => (events || []).filter((e) => !wasSent(e)), [events]);
  const [othersShown, setOthersShown] = useState(OTHERS_PAGE);
  useEffect(() => setOthersShown(OTHERS_PAGE), [events]);
  const firstAlertTier = tiers && [...tiers].sort((a, b) => a.price_monthly_cents - b.price_monthly_cents).find((t) => t.alerts_limit !== 0);
  const allIndTier = tiers && [...tiers].sort((a, b) => a.price_monthly_cents - b.price_monthly_cents).find((t) => t.industries_limit >= 999);
  const extraChannels = CHANNELS.filter(([k]) => k !== "email" && hasChannel(me, k));
  const restTriggers = TRIGGERS.filter(([k]) => !DEFAULT_TRIGGERS.includes(k));
  const groups = useMemo(() => {
    const m = new Map();
    (rules || []).forEach((r) => {
      if (!m.has(r.symbol)) m.set(r.symbol, []);
      m.get(r.symbol).push(r);
    });
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [rules]);
  const names = groups.length;

  const onRead = (id) => {
    setEvents((xs) => (xs || []).map((x) => (x.id === id ? { ...x, read: true } : x)));
    window.dispatchEvent(new Event("alerts:read"));
  };

  const markAll = async () => {
    try {
      await api("/me/alerts/read", { method: "POST", json: { all: true } });
      setEvents((xs) => (xs || []).map((x) => (x.read === false ? { ...x, read: true } : x)));
      window.dispatchEvent(new Event("alerts:read"));
      toast("All alerts marked read.");
    } catch (e) {
      toast(e.detail || "Couldn't mark alerts read.");
    }
  };

  const togglePicked = (k) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  // The API's three refusals, in the words the Notify button uses: what we
  // would watch, then the way out.
  const explainRefusal = (detail, armed) => {
    const d = detail || "";
    if (/verify/i.test(d)) return { kind: "verify", text: "Alerts only go to a verified address. Open the link we sent when you signed up, or request a new one from account settings." };
    if (/channel/i.test(d)) return { kind: "channel", text: `${d.charAt(0).toUpperCase()}${d.slice(1)}. Email always works; the other channels come with a plan that includes them.` };
    if (/plan arms|upgrade/i.test(d)) return { kind: "quota", text: `${armed ? `Turned on ${armed}, then: ` : ""}${d}. Turn off an alert you no longer need, or move to a plan that can watch this name as well.` };
    return { kind: "other", text: `${armed ? `Turned on ${armed}, then: ` : ""}${d || "couldn't turn that alert on."}` };
  };

  const arm = async (e) => {
    e.preventDefault();
    setFormErr(null);
    const keys = TRIGGERS.map(([k]) => k).filter((k) => picked.has(k));
    if (keys.length === 0) return setFormErr({ kind: "other", text: "Choose at least one fact to be told about." });
    if (remaining !== Infinity && keys.length > remaining) {
      return setFormErr({ kind: "quota", text: `That is ${plural(keys.length, "alert")}; your plan has ${remaining} left. Untick one, turn off one you no longer need, or move to a plan that can watch this name as well.` });
    }
    setBusy(true);
    let armed = 0;
    const sym = symbol.trim().toUpperCase();
    try {
      for (const k of keys) {
        // sequential on purpose: the quota is checked server-side per rule
        // eslint-disable-next-line no-await-in-loop
        await api("/me/alerts/rules", { method: "POST", json: { symbol: sym, trigger_key: k, channels } });
        armed += 1;
      }
      toast(`Alerts on for ${sym}: we'll tell you on ${plural(armed, "fact")}.`);
      setSymbol("");
      setReload((n) => n + 1);
    } catch (e2) {
      if (e2.status === 403) setFormErr(explainRefusal(e2.detail, armed));
      else if (e2.status === 404) setFormErr({ kind: "other", text: `${sym || "That name"} is not in your industries or watchlist, so we cannot watch it. Choose a name from the search above.` });
      else setFormErr({ kind: "other", text: `${armed ? `Turned on ${armed}, then: ` : ""}${e2.detail || "couldn't turn that alert on."}` });
      if (armed) setReload((n) => n + 1);
    } finally {
      setBusy(false);
      invalidateRules();
    }
  };

  const disarm = async (id) => {
    try {
      await api(`/me/alerts/rules/${id}`, { method: "DELETE" });
      setRules((r) => r.filter((x) => x.id !== id));
      toast("Alert turned off.");
    } catch (e) {
      toast(e.detail || "Couldn't turn that alert off. Try again.");
    } finally {
      invalidateRules();
    }
  };

  const setRuleChannels = async (rule, next) => {
    if (next.length === 0) return toast("Keep at least one channel, or turn the alert off.");
    try {
      const d = await api(`/me/alerts/rules/${rule.id}`, { method: "PATCH", json: { channels: next } });
      setRules((rs) => rs.map((x) => (x.id === rule.id ? { ...x, channels: d.rule.channels } : x)));
    } catch (e) {
      toast(e.detail || "Couldn't change channels.");
    } finally {
      invalidateRules();
    }
  };

  const toggleChannel = (c) => setChannels((cs) => (cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c]));

  const addFor = (sym) => {
    setSymbol(sym);
    setFormErr(null);
    if (formRef.current) formRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  // A plain function, not a nested component, so the checkboxes keep their
  // identity (and focus) across renders.
  const trigCheck = (k) => (
    <label className="tl-trig" key={k}>
      <input type="checkbox" checked={picked.has(k)} onChange={() => togglePicked(k)} />
      <div>
        <b>{triggerLabel(k)}</b>
        <span>{triggerSentence(k)}</span>
      </div>
    </label>
  );

  if (locked) {
    // Lead with the viewer's own missed count when the record is in.
    const lm = record && record.missed ? record.missed.summary : null;
    const missedLead = lm && lm.fired ? `${plural(lm.fired, "alert")} fired on ${plural(lm.names, "name")} in your industries in the last ${record.days} days.` : null;
    const missedMoved = lm && lm.measured ? ` ${lm.moved_10} of the ${lm.measured} measured moved 10%+ within five sessions.` : "";
    const fromLabel = firstAlertTier ? firstAlertTier.label : "Basic";
    const lockedLine =
      lm && lm.fired
        ? `${plural(lm.fired, "alert")} fired on ${plural(lm.names, "name")} in your industries; you were told about none.`
        : `On ${me.tier.label} we cannot tell you when something happens on a name.`;
    return (
      <div className="wrap">
        <ScreenHead
          title="My alerts"
          line={lockedLine}
          action={
            <button type="button" className="btn btn-primary" onClick={() => openUpgrade("alerts")}>
              Tell me about them
            </button>
          }
        />
        <FinePrint short />
        <div className="gate">
          <div className="sample alert-list" aria-hidden="true">
            {SAMPLE_EVENTS.map((ev) => (
              <PlainEvent key={ev.id} ev={ev} />
            ))}
          </div>
          <div className="panel">
            <div className="card">
              <p className="eyebrow">Example shown behind</p>
              <h2>{missedLead || `Alerts are included from ${fromLabel}.`}</h2>
              {missedLead && (
                <p className="muted">
                  You were told about none of them.{missedMoved} Alerts are included from {fromLabel}.
                </p>
              )}
              <p className="muted">{GLOSSARY.alert.short} The facts we watch for: the cost to borrow doubling, short interest crossing a line, a day at three times normal volume, a dated event coming up, a filing to sell more shares.</p>
              {firstAlertTier && (
                <p className="muted">
                  {firstAlertTier.label} includes {firstAlertTier.alerts_limit == null ? "unlimited alerts" : plural(firstAlertTier.alerts_limit, "alert")} by{" "}
                  {firstAlertTier.channels.map(channelWord).join(", ")}, {dollars(firstAlertTier.price_monthly_cents)}/mo.
                </p>
              )}
              <button type="button" className="btn btn-primary" onClick={() => openUpgrade("alerts")}>
                {CTA.PLANS_WITH_ALERTS}
              </button>
              <p className="xs faint" style={{ marginTop: "var(--s-3)", marginBottom: 0 }}>
                Currently on {me.tier.label}.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const firedCount = events ? events.length : null;

  // The one line (DESIGN_V6 §7): the screen's own counts, fourteen words or
  // fewer. Unread sits on the secondary control; the rules count on its tab.
  const when = windowClause(fDays);
  const filterNote = fTrigger || fUnread ? " matching this filter" : "";
  let line;
  if (!events) line = "Checking what fired on your names…";
  else if (firedCount === 0) line = `No alert fired on ${fSymbol || "your names"} ${when}${filterNote}.`;
  else if (sent.length === 0) line = `Nothing was sent to you ${when}; ${plural(others.length, "alert")} fired on names not watched.`;
  else if (others.length === 0) line = `${plural(sent.length, "alert")} sent to you${fSymbol ? ` on ${fSymbol}` : ""} ${when}${filterNote}.`;
  else line = `${plural(sent.length, "alert")} sent to you ${when}; ${others.length} more on names not watched.`;

  return (
    <div className="wrap">
      <ScreenHead
        title="My alerts"
        line={line}
        action={
          <button type="button" className="btn btn-primary" onClick={watchAName}>
            {fSymbol ? CTA.ALERT_ME_ON(fSymbol) : "Alert me on a name"}
          </button>
        }
        secondary={
          tab === "history" && unreadCount > 0 ? (
            <button className="btn btn-secondary btn-sm" onClick={markAll}>
              Mark all read ({unreadCount})
            </button>
          ) : null
        }
      />
      <FinePrint short />

      <div className="tabs tl-tabs" role="tablist" aria-label="Alerts">
        <button role="tab" className="tab" aria-selected={tab === "history"} onClick={() => setTab("history")}>
          {simple ? "Told me" : "History"}
          {events && unreadCount === 0 ? ` · ${sent.length}` : ""}
          {unreadCount > 0 && <span className="navbadge">{unreadCount}</span>}
        </button>
        <button role="tab" className="tab" aria-selected={tab === "armed"} onClick={() => setTab("armed")}>
          {simple ? "Alerting me" : "Armed"}
          {rules ? ` · ${simple ? names : rules.length}` : ""}
        </button>
        <button role="tab" className="tab" aria-selected={tab === "outcomes"} onClick={() => setTab("outcomes")}>
          {simple ? "My record" : "Outcomes"}
        </button>
      </div>

      {tab === "outcomes" && (
        <>
          <RecordBlock rec={record} allIndTier={allIndTier} simple={simple} />
          <div className="filters-row">
            <span className="muted small">What price did after each kind of alert fired on the names you can see, measured on end-of-day price bars.</span>
            <span className="spacer" />
            <label className="ctl">
              Window
              <select className="inline" value={oDays} onChange={(e) => navigate(`/alerts?tab=outcomes${Number(e.target.value) === 365 ? "" : `&odays=${e.target.value}`}`, { replace: true })}>
                <option value={90}>90 days</option>
                <option value={365}>1 year</option>
                <option value={730}>2 years</option>
              </select>
            </label>
          </div>
          <p className="tl-why">
            <Explain term="rate">Outcome rate</Explain>: {GLOSSARY.rate.short}
          </p>
          {outErr && <ErrorCard error={outErr} onRetry={() => setReload((n) => n + 1)} title="Couldn't load outcomes." />}
          {!outErr && !outcomes && <Skeleton rows={5} height={44} />}
          {outcomes && outcomes.triggers.length === 0 && <Empty title="No alert has fired on your names in this window." />}
          {outcomes && outcomes.triggers.length > 0 && (
            <>
              {simple ? (
                <div className="card">
                  {outcomes.triggers.map((t) => {
                    const enough = t.measured >= 10;
                    return (
                      <div className="tl-row" key={t.key}>
                        <div className="tl-main">
                          <div className="tl-head">
                            <b>{triggerLabel(t.key) || t.label}</b>
                            <span className="xs faint">
                              fired {plural(t.n, "time")}, {t.measured} measured
                            </span>
                          </div>
                          <p className="tl-sent">
                            {enough ? (
                              <>
                                <b className="num">{rate(t.share_max_10)}</b> of them touched +10% within five sessions; <b className="num">{rate(t.share_up_5d)}</b> closed higher after five days.
                              </>
                            ) : t.measured > 0 ? (
                              <span className="faint">Fewer than ten measured, so no figure yet.</span>
                            ) : (
                              <span className="faint">No five-day window has closed yet, so no figure yet.</span>
                            )}
                          </p>
                        </div>
                        <div className="tl-acts">
                          <Link to={`/alerts?tab=history&trigger=${t.key}`} className="btn btn-secondary btn-sm">
                            See these alerts
                          </Link>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="table-card">
                  <table className="data compact outcomes">
                    <thead>
                      <tr>
                        <th scope="col">Trigger</th>
                        <th scope="col" className="num">
                          Fired
                        </th>
                        <th scope="col" className="num">
                          Measured
                        </th>
                        <th scope="col" className="num">
                          Next day
                        </th>
                        <th scope="col" className="num">
                          5-day close
                        </th>
                        <th scope="col" className="num">
                          5-day high
                        </th>
                        <th scope="col" className="num">
                          Up after 5d
                        </th>
                        <th scope="col" className="num">
                          Reached +10%
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {outcomes.triggers.map((t) => {
                        const enough = t.measured >= 10;
                        const few = (
                          <span className="faint" title="Fewer than ten measured events; no average or rate is shown">
                            n &lt; 10
                          </span>
                        );
                        return (
                          <tr key={t.key}>
                            <td>
                              <Link to={`/alerts?tab=history&trigger=${t.key}`}>{t.label}</Link>
                            </td>
                            <td className="num">{t.n}</td>
                            <td className="num">{t.measured}</td>
                            <td className={`num ${enough ? tone(t.mean_chg_1d) : ""}`}>{enough ? signed(t.mean_chg_1d, 1, "%") : few}</td>
                            <td className={`num ${enough ? tone(t.mean_chg_5d) : ""}`} title={enough && t.median_chg_5d != null ? `median ${signed(t.median_chg_5d, 1, "%")}` : ""}>
                              {enough ? signed(t.mean_chg_5d, 1, "%") : few}
                            </td>
                            <td className={`num ${enough ? tone(t.mean_max_5d) : ""}`}>{enough ? signed(t.mean_max_5d, 1, "%") : few}</td>
                            <td className="num">{enough ? rate(t.share_up_5d) : few}</td>
                            <td className="num">{enough ? rate(t.share_max_10) : few}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="footnote">{outcomes.method} These are measured moves on your names, not a backtest and not a forecast; averages on small counts swing with one name.</p>
              {outcomes.events.length > 0 && (
                <section className="card" aria-labelledby="oe-h">
                  <div className="card-title">
                    <h2 id="oe-h">Recent alerts and what followed</h2>
                    <span className="muted small">latest {outcomes.events.length}</span>
                  </div>
                  <div className="tscroll">
                    <table className="hf reactions">
                      <thead>
                        <tr>
                          <th scope="col">Date</th>
                          <th scope="col">Name</th>
                          <th scope="col">Alert</th>
                          <th scope="col" className="num">
                            Next day
                          </th>
                          <th scope="col" className="num">
                            5-day close
                          </th>
                          <th scope="col" className="num">
                            5-day high
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {(simple && !allRecent ? outcomes.events.slice(0, HOME_ROWS) : outcomes.events).map((ev) => (
                          <tr key={ev.id}>
                            <td className="mono">{shortDate(ev.date)}</td>
                            <td>
                              <Link className="sym" to={`/stock/${ev.symbol}`}>
                                {ev.symbol}
                              </Link>{" "}
                              <span className="muted small">{ev.theme}</span>
                            </td>
                            <td title={ev.detail}>{simple ? triggerLabel(ev.trigger_key) || ev.trigger : ev.trigger}</td>
                            <td className={`num ${tone(ev.chg_1d)}`}>{pct(ev.chg_1d)}</td>
                            <td className={`num ${tone(ev.chg_5d)}`}>{ev.pending ? <span className="faint">window open</span> : pct(ev.chg_5d)}</td>
                            <td className={`num ${tone(ev.max_5d)}`}>{ev.pending ? <span className="faint">—</span> : pct(ev.max_5d)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {simple && outcomes.events.length > HOME_ROWS && (
                    <button type="button" className="btn-quiet" style={{ marginTop: "var(--s-2)", minHeight: 44 }} onClick={() => setAllRecent((a) => !a)} aria-expanded={allRecent}>
                      {allRecent ? CTA.SHOW_FEWER : CTA.SHOW_ALL(outcomes.events.length)}
                    </button>
                  )}
                </section>
              )}
            </>
          )}
        </>
      )}

      {tab === "history" && (
        <>
          <details className="acc" open={full} key={full ? "full" : "simple"}>
            <summary>
              Filter
              <span className="sum-note">
                {[fTrigger ? triggerLabel(fTrigger) : null, windowWord(fDays) === "year" ? "last year" : `last ${windowWord(fDays)}`, fUnread ? "unread only" : null, fSymbol || null]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </summary>
            <div className="acc-body">
              <div className="filters-row" style={{ marginBottom: 0 }}>
                <label className="ctl">
                  {simple ? "Kind" : "Trigger"}
                  <select className="inline" value={fTrigger} onChange={(e) => setFilters({ trigger: e.target.value })}>
                    <option value="">All</option>
                    {TRIGGERS.map(([k, l]) => (
                      <option key={k} value={k}>
                        {simple ? triggerLabel(k) : l}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ctl">
                  Window
                  <select className="inline" value={fDays} onChange={(e) => setFilters({ days: Number(e.target.value) })}>
                    <option value={30}>30 days</option>
                    <option value={90}>90 days</option>
                    <option value={365}>1 year</option>
                  </select>
                </label>
                <label className="check" style={{ padding: 0, minHeight: 40, alignItems: "center" }}>
                  <input type="checkbox" checked={fUnread} onChange={(e) => setFilters({ unread: e.target.checked ? 1 : "" })} />
                  <span>Unread only</span>
                </label>
                {fSymbol && (
                  <span className="chip chip-plain">
                    {fSymbol}{" "}
                    <button className="btn-quiet" style={{ padding: "0 8px", minHeight: 40 }} onClick={() => setFilters({ symbol: "" })} aria-label="Clear name filter">
                      ×
                    </button>
                  </span>
                )}
                <span className="spacer" />
                <SearchBar placeholder="Only one name" onPick={(r) => setFilters({ symbol: r.symbol })} />
              </div>
            </div>
          </details>

          {err && <ErrorCard error={err} onRetry={() => setReload((n) => n + 1)} title="Couldn't load alert history." />}
          {!err && !events && <Skeleton rows={6} height={92} />}
          {events && events.length === 0 && (
            <Empty
              title={hasFilters ? "No alerts match this filter." : "No alert has fired on your names yet."}
              action={
                hasFilters ? (
                  <button className="btn btn-secondary" onClick={() => navigate("/alerts", { replace: true })}>
                    Clear the filter
                  </button>
                ) : rules && rules.length === 0 ? (
                  picks && picks.length > 0 ? (
                    <NotifyButton symbol={picks[0].symbol} label={CTA.ALERT_ME_ON(picks[0].symbol)} />
                  ) : (
                    <button className="btn btn-primary" onClick={() => setTab("armed")}>
                      Alert me on a name
                    </button>
                  )
                ) : null
              }
            >
              {!hasFilters && (
                <>
                  <p style={{ margin: "0 0 var(--s-2)" }}>It tells you before the move is over. {GLOSSARY.alert.short}</p>
                  {rules && rules.length > 0 ? (
                    <p style={{ margin: 0 }}>
                      You have {plural(rules.length, "alert")} on across {plural(names, "name")}; we will tell you the moment one of those facts prints.
                    </p>
                  ) : picks && picks.length > 0 ? (
                    <p style={{ margin: 0 }}>
                      {picks[0].symbol} is the first name you watched. One tap below tells you about a dated event coming up, the cost to borrow doubling and a day at three times normal volume.
                    </p>
                  ) : null}
                </>
              )}
            </Empty>
          )}
          {events && events.length > 0 && (
            <>
              {sent.length > 0 ? (
                <div className="alert-list">
                  {sent.map((ev) => (
                    <PlainEvent key={ev.id} ev={ev} tz={tz} onRead={onRead} full={full} />
                  ))}
                </div>
              ) : (
                <Empty title={hasFilters ? "No alert sent to you matches this filter." : "Nothing was sent to you in this window."}>
                  We only send an alert for a name you are watching. {plural(others.length, "alert")} fired on names in your industries that you were not
                  watching; they are listed below.
                </Empty>
              )}
              {others.length > 0 && (
                <details className="acc tl-also" open={sent.length === 0}>
                  <summary>
                    Also fired in your industries ({others.length})
                    <span className="sum-note">names you were not watching</span>
                  </summary>
                  <div className="acc-body">
                    <div className="alert-list">
                      {others.slice(0, othersShown).map((ev) => (
                        <PlainEvent key={ev.id} ev={ev} tz={tz} onRead={onRead} full={full} />
                      ))}
                    </div>
                    {others.length > othersShown && (
                      <button type="button" className="btn-quiet" style={{ marginTop: "var(--s-3)", minHeight: 40 }} onClick={() => setOthersShown((n) => n + OTHERS_PAGE)}>
                        Show {Math.min(OTHERS_PAGE, others.length - othersShown)} more ({others.length - othersShown} left)
                      </button>
                    )}
                  </div>
                </details>
              )}
            </>
          )}
        </>
      )}

      {tab === "armed" && (
        <div className="report">
          <div className="report-main stack">
            <div className="quota-line">
              <span>
                Alerts: <b>{limit == null ? `${used} on · unlimited` : `${used} of ${limit} used`}</b> · {me && me.tier ? me.tier.label : ""}
              </span>
              {atQuota && <PlanLink reason="alerts">{CTA.NEXT_PLAN}</PlanLink>}
            </div>
            {!rules && <Skeleton rows={4} height={44} />}
            {rules && rules.length === 0 && (
              <Empty title="No alerts on yet.">
                It tells you before the move is over. Choose a name in the form, keep the three facts we suggest or choose your own, and we will email you when one prints.
              </Empty>
            )}
            {rules && rules.length > 0 && (
              <div className="card">
                <div className="card-title">
                  <h2>{simple ? "Names watched for me" : "Armed alerts"}</h2>
                  <span className="muted small">
                    {plural(names, "name")} · {plural(rules.length, simple ? "fact" : "trigger")}
                  </span>
                </div>
                {groups.map(([sym, rs]) => {
                  const chans = [...new Set(rs.flatMap((r) => r.channels || []))];
                  return (
                    <div className="tl-group" key={sym}>
                      <div className="tl-head">
                        <Link className="sym" to={`/stock/${sym}`}>
                          {sym}
                        </Link>
                        <span className="xs faint">
                          {plural(rs.length, simple ? "fact" : "trigger")} · by {chans.map(channelWord).join(", ") || "email"}
                        </span>
                        <span className="spacer" />
                        <button className="btn-quiet" onClick={() => addFor(sym)}>
                          {simple ? "Add a fact" : "Add a trigger"}
                        </button>
                      </div>
                      <div className="tl-chips simple-only">
                        {rs.map((r) => {
                          const label = triggerLabel(r.trigger_key) || r.trigger;
                          return (
                            <span className="tl-chip" key={r.id} title={triggerSentence(r.trigger_key, r.symbol)}>
                              <span>{label}</span>
                              <button type="button" className="x" aria-label={`Turn off ${label} on ${sym}`} onClick={() => disarm(r.id)}>
                                ×
                              </button>
                            </span>
                          );
                        })}
                      </div>
                      <div className="full-only">
                        {rs.map((r) => (
                          <div className="tl-rule" key={r.id}>
                            <b>{r.trigger}</b>
                            <span className="muted xs mono">on since {shortDate(r.armed_at, tz)}</span>
                            <span className="chan-chips" role="group" aria-label={`Channels for ${r.symbol} ${r.trigger}`}>
                              {CHANNELS.map(([k, label]) => {
                                const allowed = k === "email" || hasChannel(me, k);
                                const on = r.channels.includes(k);
                                return (
                                  <button
                                    key={k}
                                    type="button"
                                    aria-pressed={on}
                                    disabled={!allowed}
                                    title={allowed ? "" : "Not in your plan"}
                                    onClick={() => setRuleChannels(r, on ? r.channels.filter((c) => c !== k) : [...r.channels, k])}
                                  >
                                    {label}
                                  </button>
                                );
                              })}
                            </span>
                            <span className="spacer" />
                            <button className="btn btn-secondary btn-sm" onClick={() => disarm(r.id)}>
                              Turn off
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <aside className="card tl-form" aria-labelledby="arm-h" ref={formRef} id="arm">
            <h2 id="arm-h" style={{ marginBottom: "var(--s-3)" }}>
              {simple ? "Tell me when…" : "Turn on alerts"}
            </h2>
            {me && !me.verified ? <Notice tone="warn">Alerts only go to a verified address. Open the link we sent when you signed up, or request a new one from My account.</Notice> : null}
            <form onSubmit={arm}>
              <div className="field">
                <span className="field-label">{simple ? "Which name?" : "Name"}</span>
                <SearchBar placeholder="Find a name" onPick={(r) => setSymbol(r.symbol)} />
                <p className="hint" style={{ margin: "var(--s-1) 0 0" }}>
                  Search covers the names in your industries and <Explain term="universe">your watchlist</Explain>.
                </p>
                <label htmlFor="al-symbol" className="tl-or">
                  or type the ticker
                </label>
                <input
                  id="al-symbol"
                  className="input mono"
                  value={symbol}
                  required
                  placeholder="ticker"
                  autoComplete="off"
                  style={{ textTransform: "uppercase" }}
                  onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                />
              </div>
              <div className="field">
                <span className="field-label">
                  {simple ? `We will tell you when${symbol ? ` ${symbol}` : ""}…` : "Triggers"}{" "}
                  <span className="faint">
                    ({picked.size} chosen{remaining !== Infinity ? `, ${remaining} left on your plan` : ""})
                  </span>
                </span>
                {simple ? (
                  <>
                    {DEFAULT_TRIGGERS.map(trigCheck)}
                    <details className="acc">
                      <summary>
                        More facts <span className="sum-note">{restTriggers.filter(([k]) => picked.has(k)).length || ""}</span>
                      </summary>
                      <div className="acc-body">{restTriggers.map(([k]) => trigCheck(k))}</div>
                    </details>
                  </>
                ) : (
                  <div className="trigger-grid">
                    {TRIGGERS.map(([k, l, desc]) => (
                      <label key={k} className="check">
                        <input type="checkbox" checked={picked.has(k)} onChange={() => togglePicked(k)} />
                        <span>
                          {l}
                          <span className="lock-note">{desc}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
                {remaining !== Infinity && picked.size > remaining && (
                  <p className="hint">
                    That is {plural(picked.size, "alert")} and your plan has {remaining} left. Untick {picked.size - remaining}, turn one off, or{" "}
                    <PlanLink reason="alerts" ctx={symbol ? { symbol } : {}}>
                      move to a plan that can watch this name as well
                    </PlanLink>
                    .
                  </p>
                )}
              </div>
              <div className="field">
                <span className="field-label">{simple ? "How to reach you" : "Deliver by"}</span>
                {simple ? (
                  <>
                    <p className="hint" style={{ margin: "0 0 var(--s-1)" }}>
                      By email{me && me.email ? ` to ${me.email}` : ""}
                      {extraChannels.length ? ", and if you like:" : "."}
                    </p>
                    {extraChannels.map(([k, label]) => (
                      <label key={k} className="check" style={{ minHeight: 40, alignItems: "center" }}>
                        <input type="checkbox" checked={channels.includes(k)} onChange={() => toggleChannel(k)} />
                        <span>{label}</span>
                      </label>
                    ))}
                  </>
                ) : (
                  CHANNELS.map(([k, label]) => {
                    const allowed = k === "email" || hasChannel(me, k);
                    return (
                      <label key={k} className={`check ${allowed ? "" : "locked"}`}>
                        <input
                          type="checkbox"
                          checked={k === "email" ? true : channels.includes(k)}
                          disabled={k === "email" || !allowed}
                          onChange={() => toggleChannel(k)}
                        />
                        <span>
                          {label}
                          {k === "email" && <span className="lock-note">Required</span>}
                          {!allowed && (
                            <span className="lock-note">
                              Not in your plan ·{" "}
                              <PlanLink reason="channels" ctx={{ channel: k }}>
                                {CTA.NEXT_PLAN}
                              </PlanLink>
                            </span>
                          )}
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
              {formErr && (
                <Notice tone={formErr.kind === "other" ? "neg" : "warn"}>
                  <p style={{ margin: 0 }}>{formErr.text}</p>
                  {formErr.kind === "verify" && (
                    <p style={{ margin: "var(--s-2) 0 0" }}>
                      <Link to="/settings">Open my account</Link>
                    </p>
                  )}
                  {formErr.kind === "quota" && (
                    <p style={{ margin: "var(--s-2) 0 0" }}>
                      <PlanLink reason="alerts" ctx={symbol ? { symbol } : {}}>
                        {CTA.NEXT_PLAN}
                      </PlanLink>
                    </p>
                  )}
                  {formErr.kind === "channel" && (
                    <p style={{ margin: "var(--s-2) 0 0" }}>
                      <PlanLink reason="channels" ctx={{ channel: channels.find((c) => c !== "email" && !hasChannel(me, c)) || channels.find((c) => c !== "email") }}>
                        {CTA.NEXT_PLAN}
                      </PlanLink>
                    </p>
                  )}
                </Notice>
              )}
              <button className="btn btn-primary btn-block" disabled={busy || atQuota || (me && !me.verified) || !symbol.trim() || picked.size === 0}>
                {busy ? "Setting up…" : simple ? (symbol ? CTA.ALERT_ME_ON(symbol) : CTA.ALERT_ME) : `Turn on ${picked.size || ""} alert${picked.size === 1 ? "" : "s"}`}
              </button>
              <FinePrint short links={false} />
              {atQuota && (
                <p className="help" style={{ marginTop: "var(--s-2)" }}>
                  You're using all {limit} alerts on {me.tier.label}. Turn one off, or{" "}
                  <PlanLink reason="alerts" ctx={symbol ? { symbol } : {}}>
                    move to a plan that can watch this name as well
                  </PlanLink>
                  .
                </p>
              )}
            </form>
          </aside>
        </div>
      )}
    </div>
  );
}
