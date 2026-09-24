import React, { useEffect, useState } from "react";
import { api, getToken } from "../api.js";
import { navigate } from "../main.jsx";

const TRIGGERS = [
  ["volume_3x", "Volume 3x+"],
  ["catalyst_dated", "Catalyst dated"],
  ["band_change", "Band change"],
  ["si_cross", "SI crosses 10/15/20%"],
  ["borrow_fee_2x", "Borrow fee 2x+"],
  ["insider_buying", "Insider buying"],
  ["s3_424b", "S-3 / 424B filing"],
  ["social_surge", "Social surge"],
  ["contract_award", "Contract award"],
];

export default function Alerts() {
  const [events, setEvents] = useState(null);
  const [rules, setRules] = useState(null);
  const [authed, setAuthed] = useState(getToken() != null);
  const [symbol, setSymbol] = useState("");
  const [trigger, setTrigger] = useState("volume_3x");
  const [msg, setMsg] = useState("");

  const load = () => {
    api("/alert-events").then((d) => setEvents(d.events)).catch(() => setEvents([]));
    if (getToken()) api("/me/alerts/rules").then((d) => setRules(d.rules)).catch(() => setRules([]));
  };
  useEffect(load, []);

  const arm = async (e) => {
    e.preventDefault();
    setMsg("");
    try {
      const d = await api("/me/alerts/rules", {
        method: "POST",
        json: { symbol, trigger_key: trigger, channels: ["email"] },
      });
      setSymbol("");
      setMsg(`Armed: ${d.rule.symbol} · ${d.rule.trigger_key} → email`);
      load();
    } catch (e2) {
      setMsg(e2.detail || String(e2.message));
    }
  };

  const disarm = async (id) => {
    await api(`/me/alerts/rules/${id}`, { method: "DELETE" }).catch(() => {});
    load();
  };

  const age = (iso) => {
    const ms = Date.now() - new Date(iso).getTime();
    const h = Math.floor(ms / 3.6e6);
    if (h < 1) return "just now";
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  };

  return (
    <div className="wrap">
      <div className="pagehead">
        <h1>Alerts</h1>
        <div className="meta">Impersonal events · your rules decide who hears them</div>
      </div>
      <div className="report">
        <div className="report-main">
          <h2 style={{ fontSize: "var(--fs-md)" }}>Event feed</h2>
          {!events ? (
            <div className="table-card empty">Loading…</div>
          ) : events.length === 0 ? (
            <div className="table-card empty">No events in your visible universe.</div>
          ) : (
            <div className="table-card">
              {events.map((ev, i) => (
                <div className="eventline" key={i}>
                  <a className="sym ntf" href={`/stock/${ev.symbol}`}
                     onClick={(e) => { e.preventDefault(); navigate(`/stock/${ev.symbol}`); }}>
                    {ev.symbol}
                  </a>
                  <span className="trig">{ev.trigger}</span>
                  <span className="evdetail">{ev.detail}</span>
                  <span className="agechip mono">{age(ev.fired_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <aside className="sidebar">
          <h3>Your rules</h3>
          {!authed ? (
            <div className="aside-note">
              <a href="/login"
                 onClick={(e) => { e.preventDefault(); navigate("/login"); }}>Sign in</a> and verify
              your email to arm alerts.
            </div>
          ) : rules && rules.length > 0 ? (
            rules.map((r) => (
              <div className="kv" key={r.id}>
                <span className="k">{r.symbol}</span>
                <span className="v">{r.trigger} · {r.channels.join(", ")}</span>
                <button className="pin" onClick={() => disarm(r.id)} title="Disarm">✕</button>
              </div>
            ))
          ) : (
            <div className="aside-note">No rules armed.</div>
          )}
          {authed && (
            <form onSubmit={arm} style={{ marginTop: "var(--s-3)" }}>
              <div className="field">
                <label htmlFor="al-symbol">Symbol</label>
                <input id="al-symbol" value={symbol} required
                       placeholder="e.g. PDYN"
                       onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
              </div>
              <div className="field">
                <label htmlFor="al-trigger">Trigger</label>
                <select id="al-trigger" value={trigger} onChange={(e) => setTrigger(e.target.value)}>
                  {TRIGGERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </div>
              <button className="btn btn-primary" style={{ width: "100%" }}>Arm alert (email)</button>
            </form>
          )}
          {msg && <p className="note" style={{ fontSize: "var(--fs-sm)" }}>{msg}</p>}
        </aside>
      </div>
    </div>
  );
}