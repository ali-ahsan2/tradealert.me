import React, { useState } from "react";
import { api } from "../api.js";
import { Link, useQuery } from "../lib/router.jsx";

export default function Reset() {
  const q = useQuery();
  const token = q.get("token") || "";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [sent, setSent] = useState(false);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const request = async (e) => {
    e.preventDefault();
    setMsg("");
    setBusy(true);
    try {
      await api("/auth/forgot", { method: "POST", json: { email } });
      setSent(true);
    } catch (e2) {
      setMsg(e2.detail || String(e2.message));
    } finally {
      setBusy(false);
    }
  };

  const change = async (e) => {
    e.preventDefault();
    if (password.length < 8) return setMsg("Use a password of at least 8 characters.");
    if (password !== confirm) return setMsg("Passwords do not match.");
    setMsg("");
    setBusy(true);
    try {
      await api("/auth/reset", { method: "POST", json: { token, password } });
      setDone(true);
    } catch (e2) {
      setMsg(e2.detail || String(e2.message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-shell">
      <div className="card form-card">
        {!token && !sent && (
          <form onSubmit={request}>
            <h1>Reset your password</h1>
            <p className="sub">We'll email you a link that works for one hour.</p>
            <div className="field">
              <label htmlFor="reset-email">Email</label>
              <input id="reset-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            {msg && (
              <p className="err" role="alert">
                {msg}
              </p>
            )}
            <button className="btn btn-primary btn-block" disabled={busy}>
              {busy ? "Sending…" : "Send reset link"}
            </button>
          </form>
        )}
        {!token && sent && (
          <div>
            <h1>Check your email</h1>
            <p className="muted">If an account exists for {email}, a reset link is on its way.</p>
          </div>
        )}
        {token && !done && (
          <form onSubmit={change}>
            <h1>Choose a new password</h1>
            <p className="sub">8 to 72 characters.</p>
            <div className="field">
              <label htmlFor="reset-pw">New password</label>
              <input id="reset-pw" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="reset-pw2">Repeat it</label>
              <input id="reset-pw2" type="password" autoComplete="new-password" required minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
            {msg && (
              <p className="err" role="alert">
                {msg}
              </p>
            )}
            <button className="btn btn-primary btn-block" disabled={busy}>
              {busy ? "Saving…" : "Set password"}
            </button>
          </form>
        )}
        {token && done && (
          <div>
            <h1>Password updated</h1>
            <p className="muted">Sign in with the new password.</p>
            <Link to="/login" className="btn btn-primary btn-block">
              Sign in
            </Link>
          </div>
        )}
        <p className="small muted" style={{ marginTop: "var(--s-4)", marginBottom: 0 }}>
          <Link to="/login">Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
