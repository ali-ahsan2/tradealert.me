import React from "react";
import { getToken } from "../api.js";
import { Link, useQuery } from "../lib/router.jsx";

// GET /api/verify?token= lands here with ?ok=1|0 (DESIGN_V6 §10). One line,
// one action: Home when a session exists in this browser, log in otherwise.
export default function Verified() {
  const q = useQuery();
  const ok = q.get("ok") === "1";
  const signedIn = Boolean(getToken());
  const home = signedIn ? "/home" : `/login?next=${encodeURIComponent("/home")}`;
  return (
    <div className="auth-shell">
      <div className="card form-card verified">
        {ok ? (
          <>
            <h1>Email verified. Alerts are live.</h1>
            <p className="sub">From now on you are told the day a fact changes on a name you watch.</p>
          </>
        ) : (
          <>
            <h1>That link is invalid or already used.</h1>
            <p className="sub">If your account already shows as verified, nothing more is needed.</p>
          </>
        )}
        <Link to={home} className="btn btn-primary btn-block">
          Open my Home
        </Link>
        <p className="small muted" style={{ marginTop: "var(--s-4)", marginBottom: 0 }}>
          {ok ? (
            <>Verification gates delivery, not browsing: your Home worked before this and keeps working now.</>
          ) : (
            <>
              Need a fresh link? Open <Link to={signedIn ? "/settings" : `/login?next=${encodeURIComponent("/settings")}`}>My account</Link> and tap
              “Resend the email”.
            </>
          )}
        </p>
      </div>
    </div>
  );
}
