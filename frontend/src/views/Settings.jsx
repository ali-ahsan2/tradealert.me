import React, { useEffect, useState } from "react";
import { api, getToken, logout } from "../api.js";
import { navigate } from "../main.jsx";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function Settings() {
  const [me, setMe] = useState(null);
  const [ent, setEnt] = useState(null);
  const [allInd, setAllInd] = useState([]);
  const [followed, setFollowed] = useState([]);
  const [settings, setSettings] = useState(null);
  const [saving, setSaving] = useState("");
  const [msg, setMsg] = useState("");

  const load = () => {
    if (!getToken()) {
      setMe(null);
      setEnt(null);
      setSettings(null);
      setFollowed([]);
      return;
    }
    api("/me").then(setMe).catch(() => setMe(null));
    api("/entitlements").then(setEnt).catch(() => setEnt(null));
    api("/industries").then((d) => setAllInd(d.industries)).catch(() => setAllInd([]));
    api("/me/industries").then((d) => setFollowed(d.industries)).catch(() => setFollowed([]));
    api("/me/settings").then(setSettings).catch(() => setSettings(null));
  };
  useEffect(load, []);

  if (!getToken()) {
    return (
      <div className="wrap">
        <div className="table-card empty">
          <p>Sign in to manage your account.</p>
          <p style={{ marginTop: "var(--s-3)" }}>
            <a className="btn btn-primary" href="/login"
               onClick={(e) => { e.preventDefault(); navigate("/login"); }}>Sign in</a>
          </p>
        </div>
      </div>
    );
  }
  if (!me || !settings) return <div className="wrap"><div className="table-card empty">Loading…</div></div>;

  const patch = async (body, label) => {
    setSaving(label);
    setMsg("");
    try {
      const s = await api("/me/settings", { method: "PATCH", json: body });
      setSettings(s);
      setMsg(`Saved ${label}.`);
    } catch (e) {
      setMsg(e.detail || String(e.message));
    } finally {
      setSaving("");
    }
  };

  const follow = async (key) => {
    try {
      await api("/me/industries", { method: "POST", json: { key } });
      api("/me/industries").then((d) => setFollowed(d.industries));
    } catch (e) {
      setMsg(e.detail || String(e.message));
    }
  };
  const drop = async (key) => {
    await api(`/me/industries/${key}`, { method: "DELETE" }).catch(() => {});
    api("/me/industries").then((d) => setFollowed(d.industries));
  };

  const tier = ent?.current;
  const limit = tier ? tier.industries_limit : 1;
  const canFollow = limit >= 999 || followed.length < limit;

  return (
    <div className="wrap">
      <div className="pagehead">
        <h1>Account</h1>
        <div className="meta">Settings, industries, and delivery channels</div>
      </div>
      {msg && <p className="note">{msg}</p>}

      <div className="report">
        <div className="report-main">
          <section className="scoreblock">
            <h2 style={{ fontSize: "var(--fs-md)" }}>Plan</h2>
            <div className="row1">
              <span className="tag">{me.tier ? me.tier.label : "Free"}</span>
              <span className="st" style={{ marginLeft: "auto" }}>
                {me.tier ? `${me.tier.names_shown_limit} names · ${me.tier.industries_limit >= 999 ? "all" : me.tier.industries_limit} industries · ${me.tier.picks_limit} pinned` : ""}
              </span>
            </div>
            <p style={{ fontSize: "var(--fs-sm)", color: "var(--ink-muted)" }}>
              Email: <b>{me.email}</b> ·{" "}
              {me.verified ? "verified ✓" : "not verified — verification gates alerts and upgrades"}
            </p>
            <p className="st" style={{ fontSize: "var(--fs-sm)" }}>
              <a href="/pricing"
                 onClick={(e) => { e.preventDefault(); navigate("/pricing"); }}>
                Choose a plan
              </a>
            </p>
          </section>

          <section className="scoreblock">
            <h2 style={{ fontSize: "var(--fs-md)" }}>Industries</h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--s-2)" }}>
              {allInd.map((i) => {
                const isOn = followed.some((f) => f.key === i.key);
                return (
                  <div key={i.key} className="indrow">
                    <span>
                      <b>{i.label}</b>
                      <span className="st" style={{ color: "var(--ink-faint)", fontSize: "var(--fs-xs)" }}>
                        {" "}{i.universe_count} names · {i.benchmark_etf}
                      </span>
                    </span>
                    {isOn ? (
                      <button className="btn btn-secondary" style={{ padding: "4px 10px", fontSize: "var(--fs-sm)" }}
                              onClick={() => drop(i.key)}>Drop</button>
                    ) : (
                      <button className="btn btn-primary" style={{ padding: "4px 10px", fontSize: "var(--fs-sm)" }}
                              disabled={!canFollow} onClick={() => follow(i.key)}>Follow</button>
                    )}
                  </div>
                );
              })}
            </div>
            {!canFollow && (
              <p className="st" style={{ fontSize: "var(--fs-sm)", color: "var(--warn)" }}>
                Your plan follows {limit} industr{limit === 1 ? "y" : "ies"}; upgrade to follow more.
              </p>
            )}
          </section>

          <section className="scoreblock">
            <h2 style={{ fontSize: "var(--fs-md)" }}>Digest</h2>
            <div className="grid2">
              <label className="toggle">
                <input type="checkbox" checked={settings.digest_enabled}
                       onChange={(e) => patch({ digest_enabled: e.target.checked }, "digest")} />
                Weekly board digest
              </label>
              <label>Day
                <select value={settings.digest_day}
                        onChange={(e) => patch({ digest_day: Number(e.target.value) }, "digest day")}>
                  {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
                </select>
              </label>
              <label>Hour
                <select value={settings.digest_hour}
                        onChange={(e) => patch({ digest_hour: Number(e.target.value) }, "digest hour")}>
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
                  ))}
                </select>
              </label>
              <label>Timezone
                <select value={settings.timezone}
                        onChange={(e) => patch({ timezone: e.target.value }, "timezone")}>
                  <option>America/New_York</option>
                  <option>America/Los_Angeles</option>
                  <option>Europe/London</option>
                  <option>Asia/Tokyo</option>
                  <option>UTC</option>
                </select>
              </label>
            </div>
          </section>

          <section className="scoreblock">
            <h2 style={{ fontSize: "var(--fs-md)" }}>Away from the board</h2>
            <div className="grid2">
              <label className="toggle">
                <input type="checkbox" checked={settings.channel_email} disabled />
                Email
              </label>
              <label className="toggle">
                <input type="checkbox" checked={settings.channel_push}
                       disabled={!me.tier || !me.tier.channels.includes("push")}
                       onChange={(e) => patch({ channel_push: e.target.checked }, "push")} />
                Push
              </label>
              <label className="toggle">
                <input type="checkbox" checked={settings.channel_sms}
                       disabled={!me.tier || !me.tier.channels.includes("sms")}
                       onChange={(e) => patch({ channel_sms: e.target.checked }, "sms")} />
                SMS
              </label>
              <label className="field">Phone (SMS)
                <input value={settings.phone_number || ""}
                       placeholder="+1…"
                       onChange={(e) => patch({ phone_number: e.target.value }, "phone")} />
              </label>
            </div>
            <div className="field" style={{ marginTop: "var(--s-3)" }}>
              <label>Webhook URL (Investor; HMAC-SHA256 signed)</label>
              <input value={settings.webhook_url || ""}
                     placeholder="https://…"
                     disabled={!me.tier || !me.tier.channels.includes("webhook")}
                     onChange={(e) => patch({ webhook_url: e.target.value }, "webhook url")} />
            </div>
            {settings.webhook_secret_stored ? (
              <p className="st" style={{ fontSize: "var(--fs-sm)", color: "var(--ink-muted)" }}>
                A webhook secret is stored (encrypted).{" "}
                <a href="/settings"
                   onClick={(e) => { e.preventDefault(); patch({ regenerate_webhook_secret: true }, "webhook secret"); }}>
                  Regenerate
                </a>
              </p>
            ) : null}
          </section>
        </div>

        <aside className="sidebar">
          <h3>Password</h3>
          <p style={{ fontSize: "var(--fs-sm)", color: "var(--ink-muted)" }}>
            Use the reset link flow:{" "}
            <a href="/reset" onClick={(e) => { e.preventDefault(); navigate("/reset"); }}>
              send a reset email
            </a>
          </p>
          <h3>Session</h3>
          <button className="btn btn-secondary" style={{ width: "100%" }}
                  onClick={() => { logout(); navigate("/"); }}>
            Sign out
          </button>
          <div className="aside-note">
            Machine scores rank; the operator decides. Nothing here is a recommendation.
          </div>
        </aside>
      </div>
    </div>
  );
}

export default Settings;