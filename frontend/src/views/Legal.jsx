import React from "react";
import { Link } from "../lib/router.jsx";

const TITLES = { terms: "Terms of use", privacy: "Privacy policy", disclaimer: "Disclaimer" };

export default function Legal({ page }) {
  return (
    <div className="wrap wrap-prose prose">
      <div className="pagehead">
        <div>
          <h1>{TITLES[page]}</h1>
          <div className="meta">tradealert.me · effective September 2026</div>
        </div>
      </div>

      <h2>What this site is</h2>
      <p>
        tradealert.me publishes machine-scored research notes on small-cap tickers. Scores, bands
        and theses are produced by automated filters from public filings and quote data, then
        ranked for a human to review. Nothing on this site is a recommendation to buy or sell any
        security, and nothing is personalised to your situation.
      </p>

      {page === "privacy" ? (
        <>
          <h2>What we collect</h2>
          <p>
            An email address, the industries you follow, the names you pin, the alerts you arm,
            and your delivery preferences. For paying subscribers, billing details are processed
            by Stripe on our behalf; we never see a card number. Sign-in through Google shares
            your email address and name with us and nothing else.
          </p>
          <h2>What we do with it</h2>
          <p>
            We use it to run the product: to build your Board, send the alerts and digests you
            asked for, and bill you. We do not sell or share personal data with third parties for
            their own purposes. Email includes a one-click unsubscribe on every message.
          </p>
        </>
      ) : (
        <>
          <h2>Your use</h2>
          <p>
            Accounts let you follow industries, keep a watchlist and arm alerts. Every subscriber
            who can see a report sees the same report. Automated scraping, resale of the content,
            and sharing an account are prohibited.
          </p>
        </>
      )}

      {page === "disclaimer" ? (
        <>
          <h2>No advice</h2>
          <p>
            You are reading claims to double-check, not instructions to act on. A score ranks names
            on a fixed scale; it is not a probability of success and never a call on direction. Four
            of the five strategies are provisional, and the one calibrated strategy was tested on 32
            events over roughly two years, which measures movement, not profit.
          </p>
          <h2>Risk</h2>
          <p>
            Small-cap securities can move violently and trade thinly. Past movement does not predict
            future movement. You alone are responsible for your decisions, including any losses, and
            should consider consulting a licensed professional.
          </p>
        </>
      ) : (
        <>
          <h2>No warranties</h2>
          <p>
            The data pipeline is imperfect. Scores can miss inputs, shrink on thin coverage, and
            reflect stale filings; every figure carries its source date for that reason. The service
            is provided as-is, without warranty of accuracy or fitness for any purpose.
          </p>
        </>
      )}

      <h2>Contact</h2>
      <p>Questions about this page go to the operator at the address on your account page.</p>

      <p style={{ marginTop: "var(--s-6)" }}>
        <Link to="/board">Back to the Board</Link>
      </p>
    </div>
  );
}
