import React, { useState } from "react";
import { login, signup } from "../api.js";
import { navigate } from "../main.jsx";

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M19.6 10.23c0-.68-.06-1.34-.18-1.98H10v3.75h5.4a4.53 4.53 0 0 1-1.96 2.98v2.46h3.16c1.85-1.7 2.92-4.2 2.92-7.21z"
      />
      <path
        fill="#34A853"
        d="M10 20c2.65 0 4.88-.88 6.5-2.38l-3.16-2.45c-.88.6-2 .94-3.34.94-2.56 0-4.74-1.73-5.52-4.06H1.23v2.53A10 10 0 0 0 10 20z"
      />
      <path
        fill="#FBBC05"
        d="M4.48 12.05A6 6 0 0 1 4.29 10a6 6 0 0 1 .19-2.05V5.42H1.23A10 10 0 0 0 0 10c0 1.61.39 3.14 1.08 4.5l3.4-2.45z"
      />
      <path
        fill="#EA4335"
        d="M10 4c1.44 0 2.72.5 3.74 1.47L16.63 3A10 10 0 0 0 1.23 5.42L4.48 7.95C5.26 5.73 7.44 4 10 4z"
      />
    </svg>
  );
}

export default function Auth({ mode }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      if (mode === "signup") {
        await signup(email, password);
        setDone(true);
        navigate("/onboarding");
      } else {
        await login(email, password);
        navigate("/board");
      }
    } catch (e2) {
      setErr(e2.detail || String(e2.message || e2));
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="auth-shell">
        <div className="form-card">
          <h1 style={{ marginTop: 0, fontSize: "var(--fs-md)" }}>
            Check your inbox
          </h1>
          <p style={{ color: "var(--ink-muted)" }}>
            We sent a verification link to {email}. Log in once you verify.
          </p>
          <button
            className="btn btn-secondary"
            onClick={() => {
              login(email, password).then(() => navigate("/board")).catch(() => {});
            }}
            style={{ width: "100%", marginTop: "var(--s-3)" }}
          >
            Continue to the board
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-shell">
      <div className="form-card">
        <h1 style={{ marginTop: 0, fontSize: "var(--fs-md)" }}>
          {mode === "signup" ? "Create an account" : "Sign in"}
        </h1>
        <div style={{ marginBottom: "var(--s-2)" }}>
          <button
            type="button"
            className="btn btn-google"
            onClick={(e) => {
              e.preventDefault();
              window.location.assign("/api/oauth/start/google");
            }}
          >
            <GoogleMark />
            Continue with Google
          </button>
        </div>
        <div
          style={{
            display: "flex", alignItems: "center", gap: "var(--s-2)",
            color: "var(--ink-faint)", fontSize: "var(--fs-sm)", margin: "1em 0",
          }}
        >
          <span style={{ flex: 1, borderTop: "1px solid var(--border)" }} />
          or with email
          <span style={{ flex: 1, borderTop: "1px solid var(--border)" }} />
        </div>
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
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
              required
              minLength={mode === "signup" ? 8 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {mode === "signup" && (
              <small style={{ color: "var(--ink-faint)" }}>
                8-72 characters.
              </small>
            )}
          </div>
          {err && <p className="err" role="alert">{err}</p>}
          <button className="btn btn-primary" disabled={busy} style={{ width: "100%" }}>
            {busy ? "…" : mode === "signup" ? "Create account" : "Sign in"}
          </button>
        </form>
        <p style={{ fontSize: "var(--fs-sm)", color: "var(--ink-muted)", marginBottom: 0 }}>
          {mode === "signup" ? (
            <>
              Already have an account?{" "}
              <a
                href="/login"
                onClick={(e) => {
                  e.preventDefault();
                  navigate("/login");
                }}
              >
                Sign in
              </a>
            </>
          ) : (
            <>
              New here?{" "}
              <a
                href="/signup"
                onClick={(e) => {
                  e.preventDefault();
                  navigate("/signup");
                }}
              >
                Create an account
              </a>
            </>
          )}
        </p>
      </div>
    </div>
  );
}