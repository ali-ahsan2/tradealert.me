import React, { useEffect, useRef, useState } from "react";
import { api, getToken, login, setToken } from "../api.js";
import { Link, navigate, safeNext, useQuery } from "../lib/router.jsx";
import { useMe } from "../lib/me.jsx";
import { CONSENT_LABEL } from "../lib/legal.js";
import { fetchPulse, leadPhrase } from "../lib/record.js";
import { useCountUp, useReveal } from "../lib/motion.js";
import { pct, plural, shortDate } from "../lib/fmt.js";
import FinePrint from "../components/FinePrint.jsx";
import "./auth.css";

// Sign up and log in (DESIGN_V5 §4, step 2; DESIGN_V6 §3, §6). The form
// sits beside the live pulse: three counts from /api/pulse (anonymous,
// aggregate, no tickers) so what fired this month stays in view while the
// account is made. Sign-up carries the consent tick; the request sends
// accept_terms: true and the API refuses without it. Every door opens on
// the same first screen: a new account goes to onboarding, a returning one
// to `next` or Home. Nothing on this screen promises anything; every number
// is measured.

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">
      <path fill="#4285F4" d="M19.6 10.23c0-.68-.06-1.34-.18-1.98H10v3.75h5.4a4.53 4.53 0 0 1-1.96 2.98v2.46h3.16c1.85-1.7 2.92-4.2 2.92-7.21z" />
      <path fill="#34A853" d="M10 20c2.65 0 4.88-.88 6.5-2.38l-3.16-2.45c-.88.6-2 .94-3.34.94-2.56 0-4.74-1.73-5.52-4.06H1.23v2.53A10 10 0 0 0 10 20z" />
      <path fill="#FBBC05" d="M4.48 12.05A6 6 0 0 1 4.29 10a6 6 0 0 1 .19-2.05V5.42H1.23A10 10 0 0 0 0 10c0 1.61.39 3.14 1.08 4.5l3.4-2.45z" />
      <path fill="#EA4335" d="M10 4c1.44 0 2.72.5 3.74 1.47L16.63 3A10 10 0 0 0 1.23 5.42L4.48 7.95C5.26 5.73 7.44 4 10 4z" />
    </svg>
  );
}

// One live number with its plain label; counts up once on reveal. A null
// value (still loading) shows a dash, never a zero we did not measure.
function Num({ value, short, long, active }) {
  const n = useCountUp(value == null ? null : value, { active });
  return (
    <div className="auth-pulse-num">
      <span className="n">{value == null ? "—" : n}</span>
      <span className="l l-short">{short}</span>
      <span className="l l-long">{long}</span>
    </div>
  );
}

// The pulse's first example: industry, trigger, date, the measured move and
// the lead. No ticker; the public pulse carries none. Only the price move
// takes colour.
function Example({ e }) {
  if (!e || e.max_5d == null) return null;
  const lead = leadPhrase(e);
  return (
    <p className="auth-pulse-ex">
      <b>{e.industry_label}</b> · {e.trigger} on {shortDate(e.date)} ·{" "}
      <span className={e.max_5d >= 0 ? "pos" : "neg"}>{pct(e.max_5d)}</span> at the high within five sessions
      {e.chg_5d != null && (
        <>
          , closed <span className={e.chg_5d >= 0 ? "pos" : "neg"}>{pct(e.chg_5d)}</span>
        </>
      )}
      {lead ? ` · ${lead}` : ""}
    </p>
  );
}

// pulse: null while loading, false when the request failed, else the body.
function PulsePanel({ pulse }) {
  const [ref, seen] = useReveal();
  const a = pulse ? pulse.alerts : null;
  const u = pulse ? pulse.universe : null;
  const lead = pulse ? pulse.lead_sessions_median : null;
  const days = (pulse && pulse.days) || 30;
  const ex = pulse && pulse.examples ? pulse.examples[0] : null;
  return (
    <aside ref={ref} className={`auth-pulse reveal ${seen ? "in" : ""}`} aria-label={`What fired across every industry in the last ${days} days`}>
      <p className="auth-pulse-k">Last {days} days, every industry</p>
      {pulse === false ? (
        <p className="auth-pulse-empty">
          Every alert we send is a recorded event: the trigger, the date, and what the price did in the five sessions after.
        </p>
      ) : (
        <div className="auth-pulse-nums">
          <Num value={a ? a.fired : null} short="alerts fired" long={a ? `alerts fired on ${plural(a.names, "name")}` : "alerts fired"} active={seen} />
          <Num
            value={a ? a.moved_10 : null}
            short="moved 10%+ after"
            long={a && a.measured ? `of ${a.measured} measured, moved 10%+ within five sessions` : "moved 10%+ within five sessions after"}
            active={seen}
          />
          {pulse && lead == null ? (
            <Num
              value={u ? u.names : null}
              short="names scored"
              long={u ? `names scored each morning across ${plural(u.industries, "industry", "industries")}` : "names scored"}
              active={seen}
            />
          ) : (
            <Num value={lead} short="sessions to peak" long="sessions from alert to peak, median" active={seen} />
          )}
        </div>
      )}
      <Example e={ex} />
      <p className="auth-pulse-foot">
        <span className="m">Measured, not predicted.</span>
        {pulse && pulse.as_of && <span>As of {shortDate(pulse.as_of)}</span>}
      </p>
    </aside>
  );
}

export default function Auth({ mode }) {
  const q = useQuery();
  const next = safeNext(q.get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accept, setAccept] = useState(false);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pulse, setPulse] = useState(null);
  const isSignup = mode === "signup";

  // The pulse is public and cached server-side; a failure hides the numbers
  // and nothing else on the screen depends on it.
  useEffect(() => {
    let alive = true;
    fetchPulse(30)
      .then((d) => alive && setPulse(d))
      .catch(() => alive && setPulse(false));
    return () => {
      alive = false;
    };
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      if (isSignup) {
        if (!accept) throw Object.assign(new Error("Tick the box to continue."), { detail: "Tick the box to continue." });
        const { token } = await api("/signup", { method: "POST", json: { email, password, accept_terms: true } });
        setToken(token);
        navigate(next ? `/onboarding?next=${encodeURIComponent(next)}` : "/onboarding");
      } else {
        await login(email, password);
        navigate(next || "/home");
      }
    } catch (e2) {
      setErr(e2.detail || String(e2.message || e2));
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <div className="card form-card">
        <h1>{isSignup ? "Create your account" : "Welcome back"}</h1>
        <p className="sub">
          {isSignup ? "Email and a password. Then pick what I should watch." : "Log in to my Home, watchlist and alerts."}
        </p>
        <button
          type="button"
          className="btn btn-google"
          disabled={isSignup && !accept}
          title={isSignup && !accept ? "Tick the box below first." : undefined}
          onClick={() => {
            const p = new URLSearchParams();
            if (isSignup) p.set("accept_terms", "1");
            if (next) p.set("next", next);
            const qs = p.toString();
            window.location.assign(`/api/oauth/start/google${qs ? `?${qs}` : ""}`);
          }}
        >
          <GoogleMark />
          Continue with Google
        </button>
        <div className="or">or with email</div>
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete={isSignup ? "new-password" : "current-password"}
              required
              minLength={isSignup ? 8 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-describedby={isSignup ? "pw-help" : undefined}
            />
            {isSignup && (
              <span id="pw-help" className="help">
                8 to 72 characters.
              </span>
            )}
          </div>
          {isSignup && (
            <label className="check consent">
              <input type="checkbox" required checked={accept} onChange={(e) => setAccept(e.target.checked)} />
              <span>
                {CONSENT_LABEL}{" "}
                <span className="consent-links">
                  <Link to="/legal/terms">Terms</Link> · <Link to="/legal/privacy">Privacy</Link> · <Link to="/legal/disclaimer">Disclaimer</Link>
                </span>
              </span>
            </label>
          )}
          {err && (
            <p className="err" role="alert">
              {err}
            </p>
          )}
          <button className="btn btn-primary btn-block" disabled={busy || (isSignup && !accept)}>
            {busy ? "One moment…" : isSignup ? "Create my account" : "Log in"}
          </button>
          {isSignup && (
            <p className="auth-after">
              <b>Free plan, no card.</b> Your Home is one industry away.
            </p>
          )}
        </form>
        <p className="small muted auth-links">
          {isSignup ? (
            <>
              Already have an account? <Link to={next ? `/login?next=${encodeURIComponent(next)}` : "/login"}>Log in</Link>
            </>
          ) : (
            <>
              New here? <Link to={next ? `/signup?next=${encodeURIComponent(next)}` : "/signup"}>Create an account</Link> ·{" "}
              <Link to="/reset">Forgot password</Link>
            </>
          )}
        </p>
        <FinePrint short className="auth-legal" />
      </div>
      <PulsePanel pulse={pulse} />
    </div>
  );
}

// /auth/done: where Google sign-in lands (app/oauth.py stores the token and
// comes here with ?new=1 for a fresh row and the `next` it was started
// with). Refresh the account, then onboarding when it follows no industries,
// else `next` or Home. A session that failed to stick goes to log in.
export function AuthDone() {
  const q = useQuery();
  const next = safeNext(q.get("next"));
  const { refresh } = useMe();
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!getToken()) {
      navigate(next ? `/login?next=${encodeURIComponent(next)}` : "/login", { replace: true });
      return;
    }
    refresh().then((me) => {
      if (!me) {
        navigate("/login", { replace: true });
        return;
      }
      // ?new=1 says the row was just created; the account's own count is
      // what decides, so a returning user who never picked is sent too.
      if (me.industries_following_count === 0) {
        navigate(next ? `/onboarding?next=${encodeURIComponent(next)}` : "/onboarding", { replace: true });
      } else {
        navigate(next || "/home", { replace: true });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="wrap wrap-narrow" aria-busy="true">
      <div className="sk" aria-hidden="true">
        <div className="sk-row" style={{ height: 44 }} />
        <div className="sk-row" style={{ height: 120 }} />
      </div>
      <p className="muted small">Signing you in…</p>
    </div>
  );
}
