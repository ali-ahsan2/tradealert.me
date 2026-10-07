import React, { useState } from "react";
import { login, signup } from "../api.js";
import { Link, navigate, useQuery } from "../lib/router.jsx";

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

function safeNext(raw) {
  // only same-origin paths; never an absolute URL from the query string
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : null;
}

export default function Auth({ mode }) {
  const q = useQuery();
  const next = safeNext(q.get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const isSignup = mode === "signup";

  const submit = async (e) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      if (isSignup) {
        await signup(email, password);
        navigate("/onboarding");
      } else {
        await login(email, password);
        navigate(next || "/board");
      }
    } catch (e2) {
      setErr(e2.detail || String(e2.message || e2));
      setBusy(false);
    }
  };

  return (
    <div className="auth-shell">
      <div className="card form-card">
        <h1>{isSignup ? "Create your account" : "Welcome back"}</h1>
        <p className="sub">
          {isSignup
            ? "Free includes the top 5 names in one industry and a weekly digest. No card needed."
            : "Sign in to your Board, watchlist and alerts."}
        </p>
        <button
          type="button"
          className="btn btn-google"
          onClick={() => window.location.assign("/api/oauth/start/google")}
        >
          <GoogleMark />
          Continue with Google
        </button>
        <div className="or">or with email</div>
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
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
          {err && (
            <p className="err" role="alert">
              {err}
            </p>
          )}
          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? "One moment…" : isSignup ? "Create account" : "Sign in"}
          </button>
        </form>
        <p className="small muted" style={{ marginTop: "var(--s-4)", marginBottom: 0 }}>
          {isSignup ? (
            <>
              Already have an account? <Link to={next ? `/login?next=${encodeURIComponent(next)}` : "/login"}>Sign in</Link>
            </>
          ) : (
            <>
              New here? <Link to="/signup">Create an account</Link> · <Link to="/reset">Forgot password</Link>
            </>
          )}
        </p>
        {isSignup && (
          <p className="xs faint" style={{ marginTop: "var(--s-3)", marginBottom: 0 }}>
            By creating an account you agree to the <Link to="/legal/terms">terms</Link> and{" "}
            <Link to="/legal/privacy">privacy policy</Link>. Research and information only; never
            investment advice.
          </p>
        )}
      </div>
    </div>
  );
}
