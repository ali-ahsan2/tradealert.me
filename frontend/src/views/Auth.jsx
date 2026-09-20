import React, { useState } from "react";
import { login, signup } from "../api.js";
import { navigate } from "../main.jsx";

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
          {err && <p className="err">{err}</p>}
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