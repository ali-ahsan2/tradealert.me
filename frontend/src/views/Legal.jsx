import React from "react";
import { Link } from "../lib/router.jsx";
import { getToken } from "../api.js";
import FinePrint from "../components/FinePrint.jsx";
import { TERMS_EFFECTIVE, TERMS_VERSION } from "../lib/legal.js";
import "./legal.css";

// Terms, Privacy and Disclaimer (DESIGN_V6 §6). One component, three
// content blocks, the same head on each: title, the version a person
// accepts, the long fine print, then the prose. Anything in [brackets] is a
// placeholder the operator completes; counsel reviews the text before launch.

const TITLES = { terms: "Terms of use", privacy: "Privacy policy", disclaimer: "Disclaimer" };

const NOT_REGISTERED =
  "We are not a registered investment adviser, broker-dealer or financial planner, and we are " +
  "not registered with [REGULATOR]. Nothing on the service is investment, legal, tax or " +
  "accounting advice. Nothing is a recommendation to buy, sell or hold any security, and " +
  "nothing is an offer or a solicitation. Nothing is personalised to your situation: every " +
  "subscriber who can see a report sees the same report. We owe you no fiduciary duty, and " +
  "using the service creates no adviser-client relationship.";

const RISK =
  "Securities, and small-company securities in particular, can lose value quickly and trade " +
  "thinly. Past movement after a score or an alert says nothing about future movement. The " +
  "published backtest measures price movement over a small sample; it does not measure profit. " +
  "You can lose some or all of the money you invest.";

const TERMS = [
  {
    id: "who",
    h: "Who we are",
    p: [
      "tradealert.me (the service) is run by [ENTITY NAME], [ENTITY FORM, registered in " +
        "JURISDICTION, number N] (we, us). The service watches the industries you pick, scores " +
        "the names in them each morning from public filings and market data, and sends you " +
        "alerts and digests when a recorded fact changes. It is an information and alerting " +
        "service.",
    ],
  },
  {
    id: "not",
    h: "What the service is, and is not",
    p: [NOT_REGISTERED],
  },
  {
    id: "ack",
    h: "Your acknowledgements",
    p: ["By creating an account you confirm that:"],
    list: [
      "you understand the service sends information and alerts, not advice;",
      "your decisions and their results are your own;",
      "you will not rely on the service as the only basis for any decision;",
      "scores and alerts are machine output that can be wrong, late or missing;",
      "you are at least 18 and may lawfully use the service where you live.",
    ],
    after: [
      "The version of these terms you accepted, and when, is stored on your account.",
    ],
  },
  {
    id: "accounts",
    h: "Accounts",
    p: [
      "One person per account. Keep your password private; what happens under your account " +
        "is your responsibility. Verifying your email turns delivery on; it does not gate " +
        "browsing. You can delete your account at any time from My account. Deletion is " +
        "permanent.",
    ],
  },
  {
    id: "billing",
    h: "Subscriptions and billing",
    p: [
      "Plans and prices are on the Plans page. A subscription buys coverage and delivery, not " +
        "advice.",
      "Paid plans renew monthly until you cancel. Cancel any time from your account; access " +
        "runs to the end of the paid period, then the account returns to Free with your " +
        "settings kept. A downgrade takes effect at the end of the billing period.",
      "Payments are processed by Stripe; we never see a card number. Refunds: [REFUND " +
        "POLICY]. We announce price changes by email at least [30] days ahead.",
    ],
  },
  {
    id: "use",
    h: "Acceptable use",
    p: ["You may not:"],
    list: [
      "scrape, crawl or bulk-download the service;",
      "resell, republish or redistribute its content, scores or alerts;",
      "share an account;",
      "try to reverse-engineer the scoring;",
      "use the service to break any law or securities rule.",
    ],
    after: ["Webhook deliveries are for your own systems."],
  },
  {
    id: "accuracy",
    h: "Accuracy and availability",
    p: [
      "Data comes from public filings, exchange and FINRA publications and third-party market " +
        "data. It can be stale, incomplete or wrong; every figure carries its source date for " +
        "that reason. We do not promise that any alert will be sent, be on time or be " +
        "complete. We may change, suspend or stop any part of the service at any time.",
    ],
  },
  { id: "risk", h: "Risk", p: [RISK] },
  {
    id: "warranties",
    h: "No warranties",
    p: [
      "The service is provided as is and as available, without warranties of any kind, express " +
        "or implied, including merchantability, fitness for a particular purpose, accuracy and " +
        "non-infringement, to the fullest extent the law allows.",
    ],
  },
  {
    id: "liability",
    h: "Limitation of liability",
    p: [
      "To the fullest extent the law allows, we and our officers, employees, contractors and " +
        "data suppliers are not liable for indirect, incidental, special, consequential or " +
        "punitive damages, or for lost profits, trading losses, loss of data or loss of " +
        "goodwill, arising from your use of, or inability to use, the service.",
      "Our total liability for any claim is limited to the greater of the fees you paid us in " +
        "the twelve months before the claim and [USD 100]. Where the law does not allow these " +
        "limits, our liability is limited as far as it does.",
    ],
  },
  {
    id: "indemnity",
    h: "Indemnity",
    p: [
      "You will indemnify us, and hold us harmless, from claims, losses and reasonable legal " +
        "costs that arise from your breach of these terms or your use of the service, " +
        "including any trading decision you make.",
    ],
  },
  {
    id: "ip",
    h: "Intellectual property",
    p: [
      "The service, its scores, copy and design belong to us or our licensors. You receive a " +
        "personal, non-transferable licence to use them for your own information. Your notes " +
        "and settings remain yours; export them at any time from My account.",
    ],
  },
  {
    id: "privacy",
    h: "Privacy",
    p: ["Our Privacy policy explains what we collect and why. It forms part of these terms."],
  },
  {
    id: "changes",
    h: "Changes to these terms",
    p: [
      "We may change these terms. We announce material changes by email or in the product at " +
        "least [14] days before they take effect. When the version changes, you are asked to " +
        "tick the acknowledgement again before you continue, and the new version and date are " +
        "stored on your account.",
    ],
  },
  {
    id: "termination",
    h: "Termination",
    p: [
      "You may stop using the service and delete your account at any time. We may suspend or " +
        "close an account that breaks these terms.",
    ],
  },
  {
    id: "law",
    h: "Governing law and disputes",
    p: [
      "[These terms are governed by the laws of JURISDICTION. Disputes go to the courts of " +
        "VENUE, or to arbitration under RULES.] Consumer rights that cannot be waived are not " +
        "affected.",
    ],
  },
  { id: "contact", h: "Contact", p: ["[ENTITY NAME], [POSTAL ADDRESS], [CONTACT EMAIL]."] },
];

const PRIVACY = [
  {
    id: "controller",
    h: "Who is responsible",
    p: [
      "[ENTITY NAME] is the controller of the personal data described here. Contact: " +
        "[CONTACT EMAIL], [POSTAL ADDRESS].",
    ],
  },
  {
    id: "collect",
    h: "What we collect",
    list: [
      "Account data: your email; your name and provider id if you sign in with Google; a " +
        "password hash; whether your email is verified; the version of the terms you accepted, " +
        "and when.",
      "Product data: the industries you follow, the names you watch, your notes, the alerts " +
        "you arm, how you want to be reached, your timezone, a phone number if you add one for " +
        "SMS, a webhook address and its encrypted signing secret, and a web-push subscription.",
      "Delivery records: which alert reached you, by which channel, and when; unsubscribe " +
        "tokens.",
      "Billing: your plan and your Stripe customer and subscription ids. Card details stay " +
        "with Stripe.",
      "Technical: your IP address, held in memory for rate limits; server logs, kept [N] days.",
    ],
  },
  {
    id: "why",
    h: "Why, and on what basis",
    list: [
      "To run the service you asked for (contract).",
      "To send account emails, and the alerts and digests you turned on.",
      "To bill you.",
      "To keep the service secure and within plan limits (legitimate interest).",
      "To meet legal obligations.",
    ],
  },
  {
    id: "processors",
    h: "Who sees it",
    p: [
      "Processors only: Stripe (payments), Amazon SES (email), [Twilio] (SMS), Google (sign-in, " +
        "if you choose it), your browser's push service, and our hosting provider [HOSTING " +
        "PROVIDER]. We do not sell personal data, we run no advertising, and we do not share " +
        "data for anyone else's purposes.",
    ],
  },
  {
    id: "email",
    h: "Email and unsubscribe",
    p: [
      "Every alert and digest email carries an unsubscribe link and a link to your settings. " +
        "Account emails (verification, password reset) are sent as needed while the account " +
        "exists. Email you switched off can be switched on again from your settings.",
    ],
  },
  {
    id: "retention",
    h: "Retention",
    p: [
      "For the life of your account. Deleting it removes your watchlist, notes, alert rules, " +
        "digests and settings. Logs and backups expire within [N] days. Billing records are " +
        "kept as long as the law requires.",
    ],
  },
  {
    id: "rights",
    h: "Your rights",
    list: [
      "Export everything you authored: My account, then Export my data.",
      "Correct it in the product.",
      "Delete your account: My account, then Delete my account.",
      "Object to processing based on legitimate interest.",
      "Complain to [SUPERVISORY AUTHORITY].",
    ],
  },
  {
    id: "cookies",
    h: "Cookies and local storage",
    p: [
      "No tracking cookies. Your browser keeps your session token and your display " +
        "preferences (theme, Simple or Full) in local storage, so the product remembers you " +
        "between visits. Clearing site data signs you out.",
    ],
  },
  { id: "children", h: "Children", p: ["The service is not for anyone under 18."] },
  {
    id: "transfers",
    h: "International transfers",
    p: [
      "[Where the servers are, and the safeguard that applies if data leaves your region.]",
    ],
  },
  {
    id: "changes",
    h: "Changes",
    p: ["As in the Terms: material changes are announced at least [14] days ahead."],
  },
  { id: "contact", h: "Contact", p: ["[CONTACT EMAIL]."] },
];

const DISCLAIMER = [
  { id: "not", h: "Not advice, not a recommendation, not registered", p: [NOT_REGISTERED] },
  {
    id: "score",
    h: "What a score is, and is not",
    p: [
      "A score ranks names on a fixed 0 to 100 scale for a human to review. It is not a " +
        "probability of success and never a call on direction. When fewer inputs had data, the " +
        "number is pulled toward neutral and the report says so.",
    ],
  },
  {
    id: "alert",
    h: "What an alert is",
    p: [
      "An alert is a message that a recorded fact changed on a name you asked us to watch. It " +
        "can be late, or fail to arrive. It is not a signal to act.",
    ],
  },
  {
    id: "record",
    h: "The record",
    p: [
      "The backtest is published as it was tested: 26 of 32 events over about two years, " +
        "measuring movement, not profit. One strategy is calibrated; the others are " +
        "provisional and have no measured record yet, so treat their names as candidates. " +
        "Past movement is not a forecast.",
    ],
  },
  {
    id: "data",
    h: "Data sources and errors",
    p: [
      "Data comes from public filings, FINRA short-interest prints, and exchange and vendor " +
        "market data. Stale or wrong inputs happen; every figure carries its date so you can " +
        "check it.",
    ],
  },
  { id: "risk", h: "Risk of loss", p: [RISK] },
  {
    id: "you",
    h: "Your responsibility",
    p: [
      "You alone decide what to do, and you bear the results. Consider a licensed professional " +
        "who knows your situation.",
    ],
  },
  {
    id: "relationship",
    h: "No relationship",
    p: ["Using the service creates no adviser-client, fiduciary or brokerage relationship."],
  },
  { id: "contact", h: "Contact", p: ["[CONTACT EMAIL]."] },
];

const PAGES = { terms: TERMS, privacy: PRIVACY, disclaimer: DISCLAIMER };

// Placeholders stay in their brackets and are highlighted, so nothing
// bracketed can pass for finished text.
function ph(text) {
  const parts = text.split(/(\[[^\]]+\])/g);
  return parts.map((part, i) =>
    /^\[[^\]]+\]$/.test(part) ? (
      <mark className="legal-ph" key={i}>
        {part}
      </mark>
    ) : (
      <React.Fragment key={i}>{part}</React.Fragment>
    ),
  );
}

function Section({ s }) {
  return (
    <section aria-labelledby={`legal-${s.id}`}>
      <h2 id={`legal-${s.id}`}>{s.h}</h2>
      {(s.p || []).map((t, i) => (
        <p key={i}>{ph(t)}</p>
      ))}
      {s.list && (
        <ul className="legal-list">
          {s.list.map((t, i) => (
            <li key={i}>{ph(t)}</li>
          ))}
        </ul>
      )}
      {(s.after || []).map((t, i) => (
        <p key={`a${i}`}>{ph(t)}</p>
      ))}
    </section>
  );
}

export default function Legal({ page }) {
  const sections = PAGES[page] || PAGES.terms;
  const signedIn = Boolean(getToken());
  return (
    <div className="wrap wrap-prose prose">
      <div className="pagehead">
        <div>
          <h1>{TITLES[page] || TITLES.terms}</h1>
          <div className="meta">
            Version {TERMS_VERSION} · effective {TERMS_EFFECTIVE}
          </div>
        </div>
      </div>

      <FinePrint className="legal-fine" />

      {sections.map((s) => (
        <Section key={s.id} s={s} />
      ))}

      <p className="legal-back">
        {signedIn ? <Link to="/home">Back to my Home</Link> : <Link to="/">Back to the start</Link>}
      </p>

      <p className="legal-note">
        Placeholders in brackets are completed by the operator; this text is reviewed by counsel
        before launch.
      </p>
    </div>
  );
}
