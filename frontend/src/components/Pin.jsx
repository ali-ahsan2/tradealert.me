import React, { useRef, useState } from "react";
import { api, toast } from "../api.js";
import { Link } from "../lib/router.jsx";
import { openUpgrade } from "../lib/upgrade.js";
import { CTA } from "../lib/plain.js";
import { Modal } from "./ui.jsx";

// A controlled watch toggle ("Watch" / "Watching"; the API still calls a
// watched name a pick). The parent owns the watched set so a board of
// fifty rows makes one picks request, not fifty. The flip is optimistic
// (DESIGN_V5 §5): the star fills the moment it is tapped and goes back,
// with a toast that names the way out, if the request fails. A 403 at
// quota opens the quota card with two ways out, one of which costs nothing;
// the paid one opens the upgrade sheet in place.
// `label` shows words beside the star: "Watch" / "Watching" unless the
// caller passes `labels` as [off, on] (the dossier asks "Watch this for me").
export default function Pin({ symbol, pinned, onChange, label = false, labels = null, className = "" }) {
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
        toast(`Watching ${symbol}. It will be in your next brief.`);
      } else {
        await api(`/me/picks/${encodeURIComponent(symbol)}`, { method: "DELETE" });
        toast(`Stopped watching ${symbol}.`);
      }
    } catch (err) {
      // roll back to what the server still holds
      onChange(symbol, pinned);
      if (err.status === 403 && next) setQuota(err.detail || "Your plan's limit on watched names is reached.");
      else if (err.status === 0) toast(`${symbol} was ${next ? "not added" : "kept"}: you appear to be offline. Check your connection and tap again.`);
      else toast(`${err.detail || `Couldn't ${next ? "watch" : "stop watching"} ${symbol}.`} Tap again to retry.`);
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
        aria-label={pinned ? CTA.STOP_WATCHING_SYM(symbol) : CTA.WATCH_SYM_FOR_ME(symbol)}
        title={pinned ? CTA.STOP_WATCHING : CTA.WATCH_FOR_ME}
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
        {label && <span>{labels ? (pinned ? labels[1] : labels[0]) : pinned ? CTA.WATCHING : CTA.WATCH}</span>}
      </button>
      {quota && (
        <Modal
          title="My watchlist is full"
          onClose={() => setQuota(null)}
          actions={
            <>
              <Link to="/watchlist" className="btn btn-secondary" onClick={() => setQuota(null)}>
                {CTA.MY_WATCHLIST}
              </Link>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setQuota(null);
                  openUpgrade("picks", { symbol });
                }}
              >
                {CTA.NEXT_PLAN}
              </button>
            </>
          }
        >
          <p>{quota}</p>
          <p className="muted">Stop watching a name to make room, or move to a plan that watches more names for you.</p>
        </Modal>
      )}
    </>
  );
}
