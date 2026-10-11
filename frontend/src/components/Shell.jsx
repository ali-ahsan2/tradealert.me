import React, { useEffect, useRef, useState } from "react";
import { api, getToken, logout, prefetch } from "../api.js";
import { Link, Redirect, navigate, safeNext, usePath } from "../lib/router.jsx";
import { hasConsent, useMe } from "../lib/me.jsx";
import { THEMES, getTheme, setTheme } from "../lib/theme.js";
import { MODES, useMode } from "../lib/mode.js";
import { TierChip, ToastHost } from "./ui.jsx";
import Icon from "./Icons.jsx";
import CommandPalette from "./CommandPalette.jsx";
import Shortcuts from "./Shortcuts.jsx";
import Tour, { HOME_TOUR, restartTour } from "./Tour.jsx";
import UpgradeSheet from "./UpgradeSheet.jsx";
import FinePrint from "./FinePrint.jsx";
import ExploreTabs, { isExplore } from "./ExploreTabs.jsx";
import { CTA } from "../lib/plain.js";

// v6 shells (DESIGN_V6 §3, §10): the layout is chosen by the route, never
// by whether /api/me has answered, so a public page never wears the rail
// and nothing flashes while the account loads.
//
//   PublicShell  slim top bar · page · footer with the fine print
//   BareShell    brand · page · short fine print (onboarding, welcome)
//   AppShell     rail on desktop, four tabs on phones, palette, shortcuts
//
// Four destinations, the same on every device. Explore carries a tab strip
// over the Ranked, Find, What changed and Coming up pages.
export const NAV = [
  ["/home", "Home", "home"],
  ["/alerts", "Alerts", "alerts"],
  ["/watchlist", "Watchlist", "watchlist"],
  ["/board", "Explore", "board"],
];

function Brand({ compact = false }) {
  const home = getToken() ? "/home" : "/";
  return (
    <Link to={home} className={`brand ${compact ? "brand-compact" : ""}`} aria-label="tradealert.me">
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
  if (to === "/board") return isExplore(here);
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

// Detail: Simple is the structural default (cards, caps, one column); More
// shows the table and every control. The choice persists and nothing is
// removed either way. Every caller sets the caption "Detail" before the
// control, so the segments read "Detail: Simple / More". Other packages
// import this control.
const MODE_LABEL = { simple: "Simple", full: "More" };
export function ModeControl({ className = "" }) {
  const { mode, setMode } = useMode();
  return (
    <div className={`seg seg-sm modeseg ${className}`} role="group" aria-label="Detail level">
      {MODES.map(([k]) => (
        <button key={k} aria-pressed={mode === k} onClick={() => setMode(k)} title={k === "simple" ? "Cards, plain words, three items before Show all" : "Every column and figure; nothing is removed either way"}>
          {MODE_LABEL[k] || k}
        </button>
      ))}
    </div>
  );
}

function AccountMenu({ me, align = "right" }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const here = usePath().split("?")[0];
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
          {item("/settings", "My account")}
          {item("/pricing", CTA.MY_PLAN)}
          {item("/help", "Help")}
          <div className="acct-theme">
            <span className="xs faint">Detail</span>
            <ModeControl />
          </div>
          <div className="acct-theme">
            <span className="xs faint">Appearance</span>
            <ThemeControl />
          </div>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              if (here !== "/home") navigate("/home");
              restartTour();
            }}
          >
            {CTA.TOUR_AGAIN}
          </button>
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

function SearchPill({ wide = false }) {
  return (
    <button className={`searchpill ${wide ? "wide" : ""}`} onClick={() => window.dispatchEvent(new Event("palette:open"))} aria-label="Search names or jump to a screen (Command K)">
      <Icon name="search" size={16} />
      <span className="searchpill-text">Search names…</span>
      <kbd className="kbd">⌘K</kbd>
    </button>
  );
}

function NavItems({ here, unread, cls, badge }) {
  return NAV.map(([to, label, icon]) => {
    const active = isActive(here, to);
    return (
      <Link key={to} to={to} className={cls} aria-current={active ? "page" : undefined} title={label}>
        <span className={`${cls}-icon`}>
          <Icon name={icon} filled={active && ["home", "watchlist", "alerts"].includes(icon)} />
          {to === "/alerts" && unread > 0 && badge(unread)}
        </span>
        <span className={`${cls}-label`}>{label}</span>
      </Link>
    );
  });
}

// Desktop: the one piece of chrome. Brand, search, four items, plan and
// account at the foot. Icon-only between 900 and 1199px, labelled above.
function Rail({ me, unread }) {
  const here = usePath().split("?")[0];
  return (
    <nav className="rail" aria-label="Primary">
      <div className="rail-top">
        <Brand />
      </div>
      <div className="rail-search">
        <SearchPill wide />
      </div>
      <div className="rail-items">
        <NavItems here={here} unread={unread} cls="rail-item" badge={(n) => <span className="dot" aria-label={`${n} unread`} />} />
      </div>
      <div className="rail-bottom">
        {me && <TierChip tier={me.tier || { key: "free", label: "Free" }} />}
        {me && <AccountMenu me={me} align="left" />}
      </div>
    </nav>
  );
}

// Phones only (hidden from 900px): brand, search, avatar.
function PhoneHeader({ me }) {
  return (
    <header className="apphead">
      <div className="apphead-inner">
        <Brand />
        <span className="spacer" />
        <SearchPill />
        {me && <AccountMenu me={me} />}
      </div>
    </header>
  );
}

export function BottomBar({ unread }) {
  const here = usePath().split("?")[0];
  return (
    <nav className="bottombar" aria-label="Primary">
      <NavItems here={here} unread={unread} cls="bb-item" badge={(n) => <span className="navbadge">{n > 99 ? "99+" : n}</span>} />
    </nav>
  );
}

// The public top bar: wordmark, Plans (My plan once signed in) · Help, then
// Log in / Start free, or "Open my Home" and the avatar when a session is
// present. The sign-up and log-in screens each carry one primary (the form's
// own), so the bar shows only the other door there, quiet; the verify page
// already offers "Open my Home" once.
export function TopBar() {
  const { me } = useMe();
  const [here, qs = ""] = usePath().split("?");
  const signedIn = Boolean(getToken());
  const next = safeNext(new URLSearchParams(qs).get("next"));
  const carry = (to) => (next ? `${to}?next=${encodeURIComponent(next)}` : to);
  const onSignup = here === "/signup";
  const onLogin = here === "/login";
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Brand />
        <nav className="navlinks" aria-label="Primary">
          <Link to="/pricing" className="navlink" aria-current={isActive(here, "/pricing") ? "page" : undefined}>
            {signedIn ? CTA.MY_PLAN : "Plans"}
          </Link>
          <Link to="/help" className="navlink" aria-current={isActive(here, "/help") ? "page" : undefined}>
            Help
          </Link>
        </nav>
        <span className="spacer" />
        {signedIn ? (
          <>
            {here !== "/verified" && (
              <Link to="/home" className="btn btn-primary btn-sm">
                {CTA.OPEN_HOME}
              </Link>
            )}
            {me && <AccountMenu me={me} />}
          </>
        ) : (
          <>
            {!onLogin && (
              <Link to={carry("/login")} className="btn btn-quiet">
                Log in
              </Link>
            )}
            {!onSignup && (
              <Link to={carry("/signup")} className={onLogin ? "btn btn-quiet" : "btn btn-primary btn-sm"}>
                {CTA.START_FREE}
              </Link>
            )}
          </>
        )}
      </div>
    </header>
  );
}

export function Footer({ bare = false }) {
  const signedIn = Boolean(getToken());
  return (
    <footer className="footer">
      <div className="footer-inner">
        {!bare && (
          <div className="footer-row">
            <span className="footer-word">tradealert.me</span>
            <nav className="footer-nav" aria-label="Legal">
              <Link to="/about">About</Link>
              <Link to="/help">Help</Link>
              <Link to="/pricing">{signedIn ? CTA.MY_PLAN : "Plans"}</Link>
              <Link to="/legal/terms">Terms</Link>
              <Link to="/legal/privacy">Privacy</Link>
              <Link to="/legal/disclaimer">Disclaimer</Link>
            </nav>
            <span className="spacer" />
            <span className="xs">© {new Date().getFullYear()} tradealert.me</span>
          </div>
        )}
        {!bare && <p className="footer-tag">tradealert dot me: alerts, sent to me.</p>}
        <FinePrint short className="footer-legal" />
      </div>
    </footer>
  );
}

// One listener for every list in the product: hovering or focusing a dossier
// link starts its request, so the page opens from memory a moment later.
function usePrefetchLinks(enabled) {
  useEffect(() => {
    if (!enabled) return undefined;
    let last = "";
    const on = (e) => {
      const a = e.target && e.target.closest ? e.target.closest('a[href^="/stock/"]') : null;
      if (!a) return;
      const sym = decodeURIComponent(a.getAttribute("href").slice(7).split(/[/?#]/)[0]);
      if (!sym || sym === last) return;
      last = sym;
      prefetch(`/stock/${encodeURIComponent(sym)}`);
    };
    document.addEventListener("mouseover", on, { passive: true });
    document.addEventListener("focusin", on);
    document.addEventListener("touchstart", on, { passive: true });
    return () => {
      document.removeEventListener("mouseover", on);
      document.removeEventListener("focusin", on);
      document.removeEventListener("touchstart", on);
    };
  }, [enabled]);
}

// Shown in place of an app page until /api/me has answered, so nothing of
// the account's screens appears before the consent gate can be applied.
function Holding() {
  return (
    <div className="wrap" aria-busy="true">
      <div className="sk" aria-hidden="true">
        <div className="sk-row" style={{ height: 44 }} />
        <div className="sk-row" style={{ height: 160 }} />
      </div>
    </div>
  );
}

export function PublicShell({ children }) {
  const { me } = useMe();
  usePrefetchLinks(Boolean(me));
  return (
    <div className="app layout-public">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <TopBar />
      <main id="main" className="main" tabIndex={-1}>
        {children}
      </main>
      <Footer />
      <ToastHost />
      <UpgradeSheet />
    </div>
  );
}

// The consent gate (DESIGN_V6 §6, §10) is one screen in one chrome: an
// account that has not ticked the current terms is sent to /welcome, bare,
// with the address it was opening as `next`, and comes back once it has.
function ConsentRedirect() {
  const path = usePath();
  return <Redirect to={`/welcome?next=${encodeURIComponent(path)}`} />;
}

// Onboarding and the consent screen: the brand, the page, the short fine
// print. `gate` applies the consent check (onboarding); /welcome is the gate
// itself and /auth/done only decides where to go.
export function BareShell({ children, gate = false }) {
  const { me, loading } = useMe();
  const gated = gate && me && !hasConsent(me);
  const holding = gate && loading && !me;
  return (
    <div className="app layout-bare">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="barebar">
        <div className="barebar-inner">
          <Brand />
        </div>
      </header>
      <main id="main" className="main" tabIndex={-1}>
        {holding ? <Holding /> : gated ? <ConsentRedirect /> : children}
      </main>
      <Footer bare />
      <ToastHost />
      <UpgradeSheet />
    </div>
  );
}

export function AppShell({ children }) {
  const { me, loading } = useMe();
  const unread = useUnread(me);
  const here = usePath().split("?")[0];
  usePrefetchLinks(Boolean(me));
  const holding = loading && !me;
  // never the app chrome around the consent screen: redirect, bare
  if (me && !hasConsent(me)) return <ConsentRedirect />;
  return (
    <div className="app layout-app">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <Rail me={me} unread={unread} />
      <div className="frame">
        <PhoneHeader me={me} />
        <main id="main" className="main" tabIndex={-1}>
          {holding ? (
            <Holding />
          ) : (
            <>
              {isExplore(here) && <ExploreTabs />}
              {children}
            </>
          )}
        </main>
        <Footer />
      </div>
      <BottomBar unread={unread} />
      {me && <Tour steps={HOME_TOUR} />}
      <ToastHost />
      <UpgradeSheet />
      <CommandPalette />
      <Shortcuts />
    </div>
  );
}
