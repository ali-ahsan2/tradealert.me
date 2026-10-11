import React, { useEffect, useState } from "react";
import { api, cached, logout, toast } from "../api.js";
import { Link, navigate, useQuery } from "../lib/router.jsx";
import { openUpgrade } from "../lib/upgrade.js";
import { hasChannel, useMe } from "../lib/me.jsx";
import { DAYS, dollars, downloadText, industriesLabel, plural, shortDate, tzList } from "../lib/fmt.js";
import { CTA } from "../lib/plain.js";
import ScreenHead from "../components/ScreenHead.jsx";
import FinePrint from "../components/FinePrint.jsx";
import { ErrorCard, Meter, Modal, Notice, Skeleton } from "../components/ui.jsx";

// My account (DESIGN_V6 §2: the labels are mine). One line and, when the
// address is unverified, one action; then the sections.
const SECTIONS = [
  ["profile", "Profile"],
  ["industries", "My industries"],
  ["channels", "How to reach me"],
  ["digest", "My week, by email"],
  ["plan", "My plan"],
  ["data", "My data"],
];

function Section({ id, title, lead, children }) {
  return (
    <section id={id} className="card settings-section" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>{title}</h2>
      {lead && <p className="lead">{lead}</p>}
      {children}
    </section>
  );
}

// POST /api/me/verify/resend (DESIGN_V6 §10, rate-limited). Until the
// endpoint ships a 404 is answered in words, never as a crash.
function ResendVerify({ primary = false }) {
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      await api("/me/verify/resend", { method: "POST", json: {} });
      toast("Sent. Check your inbox for the new link.");
    } catch (e) {
      toast(e.status === 404 || e.status === 405 ? "Resending isn't available yet. The first email still works for a day." : e.detail || "Couldn't resend. Try again in a minute.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" className={`btn ${primary ? "btn-primary" : "btn-secondary btn-sm"} resend-btn`} disabled={busy} onClick={send}>
      {busy ? "Sending…" : primary ? "Verify my email" : "Resend the email"}
    </button>
  );
}

export default function Settings() {
  const { me, refresh } = useMe();
  const q = useQuery();
  const [ent, setEnt] = useState(null);
  const [allInd, setAllInd] = useState([]);
  const [followed, setFollowed] = useState(null);
  const [settings, setSettings] = useState(null);
  const [health, setHealth] = useState(null);
  const [err, setErr] = useState(null);
  const [saving, setSaving] = useState("");
  const [saved, setSaved] = useState("");
  const [confirmDrop, setConfirmDrop] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    setErr(null);
    Promise.all([api("/entitlements"), cached("/industries"), api("/me/industries"), api("/me/settings"), api("/billing/health").catch(() => null)])
      .then(([e, i, f, s, h]) => {
        if (!alive) return;
        setEnt(e);
        setAllInd(i.industries);
        setFollowed(f.industries);
        setSettings(s);
        setHealth(h);
      })
      .catch((e) => alive && setErr(e));
    return () => {
      alive = false;
    };
  }, [reload]);

  useEffect(() => {
    const hash = window.location.hash.replace("#", "");
    if (hash && settings) {
      const el = document.getElementById(hash);
      if (el) el.scrollIntoView({ block: "start" });
    }
  }, [settings]);

  const patch = async (body, label) => {
    setSaving(label);
    setSaved("");
    try {
      const s = await api("/me/settings", { method: "PATCH", json: body });
      setSettings(s);
      setSaved(label);
      setTimeout(() => setSaved(""), 3000);
      if (body.timezone) refresh();
    } catch (e) {
      toast(e.detail || `Couldn't save ${label}.`);
    } finally {
      setSaving("");
    }
  };

  const follow = async (key) => {
    try {
      await api("/me/industries", { method: "POST", json: { key } });
      const d = await api("/me/industries");
      setFollowed(d.industries);
      refresh();
    } catch (e) {
      toast(e.detail || "Couldn't add that industry.");
    }
  };

  const drop = async (key) => {
    setConfirmDrop(null);
    try {
      const r = await api(`/me/industries/${key}`, { method: "DELETE" });
      const d = await api("/me/industries");
      setFollowed(d.industries);
      refresh();
      if (r.affected_picks > 0) toast(`${plural(r.affected_picks, "watched name")} in that industry stay saved but may no longer be visible.`);
    } catch (e) {
      toast(e.detail || "Couldn't stop watching that industry.");
    }
  };

  const portal = async () => {
    try {
      const { url } = await api("/billing/portal", { method: "POST" });
      window.location.href = url;
    } catch (e) {
      toast(e.detail || "Billing portal is not available right now.");
    }
  };

  const exportData = async () => {
    try {
      const doc = await api("/me/export");
      downloadText(`tradealert-export-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(doc, null, 2), "application/json");
    } catch (e) {
      toast(e.detail || "Couldn't export your data.");
    }
  };

  if (err) {
    return (
      <div className="wrap wrap-narrow">
        <ErrorCard error={err} onRetry={() => setReload((n) => n + 1)} title="Couldn't load your account." />
      </div>
    );
  }
  if (!me || !settings || !followed || !ent) {
    return (
      <div className="wrap wrap-narrow">
        <ScreenHead title="My account" line="Where alerts reach you, which industries are watched, your plan." />
        <Skeleton rows={5} height={120} />
      </div>
    );
  }

  const tier = ent.current || me.tier;
  const limit = tier ? tier.industries_limit : 1;
  const canFollow = limit >= 999 || followed.length < limit;
  const usage = ent.usage || {};
  const nextTier = [...ent.tiers].sort((a, b) => a.price_monthly_cents - b.price_monthly_cents).find((t) => tier && t.price_monthly_cents > tier.price_monthly_cents);
  const status = (label) => (saving === label ? "Saving…" : saved === label ? "Saved" : "");
  const paid = tier && tier.price_monthly_cents > 0;

  return (
    <div className="wrap wrap-narrow">
      <ScreenHead
        title="My account"
        line="Where alerts reach you, which industries are watched, your plan."
        action={!me.verified ? <ResendVerify primary /> : null}
      />

      {q.get("billing") === "success" && (
        <Notice tone="pos">
          Your plan change went through. It can take a moment for the new limits to show here. <Link to="/home">Back to my Home</Link>
        </Notice>
      )}

      <nav className="settings-nav" aria-label="Sections">
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#${id}`}>
            {label}
          </a>
        ))}
      </nav>

      <Section id="profile" title="Profile">
        <div className="kv">
          <span className="k">Email</span>
          <span className="v" style={{ fontFamily: "inherit" }}>
            {me.email}
          </span>
        </div>
        <div className="kv">
          <span className="k">Status</span>
          <span className="v" style={{ fontFamily: "inherit" }}>
            {me.verified ? <span>Verified</span> : <span className="warn">Not verified · alerts, digests and upgrades wait on it</span>}
            {!me.verified && <ResendVerify />}
          </span>
        </div>
        {me.provider && (
          <div className="kv">
            <span className="k">Sign-in</span>
            <span className="v" style={{ fontFamily: "inherit" }}>
              {me.provider}
            </span>
          </div>
        )}
        <div className="kv">
          <span className="k">Member since</span>
          <span className="v">{shortDate(me.created_at)}</span>
        </div>
        <div className="field" style={{ marginTop: "var(--s-4)" }}>
          <label htmlFor="tz">Timezone</label>
          <select id="tz" value={settings.timezone} onChange={(e) => patch({ timezone: e.target.value }, "timezone")}>
            {[settings.timezone, ...tzList().filter((z) => z !== settings.timezone)].map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
          <span className="help">Sets when your weekly brief arrives and every timestamp you see here.</span>
          <span className="save-status" aria-live="polite">
            {status("timezone")}
          </span>
        </div>
        {me.provider ? (
          <p className="small muted" style={{ marginBottom: 0 }}>
            You log in with {me.provider}. To add a password, <Link to="/reset">send yourself a reset link</Link>.
          </p>
        ) : (
          <PasswordForm />
        )}
      </Section>

      <Section
        id="industries"
        title="My industries"
        lead={`Every name in each industry you watch is rated each morning. ${followed.length} of ${industriesLabel(limit)} picked · ${tier ? tier.label : "Free"}.`}
      >
        <div className="indlist">
          {allInd.map((i) => {
            const isOn = followed.some((f) => f.key === i.key);
            return (
              <div key={i.key} className={`indrow ${isOn ? "on" : ""}`}>
                <div className="who">
                  <b>
                    <Link to={`/industries/${i.key}`} style={{ color: "inherit" }}>
                      {i.label}
                    </Link>
                  </b>
                  <span>
                    {i.universe_count} names · <span className="mono">{i.benchmark_etf}</span>
                  </span>
                </div>
                {isOn ? (
                  <button className="btn btn-secondary btn-sm" onClick={() => setConfirmDrop(i)}>
                    {CTA.STOP_WATCHING}
                  </button>
                ) : (
                  <button className="btn btn-secondary btn-sm" disabled={!canFollow} onClick={() => follow(i.key)}>
                    Watch for me
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {!canFollow && (
          <p className="small muted" style={{ marginTop: "var(--s-3)", marginBottom: 0 }}>
            {tier.label} watches {industriesLabel(limit)}.
            {nextTier && (
              <>
                {" "}
                {nextTier.label} watches {industriesLabel(nextTier.industries_limit)}. <button type="button" className="linkbtn" onClick={() => openUpgrade("industries")}>{CTA.NEXT_PLAN}</button>
              </>
            )}
          </p>
        )}
      </Section>

      <Section id="channels" title="How to reach me" lead="Where alerts and the weekly brief reach you.">
        <label className="check">
          <input type="checkbox" checked={settings.channel_email !== false} onChange={(e) => patch({ channel_email: e.target.checked }, "email")} />
          <span>
            Email · {me.email}
            <span className="lock-note">
              Account emails always arrive; alerts and the weekly brief can be turned off.
              {status("email") ? ` ${status("email")}` : ""}
            </span>
          </span>
        </label>
        <label className={`check ${hasChannel(me, "push") ? "" : "locked"}`}>
          <input type="checkbox" checked={Boolean(settings.channel_push)} disabled={!hasChannel(me, "push")} onChange={(e) => patch({ channel_push: e.target.checked }, "push")} />
          <span>
            Web push
            {!hasChannel(me, "push") && (
              <span className="lock-note">
                Basic and above · <button type="button" className="linkbtn" onClick={() => openUpgrade("channels", { channel: "push" })}>{CTA.NEXT_PLAN}</button>
              </span>
            )}
          </span>
        </label>
        <label className={`check ${hasChannel(me, "sms") ? "" : "locked"}`}>
          <input type="checkbox" checked={Boolean(settings.channel_sms)} disabled={!hasChannel(me, "sms")} onChange={(e) => patch({ channel_sms: e.target.checked }, "sms")} />
          <span>
            SMS
            {!hasChannel(me, "sms") && (
              <span className="lock-note">
                Pro and above · <button type="button" className="linkbtn" onClick={() => openUpgrade("channels", { channel: "sms" })}>{CTA.NEXT_PLAN}</button>
              </span>
            )}
          </span>
        </label>
        {hasChannel(me, "sms") && <PhoneField settings={settings} onSave={(v) => patch({ phone_number: v }, "phone")} status={status("phone")} />}
        <div className="field" style={{ marginTop: "var(--s-3)" }}>
          <label htmlFor="webhook-url">
            Webhook URL{" "}
            {!hasChannel(me, "webhook") && (
              <span className="faint">
                · Investor only · <button type="button" className="linkbtn" onClick={() => openUpgrade("channels", { channel: "webhook" })}>{CTA.NEXT_PLAN}</button>
              </span>
            )}
          </label>
          <WebhookField settings={settings} disabled={!hasChannel(me, "webhook")} onSave={(v) => patch({ webhook_url: v }, "webhook URL")} status={status("webhook URL")} />
          <span className="help">HTTPS only. Every delivery is signed with HMAC-SHA256 using your secret.</span>
        </div>
        {hasChannel(me, "webhook") && (
          <div className="small muted">
            {settings.webhook_secret_stored ? (
              <>
                A signing secret is stored (encrypted).{" "}
                {settings.webhook_secret && (
                  <>
                    <button className="btn-quiet" onClick={() => setShowSecret((s) => !s)}>
                      {showSecret ? "Hide" : "Reveal"}
                    </button>
                    {showSecret && <code className="mono">{settings.webhook_secret}</code>}{" "}
                  </>
                )}
                <button className="btn-quiet" onClick={() => patch({ regenerate_webhook_secret: true }, "webhook secret")}>
                  Rotate
                </button>
              </>
            ) : (
              <button className="btn-quiet" onClick={() => patch({ regenerate_webhook_secret: true }, "webhook secret")}>
                Generate a signing secret
              </button>
            )}
            {settings.webhook_auto_disabled_at && (
              <Notice tone="neg">
                Deliveries were paused on {shortDate(settings.webhook_auto_disabled_at)} after repeated failures.{" "}
                <button className="btn-quiet" onClick={() => patch({ reset_auto_disable: true }, "webhook")}>
                  Resume
                </button>
              </Notice>
            )}
          </div>
        )}
      </Section>

      <Section id="digest" title="My week, by email" lead="Your names, frozen into an email once a week. The preview and past briefs live under My week.">
        <label className="check">
          <input type="checkbox" checked={Boolean(settings.digest_enabled)} onChange={(e) => patch({ digest_enabled: e.target.checked }, "digest")} />
          <span>Send me the weekly brief</span>
        </label>
        <div className="grid2" style={{ marginTop: "var(--s-2)" }}>
          <div className="field">
            <label htmlFor="dday">Day</label>
            <select id="dday" value={settings.digest_day} disabled={!settings.digest_enabled} onChange={(e) => patch({ digest_day: Number(e.target.value) }, "digest day")}>
              {DAYS.map((d, i) => (
                <option key={i} value={i}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="dhour">Hour ({settings.timezone})</label>
            <select id="dhour" value={settings.digest_hour} disabled={!settings.digest_enabled} onChange={(e) => patch({ digest_hour: Number(e.target.value) }, "digest hour")}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, "0")}:00
                </option>
              ))}
            </select>
          </div>
        </div>
        <span className="save-status" aria-live="polite">
          {status("digest") || status("digest day") || status("digest hour")}
        </span>
        <p className="small" style={{ marginBottom: 0 }}>
          <Link to="/digests">Preview my next brief and read past ones →</Link>
        </p>
      </Section>

      <Section id="plan" title="My plan">
        <div className="plan-card">
          <div className="plan-top">
            <span className="tierchip mono">{tier ? tier.label : "Free"}</span>
            <span className="price">
              {tier ? `${dollars(tier.price_monthly_cents)}/mo` : "$0/mo"}
              {ent.subscription && ent.subscription.current_period_end ? ` · renews ${shortDate(ent.subscription.current_period_end)}` : ""}
            </span>
          </div>
          <Meter label="Industries watched" used={usage.industries_followed ?? followed.length} limit={tier ? tier.industries_limit : 1} />
          <div className="meter">
            <div className="meter-row">
              <span>Names shown per industry</span>
              <span className="mono">top {tier ? tier.names_shown_limit : 5}</span>
            </div>
          </div>
          <Meter label="Names watched for me" used={usage.picks_used} limit={tier ? tier.picks_limit : 1} />
          <Meter label="Alerts on" used={usage.alerts_used} limit={tier ? tier.alerts_limit : 0} />
          <div className="meter">
            <div className="meter-row">
              <span>Delivery</span>
              <span className="mono">{tier ? tier.channels.join(", ") : "email"}</span>
            </div>
          </div>
          <div className="row" style={{ marginTop: "var(--s-4)" }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => openUpgrade("general")}>
              {nextTier ? "Change my plan" : CTA.SHOW_PLANS}
            </button>
            {health && health.configured && paid && (
              <button className="btn btn-secondary btn-sm" onClick={portal}>
                Open my billing
              </button>
            )}
          </div>
          <FinePrint short />
        </div>
      </Section>

      <Section id="data" title="My data" lead="Everything you authored here is yours to take or remove.">
        <div className="row">
          <button className="btn btn-secondary btn-sm" onClick={exportData}>
            Export my data (JSON)
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => {
              logout();
              navigate("/");
            }}
          >
            Sign out
          </button>
        </div>
        <p className="small muted" style={{ margin: "var(--s-4) 0 var(--s-2)" }}>
          Deleting the account is permanent: your watched names, notes, alerts and briefs go with it.
          {paid ? " Cancel your paid plan through billing first so nothing is charged after." : ""}
        </p>
        <button className="btn btn-secondary btn-sm" style={{ color: "var(--neg)", borderColor: "var(--neg)" }} disabled={paid} onClick={() => setConfirmDelete(true)}>
          Delete my account
        </button>
      </Section>

      {confirmDrop && (
        <Modal
          title={`Stop watching ${confirmDrop.label}?`}
          onClose={() => setConfirmDrop(null)}
          actions={
            <button className="btn btn-primary" onClick={() => drop(confirmDrop.key)}>
              {CTA.STOP_WATCHING_SYM(confirmDrop.label)}
            </button>
          }
        >
          <p>Its names leave Explore, and any alerts on them stop firing. Watched names stay saved and remain visible through My watchlist.</p>
        </Modal>
      )}

      {confirmDelete && <DeleteModal email={me.email} onClose={() => setConfirmDelete(false)} />}
    </div>
  );
}

function PasswordForm() {
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState("");
  const [nw, setNw] = useState("");
  const [rep, setRep] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    if (nw.length < 8) return setMsg("Use at least 8 characters.");
    if (nw !== rep) return setMsg("The new passwords don't match.");
    setBusy(true);
    setMsg("");
    try {
      await api("/me/password", { method: "POST", json: { current: cur, new: nw } });
      toast("Password changed.");
      setOpen(false);
      setCur("");
      setNw("");
      setRep("");
    } catch (err) {
      setMsg(err.detail || "Couldn't change the password.");
    } finally {
      setBusy(false);
    }
  };
  if (!open) {
    return (
      <p className="small muted" style={{ marginBottom: 0 }}>
        Password:{" "}
        <button className="btn-quiet" onClick={() => setOpen(true)}>
          Change
        </button>{" "}
        · <Link to="/reset">Forgot it? Send a reset link</Link>
      </p>
    );
  }
  return (
    <form onSubmit={submit} style={{ marginTop: "var(--s-2)" }}>
      <div className="field">
        <label htmlFor="pw-cur">Current password</label>
        <input id="pw-cur" type="password" autoComplete="current-password" required value={cur} onChange={(e) => setCur(e.target.value)} />
      </div>
      <div className="grid2">
        <div className="field">
          <label htmlFor="pw-new">New password</label>
          <input id="pw-new" type="password" autoComplete="new-password" required minLength={8} value={nw} onChange={(e) => setNw(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="pw-rep">Repeat it</label>
          <input id="pw-rep" type="password" autoComplete="new-password" required minLength={8} value={rep} onChange={(e) => setRep(e.target.value)} />
        </div>
      </div>
      {msg && (
        <p className="err" role="alert">
          {msg}
        </p>
      )}
      <div className="row">
        <button className="btn btn-primary btn-sm" disabled={busy}>
          {busy ? "Saving…" : "Change password"}
        </button>
        <button type="button" className="btn-quiet" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function DeleteModal({ email, onClose }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const go = async () => {
    setBusy(true);
    setMsg("");
    try {
      await api("/me", { method: "DELETE", json: { confirm: typed } });
      logout();
      navigate("/");
      toast("Your account has been deleted.");
    } catch (e) {
      setMsg(e.detail || "Couldn't delete the account.");
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Delete this account?"
      onClose={onClose}
      actions={
        <button className="btn btn-primary" style={{ background: "var(--neg)" }} disabled={busy || typed.trim().toLowerCase() !== (email || "").toLowerCase()} onClick={go}>
          {busy ? "Deleting…" : "Delete permanently"}
        </button>
      }
    >
      <p>This removes your account, watched names, notes, alerts and briefs. It cannot be undone.</p>
      <div className="field">
        <label htmlFor="del-confirm">Type your email to confirm</label>
        <input id="del-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={email} autoComplete="off" />
      </div>
      {msg && (
        <p className="err" role="alert">
          {msg}
        </p>
      )}
    </Modal>
  );
}

function PhoneField({ settings, onSave, status }) {
  const [v, setV] = useState(settings.phone_number || "");
  return (
    <div className="field" style={{ marginTop: "var(--s-2)" }}>
      <label htmlFor="phone">Phone for SMS</label>
      <div className="row">
        <input id="phone" className="input mono" value={v} placeholder="+1 555 000 0000" onChange={(e) => setV(e.target.value)} style={{ flex: 1 }} />
        <button className="btn btn-secondary btn-sm" onClick={() => onSave(v)} disabled={v === (settings.phone_number || "")}>
          Save my number
        </button>
      </div>
      <span className="help">{settings.phone_verified ? "Verified." : "Unverified numbers receive nothing until confirmed."}</span>
      <span className="save-status" aria-live="polite">
        {status}
      </span>
    </div>
  );
}

function WebhookField({ settings, disabled, onSave, status }) {
  const [v, setV] = useState(settings.webhook_url || "");
  return (
    <>
      <div className="row">
        <input id="webhook-url" className="input mono" value={v} placeholder="https://" disabled={disabled} onChange={(e) => setV(e.target.value)} style={{ flex: 1 }} />
        <button className="btn btn-secondary btn-sm" disabled={disabled || v === (settings.webhook_url || "")} onClick={() => onSave(v)}>
          Save my webhook
        </button>
      </div>
      <span className="save-status" aria-live="polite">
        {status}
      </span>
    </>
  );
}
