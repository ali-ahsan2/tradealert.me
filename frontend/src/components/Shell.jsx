import React, { useEffect, useRef, useState } from "react";
import { api, logout } from "../api.js";
import { Link, navigate, usePath } from "../lib/router.jsx";
import { useMe } from "../lib/me.jsx";
import { THEMES, getTheme, setTheme } from "../lib/theme.js";
import { MODES, useMode } from "../lib/mode.js";
import { TierChip, ToastHost } from "./ui.jsx";
import Icon from "./Icons.jsx";
import CommandPalette from "./CommandPalette.jsx";
import Shortcuts from "./Shortcuts.jsx";
import Tour, { HOME_TOUR, restartTour } from "./Tour.jsx";

// v4 shell: signed-in subscribers get a left rail on desktop and a bottom
// tab bar on phones, with a slim in-page header carrying search, plan and
// account. Visitors get a classic top bar. DESIGN_V4.md §2.4.

// Plain words in the navigation: what the screen is for, not what it is.
const NAV = [
  ["/overview", "Home", "home"],
  ["/board", "Board", "board"],
  ["/screen", "Find", "screen"],
  ["/changes", "What changed", "changes"],
  ["/calendar", "Coming up", "calendar"],
  ["/watchlist", "Watchlist", "watchlist"],
  ["/alerts", "Alerts", "alerts"],
];
const TABS = ["/overview", "/board", "/screen", "/watchlist", "/alerts"];

function Brand({ compact = false }) {
  return (
    <Link to="/" className={`brand ${compact ? "brand-compact" : ""}`} aria-label="tradealert.me home">
      <span className="brand-mark" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 20 20">
          <path d="M3 14l4-5 3 3 3-6 4 4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      </span>
      {!compact && (
        <span className="brand-word">
          tradealert<span className="brand-tld">.me</span>
        </span>
      )}
    </Link>
  );
}

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

function isActive(here, to) {
  return here === to || here.startsWith(`${to}/`) || here.startsWith(`${to}?`);
}

function ThemeControl() {
  const [t, setT] = useState(getTheme());
  return (
    <div className="seg seg-sm" role="group" aria-label="Appearance">
      {THEMES.map(([k, l]) => (
        <button
          key={k}
          aria-pressed={t === k}
          onClick={() => {
            setTheme(k);
            setT(k);
          }}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

// Simple shows plain labels and the essentials; Full shows every column and
// control. The choice persists and nothing is removed either way.
export function ModeControl({ className = "" }) {
  const { mode, setMode } = useMode();
  return (
    <div className={`seg seg-sm modeseg ${className}`} role="group" aria-label="Detail level">
      {MODES.map(([k, l]) => (
        <button key={k} aria-pressed={mode === k} onClick={() => setMode(k)} title={k === "simple" ? "Plain labels and the essentials" : "Every column and control"}>
          {l}
        </button>
      ))}
    </div>
  );
}

function AccountMenu({ me, align = "right" }) {
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
  const name = me.name || me.email || "";
  const item = (to, label) => (
    <Link to={to} role="menuitem" onClick={() => setOpen(false)}>
      {label}
    </Link>
  );
  return (
    <div className={`acct acct-${align}`} ref={box}>
      <button className="avatar" aria-haspopup="menu" aria-expanded={open} aria-label={`Account menu for ${name}`} onClick={() => setOpen((o) => !o)}>
        {(name || "?").slice(0, 1).toUpperCase()}
      </button>
      {open && (
        <div className="acct-menu" role="menu">
          <div className="acct-head">
            <div className="acct-email">{me.email}</div>
            <div className="muted xs">
              {me.verified ? "Email verified" : "Email not verified"} · {me.tier ? me.tier.label : "Free"} plan
            </div>
          </div>
          <div className="acct-theme">
            <span className="xs faint">Detail</span>
            <ModeControl />
          </div>
          <div className="acct-theme">
            <span className="xs faint">Appearance</span>
            <ThemeControl />
          </div>
          {item("/help", "How it works and glossary")}
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              if (window.location.pathname !== "/overview") navigate("/overview");
              restartTour();
            }}
          >
            Take the tour again
          </button>
          {item("/settings", "Account settings")}
          {item("/strategies", "Strategies and evidence")}
          {item("/digests", "Digests")}
          {item("/compare", "Compare names")}
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

function Rail({ me, unread }) {
  const here = usePath().split("?")[0];
  return (
    <nav className="rail" aria-label="Primary">
      <div className="rail-top">
        <Brand compact />
      </div>
      <div className="rail-items">
        {NAV.map(([to, label, icon]) => {
          const active = isActive(here, to);
          return (
            <Link key={to} to={to} className="rail-item" aria-current={active ? "page" : undefined} title={label}>
              <span className="rail-icon">
                <Icon name={icon} filled={active && ["home", "watchlist", "alerts"].includes(icon)} />
                {to === "/alerts" && unread > 0 && <span className="dot" aria-label={`${unread} unread`} />}
              </span>
              <span className="rail-label">{label}</span>
            </Link>
          );
        })}
      </div>
      <div className="rail-bottom">
        <TierChip tier={me.tier || { key: "free", label: "Free" }} />
        <AccountMenu me={me} align="left" />
      </div>
    </nav>
  );
}

function SearchPill({ wide }) {
  return (
    <button className={`searchpill ${wide ? "wide" : ""}`} onClick={() => window.dispatchEvent(new Event("palette:open"))} aria-label="Search names or jump to a screen (Command K)">
      <Icon name="search" size={16} />
      <span className="searchpill-text">Search names, screens…</span>
      <kbd className="kbd">⌘K</kbd>
    </button>
  );
}

function AppHeader({ me }) {
  return (
    <header className="apphead">
      <div className="apphead-inner">
        <div className="apphead-brand">
          <Brand />
        </div>
        <SearchPill wide />
        <span className="spacer" />
        <div className="apphead-right">
          <ModeControl className="modeseg-head" />
          <TierChip tier={me.tier || { key: "free", label: "Free" }} />
          <AccountMenu me={me} />
        </div>
      </div>
    </header>
  );
}

export function TopBar() {
  const { loading } = useMe();
  const here = usePath().split("?")[0];
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Brand />
        <nav className="navlinks" aria-label="Primary">
          <Link to="/strategies" className="navlink" aria-current={isActive(here, "/strategies") ? "page" : undefined}>
            Strategies
          </Link>
          <Link to="/pricing" className="navlink" aria-current={isActive(here, "/pricing") ? "page" : undefined}>
            Plans
          </Link>
        </nav>
        <span className="spacer" />
        {!loading && (
          <>
            <Link to="/login" className="btn btn-quiet">
              Log in
            </Link>
            <Link to="/signup" className="btn btn-primary btn-sm">
              Start free
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
  return (
    <nav className="bottombar" aria-label="Primary">
      {NAV.filter(([to]) => TABS.includes(to)).map(([to, label, icon]) => {
        const active = isActive(here, to);
        return (
          <Link key={to} to={to} className="bb-item" aria-current={active ? "page" : undefined}>
            <span className="bb-icon">
              <Icon name={icon} filled={active && ["home", "watchlist", "alerts"].includes(icon)} />
              {to === "/alerts" && unread > 0 && <span className="navbadge">{unread > 99 ? "99+" : unread}</span>}
            </span>
            <span>{label}</span>
          </Link>
        );
      })}
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
            <Link to="/help">How it works</Link>
            <Link to="/strategies">Strategies</Link>
            <Link to="/pricing">Plans</Link>
            <Link to="/legal/terms">Terms</Link>
            <Link to="/legal/privacy">Privacy</Link>
            <Link to="/legal/disclaimer">Disclaimer</Link>
          </nav>
          <span className="spacer" />
          <span className="mono xs">© {new Date().getFullYear()} tradealert.me</span>
        </div>
        <p className="footer-legal">
          Research and information only. Scores are machine output ranked for a human to review; nothing here is a recommendation to buy or
          sell any security. Every figure carries its source date. Verify it before you act.
        </p>
      </div>
    </footer>
  );
}

export function Shell({ children }) {
  const { me } = useMe();
  const unread = useUnread(me);
  const here = usePath().split("?")[0];
  return (
    <div className={`app ${me ? "authed" : "anon"}`}>
      <a className="skip" href="#main">
        Skip to content
      </a>
      {me && <Rail me={me} unread={unread} />}
      <div className="frame">
        {me ? <AppHeader me={me} /> : <TopBar />}
        <main id="main" className="main" tabIndex={-1}>
          {children}
        </main>
        <Footer />
      </div>
      <BottomBar unread={unread} />
      {me && <Tour steps={HOME_TOUR} enabled={here === "/overview"} />}
      <ToastHost />
      <CommandPalette />
      <Shortcuts />
    </div>
  );
}
