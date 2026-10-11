import React, { Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import "./styles/assist.css";
import { applyTheme } from "./lib/theme.js";
import { applyMode } from "./lib/mode.js";
import { getToken } from "./api.js";
import { Link, Redirect, RequireAuth, safeNext, usePath } from "./lib/router.jsx";
import { MeProvider } from "./lib/me.jsx";
import { AppShell, BareShell, PublicShell } from "./components/Shell.jsx";
import Board from "./views/Board.jsx";
const StockReport = lazy(() => import("./views/StockReport.jsx"));
import Landing from "./views/Landing.jsx";
import Auth, { AuthDone } from "./views/Auth.jsx";
import Watchlist from "./views/Watchlist.jsx";
import Alerts from "./views/Alerts.jsx";
const Pricing = lazy(() => import("./views/Pricing.jsx"));
const Settings = lazy(() => import("./views/Settings.jsx"));
const Onboarding = lazy(() => import("./views/Onboarding.jsx"));
const Reset = lazy(() => import("./views/Reset.jsx"));
const Legal = lazy(() => import("./views/Legal.jsx"));
const Compare = lazy(() => import("./views/Compare.jsx"));
const Strategies = lazy(() => import("./views/Strategies.jsx"));
const StrategyDetail = lazy(() => import("./views/Strategies.jsx").then((m) => ({ default: m.StrategyDetail })));
const Digests = lazy(() => import("./views/Digests.jsx"));
const DigestView = lazy(() => import("./views/Digests.jsx").then((m) => ({ default: m.DigestView })));
const Industry = lazy(() => import("./views/Industry.jsx"));
const Welcome = lazy(() => import("./views/Welcome.jsx"));
const Verified = lazy(() => import("./views/Verified.jsx"));
const Unsubscribe = lazy(() => import("./views/Unsubscribe.jsx"));
import Overview from "./views/Overview.jsx";
import Screen from "./views/Screen.jsx";
import Changes from "./views/Changes.jsx";
import Calendar from "./views/Calendar.jsx";
const Help = lazy(() => import("./views/Help.jsx"));

function NotFound() {
  const home = getToken() ? "/home" : "/";
  return (
    <div className="wrap wrap-narrow">
      <div className="card state-card">
        <p className="state-title">This page does not exist.</p>
        <p className="muted">Check the address, or go home.</p>
        <Link to={home} className="btn btn-secondary">
          {getToken() ? "Open my Home" : "Back to tradealert.me"}
        </Link>
      </div>
    </div>
  );
}

// The route table (DESIGN_V6 §3, §10). The layout is a property of the
// route, so a public page never wears the rail and nothing flashes while
// /api/me loads. `match` is an exact path or a RegExp; `element` receives
// the match, the query and the raw search string. `auth` wraps the page in
// RequireAuth; `gate` applies the consent check in the bare layout; layout
// "none" is for a pure redirect, which must run before any shell could hold
// the page behind the account load or the consent gate.
const ROUTES = [
  // public
  { match: "/", layout: "public", element: () => (getToken() ? <Redirect to="/home" /> : <Landing />) },
  { match: "/about", layout: "public", element: () => <Landing /> },
  { match: "/pricing", layout: "public", element: () => <Pricing /> },
  { match: "/help", layout: "public", element: () => <Help /> },
  { match: "/strategies", layout: "public", element: () => <Strategies /> },
  { match: /^\/strategies\/([a-z0-9_]+)$/, layout: "public", element: (m) => <StrategyDetail strategyKey={m[1]} /> },
  { match: /^\/industries\/([a-z0-9_]+)$/, layout: "public", element: (m) => <Industry industryKey={m[1]} /> },
  { match: /^\/legal\/(terms|privacy|disclaimer)$/, layout: "public", element: (m) => <Legal page={m[1]} /> },
  { match: "/login", layout: "public", element: (_m, q) => (getToken() ? <Redirect to={safeNext(q.get("next")) || "/home"} /> : <Auth mode="login" />) },
  { match: "/signup", layout: "public", element: (_m, q) => (getToken() ? <Redirect to={safeNext(q.get("next")) || "/home"} /> : <Auth mode="signup" />) },
  { match: "/reset", layout: "public", element: () => <Reset /> },
  { match: "/verified", layout: "public", element: () => <Verified /> },
  { match: "/unsubscribe", layout: "public", element: () => <Unsubscribe /> },
  // bare
  { match: "/onboarding", layout: "bare", auth: true, gate: true, element: () => <Onboarding /> },
  { match: "/welcome", layout: "bare", auth: true, element: () => <Welcome /> },
  { match: "/auth/done", layout: "bare", element: () => <AuthDone /> },
  // app
  { match: "/overview", layout: "none", element: (_m, _q, search) => <Redirect to={`/home${search}`} /> },
  { match: "/home", layout: "app", auth: true, element: () => <Overview /> },
  { match: /^\/board(\/|$)/, layout: "app", auth: true, element: () => <Board /> },
  { match: "/screen", layout: "app", auth: true, element: () => <Screen /> },
  { match: "/changes", layout: "app", auth: true, element: () => <Changes /> },
  { match: "/calendar", layout: "app", auth: true, element: () => <Calendar /> },
  { match: /^\/stock\/([^/?#]+)/, layout: "app", auth: true, element: (m) => <StockReport symbol={decodeURIComponent(m[1])} /> },
  { match: "/watchlist", layout: "app", auth: true, element: () => <Watchlist /> },
  { match: "/alerts", layout: "app", auth: true, element: () => <Alerts /> },
  { match: "/compare", layout: "app", auth: true, element: () => <Compare /> },
  { match: "/digests", layout: "app", auth: true, element: () => <Digests /> },
  { match: /^\/digests\/(\d+)$/, layout: "app", auth: true, element: (m) => <DigestView id={Number(m[1])} /> },
  { match: "/settings", layout: "app", auth: true, element: () => <Settings /> },
];

function resolve(path) {
  const [pathname, qs = ""] = path.split("?");
  const search = qs ? `?${qs}` : "";
  const q = new URLSearchParams(qs);
  for (const r of ROUTES) {
    const m = typeof r.match === "string" ? (pathname === r.match ? [pathname] : null) : pathname.match(r.match);
    if (!m) continue;
    const el = r.element(m, q, search);
    return { ...r, node: r.auth ? <RequireAuth>{el}</RequireAuth> : el };
  }
  // an unknown address: public for a visitor, inside the app for a member
  return { layout: getToken() ? "app" : "public", node: <NotFound /> };
}

function RouteFallback() {
  return (
    <div className="wrap" aria-busy="true">
      <div className="sk" aria-hidden="true">
        <div className="sk-row" style={{ height: 44 }} />
        <div className="sk-row" style={{ height: 160 }} />
        <div className="sk-row" style={{ height: 120 }} />
      </div>
    </div>
  );
}

function NoShell({ children }) {
  return children;
}

const SHELLS = { public: PublicShell, bare: BareShell, app: AppShell, none: NoShell };

function App() {
  const path = usePath();
  const route = resolve(path);
  const Shell = SHELLS[route.layout] || PublicShell;
  return (
    <MeProvider>
      <Shell gate={route.gate}>
        <Suspense fallback={<RouteFallback />}>
          <div className="page-enter" key={path.split("?")[0]}>
            {route.node}
          </div>
        </Suspense>
      </Shell>
    </MeProvider>
  );
}

applyTheme();
applyMode();
// A tab opened before a deploy may ask for a route chunk the new build no
// longer ships. Reload once so it picks up the current index page.
window.addEventListener("vite:preloadError", (e) => {
  try {
    if (sessionStorage.getItem("ta_reloaded_for_chunk")) return;
    sessionStorage.setItem("ta_reloaded_for_chunk", "1");
  } catch {}
  e.preventDefault();
  window.location.reload();
});

createRoot(document.getElementById("root")).render(<App />);
