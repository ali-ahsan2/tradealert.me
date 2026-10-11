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

## 10. Packages

Filled in from the code map (see §11) once the readers report; each package
owns its files, builds clean, and is reviewed against this document before
it merges.

## 11. The code map

Appended from the understand pass.
