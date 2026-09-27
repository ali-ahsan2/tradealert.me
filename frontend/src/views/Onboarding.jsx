import React, { useEffect, useState } from "react";
import { api, getToken } from "../api.js";
import { navigate } from "../main.jsx";

export default function Onboarding() {
  const [ind, setInd] = useState(null);
  const [picked, setPicked] = useState([]);
  const [limit, setLimit] = useState(1);
  const [worked, setWorked] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      navigate("/login");
      return;
    }
    api("/industries").then((d) => setInd(d.industries)).catch(() => setInd([]));
    api("/me/industries")
      .then((d) => setPicked(d.industries.map((i) => i.key)))
      .catch(() => {});
    api("/entitlements")
      .then((d) => setLimit(d.current.industries_limit))
      .catch(() => {});
  }, []);

  const toggle = async (key) => {
    const isOn = picked.includes(key);
    if (isOn) {
      await api(`/me/industries/${key}`, { method: "DELETE" }).catch(() => {});
      setPicked(picked.filter((k) => k !== key));
      return;
    }
    if (picked.length >= limit) return;
    try {
      await api("/me/industries", { method: "POST", json: { key } });
      setPicked([...picked, key]);
    } catch (e) {
      if (e.status === 403) return;
    }
  };

  if (worked) {
    return (
      <div className="wrap">
        <div className="table-card empty">
          <h2>Done</h2>
          <p>You are following {picked.length} industr{picked.length === 1 ? "y" : "ies"}.</p>
          <p style={{ marginTop: "var(--s-3)" }}>
            <a className="btn btn-primary" href="/board"
               onClick={(e) => { e.preventDefault(); navigate("/board"); }}>
              Open the board
            </a>
          </p>
        </div>
      </div>
    );
  }

  if (!ind) return <div className="wrap"><div className="table-card empty">Loading…</div></div>;

  return (
    <div className="wrap">
      <div className="table-card" style={{ maxWidth: 560, margin: "0 auto" }}>
        <h1 style={{ fontSize: "var(--fs-lg)", marginTop: 0 }}>Follow industries</h1>
        <p className="meta">
          Your board is built from the industries you follow (up to {limit}). You can change
          this any time in Account settings.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--s-2)", margin: "var(--s-4) 0" }}>
          {ind.map((i) => {
            const isOn = picked.includes(i.key);
            return (
              <button
                key={i.key}
                className={`indchip ${isOn ? "on" : ""}`}
                onClick={() => toggle(i.key)}
                style={{ textAlign: "left" }}
              >
                <b>{i.label}</b>
                <span className="st" style={{ display: "block", color: "var(--ink-faint)", fontSize: "var(--fs-xs)" }}>
                  {i.universe_count} tickers · {i.benchmark_etf}
                </span>
              </button>
            );
          })}
        </div>
        <p className="st" style={{ fontSize: "var(--fs-sm)" }}>
          {picked.length}/{limit} followed
        </p>
        <button className="btn btn-primary" style={{ width: "100%" }}
                disabled={picked.length === 0}
                onClick={() => setWorked(true)}>
          Continue
        </button>
      </div>
    </div>
  );
}