import React, { useEffect, useMemo, useRef, useState } from "react";
import { api, cached, toast } from "../api.js";
import { Link, navigate, useQuery } from "../lib/router.jsx";
import { hasChannel, useMe } from "../lib/me.jsx";
import { age, dateTime, dollars, pct, plural, rate, shortDate, signed, tone } from "../lib/fmt.js";
import { DILUTION_TRIGGERS, TRIGGERS } from "../lib/evidence.js";
import { DEFAULT_TRIGGERS, GLOSSARY } from "../lib/glossary.js";
import { triggerLabel, triggerSentence } from "../lib/plain.js";
import { useMode } from "../lib/mode.js";
import SearchBar from "../components/SearchBar.jsx";
import { AlertItem } from "../components/EventList.jsx";
import NotifyButton, { invalidateRules } from "../components/NotifyButton.jsx";
import Explain from "../components/Explain.jsx";
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
    detail: "Borrow fee 2.4x its 5-session average (was 12.1%, now 29.4%)",
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
    detail: "Volume 3.6x the 20-day average by midday",
    fired_at: new Date(Date.now() - 36e5 * 30).toISOString(),
    channels: ["email"],
    read: true,
  },
];

const EVENT_LIMIT = 100;

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

function channelWord(k) {
  const c = CHANNELS.find((x) => x[0] === k);
  return c ? c[1].toLowerCase() : k;
}

// The plain event card: the trigger's plain label is the title, the fact
// the engine recorded is the body. Unread is a dot plus bold, never colour
// alone; a dilution filing keeps its one allowed coloured line.
function PlainEvent({ ev, tz, onRead }) {
  const unread = ev.read === false;
  const a = age(ev.fired_at);
  const dilution = DILUTION_TRIGGERS.has(ev.trigger_key);
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
        <span className="tl-title">{triggerLabel(ev.trigger_key) || ev.trigger}</span>
        <span className="when" title={dateTime(ev.fired_at, tz)}>
          {a ? `${a.label} ago` : shortDate(ev.fired_at, tz)}
        </span>
      </div>
      <div className={`r2 ${dilution ? "dilution" : ""} ${unread ? "bold" : ""}`}>{ev.detail || ev.trigger}</div>
      <div className="r4">
        <Link to={`/stock/${ev.symbol}`} onClick={markRead}>
          Open {ev.symbol} →
        </Link>
        {unread && (
          <button className="btn-quiet" onClick={markRead}>
            Mark read
          </button>
        )}
        <span className="xs faint">
          {ev.channels && ev.channels.length
            ? `sent to you by ${ev.channels.map(channelWord).join(", ")}`
            : `you were not watching ${ev.symbol}; shown because it is in your universe`}
        </span>
      </div>
    </article>
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
  const formRef = useRef(null);
  const oDays = [90, 365, 730].includes(Number(q.get("odays"))) ? Number(q.get("odays")) : 365;

  const locked = Boolean(me && me.tier && me.tier.alerts_limit === 0);

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

  const setFilters = (next) => {
    const merged = { trigger: fTrigger, symbol: fSymbol, unread: fUnread ? 1 : "", days: fDays === 365 ? "" : fDays, ...next };
    // a symbol filter on the history must say so, or the address would read
    // as "set alerts up on this name"
    const tabOut = tab === "history" ? (merged.symbol ? "history" : "") : tab;
    navigate(`/alerts${buildQuery({ tab: tabOut, ...merged })}`, { replace: true });
  };
  const setTab = (t) => navigate(`/alerts${buildQuery({ tab: t === "history" ? "" : t, symbol: t === "armed" ? fSymbol : "" })}`, { replace: true });

  const limit = me && me.tier ? me.tier.alerts_limit : null;
  const used = rules ? rules.length : 0;
  const remaining = limit == null ? Infinity : Math.max(0, limit - used);
  const atQuota = remaining === 0;
  const tz = me && me.settings ? me.settings.timezone : undefined;
  const unreadCount = useMemo(() => (events || []).filter((e) => e.read === false).length, [events]);
  const firstAlertTier = tiers && [...tiers].sort((a, b) => a.price_monthly_cents - b.price_monthly_cents).find((t) => t.alerts_limit !== 0);
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
    if (/plan arms|upgrade/i.test(d)) return { kind: "quota", text: `${armed ? `Armed ${armed}, then: ` : ""}${d}. Disarm an alert you no longer need, or move to a plan with more.` };
    return { kind: "other", text: `${armed ? `Armed ${armed}, then: ` : ""}${d || "couldn't arm that alert."}` };
  };

  const arm = async (e) => {
    e.preventDefault();
    setFormErr(null);
    const keys = TRIGGERS.map(([k]) => k).filter((k) => picked.has(k));
    if (keys.length === 0) return setFormErr({ kind: "other", text: "Choose at least one trigger." });
    if (remaining !== Infinity && keys.length > remaining) {
      return setFormErr({ kind: "quota", text: `That is ${plural(keys.length, "alert")}; your plan has ${remaining} left. Untick one, disarm one you no longer need, or move to a plan with more.` });
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
      toast(`Watching ${sym}. We'll tell you on ${plural(armed, "trigger")}.`);
      setSymbol("");
      setReload((n) => n + 1);
    } catch (e2) {
      if (e2.status === 403) setFormErr(explainRefusal(e2.detail, armed));
      else if (e2.status === 404) setFormErr({ kind: "other", text: `${sym || "That name"} is not in your universe, so we cannot watch it. Pick a name from the search above.` });
      else setFormErr({ kind: "other", text: `${armed ? `Armed ${armed}, then: ` : ""}${e2.detail || "couldn't arm that alert."}` });
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
    return (
      <div className="wrap">
        <div className="pagehead">
          <div>
            <h1>Alerts</h1>
            <p className="utility">
              On <b>{me.tier.label}</b> we cannot tell you when something happens on a name.
              {firstAlertTier ? (
                <>
                  {" "}
                  From <b>{firstAlertTier.label}</b> we watch up to {firstAlertTier.alerts_limit == null ? "any number of" : firstAlertTier.alerts_limit} triggers for you and send the fact that fired by{" "}
                  {firstAlertTier.channels.map(channelWord).join(", ")}.
                </>
              ) : null}
            </p>
          </div>
        </div>
        <div className="gate">
          <div className="sample alert-list" aria-hidden="true">
            {SAMPLE_EVENTS.map((ev) => (
              <AlertItem key={ev.id} ev={ev} />
            ))}
          </div>
          <div className="panel">
            <div className="card">
              <p className="eyebrow">Example shown behind</p>
              <h2>Alerts are included from {firstAlertTier ? firstAlertTier.label : "Basic"}.</h2>
              <p className="muted">{GLOSSARY.alert.short} The facts we watch for: a borrow fee doubling, a short-interest print crossing a line, a day at three times normal volume, a dated event coming up, a filing to sell more shares.</p>
              {firstAlertTier && (
                <p className="muted">
                  {firstAlertTier.label} includes {firstAlertTier.alerts_limit == null ? "unlimited alerts" : plural(firstAlertTier.alerts_limit, "alert")} by{" "}
                  {firstAlertTier.channels.map(channelWord).join(", ")}, {dollars(firstAlertTier.price_monthly_cents)}/mo.
                </p>
              )}
              <Link to="/pricing" className="btn btn-primary">
                See plans
              </Link>
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

  return (
    <div className="wrap">
      <div className="pagehead">
        <div>
          <h1>Alerts</h1>
          <p className="utility">
            {!events && !rules ? (
              "Checking what fired on your names…"
            ) : (
              <>
                {events &&
                  (firedCount === 0 ? (
                    <>
                      No alert fired on {fSymbol ? <b>{fSymbol}</b> : "your names"} in the last <b>{windowWord(fDays)}</b>
                      {fTrigger || fUnread ? " matching this filter" : ""}.
                    </>
                  ) : (
                    <>
                      <b>{firedCount >= EVENT_LIMIT ? `${EVENT_LIMIT}+` : firedCount}</b> {firedCount === 1 ? "alert" : "alerts"} fired on {fSymbol ? <b>{fSymbol}</b> : "your names"} in the last{" "}
                      <b>{windowWord(fDays)}</b>
                      {fTrigger || fUnread ? " matching this filter" : ""}
                      {unreadCount > 0 ? (
                        <>
                          ; <b>{unreadCount}</b> unread
                        </>
                      ) : null}
                      .
                    </>
                  ))}
                {rules &&
                  (rules.length === 0 ? (
                    <> You have no alerts on yet.</>
                  ) : (
                    <>
                      {" "}
                      You have <b>{rules.length}</b> {rules.length === 1 ? "alert" : "alerts"} on across <b>{names}</b> {names === 1 ? "name" : "names"}.
                    </>
                  ))}
              </>
            )}
          </p>
        </div>
        {tab === "history" && unreadCount > 0 && (
          <div className="actions">
            <button className="btn btn-secondary btn-sm" onClick={markAll}>
              Mark all read ({unreadCount})
            </button>
          </div>
        )}
      </div>

      <div className="tabs" role="tablist" aria-label="Alerts">
        <button role="tab" className="tab" aria-selected={tab === "history"} onClick={() => setTab("history")}>
          {simple ? "What fired" : "History"}
          {events ? ` · ${events.length}` : ""}
          {unreadCount > 0 && <span className="navbadge">{unreadCount}</span>}
        </button>
        <button role="tab" className="tab" aria-selected={tab === "armed"} onClick={() => setTab("armed")}>
          {simple ? "Alerts on" : "Armed"}
          {rules ? ` · ${rules.length}` : ""}
        </button>
        <button role="tab" className="tab" aria-selected={tab === "outcomes"} onClick={() => setTab("outcomes")}>
          {simple ? "What happened next" : "Outcomes"}
        </button>
      </div>

      {tab === "outcomes" && (
        <>
          <div className="filters-row">
            <span className="muted small">What price did after each kind of alert fired on the names you can see, measured on daily bars.</span>
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
                            {t.measured > 0 ? (
                              <>
                                Five trading days later the average move was <b className={`num ${tone(t.mean_chg_5d)}`}>{signed(t.mean_chg_5d, 1, "%")}</b>
                                {t.mean_max_5d != null ? (
                                  <>
                                    , with an average high of <b className={`num ${tone(t.mean_max_5d)}`}>{signed(t.mean_max_5d, 1, "%")}</b> on the way
                                  </>
                                ) : null}
                                .{" "}
                              </>
                            ) : (
                              "No five-day window has closed yet. "
                            )}
                            {enough ? (
                              <>
                                <b className="num">{rate(t.share_up_5d)}</b> closed higher after five days; <b className="num">{rate(t.share_max_10)}</b> touched +10% on the way.
                              </>
                            ) : (
                              <span className="faint">Fewer than ten measured, so no rate yet.</span>
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
                        return (
                          <tr key={t.key}>
                            <td>
                              <Link to={`/alerts?tab=history&trigger=${t.key}`}>{t.label}</Link>
                            </td>
                            <td className="num">{t.n}</td>
                            <td className="num">{t.measured}</td>
                            <td className={`num ${tone(t.mean_chg_1d)}`}>{signed(t.mean_chg_1d, 1, "%")}</td>
                            <td className={`num ${tone(t.mean_chg_5d)}`} title={t.median_chg_5d != null ? `median ${signed(t.median_chg_5d, 1, "%")}` : ""}>
                              {signed(t.mean_chg_5d, 1, "%")}
                            </td>
                            <td className={`num ${tone(t.mean_max_5d)}`}>{signed(t.mean_max_5d, 1, "%")}</td>
                            <td className="num">{enough ? rate(t.share_up_5d) : <span className="faint" title="Fewer than ten measured events; no rate is shown">n &lt; 10</span>}</td>
                            <td className="num">{enough ? rate(t.share_max_10) : <span className="faint">n &lt; 10</span>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="footnote">{outcomes.method} These are measured moves on your universe, not a backtest and not a forecast; averages on small counts swing with one name.</p>
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
                        {outcomes.events.map((ev) => (
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
                    <NotifyButton symbol={picks[0].symbol} label={`Notify me about ${picks[0].symbol}`} />
                  ) : (
                    <button className="btn btn-primary" onClick={() => setTab("armed")}>
                      Set up your first alert
                    </button>
                  )
                ) : null
              }
            >
              {!hasFilters && (
                <>
                  <p style={{ margin: "0 0 var(--s-2)" }}>{GLOSSARY.alert.short}</p>
                  {rules && rules.length > 0 ? (
                    <p style={{ margin: 0 }}>
                      You have {plural(rules.length, "alert")} on across {plural(names, "name")}; we will tell you the moment one of those facts prints.
                    </p>
                  ) : picks && picks.length > 0 ? (
                    <p style={{ margin: 0 }}>
                      {picks[0].symbol} is the first name you pinned. One tap below watches it for a dated event coming up, a borrow fee doubling and a day at three times normal volume.
                    </p>
                  ) : null}
                </>
              )}
            </Empty>
          )}
          {events && events.length > 0 && (
            <div className="alert-list">
              {events.map((ev) => (simple ? <PlainEvent key={ev.id} ev={ev} tz={tz} onRead={onRead} /> : <AlertItem key={ev.id} ev={ev} tz={tz} onRead={onRead} />))}
            </div>
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
              {atQuota && <Link to="/pricing">See plans for more</Link>}
            </div>
            {!rules && <Skeleton rows={4} height={44} />}
            {rules && rules.length === 0 && (
              <Empty title="No alerts on yet.">
                {GLOSSARY.alert.short} Choose a name in the form, keep the three triggers we suggest or pick your own, and we will email you when one prints.
              </Empty>
            )}
            {rules && rules.length > 0 && (
              <div className="card">
                <div className="card-title">
                  <h2>{simple ? "Names you are watching" : "Armed alerts"}</h2>
                  <span className="muted small">
                    {plural(names, "name")} · {plural(rules.length, "trigger")}
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
                          {plural(rs.length, "trigger")} · by {chans.map(channelWord).join(", ") || "email"}
                        </span>
                        <span className="spacer" />
                        <button className="btn-quiet" onClick={() => addFor(sym)}>
                          Add a trigger
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
                            <span className="muted xs mono">armed {shortDate(r.armed_at, tz)}</span>
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
                              Disarm
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
              {simple ? "Tell me when…" : "Arm alerts"}
            </h2>
            {me && !me.verified ? <Notice tone="warn">Alerts only go to a verified address. Open the link we sent when you signed up, or request a new one from account settings.</Notice> : null}
            <form onSubmit={arm}>
              <div className="field">
                <label htmlFor="al-symbol">{simple ? "Which name?" : "Name"}</label>
                <SearchBar placeholder="Find a name in your universe" onPick={(r) => setSymbol(r.symbol)} />
                <input
                  id="al-symbol"
                  className="input mono"
                  value={symbol}
                  required
                  placeholder="Symbol"
                  style={{ textTransform: "uppercase", marginTop: "var(--s-2)" }}
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
                        More triggers <span className="sum-note">{restTriggers.filter(([k]) => picked.has(k)).length || ""}</span>
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
                    That is {plural(picked.size, "alert")} and your plan has {remaining} left. Untick {picked.size - remaining}, turn one off, or <Link to="/pricing">see plans</Link> with more.
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
                              Not in your plan · <Link to="/pricing">See plans</Link>
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
                      <Link to="/settings">Open account settings</Link>
                    </p>
                  )}
                  {(formErr.kind === "quota" || formErr.kind === "channel") && (
                    <p style={{ margin: "var(--s-2) 0 0" }}>
                      <Link to="/pricing">See plans</Link>
                    </p>
                  )}
                </Notice>
              )}
              <button className="btn btn-primary btn-block" disabled={busy || atQuota || (me && !me.verified) || !symbol.trim() || picked.size === 0}>
                {busy ? "Setting up…" : simple ? `Notify me${symbol ? ` about ${symbol}` : ""}` : `Arm ${picked.size || ""} alert${picked.size === 1 ? "" : "s"}`}
              </button>
              {atQuota && (
                <p className="help" style={{ marginTop: "var(--s-2)" }}>
                  You're using all {limit} alerts on {me.tier.label}. Turn one off, or <Link to="/pricing">see plans</Link> with more.
                </p>
              )}
            </form>
          </aside>
        </div>
      )}
    </div>
  );
}
