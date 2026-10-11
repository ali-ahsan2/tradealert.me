// The legal posture in one place (DESIGN_V6 §6). The version string is what
// a user accepts; bump it when the Terms change in substance and every
// account is asked once more. The backend holds the same constants in
// app/legal.py; the two files must match word for word.

export const TERMS_VERSION = "2026-10-11";
export const TERMS_EFFECTIVE = "11 October 2026";

// One line, under primary actions and in footers.
export const FINE_PRINT_SHORT = "Information and alerts, not advice. Your decisions are your own.";

// The paragraph, on legal pages, pricing and at the end of every email.
export const FINE_PRINT_LONG =
  "tradealert.me is an information and alerting service. It is not a registered " +
  "investment adviser or broker-dealer, owes you no fiduciary duty, does not know " +
  "your situation and gives no personalised advice; nothing it sends or shows is a " +
  "recommendation to buy, sell or hold any security. Scores rank names on a fixed " +
  "scale; alerts report that a fact changed. Past movement after an alert is not a " +
  "forecast of future movement. You are responsible for your own decisions and " +
  "their results; consider a licensed professional before you act.";

// The sentence a person ticks at sign-up and once per terms version.
export const CONSENT_LABEL =
  "I understand tradealert.me sends information and alerts, not financial advice, " +
  "and that my decisions and their results are my own.";

// Does this account still owe a tick for the current version? The server
// sends terms_version_current with /api/me so a stale client bundle never
// decides on its own; the local constant is the fallback.
export function needsConsent(me) {
  if (!me) return false;
  const current = me.terms_version_current || TERMS_VERSION;
  return me.accepted_terms_version !== current;
}
