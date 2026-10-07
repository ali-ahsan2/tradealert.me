import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
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

function Route({ path }) {
  const [pathname] = path.split("?");
  if (pathname === "/") return <Landing />;
  if (pathname === "/board" || pathname.startsWith("/board/")) {
    return (
      <RequireAuth>
        <Board />
      </RequireAuth>
    );
  }
  const stockMatch = pathname.match(/^\/stock\/([^/?#]+)/);
  if (stockMatch) {
    return (
      <RequireAuth>
        <StockReport symbol={decodeURIComponent(stockMatch[1])} />
      </RequireAuth>
    );
  }
  if (pathname === "/login") return <Auth mode="login" />;
  if (pathname === "/signup") return <Auth mode="signup" />;
  if (pathname === "/watchlist") {
    return (
      <RequireAuth>
        <Watchlist />
      </RequireAuth>
    );
  }
  if (pathname === "/alerts") {
    return (
      <RequireAuth>
        <Alerts />
      </RequireAuth>
    );
  }
  if (pathname === "/pricing") return <Pricing />;
  if (pathname === "/settings") {
    return (
      <RequireAuth>
        <Settings />
      </RequireAuth>
    );
  }
  if (pathname === "/onboarding") {
    return (
      <RequireAuth>
        <Onboarding />
      </RequireAuth>
    );
  }
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

createRoot(document.getElementById("root")).render(<App />);
