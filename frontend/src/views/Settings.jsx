import React, { useEffect, useState } from "react";
import { api, cached, logout, toast } from "../api.js";
import { Link, navigate, useQuery } from "../lib/router.jsx";
import { hasChannel, useMe } from "../lib/me.jsx";
import { DAYS, dollars, industriesLabel, plural, shortDate, tzList } from "../lib/fmt.js";
import { ErrorCard, Meter, Modal, Notice, Skeleton } from "../components/ui.jsx";

const SECTIONS = [
  ["profile", "Profile"],
  ["industries", "Industries"],
  ["channels", "Delivery"],
  ["digest", "Digest"],
  ["plan", "Plan"],
  ["session", "Session"],
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
  const [showSecret, setShowSecret] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    setErr(null);
    Promise.all([
      api("/entitlements"),
      cached("/industries"),
      api("/me/industries"),
      api("/me/settings"),
      api("/billing/health").catch(() => null),
    ])
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
      toast(e.detail || "Couldn't follow that industry.");
    }
  };

  const drop = async (key) => {
    setConfirmDrop(null);
    try {
      const r = await api(`/me/industries/${key}`, { method: "DELETE" });
      const d = await api("/me/industries");
      setFollowed(d.industries);
      refresh();
      if (r.affected_picks > 0) {
        toast(`${plural(r.affected_picks, "pinned name")} in that industry stay saved but may no longer be visible.`);
      }
    } catch (e) {
      toast(e.detail || "Couldn't drop that industry.");
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
        <div className="pagehead">
          <h1>Account</h1>
        </div>
        <Skeleton rows={5} height={120} />
      </div>
    );
  }

  const tier = ent.current || me.tier;
  const limit = tier ? tier.industries_limit : 1;
  const canFollow = limit >= 999 || followed.length < limit;
  const usage = ent.usage || {};
  const nextTier = [...ent.tiers]
    .sort((a, b) => a.price_monthly_cents - b.price_monthly_cents)
    .find((t) => tier && t.price_monthly_cents > tier.price_monthly_cents);
  const status = (label) =>
    saving === label ? "Saving…" : saved === label ? "Saved" : "";

  return (
    <div className="wrap wrap-narrow">
      <div className="pagehead">
        <div>
          <h1>Account</h1>
          <div className="meta">Everything about you rather than the market.</div>
        </div>
      </div>

      {q.get("billing") === "success" && (
        <Notice tone="pos">
          Your plan change went through. It can take a moment for the new limits to show here.{" "}
          <Link to="/board">Back to the Board</Link>
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
            {me.verified ? (
              <span className="pos">Verified</span>
            ) : (
              <span className="warn">Not verified · alerts, digests and upgrades wait on it</span>
            )}
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
          <span className="help">Drives digest send time and every timestamp you see here.</span>
          <span className="save-status" aria-live="polite">
            {status("timezone")}
          </span>
        </div>
        <p className="small muted" style={{ marginBottom: 0 }}>
          Password: <Link to="/reset">send yourself a reset link</Link>.
        </p>
      </Section>

      <Section
        id="industries"
        title="Industries"
        lead={`Your Board shows the top names in each industry you follow. ${followed.length} of ${industriesLabel(limit)} selected · ${tier ? tier.label : "Free"}.`}
      >
        <div className="indlist">
          {allInd.map((i) => {
            const isOn = followed.some((f) => f.key === i.key);
            return (
              <div key={i.key} className={`indrow ${isOn ? "on" : ""}`}>
                <div className="who">
                  <b>{i.label}</b>
                  <span>
                    {i.universe_count} names · <span className="mono">{i.benchmark_etf}</span>
                  </span>
                </div>
                {isOn ? (
                  <button className="btn btn-secondary btn-sm" onClick={() => setConfirmDrop(i)}>
                    Drop
                  </button>
                ) : (
                  <button className="btn btn-primary btn-sm" disabled={!canFollow} onClick={() => follow(i.key)}>
                    Follow
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {!canFollow && (
          <p className="small muted" style={{ marginTop: "var(--s-3)", marginBottom: 0 }}>
            {tier.label} follows {industriesLabel(limit)}.
            {nextTier && (
              <>
                {" "}
                {nextTier.label} follows {industriesLabel(nextTier.industries_limit)}. <Link to="/pricing">See plans</Link>
              </>
            )}
          </p>
        )}
      </Section>

      <Section id="channels" title="Delivery" lead="Where alerts and digests reach you. Email is always on.">
        <label className="check">
          <input type="checkbox" checked disabled />
          <span>
            Email
            <span className="lock-note">Required · {me.email}</span>
          </span>
        </label>
        <label className={`check ${hasChannel(me, "push") ? "" : "locked"}`}>
          <input
            type="checkbox"
            checked={Boolean(settings.channel_push)}
            disabled={!hasChannel(me, "push")}
            onChange={(e) => patch({ channel_push: e.target.checked }, "push")}
          />
          <span>
            Web push
            {!hasChannel(me, "push") && (
              <span className="lock-note">
                Basic and above · <Link to="/pricing">See plans</Link>
              </span>
            )}
          </span>
        </label>
        <label className={`check ${hasChannel(me, "sms") ? "" : "locked"}`}>
          <input
            type="checkbox"
            checked={Boolean(settings.channel_sms)}
            disabled={!hasChannel(me, "sms")}
            onChange={(e) => patch({ channel_sms: e.target.checked }, "sms")}
          />
          <span>
            SMS
            {!hasChannel(me, "sms") && (
              <span className="lock-note">
                Pro and above · <Link to="/pricing">See plans</Link>
              </span>
            )}
          </span>
        </label>
        {hasChannel(me, "sms") && (
          <PhoneField settings={settings} onSave={(v) => patch({ phone_number: v }, "phone")} status={status("phone")} />
        )}
        <div className="field" style={{ marginTop: "var(--s-3)" }}>
          <label htmlFor="webhook-url">
            Webhook URL{" "}
            {!hasChannel(me, "webhook") && (
              <span className="faint">
                · Investor only · <Link to="/pricing">See plans</Link>
              </span>
            )}
          </label>
          <WebhookField
            settings={settings}
            disabled={!hasChannel(me, "webhook")}
            onSave={(v) => patch({ webhook_url: v }, "webhook URL")}
            status={status("webhook URL")}
          />
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
              <Notice tone="neg" className="" >
                Deliveries were paused on {shortDate(settings.webhook_auto_disabled_at)} after repeated failures.{" "}
                <button className="btn-quiet" onClick={() => patch({ reset_auto_disable: true }, "webhook")}>
                  Resume
                </button>
              </Notice>
            )}
          </div>
        )}
      </Section>

      <Section id="digest" title="Weekly digest" lead="Your pinned names, run through the report format, once a week.">
        <label className="check">
          <input
            type="checkbox"
            checked={Boolean(settings.digest_enabled)}
            onChange={(e) => patch({ digest_enabled: e.target.checked }, "digest")}
          />
          <span>Send me the weekly digest</span>
        </label>
        <div className="grid2" style={{ marginTop: "var(--s-2)" }}>
          <div className="field">
            <label htmlFor="dday">Day</label>
            <select
              id="dday"
              value={settings.digest_day}
              disabled={!settings.digest_enabled}
              onChange={(e) => patch({ digest_day: Number(e.target.value) }, "digest day")}
            >
              {DAYS.map((d, i) => (
                <option key={i} value={i}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="dhour">Hour ({settings.timezone})</label>
            <select
              id="dhour"
              value={settings.digest_hour}
              disabled={!settings.digest_enabled}
              onChange={(e) => patch({ digest_hour: Number(e.target.value) }, "digest hour")}
            >
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
      </Section>

      <Section id="plan" title="Plan">
        <div className="plan-card">
          <div className="plan-top">
            <span className="tierchip mono">{(tier ? tier.label : "Free").toUpperCase()}</span>
            <span className="price">
              {tier ? `${dollars(tier.price_monthly_cents)}/mo` : "$0/mo"}
              {ent.subscription && ent.subscription.current_period_end
                ? ` · renews ${shortDate(ent.subscription.current_period_end)}`
                : ""}
            </span>
          </div>
          <Meter label="Industries followed" used={usage.industries_followed ?? followed.length} limit={tier ? tier.industries_limit : 1} />
          <div className="meter">
            <div className="meter-row">
              <span>Names shown per industry</span>
              <span className="mono">top {tier ? tier.names_shown_limit : 5}</span>
            </div>
          </div>
          <Meter label="Pinned names" used={usage.picks_used} limit={tier ? tier.picks_limit : 1} />
          <Meter label="Alerts armed" used={usage.alerts_used} limit={tier ? tier.alerts_limit : 0} />
          <div className="meter">
            <div className="meter-row">
              <span>Delivery</span>
              <span className="mono">{tier ? tier.channels.join(", ") : "email"}</span>
            </div>
          </div>
          <div className="row" style={{ marginTop: "var(--s-4)" }}>
            <Link to="/pricing" className="btn btn-primary btn-sm">
              {nextTier ? "Change plan" : "See plans"}
            </Link>
            {health && health.configured && tier && tier.price_monthly_cents > 0 && (
              <button className="btn btn-secondary btn-sm" onClick={portal}>
                Billing history and payment method
              </button>
            )}
          </div>
        </div>
      </Section>

      <Section id="session" title="Session">
        <button
          className="btn btn-secondary"
          onClick={() => {
            logout();
            navigate("/");
          }}
        >
          Sign out
        </button>
      </Section>

      {confirmDrop && (
        <Modal
          title={`Stop following ${confirmDrop.label}?`}
          onClose={() => setConfirmDrop(null)}
          actions={
            <button className="btn btn-primary" onClick={() => drop(confirmDrop.key)}>
              Drop {confirmDrop.label}
            </button>
          }
        >
          <p>
            Its names leave your Board, and any alerts armed on them stop firing. Pinned names stay
            saved and remain visible through your watchlist.
          </p>
        </Modal>
      )}
    </div>
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
          Save
        </button>
      </div>
      <span className="help">
        {settings.phone_verified ? "Verified." : "Unverified numbers receive nothing until confirmed."}
      </span>
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
        <input
          id="webhook-url"
          className="input mono"
          value={v}
          placeholder="https://"
          disabled={disabled}
          onChange={(e) => setV(e.target.value)}
          style={{ flex: 1 }}
        />
        <button className="btn btn-secondary btn-sm" disabled={disabled || v === (settings.webhook_url || "")} onClick={() => onSave(v)}>
          Save
        </button>
      </div>
      <span className="save-status" aria-live="polite">
        {status}
      </span>
    </>
  );
}
