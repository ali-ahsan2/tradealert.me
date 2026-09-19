# Tradealert.me — Subscriber-Facing UX Specification

Version 1.0, written 2026-09-19. Audience: a coding assistant implementing the subscriber product on top of the existing scaffold.

Authoritative inputs: `/Users/apple/Desktop/finance/PROJECT_HANDOFF.md` (architecture, entitlement table, outputs) and `/Users/apple/Desktop/finance/tradealert.me/SCAFFOLD_SPEC.md` (stack constraints). Where this document and those two disagree on business rules, they win; where they are silent on interface behavior, this document is the rule.

What exists today: `static/index.html`, `static/signup.html`, `static/login.html`, `static/app.html`, and four API routes in `app/main.py` (`POST /api/signup`, `POST /api/login`, `GET /api/me`, `GET /api/verify`). Everything else in this document is new.

Constraint that shapes every decision below: plain HTML, CSS, and vanilla `fetch()`. No build step, no npm, no framework, no client-side router. Each screen is a separate `.html` file served statically by the FastAPI `StaticFiles` mount, reading a JWT from `localStorage` and calling `/api/*`. Shared code lives in two files loaded by every page: `static/app.css` and `static/app.js`.

---

## 1. Information architecture

### 1.1 Screen list

Public (no token required):

| # | Route | File | Purpose |
|---|---|---|---|
| P1 | `/` | `index.html` | Landing page. What the platform does, the five strategies, pricing summary, signup CTA. Rewrite of the current scaffold placeholder. |
| P2 | `/signup.html` | `signup.html` | Account creation. Exists; needs a post-signup redirect change. |
| P3 | `/login.html` | `login.html` | Sign in. Exists; needs redirect to `/board.html` instead of `/app.html`. |
| P4 | `/verify-pending.html` | `verify-pending.html` | Interstitial after signup: "check your email", resend control. New. |
| P5 | `/api/verify?token=` | server-rendered in `app/main.py` | Email verified confirmation. Exists; must change its outbound link to `/onboarding.html`. |
| P6 | `/pricing.html` | `pricing.html` | Four-tier comparison. Readable logged out and logged in. |
| P7 | `/forgot.html` + `/reset.html` | two files | Password reset request and completion. |
| P8 | `/legal/terms.html`, `/legal/privacy.html`, `/legal/disclaimer.html` | three files | Required for a financial-information product. The disclaimer must be reachable from every screen footer. |

Authenticated:

| # | Route | File | Purpose |
|---|---|---|---|
| A1 | `/onboarding.html` | `onboarding.html` | Post-verification industry selection. First-run only. |
| A2 | `/board.html` | `board.html` | **Primary screen.** Ranked names by strategy and industry. Default landing after login. |
| A3 | `/stock.html?symbol=XYZ` | `stock.html` | Per-stock evaluation report. |
| A4 | `/watchlist.html` | `watchlist.html` | The subscriber's own picks, rendered in report format; the on-site twin of the Monday digest. |
| A5 | `/alerts.html` | `alerts.html` | Alert center: fired-alert history plus armed-trigger management. |
| A6 | `/account.html` | `account.html` | Profile, password, industries, delivery channels, entitlement status, danger zone. |
| A7 | `/upgrade.html` | `upgrade.html` | Logged-in tier change flow. Distinct from P6 because it knows the current tier and shows deltas. |
| A8 | `/digest.html?id=N` | `digest.html` | Web permalink for a sent digest email, so email clients that strip styles have a fallback. |

Deleted: `static/app.html`. Its role (prove the JWT loop) is absorbed by `board.html`.

### 1.2 Navigation model

One persistent top bar on every authenticated screen, rendered by a shared `renderNav()` in `app.js` so there is a single source of truth:

```
[tradealert.me]  Board  Watchlist  Alerts        [tier chip]  [account menu]
```

Rules:

- Four primary destinations maximum. Board, Watchlist, Alerts are links; Account is a menu holding Settings, Pricing, Log out.
- The tier chip is a text-plus-shape element reading `FREE`, `BASIC`, `PRO`, or `INVESTOR`. On Free and Basic it is also a link to `/upgrade.html`. On Pro and Investor it is inert text. Never color-only: the tier name is always spelled out.
- Stock reports are not a nav destination. They are reached only by drilling in from Board, Watchlist, Alerts, or a digest link. Back navigation uses the browser's own back button, which works correctly because every screen is a real URL.
- Current page gets `aria-current="page"` and a 3px underline, not just a color change.

### 1.3 Content hierarchy inside the product

```
Universe
└── Industry (10 total, subscriber follows 1 / 2 / 5 / all by tier)
    └── Strategy score per name (5 strategies)
        └── Instrument / name (401 total)
            └── Evaluation report
                ├── Score + band + coverage
                ├── Component breakdown
                ├── Filter pass/fail (Fast Mover)
                ├── Catalyst calendar
                ├── Recent alert events
                └── Data freshness footer
```

The Board is a **view** over this tree filtered two ways at once: by strategy tab (which scoring lens) and by industry tab (which slice of the universe). Getting that double-filter legible on a 375px screen is the hardest layout problem in this spec; section 5.2 resolves it.

### 1.4 Visibility rule, restated as an interface rule

From PROJECT_HANDOFF.md section 7: visible universe = top K of each followed industry, union the subscriber's own picks. Anything outside it returns 404, indistinguishable from a nonexistent ticker.

Interface consequences, which the implementer must not violate:

- The Board never renders a greyed-out row for a name above the subscriber's K limit. It renders the K rows they can see, then a **count-only** upgrade affordance: "Pro subscribers see 50 names in Semiconductors." That sentence names the tier and the number, never a ticker.
- A 404 from `/api/stock/{symbol}` must produce the exact same screen whether the ticker is out of universe or does not exist: "No report available for XYZ." Do not write "upgrade to see this" on a 404 — that leaks universe membership.
- Autocomplete in any search field queries only the visible universe. Zero results is a legitimate answer.
- The upgrade prompt is therefore always **aggregate** ("see 40 more names") and never **specific** ("see NVDA"). This is a hard rule and the most likely place for an implementer to accidentally leak.

---

## 2. Core user flows

### 2.1 Signup to first board view

```
Landing (P1)
  └─ "Start free" → Signup (P2)
       POST /api/signup → 201 {token, user}
       store token, redirect
  └─ Verify pending (P4)
       Copy: "We sent a link to you@example.com. It expires in 24 hours."
       Controls: [Resend email] (60s cooldown, client-side timer)
                 [Change email address] → account email edit, pre-verification
                 [I already verified → refresh] → re-calls GET /api/me
  └─ User opens email, clicks link
       GET /api/verify?token= → verified=true → server HTML
       CTA: "Choose your industries" → /onboarding.html
  └─ Onboarding (A1)
       Step 1 of 2: pick industries (limit = tier allowance, 1 on Free)
       Step 2 of 2: pick delivery channels (email pre-checked and locked on Free)
       POST /api/me/industries, POST /api/me/channels
  └─ Board (A2), first-run state with a dismissible tour strip
```

Design decisions and why:

- **Signup issues a session token immediately** (the current API already does this) and verification gates *delivery*, not *browsing*. An unverified user can see the Board. This matters: forcing verification before any value is seen is the single biggest drop-off point in a subscription funnel, and there is no security reason for it here since a Free account exposes only the top 5 of one industry.
- What unverified users cannot do: receive any email, arm any alert, or upgrade to a paid tier. Each blocked control shows an inline banner — "Verify your email to turn on alerts. [Resend]" — placed adjacent to the control, not as a global page-top banner that gets banner-blind after two views.
- **Onboarding is two steps, not five.** Everything else (pinning, strategy choice, digest day) has a working default and is discoverable later. Progressive disclosure: ask only for what has no sane default. Industry choice has no sane default, because the whole product is filtered by it.
- Onboarding is skippable via a text link "Skip, show me everything I can see". Skipping auto-assigns the industry with the highest current Board activity so the Board is never empty on first paint. An empty first screen reads as a broken product.

### 2.2 Board to stock report

```
Board (A2)
  ├─ Strategy tab selects scoring lens (Fast Mover default: it is the only calibrated one)
  ├─ Industry tab selects universe slice
  ├─ Row click → Stock report (A3), full page navigation to /stock.html?symbol=XYZ
  └─ Pin control on row → POST /api/me/picks {symbol}
       ├─ under quota → optimistic pin, row gains a filled pin marker + "Pinned" text
       └─ at quota    → quota modal (section 4.3), no optimistic update
```

Row click target is the entire row, not just the ticker text. Fitts's Law: on a table where every row is a link, a 40px-tall full-width target is roughly 15x the area of a 6-character ticker string, and it is the difference between a usable and a frustrating mobile table. The pin control is the one exception inside the row and must `stopPropagation()`.

### 2.3 Alert delivery to report

```
Trigger fires server-side (borrow fee 2x, SI threshold, volume 3x, catalyst,
S-3/424B, band change, insider buy, social surge, contract award)
  └─ Delivery filtered by visible universe at enqueue AND at send
       ├─ Email  → deep link /stock.html?symbol=XYZ&from=alert&alert_id=N
       ├─ Push   → same deep link
       ├─ SMS    → short link, same destination
       └─ Webhook→ no UI
  └─ Stock report opens with the triggering event pinned to the top of the page
     in a highlighted "What fired" card, above the score. The subscriber arrived
     because of that event; showing the generic report top-down buries the answer.
  └─ Alert center (A5) lists the same event in history, marked read
```

If the deep link 404s because the subscriber's universe changed between send and click, show: "This alert is no longer in your universe." with a link to `/account.html#industries`. This is the one case where a 404 may be explained, because the subscriber demonstrably already knew the ticker (it was in their email), so no information leaks.

### 2.4 Hitting a limit and upgrading

```
Limit encountered (any of: industries, names shown, picks, alerts, channels)
  └─ In-context quota prompt naming the exact limit and the exact unlock
       "You're following 2 of 2 industries on Basic. Pro follows 5."
  └─ [See plans] → /upgrade.html, with ?reason=industries so the page can
     highlight the row of the comparison table that caused the click
  └─ Tier selected → POST /api/billing/checkout → provider redirect
  └─ Return → /account.html?upgraded=1 → success banner, new tier chip,
     and a direct link back to whatever the subscriber was blocked from
```

Returning the subscriber to `/account.html` and not to the blocked screen is deliberate: they need to confirm the charge landed and the tier changed before continuing. The banner carries the resume link so the round trip costs one click, not a re-navigation.

Downgrade flow: `/account.html` → "Change plan" → `/upgrade.html` → select lower tier → confirmation interstitial that states exactly what is lost, computed from their current state, not generic:

> Downgrading to Basic on 2026-10-14. You currently follow 5 industries; Basic allows 2. Choose which 2 to keep, or we'll keep the 2 you've viewed most recently. You have 14 pinned names; Basic allows 2.

Downgrades take effect at period end, never mid-cycle. Picks over quota are **retained but inactive** in the database and re-activate on re-upgrade. Never hard-delete subscriber-authored data on a downgrade; that is the kind of thing that generates a refund request.

### 2.5 Weekly digest

```
Monday 07:00 in the subscriber's timezone (from account settings, default
America/New_York)
  └─ Digest = subscriber's picks run through the per-stock report format
  └─ Email with per-name summary blocks + "Open full digest" → /digest.html?id=N
  └─ Every name block links to /stock.html?symbol=XYZ
  └─ Footer: one-click unsubscribe (List-Unsubscribe-Post) + "digest settings"
     deep link to /account.html#digest
```

Free tier gets the digest with its single pick. Do not withhold the digest from Free — it is the recurring contact that drives upgrades, and a Free subscriber who never hears from the product churns silently.

---

## 3. Screen-by-screen specification

Common conventions used by all screens below:

- **Auth guard**: `requireAuth()` in `app.js` runs before first paint. No token → redirect to `/login.html?next=<current path+query>`. Any `401` from any endpoint → clear token, same redirect. `login.html` honors `next`.
- **Loading**: skeleton rows matching the final layout's height, never a centered spinner on a full page. A spinner that replaces content causes layout shift on arrival; a skeleton of the right height does not. Spinners are permitted inside a button during a submit.
- **Error**: an inline card with the plain-language cause and a `[Retry]` button that re-issues the same request. Never show a raw status code alone. Any `429` renders "Too many requests, try again in a minute" because the API already rate-limits signup and login.
- **Empty**: one sentence naming the cause, plus one primary action that resolves it. Never an empty box.
- **Stale data**: every screen showing scores carries a footer line "Scores from the run at {as_of} · data refreshed {fetched_at}". PROJECT_HANDOFF.md stores every field with an as-of timestamp specifically so this can be honest; surface it.
- **Focus management**: after any async content swap, move focus to the container heading and announce via an `aria-live="polite"` region. Without this the screen is unusable with a screen reader.

---

### 3.1 Board (`board.html`) — A2

**Purpose.** Answer "what looks interesting right now, in the industries I follow, through the lens I care about" in under five seconds of scanning. This is the screen subscribers open daily; everything else is reached from it.

**Layout, desktop (>= 900px).**

```
┌ nav ─────────────────────────────────────────────────────────────┐
├ Strategy tabs: [Fast Mover] Market Shift  GeoPolitics  Industry   │
│                 Restructure  Monetary Shifts                      │
├ Industry filter: [All followed ▾] [Semiconductors] [Defense] ...  │
├ Board · Fast Mover · 10 of 10 names · run 2026-09-19 06:12 ET     │
│                                    [Compact ▾] [Sort: Score ▾]    │
├──────────────────────────────────────────────────────────────────┤
│ #  Sym   Name              Score  Band      Cov  Δ1d  Flags  Pin  │
│ 1  XYZ   Example Corp       87   Strong     ███  +4   ⚑ ⓘ    ○   │
│ 2  ABC   Another Inc        81   Strong     ██▒  +1        ●   │
│ ...                                                               │
├──────────────────────────────────────────────────────────────────┤
│ [ Upgrade card: Pro shows the top 50 in each industry. → ]        │
├ Footer: data as of ... · not investment advice · disclaimer       │
└──────────────────────────────────────────────────────────────────┘
```

**Key elements.**

1. **Strategy tabs.** Five, always all five visible. Four are uncalibrated per PROJECT_HANDOFF.md and must be labeled so: each uncalibrated tab carries a small `provisional` chip, and selecting one shows a one-line dismissible notice above the table: "Market Shift weights are provisional — not enough resolved outcomes to calibrate yet." This is an honesty requirement, not a nicety. Selling uncalibrated scores as equivalent to the backtested one is the fastest route to a refund dispute. Fast Mover is the default tab and carries no notice.
2. **Industry filter.** On Free (1 industry) render it as static text, not a control — a dropdown with one option is a dead affordance. On Basic and above, a segmented control listing followed industries plus an "All followed" aggregate. Selection persists in `localStorage` per strategy tab so returning subscribers land where they left.
3. **Table.** Columns:
   - `#` — rank within the current industry+strategy view.
   - `Sym` — ticker, monospace.
   - `Name` — company name, truncated with `title` attribute at narrow widths.
   - `Score` — integer 0-100.
   - `Band` — text label. Never a bare color swatch. Colorblind requirement: the band word carries the meaning; color is redundant reinforcement only.
   - `Cov` — coverage indicator, a 3-segment bar **plus** a `title`/`aria-label` reading "Coverage 2 of 3: some inputs missing, score shrunk toward neutral". PROJECT_HANDOFF.md's shrinkage-toward-40 behavior means a thin-data 55 is a materially different claim than a full-data 55, and hiding that distinction misleads.
   - `Δ1d` — score change since previous run, signed. `new` for first appearance.
   - `Flags` — up to three small markers with text tooltips: catalyst within 14 days, recent alert fired, dilution filing (S-3/424B). Each has a text alternative.
   - `Pin` — toggle, `aria-pressed`, label "Pin XYZ to watchlist".
4. **Sort.** Score (default), Δ1d, symbol, coverage. Sorting is client-side over the already-loaded page and must not re-fetch; the payload is at most 100 rows even on Investor.
5. **Upgrade card.** Appears below the table whenever `visible_count < tier_above.names_shown`. Spec in section 4.
6. **Density toggle.** Comfortable (default, 48px rows) and Compact (32px rows) persisted to `localStorage`. On Investor's 100 rows, compact is the difference between a scroll and a scan.

**States.**

| State | Rendering |
|---|---|
| Loading | Nav and tabs render immediately from cached tier in `localStorage`; table shows 10 skeleton rows. |
| Loaded, normal | As above. |
| Empty — no industries followed | "You're not following any industries yet." + `[Choose industries]` → `/onboarding.html`. Reachable if a user skipped onboarding and an auto-assign failed. |
| Empty — no names scored yet | "No scored names in Semiconductors for Fast Mover yet. The next run is at 06:00 ET." Include the next run time; "check back later" with no time is useless. |
| Empty — filters exclude everything | "No names match. [Clear filters]" |
| Error | Inline card, `[Retry]`. Tabs stay interactive so a different strategy can be tried. |
| Unverified | Amber strip above the table: "Verify your email to receive alerts and digests. [Resend]" Board content unaffected. |
| Stale run | If `as_of` is more than 36 hours old: "Last successful run was 2026-09-17. Scores may be stale." Do not silently show old numbers as current. |

**Data required.**

`GET /api/board?strategy=fast_mover&industry=semis&sort=score`

```json
{
  "strategy": {"key": "fast_mover", "label": "Fast Mover", "calibrated": true},
  "industry": {"key": "semis", "label": "Semiconductors", "benchmark_etf": "SMH"},
  "run": {"id": 1841, "as_of": "2026-09-19T06:12:00Z", "fetched_at": "2026-09-19T06:09:00Z"},
  "entitlement": {"tier": "basic", "names_shown": 10, "names_available": 50,
                  "next_tier": {"key": "pro", "label": "Pro", "names_shown": 50, "price_monthly": 29}},
  "rows": [
    {"rank": 1, "symbol": "XYZ", "name": "Example Corp", "score": 87,
     "band": "strong", "band_label": "Strong",
     "coverage": {"present": 3, "total": 3, "shrunk": false},
     "delta_1d": 4, "is_new": false, "pinned": false,
     "flags": [{"key": "catalyst", "label": "Earnings in 6 days", "date": "2026-09-25"},
               {"key": "alert", "label": "Borrow fee doubled 2026-09-18"}]}
  ]
}
```

`rows` length is already clamped server-side to the tier's `names_shown`. The client must never receive rows it is not allowed to display; clamping in JavaScript is not access control.

`GET /api/strategies` and `GET /api/industries` supply tab labels and the subscriber's followed set. Cache both in `sessionStorage` for the session.

---

### 3.2 Per-stock evaluation report (`stock.html?symbol=XYZ`) — A3

**Purpose.** Explain why this name scores what it scores, with enough evidence that the subscriber can form their own judgment. PROJECT_HANDOFF.md is explicit that the platform applies a repeatable process rather than replacing human judgment; the report is where that promise is kept or broken. The content is identical for everyone who can see it and cached per run.

**Layout, top to bottom.** Order is fixed. It moves from "what happened" to "what we think" to "why we think it" to "how much to trust it".

```
┌ nav ─────────────────────────────────────────────────────────────┐
│ ← Back to Board                                   [Pin] [Alerts▾]│
├ [What fired] card — ONLY when ?from=alert ───────────────────────┤
│  Borrow fee crossed 2x · 2026-09-18 16:40 ET · 4.2% → 9.1%       │
├ Header ──────────────────────────────────────────────────────────┤
│  XYZ · Example Corp                                               │
│  Semiconductors · Theme: advanced packaging · Lane: A             │
├ Score panel ─────────────────────────────────────────────────────┤
│  Fast Mover  87 / 100   Band: Strong   Coverage 3/3               │
│  [other strategies as a row of small score chips, each a link]    │
├ Hard filters (Fast Mover only) ──────────────────────────────────┤
│  PASS  Market cap $840M          (band $300M-$3B)                 │
│  PASS  Float 31.2M shares        (limit < 50M)                    │
│  PASS  Short interest 18.4%      (limit > 10%, FINRA 2026-09-13)  │
│  FAIL  Revenue growth 22%        (limit > 40%)                    │
│  PASS  Catalyst in 6 days        (earnings 2026-09-25)            │
├ Score breakdown ─────────────────────────────────────────────────┤
│  Component            Raw   Weight   Contribution   Evidence      │
│  ... + shrinkage line + haircut lines, both shown explicitly      │
├ Catalyst calendar ───────────────────────────────────────────────┤
├ Recent events (alerts fired on this name, last 30 days) ─────────┤
├ Data freshness table (field, value, source, as-of) ──────────────┤
├ Disclaimer ──────────────────────────────────────────────────────┤
└──────────────────────────────────────────────────────────────────┘
```

**Element notes.**

- **Hard filters block is the most important thing on the page** and sits above the numeric breakdown, because the backtest in PROJECT_HANDOFF.md validated the filters, not the scorecard (81.2% hit rate on filter-passing events vs 58.6% for earnings generally vs 36.6% on a random day). Present the filters as the claim and the score as the ranking. Each row shows PASS or FAIL as a word plus an icon, the actual value, and the threshold. Never show a check mark alone.
- The filters block renders only on the Fast Mover strategy view. Other strategies show their declared components with a `provisional` banner instead.
- **Score breakdown table** must show the three-stage math from PROJECT_HANDOFF.md as three visible things, not one number: renormalized weights over present components, the shrinkage adjustment toward 40, then penalties and haircuts applied at full force. Render shrinkage as its own signed line ("Coverage shrinkage: −6, 2 of 5 components missing") and each haircut as its own line with its documented red flag as the label. A single opaque total destroys the explainability that is the product's reason to exist.
- **Evidence column**: quality factors are scored 0-1 "with supporting evidence, not just a number". Render the evidence as an expandable `<details>` per component. Progressive disclosure keeps the default view scannable while making the full basis one click away.
- **Alerts dropdown** in the header arms or disarms triggers for this specific name, showing the subscriber's remaining alert quota inline: "3 of 3 alerts used on Basic."
- **Other-strategy chips**: a name usually scores under multiple strategies. Show all five as small chips with score and band; clicking swaps the report's strategy context via `?strategy=` without leaving the page.

**States.**

| State | Rendering |
|---|---|
| Loading | Header renders from the query-string symbol immediately; panels below are skeletons. |
| Loaded | As above. |
| 404 | Full-page: "No report available for XYZ." plus `[Back to Board]` and a search field. **Identical markup for out-of-universe and nonexistent.** No upgrade prompt here, ever. |
| 404 from an alert deep link (`?from=alert`) | The one exception: "This alert is no longer in your universe." + link to `/account.html#industries`. |
| Partial data | Missing components render as "Not available" rows that stay in the table with zero contribution, so the renormalization is visible rather than implied. |
| Uncalibrated strategy | Banner above the score panel; score still shown, band still shown, wording states the weights are provisional. |
| Error | Inline card + `[Retry]`. |

**Data required.**

`GET /api/stock/{symbol}?strategy=fast_mover`

```json
{
  "symbol": "XYZ", "name": "Example Corp",
  "industry": {"key": "semis", "label": "Semiconductors"},
  "universe": {"theme": "advanced packaging", "lane": "A", "group": "A",
               "hook": "...", "thesis": "..."},
  "strategy": {"key": "fast_mover", "label": "Fast Mover", "calibrated": true},
  "score": {"value": 87, "band": "strong", "band_label": "Strong",
            "coverage": {"present": 5, "total": 5},
            "shrinkage": {"applied": -6, "neutral": 40},
            "haircuts": [{"label": "Recent S-3 shelf filing", "points": -4,
                          "evidence_url": "https://www.sec.gov/..."}]},
  "hard_filters": [
    {"key": "market_cap", "label": "Market cap", "pass": true,
     "value": "$840M", "threshold": "$300M – $3B", "as_of": "2026-09-19"}
  ],
  "components": [
    {"key": "short_interest", "label": "Short interest", "raw": 0.82,
     "weight": 0.25, "contribution": 20.5, "present": true,
     "evidence": [{"text": "18.4% of float, FINRA settlement 2026-09-13",
                   "source": "FINRA", "url": null}]}
  ],
  "other_strategies": [{"key": "market_shift", "label": "Market Shift",
                        "score": 61, "band_label": "Neutral", "calibrated": false}],
  "catalysts": [{"type": "earnings", "date": "2026-09-25", "confirmed": true}],
  "recent_events": [{"id": 902, "trigger": "borrow_fee_2x",
                     "label": "Borrow fee doubled", "fired_at": "2026-09-18T20:40:00Z",
                     "detail": "4.2% → 9.1%"}],
  "freshness": [{"field": "short_interest", "value": "18.4%", "source": "FINRA",
                 "as_of": "2026-09-13", "fetched_at": "2026-09-19T06:09:00Z",
                 "vintage_note": "FINRA reports biweekly"}],
  "run": {"id": 1841, "as_of": "2026-09-19T06:12:00Z"},
  "pinned": false,
  "armed_triggers": ["borrow_fee_2x"]
}
```

The `vintage_note` field exists because PROJECT_HANDOFF.md tags short interest with its FINRA reporting vintage. A subscriber looking at biweekly data labeled with today's date would reasonably feel misled.

---

### 3.3 Watchlist (`watchlist.html`) — A4

**Purpose.** The subscriber's own picks, rendered in the same per-stock report format, as the on-site twin of the Monday digest. Picks are the one part of the universe the subscriber authored, so this is the screen with the strongest sense of ownership.

**Key elements.**

- Header: "Watchlist · 7 of 20 picks used · Pro" with a linked `[Manage picks]`.
- Digest status line: "Next digest: Monday 2026-09-22, 07:00 ET, to you@example.com" plus `[Change]` → `/account.html#digest`.
- One collapsible card per pick, collapsed by default, ordered by current score descending. Collapsed card shows symbol, name, score, band, Δ since pinned, and the flags row. Expanded shows the condensed report: hard filters, top three components, next catalyst, events since the last digest.
- "Δ since pinned" is the column that makes this screen feel personal rather than a re-skinned Board. It answers "was pinning this a good call", which no other screen answers.
- `[Expand all]` / `[Collapse all]`, and `[Open full report]` on each card.
- Reorder: on desktop, up/down buttons on each card (not drag-and-drop, which is inaccessible without a keyboard fallback and expensive to build without a framework). Order persists via `PUT /api/me/picks/order`.

**States.**

| State | Rendering |
|---|---|
| Empty, has quota | "Your watchlist is empty. Pin names from the Board to track them and get them in your Monday digest. [Go to Board]" |
| Empty, Free tier | Same, plus: "Free includes 1 pick. Basic includes 2." |
| At quota | Banner: "You're using all 2 picks on Basic. Unpin one, or Pro includes 20. [See plans]" |
| Over quota after downgrade | Picks beyond quota render in an "Inactive" section with explanatory text: "These stay saved but aren't scored into your digest on Basic. Re-upgrade to reactivate." No deletion. |
| Pick dropped out of universe | Card shows "No longer in your followed industries" with `[Unpin]` and `[Follow Semiconductors]`. Picks widen access per the entitlement rule, so this case is rare, but handle it. |
| Loading | Skeleton cards at collapsed height. |

**Data required.** `GET /api/me/picks` returning the array of pick objects with `pinned_at`, `score_at_pin`, `score_now`, `active`, plus `quota: {used, limit, tier}` and `digest: {next_send_at, timezone, email}`.

---

### 3.4 Alert center (`alerts.html`) — A5

**Purpose.** Two jobs on one screen, separated into tabs: what has fired (history) and what will fire (armed triggers). Splitting them into two nav destinations would be over-structuring; merging them into one list would confuse past with future.

**Tab 1 — History.** Reverse-chronological list of alert events delivered to this subscriber. Each item:

```
● Borrow fee doubled          XYZ Example Corp        2026-09-18 16:40 ET
  4.2% → 9.1%                 Delivered: email, push  [View report →]
```

- Unread marker is a filled dot **plus** bold text, never color alone.
- Filters: by trigger type, by name, by date range, by read/unread. Filter state in the query string so a filtered view is linkable.
- `[Mark all read]`.
- Per PROJECT_HANDOFF.md, one alert event exists per (name, trigger, day) regardless of subscriber arming. History shows only events actually delivered to this subscriber; it must not reveal events on names outside their universe.

**Tab 2 — Armed triggers.** A table of (name, trigger) pairs the subscriber has armed, with quota status at the top:

```
Alerts: 3 of 3 used · Basic     [Upgrade for unlimited]

Name        Trigger                Channels        Armed        
XYZ         Borrow fee 2x          email, push     2026-09-10   [Disarm]
ABC         Short interest > 15%   email           2026-09-12   [Disarm]
```

`[+ Arm an alert]` opens a modal: name picker (visible universe only), trigger picker (the full trigger list from PROJECT_HANDOFF.md section 4: borrow fee 2x+, SI crossing 10/15/20%, volume 3x+, dated catalyst, S-3 or 424B filing, band change, insider buying, social surge, contract award), channel checkboxes gated by tier.

**States.**

| State | Rendering |
|---|---|
| Free tier | The whole screen is a locked state. Show a sample alert rendered at 40% opacity behind a solid card: "Alerts are included from Basic. Basic includes 3 alerts and push delivery, $10/mo. [See plans]" The sample must use a fabricated placeholder ticker clearly marked, never a real name from the universe. |
| Empty history, alerts armed | "No alerts have fired yet. You have 3 triggers armed; we'll email you when one fires." |
| Empty history, none armed | "No alerts armed. [Arm your first alert]" |
| At alert quota | Arm button disabled with an adjacent explanation and `[See plans]`. Disabled buttons must always carry a visible reason; a dead control with no explanation is the worst state in the spec. |
| Unverified | Arming is blocked: "Verify your email before arming alerts. [Resend]" |
| Loading | Six skeleton rows. |

**Data required.** `GET /api/me/alerts?status=&trigger=&cursor=` (paginated), `GET /api/me/alert-rules`, `POST /api/me/alert-rules`, `DELETE /api/me/alert-rules/{id}`, `POST /api/me/alerts/read`.

---

### 3.5 Account and entitlement settings (`account.html`) — A6

**Purpose.** One place for everything about the subscriber rather than the market. Single-column, section-anchored (`#profile`, `#industries`, `#channels`, `#digest`, `#plan`, `#danger`) so error banners and deep links can target exact sections.

**Sections.**

1. **`#profile`** — email with verified status and a resend control, change email (re-triggers verification, old email stays active until the new one is confirmed), change password (current + new + confirm), timezone selector (drives digest send time), account created date.
2. **`#industries`** — all 10 industries as checkboxes with benchmark ETF shown. A live counter "3 of 5 selected · Pro". At the tier limit, unchecked boxes get `disabled` plus an adjacent line: "Pro follows 5 industries. Investor follows all 10. [See plans]" Saving is explicit with a `[Save industries]` button, not auto-save on toggle, because a change here alters the entire visible universe and warrants a deliberate action. Confirmation modal on **removal**: "Removing Defense hides 10 names from your Board and stops 2 armed alerts. Continue?" with the affected count computed server-side.
3. **`#channels`** — email (always on, disabled checkbox with "Required" label), push (Basic+, requires a browser permission prompt with a pre-prompt explaining why), SMS (Pro+, requires phone entry then a verification code, per PROJECT_HANDOFF.md's verified-numbers-only rule), webhook (Investor only: URL field, HMAC signing secret with a reveal toggle and a `[Rotate]` action, `[Send test]` button, last-10 delivery log with status codes, and a visible auto-disable state if the endpoint has been failing). Each tier-locked channel shows the row greyed with the unlocking tier named.
4. **`#digest`** — Monday delivery on/off, send time, timezone (mirrors profile), "include unpinned Board top names" toggle, link to the last digest permalink.
5. **`#plan`** — current tier card showing all five entitlement dimensions with used-versus-limit meters:
   ```
   Pro · $29/mo · renews 2026-10-14
   Industries  ███░░  3 of 5
   Names shown █████  50 per industry
   Picks       ██░░░  7 of 20
   Alerts      —      unlimited
   Channels    email, push, SMS
   [Change plan]  [Billing history]  [Cancel subscription]
   ```
   Usage meters serve a specific purpose: a subscriber who can see they use 18 of 20 picks understands the value of upgrading without being nagged. Self-evident limits beat interruption prompts.
6. **`#danger`** — cancel subscription (state clearly that access continues to period end and what the Free-tier state will look like), export data (JSON of picks, alert rules, alert history), delete account (typed email confirmation, states that deletion is permanent and cancels billing).

**States.** Per-section save status: idle, saving (button spinner plus disabled), saved (inline "Saved" for 3 seconds, `aria-live`), error (inline red text naming the field and cause). Never a global page-level toast for a field-level error; the subscriber has to know which field failed. `?upgraded=1` renders a success banner at the top of `#plan`.

**Data required.** `GET /api/me/settings` (one payload for all sections), `PATCH /api/me/settings`, `POST /api/me/industries`, `POST /api/me/channels`, `POST /api/me/phone/verify`, `POST /api/me/webhook/test`, `POST /api/me/webhook/rotate-secret`, `POST /api/me/password`, `POST /api/me/email`, `GET /api/me/export`, `DELETE /api/me`.

---

### 3.6 Pricing (`pricing.html`) and Upgrade (`upgrade.html`) — P6, A7

**Two files, deliberately.** `pricing.html` is a public marketing page optimized for a cold visitor. `upgrade.html` is an authenticated page that knows the current tier and shows deltas against it. Serving one page to both audiences produces a page that is wrong for both: the cold visitor sees irrelevant usage data, the subscriber sees a pitch for the tier they already have.

**`pricing.html` elements.**

- Four columns on desktop, four stacked cards on mobile, in ascending price order. Pro is the recommended column, marked with a text label "Most popular" and a border, not a color fill alone.
- Rows exactly matching PROJECT_HANDOFF.md's entitlement table: Price, Industries, Names shown, Picks, Alerts, Channels. Add one row not in that table but needed by a buyer: "Delivery" spelling out email / +push / +SMS / +webhook and API.
- Each cell states a number, never a check mark. "Top 50" tells a buyer more than a tick.
- Below the table: a plain-language explanation of the visible-universe rule, because it is unusual and a confused buyer does not buy. Suggested copy: "You see the top-ranked names in each industry you follow, plus any name you pin. Pinning a name widens what you can see; it doesn't change the report you get."
- Honesty block, required: "Four of the five strategies are provisional. Fast Mover is the one that has been backtested; its hard filters hit on 81.2% of the 32 qualifying events tested, against 58.6% for earnings events generally. That sample is small and measures movement, not profit." Numbers are drawn from PROJECT_HANDOFF.md's tested section and must not be restated more favorably than that document supports.
- FAQ using `<details>`: what happens on downgrade, whether picks are kept, why a name 404s, how cancellation works.

**`upgrade.html` elements.**

- Top: current tier plus the reason for arrival, read from `?reason=`. Example: "You hit the industry limit on Basic."
- Comparison of current versus each higher tier with a per-row delta column ("+3 industries", "+40 names", "+18 picks"). The row named by `?reason=` is highlighted and labeled "What you hit".
- Price delta stated as the incremental cost: "Pro is $19 more per month than Basic."
- Proration line, plain: "You'll be charged the difference for the rest of this period today, then $29 on the 14th."
- `[Switch to Pro]` → `POST /api/billing/checkout` → provider redirect. Only one primary button per card.
- Downgrade path reachable below the fold under "See lower plans", not as a peer of upgrade CTAs.

**States.** Loading current tier (skeleton in the current-tier strip only, comparison table renders immediately since it is static). Checkout redirect pending (button spinner, disabled, "Opening secure checkout"). Checkout failed (inline card, `[Try again]`, support email). Already on Investor (hide upgrade CTAs, show "You're on the top plan" plus plan management links).

---

### 3.7 Onboarding (`onboarding.html`) — A1

Two steps, one file, no page reload between them.

**Step 1, industries.** All 10 as large tappable cards, each showing name, benchmark ETF, and a one-line description of what belongs in it. Counter "1 of 1 selected · Free" fixed to the bottom of the viewport on mobile. At limit, unselected cards are disabled with "Free follows 1 industry. Basic follows 2. [See plans]" `[Continue]` is disabled until at least one is selected.

**Step 2, delivery.** Email pre-checked and locked. Push and SMS shown with their tier requirement if locked. Timezone auto-detected via `Intl.DateTimeFormat().resolvedOptions().timeZone` with a visible override. `[Finish]` → `/board.html?first_run=1`.

**Progress.** "Step 1 of 2" as text plus a two-segment bar. Two steps is short enough that a progress indicator is arguably unnecessary, but stating the total up front measurably reduces abandonment because the subscriber knows it ends.

**First-run Board strip** (`?first_run=1`): a single dismissible strip, not a modal tour. "This is your Board. Scores update daily; click any row for the full report; pin a name to add it to your Monday digest. [Got it]" Dismissal persists in `localStorage`. One strip, shown once. No multi-step coach marks; they are skipped by most users and are expensive to build without a framework.

---

## 4. Entitlement gating in the interface

### 4.1 Three gate types, three treatments

The most common failure mode in tiered products is treating every limit identically. There are three structurally different cases here and each needs its own visual language.

**Type A — Quantity gate** (names shown, picks, industries, alerts). The subscriber gets a real, complete, smaller version. Treatment: show what they have, then a single upgrade card **after** the content. No blur, no fake rows, no teaser. A Free subscriber's top-5 board is a legitimate product, not a crippled one, and rendering ghost rows above the fold frames it as broken.

**Type B — Feature gate** (channels: push on Basic, SMS on Pro, webhook and API on Investor). The feature exists but is unavailable. Treatment: the control renders in place, visibly disabled, with the unlocking tier named inline. Keeping the disabled control in position teaches the product's shape; hiding it entirely means the subscriber never learns the feature exists and never upgrades for it.

**Type C — Screen gate** (the Alert center on Free). An entire screen has no content. Treatment: an explanatory card over a dimmed non-interactive sample, with the sample clearly labeled "Example". Only case where obscured content is acceptable, and the obscured content must be fabricated sample data, never real universe data held back by CSS. Anything rendered to the DOM is readable in DevTools; never CSS-gate real data.

### 4.2 Upgrade card, exact specification

Used for all Type A gates. Placement: immediately after the last visible row, in normal document flow. Never a floating overlay, never a modal on page load.

```
┌──────────────────────────────────────────────────────────┐
│ You're seeing the top 10 names in Semiconductors.        │
│ Pro shows the top 50, follows 5 industries, and includes │
│ 20 picks with unlimited alerts.                          │
│                                                          │
│ [ See plans — $29/mo ]    Currently on Basic, $10/mo     │
└──────────────────────────────────────────────────────────┘
```

Rules:

1. Name the current limit and the current tier. Ambiguity about what they already have reads as a dark pattern.
2. Name the next tier's number, not "more". "Top 50" is a decision input; "more names" is not.
3. Show the price on the button. Hiding price until checkout destroys trust in a product asking for a recurring card charge.
4. **Never name a ticker or show a blurred row.** Per section 1.4 this would leak universe membership.
5. One card per screen maximum. A Free subscriber must not meet four upgrade cards on one page.
6. Dismissible for the session (`sessionStorage`), returns next session. Permanently dismissible is a lost revenue path; non-dismissible is hostile.
7. Investor tier: the card never renders. There is nothing above it.

### 4.3 Quota modal

Shown when an action is attempted and refused (pin at quota, arm at quota, follow industry at quota). Modal is correct here and nowhere else in this spec, because the subscriber initiated an action that cannot complete, and they need a resolution before continuing.

```
┌ Pick limit reached ──────────────────────────────┐
│ You're using 2 of 2 picks on Basic.              │
│                                                  │
│ Unpin a name to make room, or upgrade to Pro for │
│ 20 picks.                                        │
│                                                  │
│ [Manage picks]  [See plans — $29/mo]    [Cancel] │
└──────────────────────────────────────────────────┘
```

Two paths out, one of which does not involve payment. An upgrade-only modal is coercive and generates cancellations. Modal requirements: focus trap, `Escape` closes, focus returns to the triggering control, `role="dialog"` with `aria-modal="true"` and a labelled heading, background scroll locked.

### 4.4 Locked control pattern

For Type B gates:

```html
<label class="locked">
  <input type="checkbox" disabled>
  <span>SMS alerts</span>
  <span class="lock-note">Pro and above · <a href="/upgrade.html?reason=sms">See plans</a></span>
</label>
```

The link inside a locked row must remain focusable and clickable even though the input is disabled. A disabled row with a non-focusable upgrade link is a keyboard dead end.

### 4.5 Server-side enforcement

Every limit is enforced by the API. The interface reflects limits; it does not impose them. Any `403` with `{"error":"entitlement","limit":"picks","current":2,"tier":"basic","required_tier":"pro"}` renders the quota modal from the response body, so limits are defined once, server-side. A client-side constants table for tier limits will drift the day pricing changes.

---

## 5. Mobile and desktop

### 5.1 Approach

Mobile-first CSS, single breakpoint at 900px, second optional breakpoint at 1280px for the Board only. One breakpoint keeps a no-framework CSS file maintainable; the Board's table genuinely needs a third layout at wide widths, nothing else does.

```css
/* base: mobile, 320px and up */
@media (min-width: 900px)  { /* desktop */ }
@media (min-width: 1280px) { /* board only: wider table, more columns */ }
```

Target sizes: 44x44px minimum on touch. Body text 16px minimum on mobile (iOS Safari zooms on focus of any input under 16px, which breaks layout). Line length capped at 70ch for report prose.

### 5.2 The Board table on mobile

The single hardest layout problem here. A 9-column table cannot work at 375px. Three approaches were considered:

- Horizontal scroll with a frozen symbol column: preserves the table mental model, but horizontal scrolling inside a vertically-scrolling page is a known source of gesture conflict, and the frozen column needs JavaScript without `position: sticky` support guarantees.
- Column hiding by breakpoint: simple, but hides coverage and flags, which are the two things that stop a subscriber misreading a thin-data score.
- Card layout below 900px: each row becomes a two-line card.

**Decision: card layout.** It keeps every field visible, needs no JavaScript, and gives a 56px full-width tap target.

```
┌────────────────────────────────────┐
│ 1  XYZ  Example Corp          87 ○ │
│    Strong · Cov 3/3 · +4 · ⚑ 6d    │
└────────────────────────────────────┘
```

Implementation without a framework: emit semantic `<table>` markup always; at mobile widths apply `display: block` to `thead` (visually hidden), `tr`, and `td`, and use `td::before { content: attr(data-label) }` for the field labels on the second line. One markup tree, two layouts, no JavaScript, screen reader semantics intact at both sizes.

### 5.3 Per-screen responsive notes

- **Strategy tabs**: five tabs do not fit at 375px. Horizontally scrollable tab strip with `scroll-snap-type: x mandatory`, a right-edge gradient hinting at overflow, and the selected tab scrolled into view on load. Do not collapse into a `<select>`; a dropdown hides four of the five products.
- **Stock report**: single column throughout. Above 900px, move the freshness table and catalyst calendar into a right rail at roughly 320px so the score breakdown stays above the fold.
- **Score breakdown table**: four columns fits at 375px only if the evidence column becomes a `<details>` disclosure below each row rather than a column. Do that at all widths for consistency.
- **Pricing**: four columns on desktop; four stacked cards on mobile in ascending price order with the current tier (if logged in) marked "Your plan". Never use a horizontally scrolling pricing table; buyers miss columns entirely.
- **Account**: single column at all widths. A settings page has no reason to use horizontal space; 640px max content width.
- **Nav**: below 900px, the three primary links become a bottom bar fixed to the viewport (Board, Watchlist, Alerts) with the tier chip and account menu remaining in the top bar. Bottom placement puts daily destinations in thumb reach. Add `padding-bottom` equal to the bar height on `body` so content is never hidden behind it, and respect `env(safe-area-inset-bottom)`.

### 5.4 Shared asset structure

```
static/
  app.css          # tokens, layout, components, one media query set
  app.js           # auth guard, api(), renderNav(), formatters, modal, toast
  board.html  stock.html  watchlist.html  alerts.html
  account.html  upgrade.html  pricing.html  onboarding.html
  verify-pending.html  digest.html  forgot.html  reset.html
  index.html  signup.html  login.html
```

`app.js` exports (as globals, no modules, to avoid CORS/module quirks when opening files locally):

- `requireAuth()` — token check plus redirect with `next`.
- `api(path, opts)` — wraps `fetch`, attaches the bearer token, handles `401` by clearing the token and redirecting, handles `403` entitlement errors by opening the quota modal, handles `429` with a standard message, and throws a typed error otherwise.
- `renderNav(active)` — injects the top bar and mobile bottom bar, reads the tier from the cached `/api/me` payload.
- `fmt.score()`, `fmt.delta()`, `fmt.relTime()`, `fmt.coverage()`.
- `openModal(config)`, `toast(message)`.
- `skeleton(container, rows)`.

Caching: `/api/me` and `/api/industries` are cached in `sessionStorage` with a 5-minute TTL so every page load does not hit three endpoints before painting. `/api/board` is never cached; it is the data the subscriber came for.

### 5.5 Accessibility requirements

Every screen in this document must pass all of the following before it ships.

- **Keyboard only**: every interactive element reachable by Tab in visual order, visible focus ring at 3:1 contrast against its background, `Escape` closes modals and menus, no keyboard trap other than an intentional modal focus trap, skip-to-content link as the first focusable element on each page.
- **Gamepad**: not applicable to a web product on desktop and mobile browsers. The keyboard requirement covers the equivalent navigation need.
- **Text**: 16px minimum body on mobile, 14px minimum for tabular data on desktop, all sizing in `rem` so browser font settings scale the interface, layout intact at 200% zoom with no horizontal scroll at 320px width.
- **Not color alone**: bands carry text labels, PASS/FAIL carries a word, unread carries a dot plus bold, coverage carries a numeric `3/3` alongside its bar, positive and negative deltas carry explicit signs. Verify by rendering every screen in greyscale.
- **Contrast**: 4.5:1 for body text, 3:1 for large text and interface component boundaries.
- **Motion**: no flashing content anywhere. Honor `prefers-reduced-motion: reduce` by disabling all transitions. No auto-refreshing Board that moves rows under the cursor; new-run availability appears as a "New scores available [Refresh]" strip the subscriber chooses to act on.
- **Screen readers**: semantic landmarks (`header`, `nav`, `main`, `footer`), one `h1` per page, tables with real `<th scope>`, `aria-live="polite"` for async content arrival and save confirmations, `aria-live="assertive"` for errors only, form inputs with real `<label>` elements and `aria-describedby` for errors.
- **Subtitles**: no audio or video content in this product. If a demo video is added to the landing page, captions are mandatory.
- **Forms**: errors announced and rendered adjacent to the field, never only at the top of the page; required fields marked in text; never rely on placeholder text as a label.

---

## 6. New API endpoints required

Existing today: `POST /api/signup`, `POST /api/login`, `GET /api/me`, `GET /api/verify`. Everything in this table is new work. Ordered so each block is independently testable, matching the incremental style of SCAFFOLD_SPEC.md's build order.

### Block 1 — Universe and Board (unblocks A2, the primary screen)

| Method | Path | Returns | Notes |
|---|---|---|---|
| GET | `/api/strategies` | five strategies with `key`, `label`, `calibrated`, `description` | Static-ish; cacheable. `calibrated` is true only for Fast Mover today. |
| GET | `/api/industries` | 10 industries with `key`, `label`, `benchmark_etf`, `description`, `followed` | `followed` is per-subscriber. |
| GET | `/api/board` | section 3.1 payload | Query: `strategy`, `industry`, `sort`. Rows clamped server-side to tier. |
| GET | `/api/runs/latest` | `{run_id, as_of, fetched_at, status}` | Drives the freshness footer and the "new scores available" strip. |

### Block 2 — Stock report (unblocks A3)

| Method | Path | Returns | Notes |
|---|---|---|---|
| GET | `/api/stock/{symbol}` | section 3.2 payload | Query: `strategy`. **404 for out-of-universe, identical body to nonexistent.** Cached per run. |
| GET | `/api/search?q=` | up to 10 `{symbol, name, industry}` | Visible universe only. |

### Block 3 — Picks and watchlist (unblocks A4)

| Method | Path | Returns | Notes |
|---|---|---|---|
| GET | `/api/me/picks` | picks array plus `quota` and `digest` | Includes `score_at_pin` for the Δ-since-pinned column. |
| POST | `/api/me/picks` | created pick | Body `{symbol}`. `403` with the entitlement error shape at quota. |
| DELETE | `/api/me/picks/{symbol}` | 204 | |
| PUT | `/api/me/picks/order` | 204 | Body `{symbols: [...]}`. |

### Block 4 — Alerts (unblocks A5)

| Method | Path | Returns | Notes |
|---|---|---|---|
| GET | `/api/me/alerts` | paginated delivered events | Query: `status`, `trigger`, `symbol`, `from`, `to`, `cursor`. |
| POST | `/api/me/alerts/read` | 204 | Body `{ids}` or `{all: true}`. |
| GET | `/api/me/alert-rules` | armed rules plus `quota` | |
| POST | `/api/me/alert-rules` | created rule | Body `{symbol, trigger, channels}`. `403` at quota, `403` on unverified email, `403` on a channel above tier. |
| DELETE | `/api/me/alert-rules/{id}` | 204 | |
| GET | `/api/triggers` | trigger catalog with labels and descriptions | Feeds the arm-alert modal. |

### Block 5 — Settings and entitlements (unblocks A6, A1)

| Method | Path | Returns | Notes |
|---|---|---|---|
| GET | `/api/me/settings` | one payload covering profile, industries, channels, digest, plan usage | Single request to render the whole account screen. |
| PATCH | `/api/me/settings` | updated settings | Partial update: timezone, digest prefs. |
| POST | `/api/me/industries` | updated followed set | Body `{keys: [...]}`. `403` over tier limit. |
| GET | `/api/me/industries/impact` | `{names_hidden, alerts_stopped, picks_affected}` | Powers the removal confirmation modal's real numbers. Query: `keys`. |
| POST | `/api/me/channels` | updated channels | `403` for above-tier channels. |
| POST | `/api/me/password` | 204 | Body `{current, new}`. |
| POST | `/api/me/email` | 202 | Triggers verification of the new address; old address remains active until confirmed. |
| POST | `/api/me/resend-verification` | 202 | Rate limited; the resend control on P4 and every unverified banner needs this. |
| POST | `/api/me/phone` | 202 | Sends an SMS verification code. Pro+. |
| POST | `/api/me/phone/verify` | 204 | Body `{code}`. |
| POST | `/api/me/push/subscribe` | 204 | VAPID subscription object. Basic+. |
| DELETE | `/api/me/push/subscribe` | 204 | |
| GET | `/api/me/webhook` | `{url, secret_last4, enabled, auto_disabled_at, recent_deliveries}` | Investor only. |
| PUT | `/api/me/webhook` | updated config | |
| POST | `/api/me/webhook/test` | delivery result | |
| POST | `/api/me/webhook/rotate-secret` | `{secret}` | Full secret returned exactly once. |
| GET | `/api/me/export` | JSON download | |
| DELETE | `/api/me` | 204 | Requires password confirmation in the body. |
| GET | `/api/entitlements` | the four tiers with all limits | Public, unauthenticated, so `pricing.html` renders from one source of truth rather than hardcoded HTML. |

### Block 6 — Billing (unblocks A7)

| Method | Path | Returns | Notes |
|---|---|---|---|
| POST | `/api/billing/checkout` | `{redirect_url}` | Body `{tier}`. |
| POST | `/api/billing/portal` | `{redirect_url}` | Billing history and payment method, handled by the provider's portal rather than building one. |
| POST | `/api/billing/downgrade` | `{effective_at, losses}` | `losses` drives the downgrade confirmation copy with real numbers. |
| POST | `/api/billing/cancel` | `{access_until}` | |
| POST | `/api/billing/webhook` | 200 | Provider callback, unauthenticated but signature-verified. Not called by the UI. |

Note against the cost constraint in PROJECT_HANDOFF.md: a payment provider takes per-transaction fees rather than a monthly subscription, so it does not violate the no-paid-SaaS rule. Confirm before building.

### Block 7 — Digest (unblocks A8)

| Method | Path | Returns | Notes |
|---|---|---|---|
| GET | `/api/digests` | list of sent digests for this subscriber | |
| GET | `/api/digests/{id}` | one digest's rendered content | Backs the email permalink. |
| GET | `/api/unsubscribe?token=` | HTML confirmation | One-click, no login required, token-scoped to a single channel. Required for email compliance and named in PROJECT_HANDOFF.md section 6. |

### Block 8 — Password reset (unblocks P7)

| Method | Path | Returns | Notes |
|---|---|---|---|
| POST | `/api/forgot` | 202 | Always 202 regardless of whether the email exists, so the endpoint is not an account-enumeration oracle. |
| POST | `/api/reset` | 204 | Body `{token, password}`. |

### Cross-cutting API requirements

1. **Uniform error envelope.** Every non-2xx returns `{"error": "<machine_key>", "message": "<human sentence>", ...context}`. The client renders `message` directly, so error copy is written once, server-side.
2. **Entitlement error shape.** `403` with `{"error":"entitlement","limit":"picks","current":2,"tier":"basic","required_tier":"pro","message":"..."}`. The quota modal is built entirely from this body.
3. **Unverified error shape.** `403` with `{"error":"unverified","message":"Verify your email to arm alerts."}` so the client can attach a resend control.
4. **Server-side clamping.** Board rows, search results, and every list are cut to the tier limit server-side before serialization.
5. **404 uniformity.** Out-of-universe and nonexistent must be byte-identical, including timing characteristics where practical. This is stated as a product requirement in PROJECT_HANDOFF.md section 7 and is the single most important correctness property in this document.
6. **Existing routes need one change**: `GET /api/me` should include `tier`, `verified`, `followed_industry_count`, and `timezone` so `renderNav()` can draw the tier chip without a second request.

---

## 7. Build order

Each stage is usable on its own and testable before the next starts.

1. `app.css` + `app.js` + rewritten `index.html`, `login.html`, `signup.html`, `verify-pending.html`. Delete `app.html`. Extend `GET /api/me`. Redirect targets updated.
2. Block 1 API + `board.html`, Fast Mover only, one hardcoded industry. This is the first screen that delivers product value and should be reachable before anything else is built.
3. Block 2 API + `stock.html`. Board rows become links. The Board-to-report loop is the product's core interaction; get it right before adding surface area.
4. Block 5 API + `account.html` + `onboarding.html` + real industry following. Board's industry filter goes live.
5. Block 3 API + `watchlist.html` + pinning from the Board.
6. Entitlement gating throughout: upgrade card, quota modal, locked controls, `pricing.html` from `/api/entitlements`.
7. Block 4 API + `alerts.html`, email channel only.
8. Block 6 API + `upgrade.html`. Revenue is possible at the end of this stage.
9. Block 7 API + digest generation + `digest.html` + unsubscribe.
10. Remaining channels (push, SMS, webhook), the four provisional strategies exposed as tabs, Block 8 password reset.

Stages 1-3 produce a coherent, demonstrable product. Everything after widens it.
