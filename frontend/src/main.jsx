import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import "./styles/assist.css";
import { applyTheme } from "./lib/theme.js";
import { applyMode } from "./lib/mode.js";
import { usePath, RequireAuth, Link } from "./lib/router.jsx";
import { MeProvider } from "./lib/me.jsx";
import { Shell } from "./components/Shell.jsx";
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
import Legal from "./views/Legal.jsx";
import Compare from "./views/Compare.jsx";
import Strategies, { StrategyDetail } from "./views/Strategies.jsx";
import Digests, { DigestView } from "./views/Digests.jsx";
import Industry from "./views/Industry.jsx";
import Overview from "./views/Overview.jsx";
import Screen from "./views/Screen.jsx";
import Changes from "./views/Changes.jsx";
import Calendar from "./views/Calendar.jsx";

function NotFound() {
  return (
    <div className="wrap wrap-narrow">
      <div className="card state-card">
        <p className="state-title">This page does not exist.</p>
        <p className="muted">Check the address, or go back to your Board.</p>
        <Link to="/board" className="btn btn-secondary">
          Go to the Board
        </Link>
      </div>
    </div>
  );
}

const authed = (el) => <RequireAuth>{el}</RequireAuth>;

function Route({ path }) {
  const [pathname] = path.split("?");
  if (pathname === "/") return <Landing />;
  if (pathname === "/overview") return authed(<Overview />);
  if (pathname === "/board" || pathname.startsWith("/board/")) return authed(<Board />);
  if (pathname === "/screen") return authed(<Screen />);
  if (pathname === "/changes") return authed(<Changes />);
  if (pathname === "/calendar") return authed(<Calendar />);
  const stockMatch = pathname.match(/^\/stock\/([^/?#]+)/);
  if (stockMatch) return authed(<StockReport symbol={decodeURIComponent(stockMatch[1])} />);
  if (pathname === "/login") return <Auth mode="login" />;
  if (pathname === "/signup") return <Auth mode="signup" />;
  if (pathname === "/watchlist") return authed(<Watchlist />);
  if (pathname === "/alerts") return authed(<Alerts />);
  if (pathname === "/compare") return authed(<Compare />);
  if (pathname === "/digests") return authed(<Digests />);
  const digestMatch = pathname.match(/^\/digests\/(\d+)$/);
  if (digestMatch) return authed(<DigestView id={Number(digestMatch[1])} />);
  if (pathname === "/strategies") return <Strategies />;
  const stratMatch = pathname.match(/^\/strategies\/([a-z0-9_]+)$/);
  if (stratMatch) return <StrategyDetail strategyKey={stratMatch[1]} />;
  const indMatch = pathname.match(/^\/industries\/([a-z0-9_]+)$/);
  if (indMatch) return <Industry industryKey={indMatch[1]} />;
  if (pathname === "/pricing") return <Pricing />;
  if (pathname === "/settings") return authed(<Settings />);
  if (pathname === "/onboarding") return authed(<Onboarding />);
  if (pathname === "/reset") return <Reset />;
  const legalMatch = pathname.match(/^\/legal\/(terms|privacy|disclaimer)$/);
  if (legalMatch) return <Legal page={legalMatch[1]} />;
  return <NotFound />;
}

function App() {
  const path = usePath();
  return (
    <MeProvider>
      <Shell>
        <Route path={path} />
      </Shell>
    </MeProvider>
  );
}

applyTheme();
applyMode();
createRoot(document.getElementById("root")).render(<App />);
