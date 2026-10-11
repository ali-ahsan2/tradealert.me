import React, { useState } from "react";
import { api, logout, toast } from "../api.js";
import { Link, Redirect, navigate } from "../lib/router.jsx";
import { currentTermsVersion, hasConsent, useMe } from "../lib/me.jsx";
import { CONSENT_LABEL } from "../lib/legal.js";
import FinePrint from "../components/FinePrint.jsx";

// The consent gate (DESIGN_V6 §6, §10): one screen, one tick, one button.
// Shown in place of any app screen until the account has accepted the
// current terms version; Google sign-ups and existing accounts meet it
// here, email sign-ups ticked the same sentence on the form. /legal/* is
// public, so the linked documents stay readable from this screen.
export default function Welcome() {
  const { me, refresh } = useMe();
  const [tick, setTick] = useState(false);
  const [busy, setBusy] = useState(false);

  if (me && hasConsent(me)) return <Redirect to="/home" />;

  const go = async (e) => {
    e.preventDefault();
    if (!tick) return;
    setBusy(true);
    try {
      await api("/me/consent", { method: "POST", json: { version: currentTermsVersion(me) } });
      const next = await refresh();
      if (!next || !hasConsent(next)) toast("Saved, but the account did not update. Reload and try again.");
    } catch (err) {
      toast(err.status === 404 || err.status === 405 ? "Consent cannot be recorded yet. Try again later." : err.detail || "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wrap wrap-narrow welcome">
      <form className="card welcome-card" onSubmit={go}>
        <p className="welcome-k">Before we start</p>
        <h1>Welcome to tradealert.me.</h1>
        <p className="welcome-lede">
          It watches my industries. It tells me before the move is over. Measured, not predicted.
        </p>
        <p className="muted">
          You pick the industries. It watches every name in them each morning, tells you the day a fact changes, and keeps score of how early it told
          you. You decide what to do; it never decides for you.
        </p>
        <label className="check consent">
          <input type="checkbox" required checked={tick} onChange={(e) => setTick(e.target.checked)} />
          <span>
            {CONSENT_LABEL}{" "}
            <span className="consent-links">
              <Link to="/legal/terms">Terms</Link> · <Link to="/legal/privacy">Privacy</Link> · <Link to="/legal/disclaimer">Disclaimer</Link>
            </span>
          </span>
        </label>
        <FinePrint short links={false} className="welcome-fine" />
        <button type="submit" className="btn btn-primary btn-block" disabled={!tick || busy}>
          {busy ? "One moment…" : "Open my Home"}
        </button>
        <p className="xs faint welcome-out">
          {me && me.email ? `Signed in as ${me.email}. ` : ""}
          <button
            type="button"
            className="linkbtn"
            onClick={() => {
              logout();
              navigate("/");
            }}
          >
            Sign out
          </button>
        </p>
      </form>
    </div>
  );
}
