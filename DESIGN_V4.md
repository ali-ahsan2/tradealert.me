# tradealert.me — Design v4: consumer app, analysis terminal

Supersedes PRODUCT_DESIGN.md §1.3 (color), §1.4 (typography), §4.1–4.3 and
§4.8 (token block). Everything in PRODUCT_DESIGN.md §2 (confidence and
uncertainty) and §3 (strategy differentiation) still holds word for word:
bands are the unit, numbers are the detail, thin coverage carries `~`, red
and green belong to market outcomes and verdicts, synthetic data never
reaches a subscriber, and nothing is fabricated.

## 1. Two surfaces, two personalities

**The app** (everything a subscriber sees) looks and moves like a modern
retail investing app: one big number per screen that answers "how am I
doing", a chart under it, lists of names with a sparkline and a coloured
move on every row, soft cards, pill buttons, a left rail on desktop and a
bottom tab bar on phones. Calm, bright, confident.

**The Lab** (the operator's analysis engine) looks like a trading
terminal: dark only, flat panels with hairline borders, dense monospace
tables, amber for the thing you are working on, cyan for links, a command
bar on top and a status strip at the bottom. Nothing decorative; every
pixel is a number or a control.

The two share tokens.css and the honesty rules, nothing else.

## 2. The app

### 2.1 Color
- Page `#f5f6fa`, cards white, hairline borders `#e6e8ef`, ink `#0f1420`.
  Dark: page `#0b0f17`, cards `#121826`, ink `#eef2f8`. Dark follows the
  OS or an explicit `data-theme`; there is still no in-product switch.
- Brand accent is **cobalt** `#2f5cff` (dark `#6d8cff`). It is the only
  branded colour and it never means up or down.
- **Green `#0f9d58` and red `#e0393e` mean one thing**: a market move or a
  pass/fail verdict. A sparkline is green when the window closed above
  where it opened and red otherwise. Nothing else may use them.
- Score bands are one cobalt ramp: strong (solid cobalt, white text),
  elevated (lighter cobalt), neutral (cool grey), weak (warm grey),
  excluded (outline). Ordered weight, never five strengths of "buy".

### 2.2 Type
- **Manrope**, self-hosted variable file, for everything on the app.
  Display numbers 36–56px at weight 800 with `-0.02em` tracking; body 15px
  at 500; labels 11–12px uppercase with `0.08em` tracking.
- Every column of digits is `tabular-nums`. Scores stay integers.

### 2.3 Shape and depth
- Cards: radius 16px, no border, one soft shadow. Inputs and segmented
  controls: radius 12px. Buttons and chips: pills.
- Depth is not information. One shadow level for cards that float
  (hero, dossier header), hairlines for everything that sits in a list.

### 2.4 Layout
- Desktop (≥900px): a 76px icon rail on the left (brand, Home, Board,
  Screen, Changes, Calendar, Watchlist, Alerts; account at the bottom)
  that widens to 220px with labels at ≥1200px. Content column max 1120px
  with a slim in-page header: title, search pill, tier chip.
- Phone: a compact top header (brand, search, avatar) and a five-item
  bottom tab bar (Home, Board, Screen, Watchlist, Alerts) with a filled
  icon on the active tab.

### 2.5 The hero number
Every primary screen opens with one number and one chart:
- **Home**: the subscriber's watchlist as an equal-weight index, rebased to
  100 at the start of the window, with 1M/3M/1Y pills; when nothing is
  pinned, the ETFs of the industries they follow. Under it, horizontally
  scrolling mover cards (symbol, big %, sparkline), then the industries
  as cards with the ETF sparkline and the band distribution.
- **Stock**: the last close as the headline, the day and 30-day moves
  beside it, and the chart full-width directly beneath with 1W/1M/3M/1Y
  pills (area line by default, candles on request). The score card and
  a "key stats" grid follow, then the evidence sections.
- **Board / Screener / Watchlist**: every row carries a 30-day sparkline
  and a coloured 30-day move beside the band pill, so the list reads at a
  glance the way a brokerage watchlist does.

### 2.6 Components
- **Score pill**: band word, integer, coverage ticks; `~` on thin coverage.
- **Move chip**: `+4.2%` in green or red, tabular, with a small sparkline
  to its left where there is room.
- **Stat tile**: label above, large number, one-line sub-text. Used only
  where the figures are the point of the screen.
- **Key stats grid**: eight label/value pairs, each with its age chip.
- **Mover card**: symbol, theme, sparkline, 30-day move; a horizontal
  scroller on every width.

### 2.7 Landing page
The landing page sells the product, it does not explain it. It opens with
one claim and one live visual: the product itself, rendered from public
data (today's run: how many names scored, how the bands fell), beside a
single primary action. Then proof as numbers, three benefits as cards with
a visual each, a product tour as framed screens, a two-plan pricing
teaser, and a final call to action. Copy is short; the figures are real
and sourced; no name that a plan would hide is ever shown.

## 3. Honesty rules carried into v4
- A sparkline is drawn only from stored closes; no interpolation.
- The hero index is rebased and labelled "relative movement, rebased to
  100"; the product never shows a dollar figure it does not hold.
- A move chip is blank, not zero, when no bar exists.
- Band words and `~` render exactly as before; the pill shape changes,
  the semantics do not.

## 4. The Lab terminal
- Dark only, forced by `html[data-surface="lab"]` in tokens.css. Page
  `#090c11`, panels `#0f131a`, borders `#1c2430`, ink `#d9e0ea`.
- **Amber `#f5a524`** is the working accent: active tab, selected chip,
  the control being edited, primary button. **Cyan `#38bdf8`** is for links
  and chart lines. Green/red keep their meaning.
- IBM Plex Sans 13–14px for UI; IBM Plex Mono for every number, key, id
  and timestamp. Panels have 4px radius, 1px borders, no shadow.
- A **command bar** on top: mark, surface name, screen tabs as underlined
  terminal tabs, the strategy selector, run and fixture counts, sign out.
  A **status strip** on the bottom: environment, latest run, fixture
  events, version state, the keyboard hint.
- Tables are dense (28px rows), header labels uppercase 11px tracked,
  numbers right-aligned tabular, hover row highlight, zebra off.

## 5. Functional enhancements shipped with v4

Added alongside the visual uplift because the new layouts asked for them.
Each one reads data the product already stores.

- **Watchlist index** (`GET /api/me/watchlist/series`): the subscriber's
  pinned names as an equal-weight index rebased to 100 at the start of a
  30/90/365-day window, with the ETF of each followed industry as a ghost
  line. It is the home screen's hero chart and is labelled as relative
  movement, never a balance.
- **Sparklines on every row**: `/api/board`, `/api/screen` and
  `/api/me/watchlist/stats` carry the last 30 closes (`price.closes`,
  `closes`) and the overview's industry benchmarks carry theirs. Board,
  Screener, Watchlist, Home movers and industry cards draw them; green or
  red by the window's direction.
- **Movers strip** on Home: the biggest 30-day price moves among the
  subscriber's visible names, up and down, from the screener sorted by
  30-day change.
- **Chart-first dossier**: the last close as the headline with day, 30-day
  and benchmark moves; 1W/1M/3M/1Y/2Y ranges; a close line with a soft fill
  by default and candles on request; event markers unchanged.
- **Key stats grid** on the dossier: market cap, float, short interest,
  borrow fee, days to cover, 3-month move, distance from the 52-week high
  and next earnings, each with its age chip.
- **Appearance preference**: Auto, Light or Dark in the account menu,
  stored per browser and applied as `data-theme`; Auto follows the OS.
- **Copy link** on the Screener: the address is the screen, so a filter
  set can be handed to a colleague on the same plan.
- **Lab status strip**: environment, strategy and fixture counts, the
  current screen and strategy key, and the rule that synthetic rows never
  leave the surface, always visible.

## 6. Positioning: a helpful tool that advises and alerts

Owner's correction, binding on every screen: the product is a research
assistant that watches the industries you follow, explains what changed
and why it matters, and alerts you on facts. It is not a trading portal.
"Advise" means guidance inside the honesty rules (what matters today, what
changed, what to look at next, what the evidence does and does not
support), never a buy or sell.

What this changes in v4:
- **Home is a daily brief.** It leads with what changed on your names
  since the last run and why, the alerts that fired, the dated events
  ahead and one suggested next step. The rebased index and the movers are
  context further down, not the headline.
- **Every screen states its utility** in one plain line and proves it
  with the subscriber's own real figures ("alerts fired on 7 of your names
  this month", "3 of your pins cleared the screen today"). Upgrade prompts
  are framed on what you would be told, never on more tickers.
- **Alerts are the centre of gravity.** "Notify me" is the obvious action
  on a name, with sensible default triggers, and every trigger is
  explained in plain words.
- **Tone** is calm and explanatory. Prices and moves are context; the
  signal, its reason and its evidence are the headline. Brokerage cues
  (price-first dossier header, portfolio-style index, "movers") are
  demoted, not deleted.
- **The landing page** pitches the assistant: it watches, it explains, it
  alerts. The proof numbers stay exactly as published.

## 7. Newcomer ease: the same product, readable by anyone

Owner's correction, binding alongside §6: v4 looked capable but not easy.
This pass re-imagines the subscriber side for someone who has never traded
while keeping every function reachable. The method was a master plan
executed as six parallel packages over shared primitives.

### 7.1 Principles

- **Plain words first, the term second.** Every screen reads in ordinary
  English. Where a term of art remains (band, coverage, shrinkage, borrow
  fee), it is underlined and a tap opens its definition. Definitions live
  in one glossary so a word means the same thing everywhere.
- **One sentence of utility under every title**, built from the
  subscriber's own live figures. If a figure cannot be derived from the
  data on screen it is left out, never estimated.
- **Simple and Full.** Simple is the default: plain labels, the columns a
  newcomer needs, advanced controls folded behind "More" or "Advanced".
  Full shows every column and control. The choice persists per browser,
  is one tap away in the header and the account menu, and nothing is
  removed in either mode.
- **Verdict before chart.** A name opens with what the number means, why,
  and what you can do about it. Price is context below.
- **One obvious action.** "Notify me" arms three default triggers with one
  tap and answers every refusal (unverified email, a plan without alerts,
  a plan at its limit) by saying what we would watch before any mention
  of a plan.
- **Honesty unchanged.** Integer scores, `~` on thin coverage, band words
  as the claim, red and green only on price moves and PASS/FAIL, rates
  only at n ≥ 10, nothing fabricated. Plain language never softens a fact
  into a forecast; "advise" means explain and suggest a product action.

### 7.2 Shared primitives

| Piece | What it is |
| --- | --- |
| `lib/glossary.js` | One definition per product term (`GLOSSARY`), plain trigger phrases (`TRIGGER_PLAIN`), the three default triggers, plain field names for Simple mode (`PLAIN_FIELD`) and the field → term map. |
| `lib/plain.js` | Sentences from the engine's own fields: `verdict()` (headline + detail lines incl. coverage and shrinkage), `whySentence()`, `changeSentence()`, `triggerSentence()`, `nextStep()`. Nothing in it predicts. |
| `lib/mode.js` | Simple/Full preference (`ta_mode`), `useMode()`, `data-mode` on `<html>` so CSS can hide `.full-only` or `.simple-only`. |
| `components/Explain.jsx` | Tap-to-open definition on any term (dotted underline) or a small "?" without children. Touch friendly, keyboard friendly, links to `/help#term`. |
| `components/NotifyButton.jsx` | One-tap alerts on a name over email with shared rule cache; verify / plan / quota cards framed on utility. |
| `styles/assist.css` | The assist layer: utility line, verdict block, next-step card, sticky action row on phones, accordion sections, tour sheet, help grid, mode toggle. |
| `/help` | "How tradealert works": five steps, "Is this advice?", the glossary with anchors, the mode toggle explained. |

### 7.3 Navigation and shell

- Rail and tab labels in plain words: Home, Board, Find, What changed,
  Coming up, Watchlist, Alerts. The command palette uses the same words.
- Simple/Full toggle in the header (≥ 640px) and in the account menu with
  Appearance; "How it works and glossary" and "Take the tour again" in the
  account menu; "How it works" in the footer.
- Plans page: under each price, one sentence built from the plan's own
  limits saying what you would be told, before the feature rows.

### 7.4 Screens
