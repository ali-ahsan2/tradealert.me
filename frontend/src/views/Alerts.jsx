import React, { useEffect, useMemo, useState } from "react";
import { api, cached, toast } from "../api.js";
import { Link, useQuery } from "../lib/router.jsx";
import { hasChannel, useMe } from "../lib/me.jsx";
import { age, dateTime, dollars, shortDate } from "../lib/fmt.js";
import { DILUTION_TRIGGERS, TRIGGERS } from "../lib/evidence.js";
import SearchBar from "../components/SearchBar.jsx";
import { Empty, ErrorCard, Notice, Skeleton } from "../components/ui.jsx";

const CHANNELS = [
  ["email", "Email"],
  ["push", "Web push"],
  ["sms", "SMS"],
  ["webhook", "Webhook"],
];

function AlertItem({ ev, tz }) {
  const dilution = DILUTION_TRIGGERS.has(ev.trigger_key);
  const a = age(ev.fired_at);
  return (
    <article className="card alert">
      <div className="r1">
        <Link className="sym" to={`/stock/${ev.symbol}`}>
          {ev.symbol}
        </Link>
        <span className="chip chip-plain">{ev.trigger}</span>
        <span className="when" title={dateTime(ev.fired_at, tz)}>
          {a ? `${a.label} ago` : shortDate(ev.fired_at, tz)}
        </span>
      </div>
      <div className={`r2 ${dilution ? "dilution" : ""}`}>{ev.detail || ev.trigger}</div>
      <div className="r3">
        {ev.theme ? `${ev.theme} · ` : ""}
        {ev.delivered > 0 ? "delivered to you" : "not armed on your account; shown because the name is in your universe"}
      </div>
      <div className="r4">
        <Link to={`/stock/${ev.symbol}`}>View report →</Link>
      </div>
    </article>
  );
}

// Fabricated placeholder for the Free-tier lock screen. Never a real name.
const SAMPLE_EVENTS = [
  {
    symbol: "EXMPL",
    theme: "Example only",
    trigger_key: "borrow_fee_2x",
    trigger: "Borrow fee 2x+",
    detail: "Borrow fee 2.4x its 5-session average (was 12.1%, now 29.4%)",
    fired_at: new Date(Date.now() - 36e5 * 5).toISOString(),
    delivered: 1,
  },
  {
    symbol: "EXMPL",
    theme: "Example only",
    trigger_key: "volume_3x",
    trigger: "Volume at 3x+",
    detail: "Volume 3.6x the 20-day average by midday",
    fired_at: new Date(Date.now() - 36e5 * 30).toISOString(),
    delivered: 1,
  },
];

export default function Alerts() {
  const { me } = useMe();
  const q = useQuery();
  const [tab, setTab] = useState(q.get("tab") === "armed" ? "armed" : "history");
  const [events, setEvents] = useState(null);
  const [rules, setRules] = useState(null);
  const [tiers, setTiers] = useState(null);
  const [err, setErr] = useState(null);
  const [reload, setReload] = useState(0);
  const [symbol, setSymbol] = useState((q.get("symbol") || "").toUpperCase());
  const [trigger, setTrigger] = useState("volume_3x");
  const [channels, setChannels] = useState(["email"]);
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState(null);

  const locked = Boolean(me && me.tier && me.tier.alerts_limit === 0);

  useEffect(() => {
    let alive = true;
    setErr(null);
    if (!locked) {
      api("/alert-events")
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
  }, [reload, locked]);

  const limit = me && me.tier ? me.tier.alerts_limit : null;
  const used = rules ? rules.length : 0;
  const atQuota = limit != null && used >= limit;
  const tz = me && me.settings ? me.settings.timezone : undefined;
  const triggerMeta = useMemo(() => TRIGGERS.find((t) => t[0] === trigger), [trigger]);
  const firstAlertTier =
    tiers &&
    [...tiers]
      .sort((a, b) => a.price_monthly_cents - b.price_monthly_cents)
      .find((t) => t.alerts_limit !== 0);

  const arm = async (e) => {
    e.preventDefault();
    setFormErr(null);
    setBusy(true);
    try {
      const d = await api("/me/alerts/rules", {
        method: "POST",
        json: { symbol: symbol.trim().toUpperCase(), trigger_key: trigger, channels },
      });
      toast(`Armed ${d.rule.symbol} · ${triggerMeta ? triggerMeta[1] : trigger}`);
      setSymbol("");
      setReload((n) => n + 1);
    } catch (e2) {
      setFormErr(e2.detail || "Couldn't arm that alert.");
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

  const toggleChannel = (c) =>
    setChannels((cs) => (cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c]));

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
            {SAMPLE_EVENTS.map((ev, i) => (
              <AlertItem key={i} ev={ev} />
            ))}
          </div>
          <div className="panel">
            <div className="card">
              <p className="eyebrow">Example shown behind</p>
              <h2>Alerts are included from {firstAlertTier ? firstAlertTier.label : "Basic"}.</h2>
              <p className="muted">
                An alert fires on a concrete, impersonal trigger: a borrow fee doubling, a FINRA short-interest
                print crossing a threshold, volume at 3x, a dated catalyst, an S-3 filing.
              </p>
              {firstAlertTier && (
                <p className="muted">
                  {firstAlertTier.label} includes{" "}
                  {firstAlertTier.alerts_limit == null ? "unlimited alerts" : `${firstAlertTier.alerts_limit} alerts`}{" "}
                  and {firstAlertTier.channels.map((c) => CHANNELS.find((x) => x[0] === c)?.[1] || c).join(", ")} delivery,{" "}
                  {dollars(firstAlertTier.price_monthly_cents)}/mo.
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
      </div>

      <div className="tabs" role="tablist" aria-label="Alerts">
        <button role="tab" className="tab" aria-selected={tab === "history"} onClick={() => setTab("history")}>
          History{events ? ` · ${events.length}` : ""}
        </button>
        <button role="tab" className="tab" aria-selected={tab === "armed"} onClick={() => setTab("armed")}>
          Armed{rules ? ` · ${rules.length}` : ""}
        </button>
      </div>

      {tab === "history" && (
        <>
          {err && <ErrorCard error={err} onRetry={() => setReload((n) => n + 1)} title="Couldn't load alert history." />}
          {!err && !events && <Skeleton rows={6} height={92} />}
          {events && events.length === 0 && (
            <Empty
              title="No alerts have fired yet."
              action={
                rules && rules.length === 0 ? (
                  <button className="btn btn-primary" onClick={() => setTab("armed")}>
                    Arm your first alert
                  </button>
                ) : null
              }
            >
              {rules && rules.length > 0
                ? `You have ${rules.length} trigger${rules.length === 1 ? "" : "s"} armed; we'll email you when one fires.`
                : "Nothing is armed on your account."}
            </Empty>
          )}
          {events && events.length > 0 && (
            <div className="alert-list">
              {events.map((ev, i) => (
                <AlertItem key={`${ev.symbol}-${ev.fired_at}-${i}`} ev={ev} tz={tz} />
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
                Alerts:{" "}
                <b>
                  {limit == null ? `${used} armed · unlimited` : `${used} of ${limit} used`}
                </b>{" "}
                · {me && me.tier ? me.tier.label : ""}
              </span>
              {atQuota && <Link to="/pricing">See plans for more</Link>}
            </div>
            {!rules && <Skeleton rows={4} height={44} />}
            {rules && rules.length === 0 && (
              <Empty title="No alerts armed.">Use the form to arm your first trigger.</Empty>
            )}
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
                        <td className="muted">{r.channels.join(", ")}</td>
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
              Arm an alert
            </h2>
            {me && !me.verified ? (
              <Notice tone="warn">Verify your email before arming alerts. The link is in your inbox.</Notice>
            ) : null}
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
                <label htmlFor="al-trigger">Trigger</label>
                <select id="al-trigger" value={trigger} onChange={(e) => setTrigger(e.target.value)}>
                  {TRIGGERS.map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
                {triggerMeta && <span className="help">{triggerMeta[2]}</span>}
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
              <button
                className="btn btn-primary btn-block"
                disabled={busy || atQuota || (me && !me.verified) || !symbol.trim()}
              >
                {busy ? "Arming…" : "Arm alert"}
              </button>
              {atQuota && (
                <p className="help" style={{ marginTop: "var(--s-2)" }}>
                  You're using all {limit} alerts on {me.tier.label}. Disarm one, or{" "}
                  <Link to="/pricing">see plans</Link> with more.
                </p>
              )}
            </form>
          </aside>
        </div>
      )}
    </div>
  );
}
