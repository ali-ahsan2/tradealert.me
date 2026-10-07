import React, { useEffect, useMemo, useState } from "react";
import { api, cached, toast } from "../api.js";
import { Link, navigate, useQuery } from "../lib/router.jsx";
import { hasChannel, useMe } from "../lib/me.jsx";
import { dollars, pct, rate, shortDate, signed, tone } from "../lib/fmt.js";
import { TRIGGERS } from "../lib/evidence.js";
import SearchBar from "../components/SearchBar.jsx";
import { AlertItem } from "../components/EventList.jsx";
import { Empty, ErrorCard, Notice, Skeleton } from "../components/ui.jsx";

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

function buildQuery(params) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== "" && v != null && v !== false) qs.set(k, String(v));
  });
  const s = qs.toString();
  return s ? `?${s}` : "";
}

export default function Alerts() {
  const { me } = useMe();
  const q = useQuery();
  const tab = q.get("tab") === "armed" ? "armed" : q.get("tab") === "outcomes" ? "outcomes" : "history";
  const fTrigger = q.get("trigger") || "";
  const fSymbol = (q.get("symbol") || "").toUpperCase();
  const fUnread = q.get("unread") === "1";
  const fDays = Number(q.get("days") || 365);

  const [events, setEvents] = useState(null);
  const [rules, setRules] = useState(null);
  const [tiers, setTiers] = useState(null);
  const [err, setErr] = useState(null);
  const [reload, setReload] = useState(0);
  const [symbol, setSymbol] = useState(fSymbol);
  const [picked, setPicked] = useState(new Set(["volume_3x"]));
  const [channels, setChannels] = useState(["email"]);
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState(null);
  const [outcomes, setOutcomes] = useState(null);
  const [outErr, setOutErr] = useState(null);
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
      api(`/alert-events${buildQuery({ trigger: fTrigger, symbol: fSymbol, unread: fUnread ? 1 : "", days: fDays, limit: 100 })}`)
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

  useEffect(() => setSymbol(fSymbol), [fSymbol]);

  const setFilters = (next) =>
    navigate(`/alerts${buildQuery({ tab, trigger: fTrigger, symbol: fSymbol, unread: fUnread ? 1 : "", days: fDays === 365 ? "" : fDays, ...next })}`, {
      replace: true,
    });
  const setTab = (t) => navigate(`/alerts${buildQuery({ tab: t === "history" ? "" : t, symbol: t === "armed" ? fSymbol : "" })}`, { replace: true });

  const limit = me && me.tier ? me.tier.alerts_limit : null;
  const used = rules ? rules.length : 0;
  const remaining = limit == null ? Infinity : Math.max(0, limit - used);
  const atQuota = remaining === 0;
  const tz = me && me.settings ? me.settings.timezone : undefined;
  const unreadCount = useMemo(() => (events || []).filter((e) => e.read === false).length, [events]);
  const firstAlertTier = tiers && [...tiers].sort((a, b) => a.price_monthly_cents - b.price_monthly_cents).find((t) => t.alerts_limit !== 0);

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

  const arm = async (e) => {
    e.preventDefault();
    setFormErr(null);
    const keys = TRIGGERS.map(([k]) => k).filter((k) => picked.has(k));
    if (keys.length === 0) return setFormErr("Choose at least one trigger.");
    if (remaining !== Infinity && keys.length > remaining) {
      return setFormErr(`That is ${keys.length} alerts; your plan has ${remaining} left.`);
    }
    setBusy(true);
    let armed = 0;
    try {
      for (const k of keys) {
        // sequential on purpose: the quota is checked server-side per rule
        // eslint-disable-next-line no-await-in-loop
        await api("/me/alerts/rules", { method: "POST", json: { symbol: symbol.trim().toUpperCase(), trigger_key: k, channels } });
        armed += 1;
      }
      toast(`Armed ${armed} alert${armed === 1 ? "" : "s"} on ${symbol.toUpperCase()}.`);
      setSymbol("");
      setReload((n) => n + 1);
    } catch (e2) {
      setFormErr(`${armed ? `Armed ${armed}, then: ` : ""}${e2.detail || "couldn't arm that alert."}`);
      if (armed) setReload((n) => n + 1);
    } finally {
      setBusy(false);
    }
  };

  const disarm = async (id) => {
    try {
      await api(`/me/alerts/rules/${id}`, { method: "DELETE" });
      setRules((r) => r.filter((x) => x.id !== id));
      toast("Alert disarmed.");
    } catch (e) {
      toast(e.detail || "Couldn't disarm. Try again.");
    }
  };

  const setRuleChannels = async (rule, next) => {
    if (next.length === 0) return toast("Keep at least one channel, or disarm the alert.");
    try {
      const d = await api(`/me/alerts/rules/${rule.id}`, { method: "PATCH", json: { channels: next } });
      setRules((rs) => rs.map((x) => (x.id === rule.id ? { ...x, channels: d.rule.channels } : x)));
    } catch (e) {
      toast(e.detail || "Couldn't change channels.");
    }
  };

  const toggleChannel = (c) => setChannels((cs) => (cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c]));

  if (locked) {
    return (
      <div className="wrap">
        <div className="pagehead">
          <div>
            <h1>Alerts</h1>
            <div className="meta">What fired on the names you can see, and the triggers you have armed.</div>
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
              <p className="muted">
                An alert fires on a concrete, impersonal trigger: a borrow fee doubling, a FINRA short-interest print crossing a threshold, volume at 3x, a dated
                catalyst, an S-3 filing.
              </p>
              {firstAlertTier && (
                <p className="muted">
                  {firstAlertTier.label} includes {firstAlertTier.alerts_limit == null ? "unlimited alerts" : `${firstAlertTier.alerts_limit} alerts`} and{" "}
                  {firstAlertTier.channels.map((c) => CHANNELS.find((x) => x[0] === c)?.[1] || c).join(", ")} delivery, {dollars(firstAlertTier.price_monthly_cents)}
                  /mo.
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

  return (
    <div className="wrap">
      <div className="pagehead">
        <div>
          <h1>Alerts</h1>
          <div className="meta">What fired on the names you can see, and the triggers you have armed.</div>
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
          History{events ? ` · ${events.length}` : ""}
          {unreadCount > 0 && <span className="navbadge">{unreadCount}</span>}
        </button>
        <button role="tab" className="tab" aria-selected={tab === "armed"} onClick={() => setTab("armed")}>
          Armed{rules ? ` · ${rules.length}` : ""}
        </button>
        <button role="tab" className="tab" aria-selected={tab === "outcomes"} onClick={() => setTab("outcomes")}>
          Outcomes
        </button>
      </div>

      {tab === "outcomes" && (
        <>
          <div className="filters-row">
            <span className="muted small">What price did after each trigger fired on the names you can see, measured on daily bars.</span>
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
          {outErr && <ErrorCard error={outErr} onRetry={() => setReload((n) => n + 1)} title="Couldn't load outcomes." />}
          {!outErr && !outcomes && <Skeleton rows={5} height={44} />}
          {outcomes && outcomes.triggers.length === 0 && <Empty title="No alert has fired on your names in this window." />}
          {outcomes && outcomes.triggers.length > 0 && (
            <>
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
                            <Link to={`/alerts?trigger=${t.key}`}>{t.label}</Link>
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
              <p className="footnote">{outcomes.method} These are measured moves on your universe, not a backtest and not a forecast; averages on small counts swing with one name.</p>
              {outcomes.events.length > 0 && (
                <section className="card" aria-labelledby="oe-h">
                  <div className="card-title">
                    <h2 id="oe-h">Recent events and what followed</h2>
                    <span className="muted small">latest {outcomes.events.length}</span>
                  </div>
                  <div className="tscroll">
<table className="hf reactions">
                    <thead>
                      <tr>
                        <th scope="col">Date</th>
                        <th scope="col">Name</th>
                        <th scope="col">Trigger</th>
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
                          <td title={ev.detail}>{ev.trigger}</td>
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
          <div className="filters-row">
            <label className="ctl">
              Trigger
              <select className="inline" value={fTrigger} onChange={(e) => setFilters({ trigger: e.target.value })}>
                <option value="">All</option>
                {TRIGGERS.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
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
            <label className="check" style={{ padding: 0 }}>
              <input type="checkbox" checked={fUnread} onChange={(e) => setFilters({ unread: e.target.checked ? 1 : "" })} />
              <span>Unread only</span>
            </label>
            {fSymbol && (
              <span className="chip chip-plain">
                {fSymbol}{" "}
                <button className="btn-quiet" style={{ padding: "0 4px" }} onClick={() => setFilters({ symbol: "" })} aria-label="Clear symbol filter">
                  ×
                </button>
              </span>
            )}
            <span className="spacer" />
            <SearchBar placeholder="Filter by name" onPick={(r) => setFilters({ symbol: r.symbol })} />
          </div>

          {err && <ErrorCard error={err} onRetry={() => setReload((n) => n + 1)} title="Couldn't load alert history." />}
          {!err && !events && <Skeleton rows={6} height={92} />}
          {events && events.length === 0 && (
            <Empty
              title={fTrigger || fSymbol || fUnread ? "No alerts match these filters." : "No alerts have fired yet."}
              action={
                fTrigger || fSymbol || fUnread ? (
                  <button className="btn btn-secondary" onClick={() => navigate("/alerts", { replace: true })}>
                    Clear filters
                  </button>
                ) : rules && rules.length === 0 ? (
                  <button className="btn btn-primary" onClick={() => setTab("armed")}>
                    Arm your first alert
                  </button>
                ) : null
              }
            >
              {!fTrigger && !fSymbol && !fUnread && rules && rules.length > 0
                ? `You have ${rules.length} trigger${rules.length === 1 ? "" : "s"} armed; we'll email you when one fires.`
                : null}
            </Empty>
          )}
          {events && events.length > 0 && (
            <div className="alert-list">
              {events.map((ev) => (
                <AlertItem key={ev.id} ev={ev} tz={tz} onRead={onRead} />
              ))}
            </div>
          )}
        </>
      )}

      {tab === "armed" && (
        <div className="report">
          <div className="report-main stack">
            <div className="quota-line">
              <span>
                Alerts: <b>{limit == null ? `${used} armed · unlimited` : `${used} of ${limit} used`}</b> · {me && me.tier ? me.tier.label : ""}
              </span>
              {atQuota && <Link to="/pricing">See plans for more</Link>}
            </div>
            {!rules && <Skeleton rows={4} height={44} />}
            {rules && rules.length === 0 && <Empty title="No alerts armed.">Use the form to arm your first trigger.</Empty>}
            {rules && rules.length > 0 && (
              <div className="table-card">
                <table className="data comfortable">
                  <thead>
                    <tr>
                      <th scope="col">Name</th>
                      <th scope="col">Trigger</th>
                      <th scope="col">Channels</th>
                      <th scope="col">Armed</th>
                      <th scope="col">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rules.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <Link className="sym" to={`/stock/${r.symbol}`}>
                            {r.symbol}
                          </Link>
                        </td>
                        <td>{r.trigger}</td>
                        <td>
                          <span className="chan-chips" role="group" aria-label={`Channels for ${r.symbol} ${r.trigger}`}>
                            {CHANNELS.map(([k, label]) => {
                              const allowed = k === "email" || hasChannel(me, k);
                              const on = r.channels.includes(k);
                              return (
                                <button
                                  key={k}
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
                        </td>
                        <td className="muted mono">{shortDate(r.armed_at, tz)}</td>
                        <td style={{ textAlign: "right" }}>
                          <button className="btn btn-secondary btn-sm" onClick={() => disarm(r.id)}>
                            Disarm
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <aside className="card" aria-labelledby="arm-h">
            <h2 id="arm-h" style={{ marginBottom: "var(--s-3)" }}>
              Arm alerts
            </h2>
            {me && !me.verified ? <Notice tone="warn">Verify your email before arming alerts. The link is in your inbox.</Notice> : null}
            <form onSubmit={arm}>
              <div className="field">
                <label htmlFor="al-symbol">Name</label>
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
                  Triggers{" "}
                  <span className="faint">
                    ({picked.size} chosen{remaining !== Infinity ? `, ${remaining} left on your plan` : ""})
                  </span>
                </span>
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
              </div>
              <div className="field">
                <span className="field-label">Deliver by</span>
                {CHANNELS.map(([k, label]) => {
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
                })}
              </div>
              {formErr && (
                <p className="err" role="alert">
                  {formErr}
                </p>
              )}
              <button className="btn btn-primary btn-block" disabled={busy || atQuota || (me && !me.verified) || !symbol.trim() || picked.size === 0}>
                {busy ? "Arming…" : `Arm ${picked.size || ""} alert${picked.size === 1 ? "" : "s"}`}
              </button>
              {atQuota && (
                <p className="help" style={{ marginTop: "var(--s-2)" }}>
                  You're using all {limit} alerts on {me.tier.label}. Disarm one, or <Link to="/pricing">see plans</Link> with more.
                </p>
              )}
            </form>
          </aside>
        </div>
      )}
    </div>
  );
}
