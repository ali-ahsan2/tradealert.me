# Design v6: tell me first

v5 built the record and the funnel. The owner's review of it: the interface
is heavy and Excel-like; the landing wears the app's side nav; Home is not
simple; the strategies are not explained in human terms; the ".me" in the
name is the user, not a region; the vibe must say "this alerts me to moves
so I can be aware and make money" while the fine print says, unmistakably,
that we are not advisers; attention is short, so the value must be obvious
on every screen; and the Lab must be readable by people without the domain.

v6 is the user-journey rebuild that answers all of that. This document is
the master plan and the binding rules. The honesty rules of PRODUCT_DESIGN
§2 and DESIGN_V5 §2 still hold underneath everything here.

## 1. The proposition, in the user's words

**tradealert.me: tell me before the move is over.**

The product is "me" software. I pick the industries I care about. It watches
every name in them, every morning. It tells me the day a fact changes, and it
keeps score of how early it told me. I decide what to do; it never decides
for me.

Three sentences carry the whole product and recur, verbatim or nearly, on
every surface:

1. *It watches my industries.*
2. *It tells me before the move is over.*
3. *Measured, not predicted.*

What the vibe may say: awareness, timing, lead, coverage, "you were told
five sessions before the peak", "18 alerts fired in industries you don't
follow". What it may never say: a return, a profit, a recommendation, a
prediction, "guaranteed", "most popular", a countdown.

## 2. The voice (binding)

- **Labels are mine.** Nouns that belong to the user take "My": My alerts,
  My watchlist, My record, My week, My industries, My plan.
- **Buttons ask on my behalf.** "Alert me", "Tell me when it moves", "Watch
  this for me", "Show me what I missed", "Send me the brief". A button is a
  request from me to the product, in four words or fewer where possible.
- **Sentences speak to me.** Body copy uses "you": "You were told 5 sessions
  before the peak." Never "the user", never "subscribers" on a subscriber
  screen.
- **One idea per sentence, 14 words or fewer** on cards and headers.
- **Plain word first, technical word second.** "How much data (coverage)",
  "pulled toward neutral for missing data (shrinkage)". The jargon table in
  §7 is the dictionary. A technical word may appear alone only inside Full
  mode and the Lab.
- **No region.** Nothing in copy, imagery or naming implies the Middle East
  or any geography. ".me" is read aloud as "me" wherever the name is
  explained: "tradealert dot me: alerts, sent to me."

## 3. The journey

Two layouts, chosen by who is looking, never by the route alone:

- **Public layout**: a slim top bar (wordmark, Log in, Start free), the page,
  a footer with the fine print and the legal links. Used for the landing,
  pricing, help, legal, log in, sign up, reset, and the verify page when the
  viewer is anonymous. No side nav, no tab bar, no account menu.
- **App layout**: the shell (side nav on desktop, five tabs on phones, the
  account menu). Used for every app screen when signed in. A signed-in user
  who visits `/` is sent to Home. A signed-in user who opens pricing, help
  or legal sees them inside the app layout.

The newcomer's path, each step one screen with one action:

1. Landing (public): the proposition, the live pulse, how it works, the
   record, plans, questions. One action: Start free.
2. Sign up: email, password, the consent tick (§6). One action: Create my
   account. The pulse panel stays as reassurance.
3. Verify: a page that says what was sent and what happens next; the
   onboarding may continue meanwhile.
4. Onboarding, three steps: pick my industries; pick the names to watch for
   me; choose how to tell me. Each step states the month in numbers for what
   I just picked.
5. Home, first time: a welcome card that restates the three sentences and
   points at the first thing to read. Dismissed once.

Navigation is the same five items on every device: **Home, Board, Find,
Watchlist, Alerts.** "What changed" and "Coming up" become sections of Home
with their own pages reachable by "See all". Everything else lives in the
account menu.

## 4. Home: simple, value first

Home answers "what happened for me and what should I look at" in one glance.

1. **The line**: one sentence with today's counts and one primary action,
   the most urgent thing: "Since yesterday's run: 3 alerts for you, 2 names
   you watch moved, 21 dates in the next two weeks." → "Read my alerts".
2. **Three cards**, equal, a big number and one sentence each:
   - *Told me*: alerts delivered; the latest one named. → My alerts.
   - *I'd have known*: alerts on names in my industries I was not watching,
     and how many moved. → Show me what I missed. (The honest FOMO card.)
   - *Coming up*: dated events in the next 14 days, the nearest named. →
     Calendar.
3. **My record**, one line: "You were told 5 sessions before ATI peaked
   +13.5%." → My record.
4. **What changed**, three rows, then "Show all 46".
5. **My plan**, quiet: "Your plan watches 5 of 10 industries. 18 alerts fired
   in the other 4 this month." → See what the next plan watches. This is the
   in-product marketing; it is a fact, and it opens the upgrade sheet.
6. **How this works**, shown until dismissed: three icons, three sentences.

Caps: three items per list before "Show all"; two lines of text per card;
one chart at most above the fold, and only if it says something.

## 5. Lightness: the system

- Type: body 16px minimum; card sentences 17px; big numbers 32–40px;
  section titles 20px. Monospace only in Full mode and the Lab; numbers use
  tabular figures in the body face.
- Space: 20px card padding on phones, 24px on desktop; rows at least 56px
  tall; one shadow level; borders at 8% ink.
- Shape: cards and lists, not tables, in Simple mode. The table is a Full
  mode view with a visible switch ("More detail").
- Colour: ink, one accent, one warm accent for the live dot; red and green
  only on price moves and PASS/FAIL, as before.
- Chips: at most two per row; the band word is the chip, the score follows
  it in text.
- Board (Simple): a card per name: symbol and theme, one sentence of what
  changed, the band word, "Alert me" and "Watch". Full: the table.
- Find (Simple): ready-made screens as big buttons, results as cards. Full:
  the filter grid.
- Dossier: the sentence, the band, two actions, one chart; "Why" as three
  plain bullets; "Full breakdown" collapsed.

## 6. The legal posture (binding)

The vibe says "this helps me be aware and act in time". The fine print says,
everywhere it matters and once with a tick, that we are information and
alerts, not advice.

- **Consent at sign-up**: a required tick. "I understand tradealert.me sends
  information and alerts, not financial advice, and that my decisions and
  their results are my own." The API refuses sign-up without it and stores
  `terms_version` and `terms_accepted_at` on the user. Sign-in with Google
  collects the same tick before the account is usable.
- **Existing accounts** see a one-time acknowledgement on their next visit,
  with the same tick, before the app continues.
- **One fine-print component**, two sizes. *Short*, one line, under every
  primary action area and in every footer: "Information and alerts, not
  advice. Your decisions are your own." *Long*, the paragraph, on the legal
  pages, the pricing page and in every email.
- **Terms, Privacy, Disclaimer** rewritten to the standard a lawyer expects:
  what the service is and is not (not a registered investment adviser or
  broker-dealer; no fiduciary duty; no personalised advice), the user's
  acknowledgements, accounts and subscriptions, acceptable use, accuracy and
  availability, risk, limitation of liability, indemnity, changes,
  governing law (placeholder), contact. Placeholders are marked for the
  operating entity and jurisdiction. **A lawyer must review before launch.**
- **Emails** carry the long fine print and the unsubscribe line.
- **Pricing**: "A subscription buys coverage and delivery, not advice."

## 7. Attention: utility on every screen

Every screen opens with **one line and one action**: what this screen does
for me today, and the thing to do. Then at most three items before "more".

The jargon table, applied everywhere outside Full mode and the Lab:

| Technical | Plain, shown first |
| --- | --- |
| band | the rating word (strong, elevated, neutral, weak) |
| coverage | how much data the score had |
| shrinkage | pulled toward neutral for missing data |
| lens | strategy |
| calibrated | has a measured record |
| provisional | no measured record yet |
| hard filter | must-pass rule |
| SI / short interest print | short interest: the share of the float sold short |
| borrow fee 2x | the cost to borrow the stock doubled |
| stage: early / event | no date set yet / a date is set |
| catalyst | a dated event that can move the price |
| run | this morning's scoring |

## 8. Strategies and themes, in human terms

Each strategy gets a plain card, the same shape every time, and the recipe
stays private:

- *In one line*: what it hunts.
- *What it looks for*: three or four plain bullets, no numbers.
- *The move it tries to catch*: the shape of the move and the time frame.
- *What it ignores*: so the user knows what it is not.
- *Its record*: for a calibrated strategy, the measured numbers; for a
  provisional one, "no measured record yet; treat its names as candidates".

The same shape for industries: what is in it, why it moves, what tends to
fire there, the month in numbers. The copy lives in code
(`app/plain_copy.py`), ships through the existing strategy and industry
endpoints as a `plain` object, and appears on the lens picker, the
Strategies page, the dossier's "Why" card and onboarding. Exact weights,
thresholds and filter numbers leave every subscriber surface; they remain
in the Lab.

## 9. The Lab, readable

Function beats form in the Lab, so nothing moves. Clarity is added: a
"What this lab is" panel first; every panel headed with what it shows, why it
matters and how to read it; plain labels beside technical ones; a glossary
drawer; a "Start here" path for a new programmer. Raw JSON stays, behind a
toggle, with a sentence above it.

## 10. Packages, ownership and contracts

Six packages run in parallel worktrees (wave 1), then one sweep (wave 2).
Each owns its files; nobody edits a file another package owns. Shared
pieces were committed to the branch before the worktrees were cut:
`app/plain_copy.py` (+ `plain` on `/api/strategies`, `/api/industries` and
both detail endpoints), `frontend/src/components/Plain.jsx`,
`frontend/src/components/FinePrint.jsx`, `frontend/src/lib/legal.js`,
`frontend/src/lib/caps.js`.

Decisions that bind every package:

- Routes: `/home` replaces `/overview` (permanent client redirect kept).
  Nav is four items on every device: **Home** (`/home`), **Alerts**,
  **Watchlist**, **Explore** (`/board`, with a tab strip Ranked · Find ·
  What changed · Coming up over the existing Board, Find, Changes and
  Calendar pages; their URLs keep working). Account menu: Account, Plans,
  Help, Sign out (+ Lab for admins). The command palette keeps every screen.
- Layouts by route: public (`/`, `/pricing`, `/help`, `/strategies*`,
  `/industries/*`, `/legal/*`, `/login`, `/signup`, `/reset`, `/verified`,
  `/unsubscribe`, `/about`), bare (`/onboarding`, `/welcome`), app (all
  else). Signed-in `/` → `/home`; the landing stays reachable at `/about`.
- Simple is the structural default (cards, caps, one column); the table
  exists only in Full. The switch is labelled "Detail: Simple / More" and
  lives in the account menu and at the top of Explore and the dossier.
- Consent contract: `POST /api/signup` requires `accept_terms: true` (422
  otherwise); `GET /api/me` returns `accepted_terms_at` and
  `accepted_terms_version`; `POST /api/me/consent {version}` records them.
  `TERMS_VERSION = "2026-10-11"` in `app/legal.py` and
  `frontend/src/lib/legal.js`. A signed-in user without consent for the
  current version is shown `/welcome` (bare layout, one tick, one button)
  before any app screen; `/legal/*` stays readable from it.
- Verify: `GET /api/verify?token=` redirects to `/verified?ok=1|0`; the
  client page offers "Open my Home" (Home when a session exists, else log
  in). `POST /api/me/verify/resend` is rate-limited.
- Email links point at `/home`, `/stock/{sym}`, `/settings`, and
  `/unsubscribe?token=…&channel=…`, which is a client page that calls
  `GET /api/unsubscribe`.
- The recipe stays private: no weights, thresholds or filter values on any
  subscriber surface, Full mode included. Inputs may be named and marked
  "had data / lifted / weighed"; rules may be named and marked pass / fail.

| Package | Owns | Must not touch |
| --- | --- | --- |
| P1 Journey & shell | `main.jsx`, `lib/router.jsx`, `lib/me.jsx`, `components/Shell.jsx`, `components/CommandPalette.jsx`, `components/Shortcuts.jsx`, `components/Tour.jsx`, `views/Auth.jsx`, `views/Onboarding.jsx`, `views/Pricing.jsx`, `views/Landing.jsx` (routing hooks only), `views/Reset.jsx`, new `views/Welcome.jsx`, `views/Verified.jsx`, `views/Unsubscribe.jsx`, `components/ExploreTabs.jsx`, `app/oauth.py`, `frontend/index.html`, shell regions of `styles.css` / `assist.css` | `Overview.jsx`, Board/Screen/StockReport/Watchlist, `app/main.py`, `app/jobs.py`, `Legal.jsx` |
| P2 Home | `views/Overview.jsx`, `views/overview.css`, `components/RecordCard.jsx`, `components/upgrade.css`, `lib/record.js` | everything else |
| P3 Lightness | `public/tokens.css`, type/table/badge/chip regions of `styles.css`, `views/Board.jsx`, `board.css`, `views/Screen.jsx`, `views/StockReport.jsx`, `stock.css`, `views/Watchlist.jsx`, `tools.css`, `components/ScoreBadge.jsx`, `components/ui.jsx`, `components/Spark.jsx`, new `components/NameCard.jsx` | `Overview.jsx`, shell files, `Shell.jsx` |
| P4 Plain words | `app/product.py`, `app/plain_copy.py`, `views/Strategies.jsx`, `views/Industry.jsx`, `views/Help.jsx`, `lib/glossary.js`, `lib/plain.js`, `components/Explain.jsx`, `components/Plain.jsx`, `db/seed*.py` strategy copy | Board/StockReport (P3 places the cards), `Onboarding.jsx` (P1 places the industry line) |
| P5 Legal | new `app/legal.py`, `app/main.py`, `app/account.py`, `app/jobs.py`, `app/email.py`, `db/migrations/012_consent.sql`, `views/Legal.jsx`, `components/FinePrint.jsx`, `lib/legal.js`, `tests/test_v6_legal.py` | `Auth.jsx` (P1 renders the tick), `oauth.py` |
| P7 Lab | `frontend/src/lab/*`, `frontend/lab.html`, `app/lab.py` (read-only copy fields only) | everything outside the Lab |
| P6 Sweep (wave 2) | every user-facing string: voice, the three sentences, jargon table, one line + one action per screen, landing copy | backend |

## 11. The code map (from the understand pass)

Six readers (journey, density, strategies, legal, Lab, attention) mapped
the v5 code against the critique before this plan was written; the points
that shaped §10:

- The chrome is chosen by `me`, not by the route (Shell.jsx:356-368), so
  the landing wears the rail for subscribers and every signed-in page load
  flashes the visitor bar first. Route-chosen layouts fix both.
- Three doors, three first screens: email sign-up → onboarding, Google →
  `/board` (empty for a newcomer), log in → `/overview`. One door, one first
  screen.
- The digest's unsubscribe link has no page behind it (jobs.py:232).
- Consent is a passive sentence; nothing is stored (main.py:85-87).
- Simple mode is a visibility toggle: Board Simple is still an 8-column
  table, Find a 16-column one with a "swipe sideways" hint, Home six equal
  cards of 5-6 rows fed by nine requests, the dossier's chart is the ninth
  block. Monospace appears in 33 rules and five uppercase microlabel
  styles coexist. The lightness pass replaces structure, not just colour.

## 12. What shipped

Everything in §3–§9 landed on this branch in seven packages and a sweep,
each built, screenshot-tested and reviewed against this document. The
differences from the plan are listed last.

**Journey.** Three layouts chosen by route: public (slim bar, footer with
the fine print and the tagline), bare (onboarding, the consent screen) and
app (rail or tabs). The landing never wears the rail; a signed-in root goes
to Home; `/home` replaces `/overview` with a permanent redirect; `/about`
keeps the landing reachable. Four destinations on every device: Home,
Alerts, Watchlist, Explore (a tab strip over Ranked, Find, What changed and
Coming up). One door: email sign-up, Google and log in all reach the same
first screen; the verify link lands on a page with "Open my Home"; the
digest's unsubscribe link has a page behind it; verification can be re-sent.
Onboarding is three steps in the bare layout: pick what I should watch,
pick names, choose how to tell me.

**Home.** A greeting, one sentence of today's counts, one button chosen by
urgency; three cards (Told me, I'd have known, Coming up) with a number that
settles once seen; the record in one line; three rows of what changed; the
plan's coverage as a fact that opens the upgrade sheet; a how-this-works
card shown until dismissed; everything else behind one "More on my names".

**Lightness.** One sentence-case label style; no monospace in the
subscriber product; body 16px; tables only in Full ("More detail") on Board, Find, the
Industry list, Coming up and the dossier, while My week and the Alerts
record keep one capped table in Simple; Board,
Find and the Industry list as name cards in Simple with ready-made screens
and plain figures; the dossier opens with the verdict sentence and the
chart, explains itself in three bullets, and keeps the rest behind one
details; outlined chips for neutral and weak; one shadow level.

**Strategies in human terms.** `app/plain_copy.py` ships a recipe-free card
per strategy and industry through the existing endpoints; the record has a
real source (migration 013) and reads 26 of 32 on the product; a strategy
says whether it is measured, has no record yet, or is not scoring; the
public strategy page carries no weights, thresholds, cutoffs or filter
values and the dossier ranks inputs instead of exposing weights; an
industry's "what tends to fire here" is measured from the alert record and
stays silent under ten alerts.

**Legal posture.** Sign-up requires the tick and stores the terms version
and time (migration 012); `/api/me` carries them and the current version;
old and Google accounts meet the consent screen once; the fine print is one
component in two sizes, under every primary action area, in every footer,
on the plans page and at the end of every email, which also carries a
working unsubscribe link; Terms, Privacy and Disclaimer follow the §6
outline with bracketed placeholders for the operator and counsel.

**Voice.** Labels are mine (My alerts, My watchlist, My record, My week, My
account), buttons are requests (Alert me, Watch this for me, Show me the
report, Take me to checkout), the three sentences recur on the landing, the
consent screen, Home, Help and the tour, and the jargon table applies
outside Full mode; the CTA and PLAIN_WORD maps live in `lib/plain.js` and
nineteen vocabulary tests keep the words from drifting.

**The Lab.** A "What this lab is" panel with a start-here path, a head on
every panel (what it shows, why it matters, how to read it), tooltips on
every abbreviated metric, plain labels beside technical ones, rules and
diffs in words with raw values behind a toggle, the floors stated where
decisions are made and served from the API, and the server's own
one-sentence verdict at the top of Versions. Nothing moved.

**Verification.** 86 backend and vocabulary tests pass on a database
bootstrapped from scratch, and one skips where no compose container holds
the reset link; the Playwright pass
over nineteen screens in four contexts reports no console errors and no
horizontal overflow; the consent journey was walked end to end; five
adversarial reviews (journey, lightness, voice, legal, recipe) ran against
this document and the honesty rules, and their confirmed findings were
fixed before the pull request was updated.

**Review fixes, stated.** The five reviews returned 95 findings; all but
one were applied (the landing's "How it works" quotes stay hard-coded
beside the static screenshots they describe, and change when the shots are
re-captured). The ones that changed a §10 decision or a shipped claim:
- Consent is enforced server-side, not only in the client. Every
  authenticated endpoint answers 403 `consent_required` until the account
  has ticked the current terms version; `/api/me`, the consent and
  verification-resend calls, the data export and account deletion stay
  open so the person can always see, tick, take their data or leave; admin
  accounts are exempt so the Lab is never blocked; the client sends that
  403 to `/welcome`.
- Google sign-up no longer records consent from a query parameter the
  person may never have seen; Google accounts tick on `/welcome`, where an
  authenticated POST records it.
- The operator notes (hook, thesis) leave the subscriber product entirely:
  the dossier API sends them empty to non-admins, the board rows no longer
  carry them, and onboarding's one-line "why" is the plain verdict.
- The recipe is shut tighter: hard filters are named in plain words with no
  value, score components carry no weight, penalty points and the neutral
  cutoff left the payloads, missing inputs sort by name rather than by
  weight.
- The plain layer was corrected where it overstated the engine: large
  companies and undated names are scored down, not dropped; a share-sale
  filing fires an alert and costs no points; the record counts moves up,
  from two trading days before the event to five after; the 26 of 32
  record is the backtest's six filters, and four run today.
- The consent gate is the bare `/welcome` screen (the app shell redirects
  to it rather than rendering it inside the rail); a third onboarding step
  chooses the channel; Help and Strategies have one name each; the detail
  switch reads Simple / More.
- The not-running strategies disappear from Simple pickers and lists and
  are never counted as "provisional"; rates print only at ten or more.
- The gate applies to the app, not to delivery. Alerts, SMS, push and the
  weekly brief keep reaching accounts configured under the previous terms
  until their next visit, because the person asked for them and every
  message carries the long fine print and an unsubscribe link; the API
  refuses those same accounts every screen until they tick. If counsel
  wants delivery held too, the two recipient queries in `app/jobs.py` take
  one more condition on the accepted terms version. The consent screen
  also offers export and deletion, so declining is a real option.

**Deviations, stated.**
- The account menu reads My account, My plan, Help rather than §10's
  "Account, Plans, Help": §2's labels won.
- The Watchlist in Simple caps at ten names, not three: a curated list of
  four behind "Show all 4" would be hostile.
- Find's ready-made screens state their own limits ("more than 15% sold
  short"): those are the user's screen parameters, not the recipe.
- The Board card's sentence is the change sentence, because the board
  payload carries no ranked inputs; the operator's shorthand hook and
  thesis are Lab-only and never reach a subscriber surface (see the review
  fixes below).
- An account-level detail preference did not ship; Simple stays the default
  per browser.
- The legal pages carry visible placeholders for the operating entity,
  jurisdiction, refund policy and contact; a lawyer must review before
  launch.
