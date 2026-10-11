# Design v5: desire, flow, and the record

v4 made the product look like a consumer app and read like an assistant.
v5 makes people want it. The owner's brief: human nature trumps everything;
package the product so that it invokes FOMO and the desire for a return;
make the flows smooth and connected; keep it solid and fast; make it
legendary. This document is the master plan and the rules that keep that
packaging honest, because the honest version is the one that holds up with
a sceptical, grown-up audience.

## 1. The thesis

**Earned FOMO. Visible lead. Zero friction.**

- *Earned FOMO*: every "you missed it" is a recorded event. An alert fired
  on a name in your industries; you were not watching it; the name then
  moved. We show that, with the date, the trigger and the measured move.
  Nothing invented, no countdowns, no fake scarcity, no testimonials we do
  not have.
- *Visible lead*: the return the product offers is time and coverage. "You
  were told three sessions before the peak." "Seven names in your
  industries moved 10% or more after an alert this month; your plan watched
  one of them." That is the ROI story, and it is true.
- *Zero friction*: sign up, pick an industry, pin a name, turn on alerts,
  see your first brief, and never leave the page to upgrade. Every
  decision point has one obvious action and the reason for it.

## 2. Copy rules (binding)

Allowed, because recorded:
- "You were told", "you would have been told", "fired", "moved", "peaked",
  "N sessions before", "N of M measured", "your plan watched K of them".
- Counts of what happened beyond the subscriber's plan (never tickers).
- The backtest record exactly as published (26 of 32 events, 81.2%, with
  its caveats), the subscriber's own record, the universe's pulse.
- Plan facts as desire: unlimited alerts, every industry, four channels.

Never:
- Returns, profit, "make money", "winner", "opportunity", predictions,
  "will move", "guaranteed", "most popular" without data.
- Testimonials, user counts, "join thousands", invented urgency.
- Red or green outside price moves and PASS/FAIL. Score deltas stay plain.
- A ticker the plan does not entitle the viewer to see.

Tone: calm, precise, a little dangerous. Short sentences. Numbers do the
selling; adjectives do not.

## 3. The record (backend)

New module `app/record.py`, measured the same way as the alert outcomes
screen (last close on or before the alert → close five sessions later and
the highest high inside those sessions). Three products of one query:

| Endpoint | Who | What |
| --- | --- | --- |
| `GET /api/pulse?days=30` | anonymous, cached 5 min | Universe totals (names, industries, strategies), alerts fired / measured / moved 10% / moved 20%, median sessions from alert to peak, per-industry counts, and up to six examples with industry, trigger, move and lead but **no ticker**. |
| `GET /api/me/record?days=30` | subscriber, visibility-scoped | `told` (alerts delivered to this account, with the move after), `missed` (alerts on names in the universe with no rule armed; tickers clamped to `names_shown_limit`, the rest as counts), `beyond` (alerts in industries not followed: counts and industry labels only). |
| digest | email job | Three plain lines from the same facts: told, missed, beyond. |

Fields on an event: `symbol, theme, industry_label, trigger, date, detail,
told, chg_5d, max_5d, peak_after_sessions, pending`. A tally is
`{fired, names, measured, moved_10, moved_20, industries}`.

Indexes: `alert_events (fired_at DESC)`, `alert_deliveries (alert_event_id,
user_id)` (migration 011).

## 4. The funnel, connected

1. **Landing** opens on the live pulse: what fired across the universe
   this month and what moved after, counted; one example sentence with a
   lead ("told 3 sessions before a 24% peak"); the record; three real
   product shots; plans anchored on Pro's unlimited alerts; one CTA
   everywhere, sticky on phones.
2. **Sign up** keeps the pulse in view and takes 20 seconds.
3. **Onboarding** picks an industry with its month in numbers (alerts
   fired, names that moved after), explains three words, pins one name and
   turns on alerts in one tap.
4. **First brief** on Home: "Since you signed up / this month in your
   industries: N alerts fired, M moved 10%+. You are now watching K." Then
   the brief itself.
5. **Daily**: Home leads with what changed and what you were told; the
   "You'd have known" card shows the misses with the lead time; the
   "Your record" card shows told → moved.
6. **Upgrade** is a sheet, not a page. Any plan prompt opens it in place,
   framed on the viewer's own counts ("12 alerts fired in 4 industries you
   don't follow; 5 moved 10%+. Investor follows all of them."), with
   one-tap checkout. The plans page stays for comparison.
7. **Email**: the digest carries the week's record and a link to the brief.

## 5. Interface patterns

- **Pulse counters** count up once on reveal; respect reduced motion.
- **Lead badge**: "told 3 sessions before the peak" as a chip beside a
  measured move; "window open" while the five sessions are not complete.
- **Miss row**: symbol · trigger · date · moved +24% (max in 5 sessions) ·
  Notify me. The move keeps price colour; nothing else is coloured.
- **Upgrade sheet**: title states the viewer's own missed count; body
  states what the next plan watches; one primary button to checkout;
  secondary "Compare plans"; never more than two sentences of pitch.
- **Reveal**: sections fade and rise 8px on first scroll into view;
  numbers settle; no parallax, no autoplay video.
- **Optimistic actions**: pin and notify flip instantly and roll back on
  error with a toast that names the way out.

## 6. Performance

- Route-level code splitting: the dossier and its charting library load on
  first use; the Lab is already separate; landing stays light.
- Public endpoints carry `Cache-Control`; the pulse is computed at most
  once per five minutes per process.
- Hover and focus prefetch of the dossier payload on Board, Home and Find.
- The two new indexes keep the record queries on index scans.

## 7. Packages

- P-A Landing v5 (`views/Landing.jsx`, `landing.css`, `components/Pulse.jsx`).
- P-B Flow: `views/Auth.jsx`, `views/Onboarding.jsx`, first-brief moment on Home.
- P-C Home + Upgrade sheet + record cards (`views/Overview.jsx`,
  `components/UpgradeSheet.jsx`, `components/RecordCard.jsx`, `lib/upgrade.js`).
- P-D Dossier, Alerts, Watchlist desire layer and optimistic actions.
- P-E Shell, routing, code splitting, prefetch, motion tokens, docs, tests.
