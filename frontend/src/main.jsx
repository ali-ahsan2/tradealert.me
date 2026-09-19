import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { getToken, logout } from "./api.js";
import Board from "./views/Board.jsx";
import StockReport from "./views/StockReport.jsx";
import Landing from "./views/Landing.jsx";
import Auth from "./views/Auth.jsx";
import Watchlist from "./views/Watchlist.jsx";
import Alerts from "./views/Alerts.jsx";
import Pricing from "./views/Pricing.jsx";
import Settings from "./views/Settings.jsx";
import Onboarding from "./views/Onboarding.jsx";
import Reset from "./views/Reset.jsx";

export function usePath() {
  const [path, setPath] = useState(window.location.pathname + window.location.search);
  useEffect(() => {
    const onChange = () =>
      setPath(window.location.pathname + window.location.search);
    window.addEventListener("popstate", onChange);
    return () => window.removeEventListener("popstate", onChange);
  }, []);
  return path;
}

export function navigate(to) {
  window.history.pushState({}, "", to);
  window.dispatchEvent(new Event("popstate"));
  window.scrollTo({ top: 0 });
}

function Shell({ children }) {
  const [me, setMe] = useState(null);
  const [checked, setChecked] = useState(false);
  const [toast, setToast] = useState(null);
  useEffect(() => {
    if (!getToken()) {
      setChecked(true);
      return;
    }
    fetch("/api/me", {
      headers: { authorization: `Bearer ${getToken()}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setMe(d))
      .catch(() => setMe(null))
      .finally(() => setChecked(true));
    return;
  }, []);
  useEffect(() => {
    const onToast = (e) => setToast(e.detail);
    window.addEventListener("toast", onToast);
    return () => window.removeEventListener("toast", onToast);
  }, []);
  const acct = me
    ? `${me.email} · ${me.tier ? me.tier.label : "Free"}`
    : "Sign in";
  const nav = (label, to, active) => (
    <a
      className={`navlink ${active ? "active" : ""}`}
      href={to}
      onClick={(e) => {
        e.preventDefault();
        navigate(to);
      }}
    >
      {label}
    </a>
  );
  const here = window.location.pathname;
  const links = me ? (
    <>
      {nav("Watchlist", "/watchlist", here.startsWith("/watchlist"))}
      {nav("Alerts", "/alerts", here.startsWith("/alerts"))}
      {nav("Plans", "/pricing", here.startsWith("/pricing"))}
      {nav("Account", "/settings", here.startsWith("/settings"))}
    </>
  ) : (
    <>
      {nav("Board", "/board", here.startsWith("/board"))}
      {nav("Plans", "/pricing", here.startsWith("/pricing"))}
    </>
  );
  return (
    <>
      <div className="bar">
        <b>Sandbox preview</b> — seeded from the operator&rsquo;s workbench, not live
        market data. Every figure is a claim to re-verify.
      </div>
      <nav className="topbar">
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate("/");
          }}
        >
          <span className="mark">FM</span>
          tradealert<span style={{ color: "var(--info)" }}>.me</span>
        </a>
        <span className="navlinks">{links}</span>
        <div className="spacer" />
        <span className="acct mono">{checked ? acct : "…"}</span>
        {me ? (
          <button
            className="btn btn-secondary"
            style={{ padding: "6px 14px", fontSize: "var(--fs-sm)" }}
            onClick={() => {
              logout();
              setMe(null);
              navigate("/");
            }}
          >
            Sign out
          </button>
        ) : (
          <a
            className="btn btn-primary"
            style={{ padding: "6px 14px", fontSize: "var(--fs-sm)" }}
            href="/login"
            onClick={(e) => {
              e.preventDefault();
              navigate("/login");
            }}
          >
            Sign in
          </a>
        )}
      </nav>
      {toast && (
        <div className="toast" onClick={() => setToast(null)}>
          {toast}
        </div>
      )}
      {children}
    </>
  );
}

function NotFound({ what }) {
  return (
    <div className="wrap">
      <div className="pagehead">
        <h1>{what}</h1>
        <p style={{ color: "var(--ink-muted)" }}>
          This page does not exist.{" "}
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              navigate("/");
            }}
          >
            Go to the board
          </a>
        </p>
      </div>
    </div>
  );
}

function Route({ path }) {
  const [_, search] = path.split("?");
  const qs = new URLSearchParams(search || "");
  if (path === "/" || path.startsWith("/?")) return <Landing />;
  if (path.startsWith("/board")) return <Board />;
  const stockMatch = path.match(/^\/stock\/([^/?#]+)/);
  if (stockMatch) return <StockReport symbol={stockMatch[1]} />;
  if (path.startsWith("/login")) return <Auth mode="login" />;
  if (path.startsWith("/signup")) return <Auth mode="signup" />;
  if (path.startsWith("/watchlist")) return <Watchlist />;
  if (path.startsWith("/alerts")) return <Alerts />;
  if (path.startsWith("/pricing")) return <Pricing />;
  if (path.startsWith("/settings")) return <Settings />;
  if (path.startsWith("/onboarding")) return <Onboarding />;
  if (path.startsWith("/reset")) return <Reset />;
  return <NotFound what={qs.get("what") || "Not found"} />;
}

function App() {
  const path = usePath();
  return (
    <Shell>
      <Route path={path} />
    </Shell>
  );
}

createRoot(document.getElementById("root")).render(<App />);