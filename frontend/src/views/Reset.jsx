import React, { useEffect, useState } from "react";
import { api } from "../api.js";

export default function Reset() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token") || "";
  const [step, setStep] = useState(token ? "change" : "request");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [sent, setSent] = useState(false);
  const [done, setDone] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (token) setStep("change");
  }, [token]);

  const request = async (e) => {
    e.preventDefault();
    setMsg("");
    try {
      await api("/auth/forgot", { method: "POST", json: { email } });
      setSent(true);
    } catch (e2) {
      setMsg(e2.detail || String(e2.message));
    }
  };

  const change = async (e) => {
    e.preventDefault();
    if (password.length < 8) {
      setMsg("Use a password of at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setMsg("Passwords do not match.");
      return;
    }
    setMsg("");
    try {
      await api("/auth/reset", { method: "POST", json: { token, password } });
      setDone(true);
    } catch (e2) {
      setMsg(e2.detail || String(e2.message));
    }
  };

  return (
    <div className="wrap">
      <div className="table-card" style={{ maxWidth: 420, margin: "0 auto" }}>
        {step === "request" && !sent && (
          <form onSubmit={request}>
            <h1 style={{ fontSize: "var(--fs-lg)", marginTop: 0 }}>Reset password</h1>
            <div className="field">
              <label htmlFor="reset-email">Email</label>
              <input id="reset-email" type="email" required value={email}
                     onChange={(e) => setEmail(e.target.value)} />
            </div>
            {msg && <p className="note">{msg}</p>}
            <button className="btn btn-primary" style={{ width: "100%" }}>
              Send reset link
            </button>
          </form>
        )}
        {step === "request" && sent && (
          <div>
            <h1 style={{ fontSize: "var(--fs-lg)", marginTop: 0 }}>Check your email</h1>
            <p>If an account exists for that address, a reset link is on its way.</p>
            <p className="st" style={{ fontSize: "var(--fs-sm)", color: "var(--ink-muted)" }}>
              In the sandbox the link is written to the app log.
            </p>
          </div>
        )}
        {step === "change" && !done && (
          <form onSubmit={change}>
            <h1 style={{ fontSize: "var(--fs-lg)", marginTop: 0 }}>Choose a new password</h1>
            <div className="field">
              <label htmlFor="reset-pw">New password</label>
              <input id="reset-pw" type="password" required minLength={8} value={password}
                     onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="reset-pw2">Repeat</label>
              <input id="reset-pw2" type="password" required minLength={8} value={confirm}
                     onChange={(e) => setConfirm(e.target.value)} />
            </div>
            {msg && <p className="note">{msg}</p>}
            <button className="btn btn-primary" style={{ width: "100%" }}>Set password</button>
          </form>
        )}
        {step === "change" && done && (
          <div>
            <h1 style={{ fontSize: "var(--fs-lg)", marginTop: 0 }}>Password updated</h1>
            <p>Sign in with the new password.</p>
          </div>
        )}
      </div>
    </div>
  );
}