import React, { useState } from "react";
import { api, toast } from "../api.js";
import { Link } from "../lib/router.jsx";
import { Modal } from "./ui.jsx";

// A controlled pin toggle. The parent owns the pinned set so a board of
// fifty rows makes one picks request, not fifty. A 403 at quota opens the
// quota modal with two ways out, one of which costs nothing.
export default function Pin({ symbol, pinned, onChange, label = false, className = "" }) {
  const [busy, setBusy] = useState(false);
  const [quota, setQuota] = useState(null);

  const toggle = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    try {
      if (pinned) {
        await api(`/me/picks/${encodeURIComponent(symbol)}`, { method: "DELETE" });
        onChange(symbol, false);
        toast(`Removed ${symbol} from your watchlist.`);
      } else {
        await api("/me/picks", { method: "POST", json: { symbol } });
        onChange(symbol, true);
        toast(`Pinned ${symbol}. It will be in your next digest.`);
      }
    } catch (err) {
      if (err.status === 403) setQuota(err.detail || "Your plan's pick limit is reached.");
      else toast(err.detail || "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className={`pin ${pinned ? "pinned" : ""} ${label ? "pin-labelled" : ""} ${className}`}
        aria-pressed={pinned}
        aria-label={pinned ? `Remove ${symbol} from watchlist` : `Pin ${symbol} to watchlist`}
        title={pinned ? "Remove from watchlist" : "Pin to watchlist"}
        disabled={busy}
        onClick={toggle}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M8 1.6l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.4l-3.8 2 .7-4.3-3.1-3 4.3-.6z"
            fill={pinned ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
        </svg>
        {label && <span>{pinned ? "Pinned" : "Pin"}</span>}
      </button>
      {quota && (
        <Modal
          title="Pick limit reached"
          onClose={() => setQuota(null)}
          actions={
            <>
              <Link to="/watchlist" className="btn btn-secondary" onClick={() => setQuota(null)}>
                Manage watchlist
              </Link>
              <Link to="/pricing" className="btn btn-primary" onClick={() => setQuota(null)}>
                See plans
              </Link>
            </>
          }
        >
          <p>{quota}</p>
          <p className="muted">Unpin a name to make room, or move to a plan with more picks.</p>
        </Modal>
      )}
    </>
  );
}
