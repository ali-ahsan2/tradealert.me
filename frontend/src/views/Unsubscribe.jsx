import React, { useEffect, useState } from "react";
import { getToken } from "../api.js";
import { Link, useQuery } from "../lib/router.jsx";

// The email's unsubscribe link (DESIGN_V6 §10): a client page in the public
// layout that calls GET /api/unsubscribe with the token and channel and
// says what happened. The API has answered with HTML so far and will answer
// JSON once the legal package lands; both are read.
const CHANNEL = { email: "email", push: "web push", sms: "SMS", digest: "digests" };

export default function Unsubscribe() {
  const q = useQuery();
  const token = q.get("token") || "";
  const channel = q.get("channel") || "email";
  const [state, setState] = useState(token ? "busy" : "missing"); // busy | ok | bad | missing | offline

  useEffect(() => {
    if (!token) return undefined;
    let alive = true;
    const url = `/api/unsubscribe?token=${encodeURIComponent(token)}&channel=${encodeURIComponent(channel)}`;
    fetch(url)
      .then(async (res) => {
        const text = await res.text();
        let ok = res.ok;
        try {
          const body = JSON.parse(text);
          if (body && typeof body.ok === "boolean") ok = body.ok;
          else if (body && body.detail && !res.ok) ok = false;
        } catch {
          // the legacy HTML page: the heading says which way it went
          if (/invalid|already used/i.test(text)) ok = false;
        }
        if (alive) setState(ok ? "ok" : "bad");
      })
      .catch(() => alive && setState("offline"));
    return () => {
      alive = false;
    };
  }, [token, channel]);

  const signedIn = Boolean(getToken());
  const what = CHANNEL[channel] || channel;
  return (
    <div className="auth-shell">
      <div className="card form-card unsubscribe" aria-busy={state === "busy"}>
        {state === "busy" && (
          <>
            <h1>One moment…</h1>
            <p className="sub">Turning off {what} for this address.</p>
          </>
        )}
        {state === "ok" && (
          <>
            <h1>Unsubscribed.</h1>
            <p className="sub">No more {what} to this address. Your account and watchlist are unchanged; turn it back on any time in My account.</p>
          </>
        )}
        {state === "bad" && (
          <>
            <h1>That link is invalid or already used.</h1>
            <p className="sub">If you still receive {what}, open My account and turn the channel off there.</p>
          </>
        )}
        {state === "missing" && (
          <>
            <h1>This link is incomplete.</h1>
            <p className="sub">Open the unsubscribe link from the email itself, or change how you are reached in My account.</p>
          </>
        )}
        {state === "offline" && (
          <>
            <h1>Couldn't reach the server.</h1>
            <p className="sub">Check your connection and reload this page.</p>
          </>
        )}
        {state !== "busy" && (
          <Link to={signedIn ? "/settings#channels" : `/login?next=${encodeURIComponent("/settings")}`} className="btn btn-secondary btn-block">
            Change how I'm reached
          </Link>
        )}
        <p className="small muted" style={{ marginTop: "var(--s-4)", marginBottom: 0 }}>
          <Link to={signedIn ? "/home" : "/"}>{signedIn ? "Open my Home" : "Back to tradealert.me"}</Link>
        </p>
      </div>
    </div>
  );
}
