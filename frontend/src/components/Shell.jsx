import React, { useEffect, useRef, useState } from "react";
import { api, logout } from "../api.js";
import { Link, navigate, usePath } from "../lib/router.jsx";
import { useMe } from "../lib/me.jsx";
import { TierChip, ToastHost } from "./ui.jsx";
import CommandPalette from "./CommandPalette.jsx";
import Shortcuts from "./Shortcuts.jsx";

function Brand() {
  return (
    <Link to="/" className="brand" aria-label="tradealert.me home">
      <span className="brand-mark" aria-hidden="true">
        ta
      </span>
      <span>
        tradealert<span className="brand-tld">.me</span>
      </span>
    </Link>
  );
}

// Unread alerts delivered to this subscriber. Polled slowly; refreshed at
// once when any screen marks something read.
function useUnread(me) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!me) {
      setCount(0);
      return undefined;
    }
    let alive = true;
    const load = () =>
      api("/me/alerts/unread")
        .then((d) => alive && setCount(d.count || 0))
        .catch(() => {});
    load();
    const t = setInterval(load, 60000);
    window.addEventListener("alerts:read", load);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener("alerts:read", load);
    };
  }, [me]);
  return count;
}

function NavLink({ to, children, here, badge }) {
  const active = here === to || here.startsWith(`${to}/`) || here.startsWith(`${to}?`);
  return (
    <Link to={to} className="navlink" aria-current={active ? "page" : undefined}>
      {children}
      {badge > 0 && (
        <span className="navbadge" aria-label={`${badge} unread`}>
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </Link>
  );
}

function AccountMenu({ me }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => box.current && !box.current.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const name = me.name || me.email;
  const item = (to, label) => (
    <Link to={to} role="menuitem" onClick={() => setOpen(false)}>
      {label}
    </Link>
  );
  return (
    <div className="acct" ref={box}>
      <button className="acct-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} aria-label={`Account menu for ${name}`}>
        <span className="acct-initial" aria-hidden="true">
          {(name || "?").slice(0, 1)}
        </span>
        <span className="acct-name">{name}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      {open && (
        <div className="acct-menu" role="menu">
          <div className="acct-head">
            <div className="acct-email">{me.email}</div>
            <div className="muted">
              {me.verified ? "Email verified" : "Email not verified"} · {me.tier ? me.tier.label : "Free"} plan
            </div>
          </div>
          {item("/changes", "Changes since last run")}
          {item("/calendar", "Catalyst calendar")}
          {item("/strategies", "Strategies and evidence")}
          {item("/digests", "Digests")}
          {item("/compare", "Compare names")}
          {item("/settings", "Account settings")}
          {item("/pricing", "Plans")}
          {me.is_admin && (
            <a href="/lab" role="menuitem">
              Lab
            </a>
          )}
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              logout();
              navigate("/");
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function TopBar({ unread }) {
  const { me, loading } = useMe();
  const here = usePath().split("?")[0];
  return (
    <header className="topbar">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <div className="topbar-inner">
        <Brand />
        {me && (
          <nav className="navlinks" aria-label="Primary">
            <NavLink to="/overview" here={here}>
              Overview
            </NavLink>
            <NavLink to="/board" here={here}>
              Board
            </NavLink>
            <NavLink to="/screen" here={here}>
              Screen
            </NavLink>
            <NavLink to="/changes" here={here}>
              Changes
            </NavLink>
            <NavLink to="/calendar" here={here}>
              Calendar
            </NavLink>
            <NavLink to="/watchlist" here={here}>
              Watchlist
            </NavLink>
            <NavLink to="/alerts" here={here} badge={unread}>
              Alerts
            </NavLink>
          </nav>
        )}
        {!me && !loading && (
          <nav className="navlinks" aria-label="Primary">
            <NavLink to="/strategies" here={here}>
              Strategies
            </NavLink>
            <NavLink to="/pricing" here={here}>
              Plans
            </NavLink>
          </nav>
        )}
        <span className="spacer" />
        {me && (
          <button
            className="palette-btn"
            onClick={() => window.dispatchEvent(new Event("palette:open"))}
            aria-label="Search or jump (Command K)"
            title="Search or jump"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span className="palette-hint">Search</span>
            <kbd className="kbd">⌘K</kbd>
          </button>
        )}
        {me ? (
          <>
            <TierChip tier={me.tier || { key: "free", label: "Free" }} />
            <AccountMenu me={me} />
          </>
        ) : loading ? (
          <span className="muted mono">…</span>
        ) : (
          <>
            <Link to="/login" className="btn btn-quiet">
              Log in
            </Link>
            <Link to="/signup" className="btn btn-primary btn-sm">
              Sign up
            </Link>
          </>
        )}
      </div>
    </header>
  );
}

export function BottomBar({ unread }) {
  const { me } = useMe();
  const here = usePath().split("?")[0];
  if (!me) return null;
  const item = (to, label, d, badge) => {
    const active = here === to || here.startsWith(`${to}/`);
    return (
      <Link to={to} className="bb-item" aria-current={active ? "page" : undefined}>
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <path d={d} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
        <span>{label}</span>
        {badge > 0 && <span className="navbadge">{badge > 99 ? "99+" : badge}</span>}
      </Link>
    );
  };
  return (
    <nav className="bottombar" aria-label="Primary">
      {item("/overview", "Overview", "M3 3h6v6H3zM11 3h6v6h-6zM3 11h6v6H3zM11 11h6v6h-6z")}
      {item("/board", "Board", "M3 4h14v12H3zM3 9h14M8 9v7")}
      {item("/screen", "Screen", "M3 5h14M5 10h10M7 15h6")}
      {item("/watchlist", "Watchlist", "M10 2.5l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.8 7.8l5-.7z")}
      {item("/alerts", "Alerts", "M5 13V9a5 5 0 0110 0v4l1.5 2h-13zM8.5 17a1.5 1.5 0 003 0", unread)}
    </nav>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-row">
          <span className="footer-word">tradealert.me</span>
          <nav className="footer-nav" aria-label="Legal">
            <Link to="/strategies">Strategies</Link>
            <Link to="/pricing">Plans</Link>
            <Link to="/legal/terms">Terms</Link>
            <Link to="/legal/privacy">Privacy</Link>
            <Link to="/legal/disclaimer">Disclaimer</Link>
          </nav>
          <span className="spacer" />
          <span className="mono">© {new Date().getFullYear()} tradealert.me</span>
        </div>
        <p className="footer-legal">
          Research and information only. Scores are machine output ranked for a human to review;
          nothing here is a recommendation to buy or sell any security. Every figure carries its
          source date. Verify it before you act.
        </p>
      </div>
    </footer>
  );
}

export function Shell({ children }) {
  const { me } = useMe();
  const unread = useUnread(me);
  return (
    <div className={`app ${me ? "authed" : ""}`}>
      <TopBar unread={unread} />
      <main id="main" className="main" tabIndex={-1}>
        {children}
      </main>
      <Footer />
      <BottomBar unread={unread} />
      <ToastHost />
      <CommandPalette />
      <Shortcuts />
    </div>
  );
}
