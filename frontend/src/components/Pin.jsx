import React, { useEffect, useState } from "react";
import { api, getToken } from "../api.js";

const toast = (msg) => window.dispatchEvent(new CustomEvent("toast", { detail: msg }));

export default function Pin({ symbol }) {
  const [pinned, setPinned] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      setPinned(false);
      return;
    }
    let alive = true;
    api("/me/picks")
      .then((d) => alive && setPinned(d.picks.some((p) => p.symbol === symbol)))
      .catch(() => alive && setPinned(false));
    return () => {
      alive = false;
    };
  }, [symbol]);

  const toggle = async () => {
    if (!getToken()) {
      toast("Sign in to pin tickers to your watchlist.");
      return;
    }
    setBusy(true);
    try {
      if (pinned) {
        await api(`/me/picks/${encodeURIComponent(symbol)}`, { method: "DELETE" });
        setPinned(false);
        toast(`Removed ${symbol} from watchlist.`);
      } else {
        await api("/me/picks", { method: "POST", json: { symbol } });
        setPinned(true);
        toast(`Pinned ${symbol} to watchlist.`);
      }
    } catch (e) {
      toast(e.status === 403 ? `${e.detail}` : (e.detail || String(e.message)));
    } finally {
      setBusy(false);
    }
  };

  if (pinned === null) return <span className="pinpin" aria-hidden="true">…</span>;
  return (
    <button
      className={`pin ${pinned ? "pinned" : ""}`}
      aria-label={pinned ? `Remove ${symbol} from watchlist` : `Pin ${symbol}`}
      title={pinned ? "Remove from watchlist" : "Pin to watchlist"}
      disabled={busy}
      onClick={toggle}
    >
      {pinned ? "★" : "☆"}
    </button>
  );
}