import React, { useState } from "react";
import { api, logout, toast } from "../api.js";
import { Link, Redirect, navigate, safeNext, useQuery } from "../lib/router.jsx";
import { currentTermsVersion, hasConsent, useMe } from "../lib/me.jsx";
import { CONSENT_LABEL } from "../lib/legal.js";
import FinePrint from "../components/FinePrint.jsx";
import { downloadText } from "../lib/fmt.js";
import { DeleteModal } from "./Settings.jsx";

// The consent gate (DESIGN_V6 §6, §10): one screen, one tick, one button.
// Shown in place of any app screen until the account has accepted the
// current terms version; Google sign-ups and existing accounts meet it
// here, email sign-ups ticked the same sentence on the form. /legal/* is
// public, so the linked documents stay readable from this screen. The shells
// arrive here with the address they were opening as `next`; the tick sends
// the person back there, else to Home.
export default function Welcome() {
  const { me, refresh } = useMe();
  const q = useQuery();
  const next = safeNext(q.get("next"));
  const [tick, setTick] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Someone who will not tick can still take their data or leave (§6, §12):
  // both endpoints accept an account that has not consented.
  const exportData = async () => {
    try {
      const doc = await api("/me/export");
      downloadText(`tradealert-export-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(doc, null, 2), "application/json");
    } catch (e) {
      toast(e.detail || "Couldn't export right now.");
    }
  };
  const toHome = !next || next === "/home" || next.startsWith("/home?");

  if (me && hasConsent(me)) return <Redirect to={next || "/home"} />;

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
          {busy ? "One moment…" : toHome ? "Open my Home" : "Continue"}
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
          {me && (
            <>
              {" · "}
              <button type="button" className="linkbtn" onClick={exportData}>
                Export my data
              </button>
              {" · "}
              <button type="button" className="linkbtn" onClick={() => setConfirmDelete(true)}>
                Delete my account
              </button>
            </>
          )}
        </p>
      </form>
      {confirmDelete && <DeleteModal email={me ? me.email : ""} onClose={() => setConfirmDelete(false)} />}
    </div>
  );
}
