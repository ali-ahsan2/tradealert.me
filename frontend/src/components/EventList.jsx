import React from "react";
import { api } from "../api.js";
import { Link } from "../lib/router.jsx";
import { age, dateTime, shortDate } from "../lib/fmt.js";
import { DILUTION_TRIGGERS } from "../lib/evidence.js";

// One renderer for an impersonal alert event, used by the Alerts screen and
// the dossier. Unread is a dot plus bold, never colour alone. A dilution
// filing is the one event allowed coloured body text: it is a stop sign.
export function AlertItem({ ev, tz, showSymbol = true, onRead }) {
  const dilution = DILUTION_TRIGGERS.has(ev.trigger_key);
  const a = age(ev.fired_at);
  const unread = ev.read === false;
  const markRead = () => {
    if (!unread || !ev.id) return;
    api("/me/alerts/read", { method: "POST", json: { event_id: ev.id } })
      .then(() => onRead && onRead(ev.id))
      .catch(() => {});
  };
  return (
    <article className={`card alert ${unread ? "unread" : ""}`}>
      <div className="r1">
        {unread && <span className="unread-dot" aria-label="Unread" />}
        {showSymbol && (
          <Link className="sym" to={`/stock/${ev.symbol}`} onClick={markRead}>
            {ev.symbol}
          </Link>
        )}
        <span className="chip chip-plain">{ev.trigger}</span>
        <span className="when" title={dateTime(ev.fired_at, tz)}>
          {a ? `${a.label} ago` : shortDate(ev.fired_at, tz)}
        </span>
      </div>
      <div className={`r2 ${dilution ? "dilution" : ""} ${unread ? "bold" : ""}`}>{ev.detail || ev.trigger}</div>
      <div className="r3">
        {ev.theme ? `${ev.theme} · ` : ""}
        {ev.channels && ev.channels.length
          ? `delivered by ${ev.channels.join(", ")}${ev.delivered_at ? ` · ${shortDate(ev.delivered_at, tz)}` : ""}`
          : "not armed on your account; shown because the name is in your universe"}
      </div>
      <div className="r4">
        <Link to={`/stock/${ev.symbol}`} onClick={markRead}>
          View report →
        </Link>
        {unread && (
          <button className="btn-quiet" onClick={markRead}>
            Mark read
          </button>
        )}
        <Link to={`/alerts?tab=armed&symbol=${encodeURIComponent(ev.symbol)}`} className="faint">
          Arm on {ev.symbol}
        </Link>
      </div>
    </article>
  );
}
