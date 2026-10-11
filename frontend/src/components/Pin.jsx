import React, { useRef, useState } from "react";
import { api, toast } from "../api.js";
import { Link } from "../lib/router.jsx";
import { openUpgrade } from "../lib/upgrade.js";
import { Modal } from "./ui.jsx";

// A controlled pin toggle. The parent owns the pinned set so a board of
// fifty rows makes one picks request, not fifty. The flip is optimistic
// (DESIGN_V5 §5): the star fills the moment it is tapped and goes back,
// with a toast that names the way out, if the request fails. A 403 at
// quota opens the quota card with two ways out, one of which costs nothing;
// the paid one opens the upgrade sheet in place.
// `label` shows words beside the star; `labels` is [off, on], defaulting
// to "Pin" / "Pinned" so a caller can ask "Watch this for me" / "Watching".
export default function Pin({ symbol, pinned, onChange, label = false, labels = ["Pin", "Pinned"], className = "" }) {
  const inflight = useRef(false);
  const [quota, setQuota] = useState(null);

  const toggle = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (inflight.current) return;
    inflight.current = true;
    const next = !pinned;
    onChange(symbol, next);
    try {
      if (next) {
        await api("/me/picks", { method: "POST", json: { symbol } });
        toast(`Watching ${symbol} for you. It will be in your next digest.`);
      } else {
        await api(`/me/picks/${encodeURIComponent(symbol)}`, { method: "DELETE" });
        toast(`Removed ${symbol} from your watchlist.`);
      }
    } catch (err) {
      // roll back to what the server still holds
      onChange(symbol, pinned);
      if (err.status === 403 && next) setQuota(err.detail || "Your plan's pick limit is reached.");
      else if (err.status === 0) toast(`${symbol} was ${next ? "not pinned" : "kept"}: you appear to be offline. Check your connection and tap again.`);
      else toast(`${err.detail || `Couldn't ${next ? "pin" : "unpin"} ${symbol}.`} Tap again to retry.`);
    } finally {
      inflight.current = false;
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
        {label && <span>{pinned ? labels[1] : labels[0]}</span>}
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
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setQuota(null);
                  openUpgrade("picks", { symbol });
                }}
              >
                See plans
              </button>
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
