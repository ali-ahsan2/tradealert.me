# tradealert.me — Product Design Direction

Status: initial direction, written 2026-09-19. Authority: visual and product design only. Flow and screen specification lives in `UX_SPEC.md` and is not duplicated here. Technical and business facts are taken from `PROJECT_HANDOFF.md` (2026-09-18), which wins on any conflict.

Scope of this document: visual identity, how the platform tells the truth about score confidence, how the five strategies are differentiated, a plain-CSS component starter, and the list of things not to build.

---

## 1. Visual identity direction

### 1.1 Who this is for, and what that rules out

The subscriber is a retail investor who reads FINRA short interest prints and knows what an S-3 filing means. They are paying $10 to $39 a month for a filtered opinion, and their default posture toward any paid stock-signal product is suspicion. Three quarters of the market they are comparing against is either a Discord room with a screenshot of somebody's brokerage P&L, or a terminal-grade product they cannot afford.

That positions the design between two wrong answers:

- **Consumer trading app** (Robinhood lineage): confetti, large friendly numbers, saturated green and red, gamified streaks. Wrong because the product's core claim is restraint. The handoff document is unusually careful about what the backtest does and does not prove; an interface that reads like a slot machine actively contradicts the written methodology.
- **Enterprise SaaS dashboard**: dense grey chrome, a left nav with twelve sections, a settings surface bigger than the product. Wrong because there is one operator and no procurement committee. Nobody needs role management. Enterprise visual language also implies a support organization that does not exist.

The target is closer to a **research desk note**: something that looks like it was produced by a person who did the work and is showing you their working. Precedent in tone, not in pixels: a well set sell-side note, a FINRA data page, the SEC EDGAR full-text search results page. Serious, legible, unglamorous, and visibly dated.

### 1.2 Tone, stated as rules

1. **Numbers are the ornament.** No decorative graphics compete with data. If an element does not carry information, it is a border or it is nothing.
2. **Every figure carries its age.** The existing workbench already established data-age chips as a convention (`live_interface_plan.md` §1: "freshness shown, never implied"). Carry that into the product. A number without a timestamp is a design bug.
3. **Human judgment is visually marked as human.** The same file's §3 separates mechanically computed cells from judgment cells. The product keeps this split. Publishing is human-gated; the interface should say so on the artifact, not only in marketing copy.
4. **Confidence is never implied by polish.** A provisional strategy must not be able to look as finished as a calibrated one. See §3.
5. **No celebration states.** A win is shown as a resolved outcome in the calibration record, at the same visual weight as a loss.

### 1.3 Color approach

Anchor on a **cool desaturated neutral** base, not white and not near-black. A pure `#ffffff` page reads as a blog; a pure dark theme reads as a crypto app. Use a paper-cool off-white.

**Neutrals (the 90% of the page):**

| Token | Value | Use |
|---|---|---|
| `--bg` | `#f7f8fa` | page background, cool off-white |
| `--surface` | `#ffffff` | cards, tables, anything raised |
| `--surface-sunken` | `#eef0f4` | locked regions, disabled fields, table zebra |
| `--border` | `#d8dce3` | default 1px borders |
| `--border-strong` | `#b4bac6` | table header rules, card dividers that must read |
| `--ink` | `#161a21` | body text, near-black with blue in it, not `#000` |
| `--ink-muted` | `#5b6472` | labels, timestamps, secondary rows |
| `--ink-faint` | `#8b93a2` | data-age chips, disclaimers |

**Brand accent: a muted navy, not bright blue.** Around `#1d3a5f` to `#24466f`. The current landing page uses `#116dff`, a saturated consumer blue borrowed from generic SaaS. Replace it. Navy at that saturation reads as institutional without reading as a bank's compliance portal, and it stays legible as a link color on the off-white background. Use a single accent; resist adding a secondary brand color, because every extra hue steals meaning from the semantic set below.

**Semantic colors, deliberately restrained.** The trap in finance UI is that red and green get used both for price direction and for product state, and the two meanings collide. Rule: **red and green mean market outcome only.** Product state (errors, locked content, upgrade prompts) uses navy and amber, never green or red.

| Token | Value | Meaning |
|---|---|---|
| `--pos` | `#1f6b4a` | a muted forest green, not `#00c853`. Positive move, hit outcome |
| `--neg` | `#9b2c2c` | a brick red, not a fire-engine red. Negative move, miss outcome |
| `--warn` | `#8a5a00` | amber-brown. Thin coverage, stale data, provisional strategy |
| `--info` | `#24466f` | the navy accent. Locked content, upgrade, neutral notice |

The greens and reds are deliberately dark enough to pass 4.5:1 on `--surface`, which also means they cannot glow. That is the point. A 20% move should be communicated by the number `+20.4%`, not by a color intense enough to be felt.

**Band colors: do not use a red-to-green gradient.** Five score bands on a traffic-light ramp will be read as five strengths of "buy", which is a stronger claim than the platform makes. Use a **single-hue navy ramp with varying tint**, so bands read as ordered intensity rather than as endorsement. Specified in §2.3.

**Accessibility floor:** all text at least 4.5:1 against its background; band badges at least 3:1 for the fill plus a text label, because roughly 8% of men have red-green color deficiency and this audience skews male. No band, outcome, or strategy status may be communicated by color alone. Every one gets a word.

### 1.4 Typography direction

Three typographic jobs, and they should not share a face.

**Data: a tabular-figure monospace or a true tabular sans.** Scores, prices, short interest percentages, dates, and ticker symbols must align vertically in columns. Non-negotiable. Use the system monospace stack so there is no webfont request and no paid license:

```
ui-monospace, "SF Mono", "Cascadia Mono", "Roboto Mono", Menlo, Consolas, monospace
```

Tickers get monospace, uppercase, and slight letter-spacing (`0.02em`). This single choice does more to make the product read as a data tool than any color decision.

**Interface and prose: a neutral grotesque via the system stack.** `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`. Zero network cost, renders natively correct on every target, and neutral enough to disappear behind the numbers.

**Headings: same family, differentiated by weight and size, not by a display face.** A decorative heading font would be the single fastest way to make this look like a marketing site rather than a research product.

If one webfont is ever added, the argument for it is a serif used only for the per-stock report body, which would push the "research note" association harder. That is a later luxury; ship on system fonts. Every webfont is a render-blocking request on a single EC2 box with no CDN.

**Type scale** (1.20 ratio, rounded to whole pixels, `rem`-based at 16px root):

| Token | px | Use |
|---|---|---|
| `--fs-xs` | 12 | data-age chips, footnotes, legal |
| `--fs-sm` | 14 | table cells, labels, secondary UI |
| `--fs-base` | 16 | body prose, form inputs |
| `--fs-md` | 19 | card titles, section leads |
| `--fs-lg` | 23 | page headings |
| `--fs-xl` | 28 | score numeral on the report page |
| `--fs-2xl` | 34 | landing headline only |

Body prose line-height `1.6`; data rows `1.35`; headings `1.2`. Measure capped at `68ch` for prose, which matters on the per-stock report where the thesis is real paragraphs.

---

## 2. Communicating confidence and uncertainty

This is the part of the design where the product's credibility is won or lost, and it is the part most easily broken by a well-meaning UI choice.

### 2.1 The honesty problem, precisely

Three separate facts have to reach the subscriber without being conflated:

1. **Where the score landed** (the band).
2. **How much data was behind it** (coverage), given the engine shrinks toward a neutral value of 40 when coverage is thin. A 52 built from full coverage and a 52 shrunk up from sparse inputs are different objects wearing the same number.
3. **Whether the strategy that produced it has been calibrated at all.** Covered in §3.

Displaying a bare `52` collapses all three into one falsely precise integer. Displaying `52.0` would be worse.

### 2.2 The governing rule: bands are the unit, numbers are the detail

**The band name is the primary display. The integer is secondary and always smaller.** Everywhere a score appears in a list, a card, an alert, or an email, the band word is the larger element and the number sits beneath or beside it at `--fs-sm` in `--ink-muted`.

This matches the engine (the handoff specifies banding as the final scoring step) and it is defensible. "Elevated" survives a ±4 point model revision; "67" does not.

**Never render a decimal.** Never render a score as a percentage or attach a "%" to it, because subscribers will read a percent as a probability of success. It is not one.

### 2.3 Band scale

Five bands, ordered, each with a fixed word, a fixed navy tint, and a fixed short definition that appears in the tooltip and in the glossary. Exact numeric cutoffs are the engine's to set; the design requires only that they are fixed, published, and identical across strategies.

| Band | Fill | Text | Border | Meaning shown on hover |
|---|---|---|---|---|
| Strong | `#1d3a5f` | `#ffffff` | `#162c48` | Top of the strategy's range on this run |
| Elevated | `#3a6491` | `#ffffff` | `#2d5178` | Above the strategy's typical range |
| Neutral | `#dfe3ea` | `#2b323d` | `#c3c9d4` | Within the typical range; no signal |
| Weak | `#e8e4d8` | `#5b5240` | `#d3ccb9` | Below typical range |
| Excluded | `#eef0f4` | `#5b6472` | `#d8dce3` | Failed a hard filter or carries a disqualifying haircut |

Note that the ramp runs navy-to-neutral-to-warm-grey, not green-to-red. Strong is dark and dense; Excluded is pale and recessive. A subscriber scanning a list sees weight, not approval.

"Excluded" deserves its own band rather than being hidden, because the Fast Mover hard filters are the evidenced part of the system. Showing a name that failed a filter, with the filter named, is a stronger credibility signal than silently dropping it.

### 2.4 The coverage indicator

The handoff calls for a coverage indicator on every score. Specification:

**Form: a three-segment bar, 36px wide, 4px tall, 2px gaps, sitting directly under the band badge.** Not a percentage, not a ring, not a gauge. Segments fill left to right in `--ink-muted`; unfilled segments are `--border`.

| Segments | State word | Additional treatment |
|---|---|---|
| 3 of 3 | Full coverage | none |
| 2 of 3 | Partial coverage | none |
| 1 of 3 | Thin coverage | band badge gains a 1px dashed border in `--warn`, and the score integer is suffixed with a `~` |

**The `~` prefix/suffix convention is the single most valuable honesty affordance available here.** A score displayed as `~46` reads instantly, in any context including plain-text email, as "approximately". It survives copy-paste into a text message. It costs nothing to render. Use it everywhere a thin-coverage score appears, including in emails and webhook payload display.

**Shrinkage must be stated, not implied.** On the per-stock report, when shrinkage moved a score by any amount, print one line beneath the score in `--fs-xs`, `--ink-muted`:

> Shrunk toward neutral (40) from 61 to 46 — 4 of 11 components had data on this run.

That sentence is the product's whole thesis in one line. It says the platform knows what it does not know. It should be visible by default, not behind a disclosure toggle.

### 2.5 Ranges over points, where a range exists

Where the engine can express uncertainty as a range, show the range as the primary figure and drop the point estimate: `44–58` rather than `51`. If the engine cannot yet produce a range, do not invent a visual one. A fabricated confidence interval is worse than no interval.

### 2.6 Freshness

Carry the data-age chip convention forward verbatim. Every number derived from an external source displays its age at `--fs-xs` in `--ink-faint`, in the form `SI 9d` or `borrow 4h`.

Short interest is structurally around nine days stale by FINRA's publication schedule. The interface should say `FINRA vintage Aug 31` rather than presenting the figure as current, and the borrow fee should sit adjacent to it as the fresher proxy. Getting this right on the per-stock report is a differentiator against every Discord screenshot the subscriber has seen.

A failed refresh shows as a stale age chip in `--warn`, never as a silently reused value.

### 2.7 What not to do

- No gauge, speedometer, or dial. They imply a continuous, precise, meterable quantity.
- No star ratings, letter grades, or emoji. Grades imply a grading authority.
- No percentage framing of any score.
- No "confidence: 87%" anywhere. The platform does not produce a calibrated probability, and printing one would be a lie with a decimal point.
- No sparkline next to a score unless the underlying series is real daily price history. Decorative sparklines are fabricated data.

---

## 3. Differentiating the five strategies

### 3.1 The obligation

One strategy is calibrated against 191 real earnings events with a documented 81.2% hit rate on filter-passing events, and four are architecturally complete but have not accumulated the 30 resolved outcomes needed to trust their weights. A paying subscriber who cannot tell these apart at a glance has been misled, regardless of what the terms of service say.

The design position: **this is a disclosure requirement, not a styling preference.** It should be as hard to remove from the interface as a price is.

### 3.2 Do not differentiate strategies by color

The tempting move is five brand colors, one per strategy. Reject it. Reasons:

1. The semantic palette is already carrying band, outcome, and warning meaning. Five more hues break it.
2. Color-coded strategies invite the subscriber to build a private folk theory ("the purple one is good"), which is the opposite of the disclosure goal.
3. It does not survive plain-text email, which is a delivery channel from day one.

**Differentiate by name, by a monogram mark, and above all by evidence status.**

### 3.3 Evidence status is the primary differentiator

Two statuses, one word each, applied consistently:

**Calibrated** — Fast Mover only, today.
- Badge: `--fs-xs`, uppercase, letter-spacing `0.06em`, `--ink` text on `--surface`, 1px solid `--border-strong`, 2px radius, padding `2px 6px`.
- Reads as a quiet certification mark. It does not shout, because the number does the shouting.
- Links to the evidence page: the backtest method, the 32 filter-passing events, the 81.2% figure, and the explicit list of what the test does not prove (no profitability claim, no direction claim, small sample, roughly two years of regimes).

**Provisional** — Market Shift, GeoPolitics, Industry Restructure, Monetary Shifts.
- Badge: same geometry, `--warn` text, 1px solid `--warn` at 40% opacity, fill `#fdf8ec`.
- Label text: `PROVISIONAL — UNCALIBRATED`. Spell it out. `PROV.` is an abbreviation a subscriber can ignore.
- Links to a page stating plainly: the strategy's inputs are implemented, the weights are not backed by resolved outcomes yet, the count of resolved outcomes so far, and the threshold (30) at which recalibration can even be proposed.

### 3.4 Structural demotion, not just a badge

A badge alone will be tuned out by week three. Three structural rules that cannot be habituated away:

**Rule 1: provisional strategies render with a hatched left rule.** Every card, row, and report from a provisional strategy carries a 3px left border in `--warn` with a repeating-linear-gradient hatch. A calibrated strategy carries a 3px solid `--ink` left border. The difference is pre-attentive; a subscriber scanning a list sorts them without reading.

**Rule 2: provisional strategies never appear first.** Default sort, default tab, and default digest order put Fast Mover first. Provisional strategies sit below a labelled divider rule reading `Provisional strategies — weights not yet backed by outcomes`. If a subscriber sorts by score across strategies, the divider disappears but the hatch and badge do not.

**Rule 3: provisional scores use provisional vocabulary.** A calibrated strategy produces a **signal**. A provisional strategy produces a **candidate**. Different noun, everywhere, including email subject lines and the webhook payload's display fields. `Fast Mover signal: TICK` versus `Market Shift candidate: TICK`. Language does disclosure work that visual design cannot do in a plain-text channel.

### 3.5 Strategy identity, kept minimal

Each strategy gets a name in title case and a two-letter monogram in a 24px square, `--surface-sunken` fill, `--ink-muted` monospace text, 3px radius: `FM`, `MS`, `GP`, `IR`, `MN`. Monograms are for scanning density in lists, not for branding. No icons, no illustrations, no per-strategy mascots or metaphors. Drawing a magnet for Fast Mover or a globe for GeoPolitics would suggest each strategy is a separate product; they are one engine with different component sets, and the visual language should reflect that.

### 3.6 The transition, designed in advance

When a strategy crosses into calibrated, the interface must not quietly swap the badge. Show a dated calibration event on the strategy page: the date, the number of resolved outcomes it was based on, the operator who approved it, and the previous weights. The handoff is explicit that a human applies or rejects every weight override. That audit trail is an asset; give it a surface.

---

## 4. Design system starter

Plain CSS, custom properties, no framework, no build step, no preprocessor. Everything below is implementable in a single hand-written stylesheet.

### 4.1 Spacing scale

A 4px base. Eight steps. Do not use a value that is not on the scale.

| Token | px |
|---|---|
| `--s-1` | 4 |
| `--s-2` | 8 |
| `--s-3` | 12 |
| `--s-4` | 16 |
| `--s-5` | 24 |
| `--s-6` | 32 |
| `--s-7` | 48 |
| `--s-8` | 64 |

Defaults: card padding `--s-4`; gap between cards `--s-3`; section spacing `--s-6`; page gutter `--s-4` on mobile, `--s-5` above 768px. Table cell padding `--s-2` vertical, `--s-3` horizontal.

### 4.2 Radii, borders, elevation

Radii: `--r-sm: 3px` (badges, chips), `--r-md: 6px` (cards, inputs, buttons). Nothing rounder. Pill shapes read as consumer.

Borders are the primary separation device. **One shadow only**, and it is nearly invisible: `--shadow: 0 1px 2px rgba(22, 26, 33, 0.06)`, used on cards and on the upgrade prompt. No layered shadows, no glow, no colored shadow. Depth is not information here.

### 4.3 Breakpoints

Two, both mobile-first: `560px` (single to two column) and `900px` (report sidebar appears). No desktop-only features; alerts get read on a phone.

### 4.4 Component: score badge

The atomic unit. Band word, integer, coverage bar.

**Anatomy, top to bottom:** band word (`--fs-sm`, weight 600, uppercase, letter-spacing `0.04em`), score integer (`--fs-xs`, monospace, tabular-nums, `--ink-muted`), coverage bar (36 × 4px, three segments).

**Geometry:** `inline-flex` column, `align-items: flex-start`, gap `--s-1`, padding `--s-2 --s-3`, radius `--r-sm`, fill and text per the band table in §2.3, 1px solid border in the band's border color.

**States:**

| State | Treatment |
|---|---|
| Default | per band table |
| Thin coverage | border becomes `1px dashed var(--warn)`; integer prefixed `~` |
| Stale (source older than its cadence allows) | 60% opacity on the integer only; age chip turns `--warn` |
| Locked (outside subscriber's visible universe) | band word replaced by `—`; fill `--surface-sunken`; no integer; no coverage bar |
| Provisional strategy context | inherits the hatched left rule from its parent card; badge itself is unchanged |
| Hover / focus-visible | 2px outline in `--info` offset 2px; tooltip gives band definition and cutoff |

Two sizes: **compact** (list rows, band word at `--fs-xs`, no integer, coverage bar 24px) and **full** (report header, band word at `--fs-md`, integer at `--fs-xl`).

Every badge carries an `aria-label` reading the full sentence: `Elevated, score 67, full coverage, Fast Mover, calibrated`.

### 4.5 Component: alert card

Fires on concrete impersonal triggers: borrow fee crossing 2x, short interest crossing 10/15/20%, volume at 3x, a dated catalyst, an S-3 or 424B filing, a band change, insider buying, a social surge, a contract award.

**Anatomy:**

```
[3px left rule: solid --ink if calibrated, --warn hatch if provisional]
Row 1:  TICKER (mono, uppercase)   ·  strategy monogram  ·  status badge     [time, right-aligned]
Row 2:  Trigger sentence, --fs-base, --ink. One sentence, names the threshold crossed.
Row 3:  Trigger evidence, --fs-sm mono, --ink-muted: the number, its threshold, its source, its age.
Row 4:  [compact score badge]  [secondary link: full report]
```

**The trigger sentence must name the threshold and the crossing value.** `Borrow fee 2.4x its 5-session average (was 12.1%, now 29.4%)` not `Unusual borrow activity`. Vague alert copy is how a signal product becomes noise.

**Geometry:** `--surface` fill, 1px `--border`, `--r-md`, padding `--s-4`, left rule 3px, `--s-3` gap between stacked cards. Full-bleed edge-to-edge below 560px, with side borders removed and a `--border` top rule instead.

**States:**

| State | Treatment |
|---|---|
| Unread | left rule at full opacity; 6px `--info` dot before the ticker |
| Read | left rule at 55% opacity; no dot |
| Dilution-risk trigger (S-3, 424B) | trigger sentence text in `--neg`; the one place a card gets colored body text, because this is a stop sign |
| Positive-mechanic trigger (short interest, borrow, volume, catalyst) | neutral `--ink` body text. Explicitly not green. An alert is a fact, not a recommendation |
| Resolved (outcome recorded in the calibration journal) | outcome appended as a row: `Resolved +23.1% over 30d — hit` in `--pos`, or `Resolved −4.2% — miss` in `--neg`, at `--fs-sm` |
| Quota-exhausted placeholder | see §4.6 |
| Focus-visible | 2px `--info` outline, offset 2px |

**Misses are displayed with identical prominence to hits.** No filter defaults to hiding them. This is a design rule with a business rationale: the calibration journal is the product's evidence base, and an evidence base that only shows wins is a marketing page.

### 4.6 Component: locked content and upgrade prompt

The entitlement model is unusual and the design has to respect it: anything outside a subscriber's visible universe returns 404, identical to a name that does not exist. **There is no way to detect what you cannot see.**

**This creates a hard design constraint: there is no such thing as a blurred preview of a specific hidden name.** No "TSL_" teasers, no blurred tickers, no count of hidden results. A blurred preview leaks existence and breaks the model. Any designer's instinct to "show them what they're missing" must be refused here.

What is permitted: **quantified, non-specific capability statements.** The subscriber is told what the tier grants, never what a specific hidden row contains.

**Two variants.**

**Variant A — inline quota marker.** Used at the end of a truncated list, where the truncation is a documented tier limit rather than a hidden-name leak.

```
─────────────────────────────────────
Showing 5 of your plan's 5 names.
Basic ($10/mo) shows 10 · Pro ($29/mo) shows 50
[ Compare plans ]
─────────────────────────────────────
```

Geometry: `--surface-sunken` fill, dashed 1px `--border-strong`, `--r-md`, padding `--s-4`, centered, `--fs-sm`, `--ink-muted`. The tier numbers in `--ink`. Text link, not a button, at this position; a button here is pushy on a screen the subscriber came to for data.

**Variant B — feature gate panel.** Used where a whole capability is absent: alerts on Free, SMS below Pro, webhook and API below Investor.

Geometry: `--surface`, 1px `--border`, `--r-md`, `--shadow`, padding `--s-5`. Anatomy: a one-line statement of what the feature does, a two-line statement of what the qualifying tier includes, a primary button, and the current tier stated in `--fs-xs --ink-faint`.

**Button styling:** primary is `--info` fill, `#ffffff` text, `--r-md`, padding `--s-3 --s-5`, weight 600. Hover darkens to `#1a3455`. Active darkens to `#162c48`. Focus-visible gets a 2px `--info` outline at 2px offset. Disabled is `--surface-sunken` fill, `--ink-faint` text, `cursor: not-allowed`. Secondary is a `--border` outlined button with `--ink` text.

**Prohibited in every upgrade surface:** countdown timers, "limited time", strikethrough pricing, testimonial quotes, urgency of any kind. This audience reads scarcity marketing as a tell that the signal is not good enough to sell on its merits. State the price and what it unlocks.

### 4.7 Component: per-stock report layout

The most important screen. Identical for every subscriber who can see it, cached per run. This is the artifact that justifies the subscription, and it should read like a one-page research note.

**Layout:** single column below 900px. Above 900px, a 2fr / 1fr grid with an evidence sidebar on the right, gap `--s-6`, max-width `1080px`, centered.

**Vertical order in the main column:**

1. **Header block.** Ticker in monospace `--fs-lg` uppercase; company name `--fs-base --ink-muted`; industry and benchmark ETF `--fs-sm`. Right side: run timestamp and `Published by human review on [date]`. That last line is the product's differentiator and belongs above the fold, not in a footer.

2. **Score block.** Full-size score badge, strategy name, monogram, and the calibrated/provisional status badge on one row. Directly beneath, in `--fs-xs --ink-muted`: the shrinkage sentence from §2.4 when shrinkage applied, and the coverage state word. Separated below by a 1px `--border-strong` rule.

3. **Hard filter table.** For Fast Mover this is the evidenced part of the system and should be visually dominant, above the scorecard. Four columns: criterion, required, actual, pass or fail. Pass is a `--pos` checkmark glyph plus the word `pass`; fail is a `--neg` glyph plus `fail`. Monospace values, `tabular-nums`, right-aligned numeric columns. Zebra rows in `--surface-sunken`. Every actual value carries its data-age chip.

4. **Score breakdown.** One row per component: name, weight after renormalization, contribution, and whether data was present. Components with no data render in `--ink-faint` with the word `no data` rather than a zero, since the engine redistributes weight rather than zeroing. Showing a `0` here would be a factual error in the interface.

5. **Haircuts and penalties.** Only rendered when present. `--neg` left rule, `#fdf5f5` fill, each haircut naming the red flag and the points subtracted. Haircuts apply after shrinkage at full force, so they are listed after the breakdown, not folded into it.

6. **Thesis and hook.** Human-written prose. Measure capped at `68ch`, `--fs-base`, line-height `1.6`. Prefixed by a human-judgment marker: a small `--fs-xs` uppercase label reading `Operator note` with a 2px `--border-strong` left rule. This is the §3-of-`live_interface_plan` rule made concrete: computed and judgment content must never be confusable.

**Evidence sidebar (900px and up), sticky, `--surface-sunken`, `--r-md`, padding `--s-4`:**

- Data sources for this report, each with its as-of timestamp
- FINRA short interest vintage, stated as a date
- Borrow fee, stated adjacent to short interest as the fresher proxy
- Calibration record for this strategy: resolved outcome count, hit rate by band
- Standing disclaimer, `--fs-xs --ink-faint`: not investment advice, every figure is a claim to re-verify

Below 900px the sidebar becomes the final section of the single column, not a collapsed accordion. Provenance hidden behind a tap is provenance the subscriber will not read.

**Print stylesheet.** Half an hour of CSS. This audience saves and forwards research notes, and a report that prints cleanly on one page gets shared, which is the cheapest acquisition channel a zero-revenue product has. Hide nav and buttons, force `--surface` white, keep the sidebar as a footer block, keep every timestamp.

### 4.8 Token block, ready to paste

```
Colors:        bg #f7f8fa · surface #ffffff · surface-sunken #eef0f4
               border #d8dce3 · border-strong #b4bac6
               ink #161a21 · ink-muted #5b6472 · ink-faint #8b93a2
               info/accent #24466f · pos #1f6b4a · neg #9b2c2c · warn #8a5a00
Bands:         strong #1d3a5f · elevated #3a6491 · neutral #dfe3ea
               weak #e8e4d8 · excluded #eef0f4
Spacing:       4 8 12 16 24 32 48 64
Type sizes:    12 14 16 19 23 28 34
Radii:         3 (badge) · 6 (card)
Shadow:        0 1px 2px rgba(22,26,33,0.06)
Breakpoints:   560 · 900
Max widths:    68ch prose · 1080px report
```

Ship this as one `tokens.css` with custom properties on `:root`, imported before a single `app.css`. Two stylesheets total. That is the whole system.

---

## 5. Non-goals

Bootstrapped, zero revenue, no paying subscribers, a single EC2 box, no paid SaaS subscriptions anywhere in the stack, and one person building it. Each item below is a thing a designer would reasonably propose and should not.

**Do not add a JavaScript charting library.** Highcharts, ECharts, and Chart.js are 90KB to 250KB gzipped before a single data point renders, they need a build step the project deliberately does not have, and Highcharts carries a commercial license. Where a price series genuinely must appear, hand-write an inline SVG polyline from server-rendered data; a 30-line Python helper emitting a `<polyline points="...">` covers the entire realistic charting need. Most of the value here is in tables anyway, and tables are more honest than charts at this sample size.

**Do not commission illustration.** No hero illustrations, no empty-state characters, no 3D renders, no abstract gradient blobs. Custom illustration costs real money, dates immediately, and pushes the product toward the consumer-app register §1.1 rejects. Empty states are one sentence of text plus a `--border` box.

**Do not build animation.** No page transitions, no number count-ups, no skeleton shimmer, no card entrance staggers, no scroll-triggered reveals. Permitted total: a 120ms `background-color` and `border-color` transition on interactive elements, and a `prefers-reduced-motion` guard around it. Animated numbers on a financial product are actively harmful because they make a static figure feel live.

**Do not adopt a CSS framework or a design-system dependency.** No Tailwind (build step), no Bootstrap (visual signature is recognizable and wrong for this audience), no component library (implies a framework). Two hand-written stylesheets under roughly 900 lines total will cover every component in §4.

**Do not build a dark mode yet.** It doubles every color decision, doubles review surface, and doubles the ways a band ramp can break. Revisit after the first paying subscriber asks. The cool off-white base is comfortable enough for extended reading.

**Do not add webfonts.** Covered in §1.4. Render-blocking requests on a single unfronted EC2 box, for a benefit the system monospace stack already delivers.

**Do not design a mobile app, a native shell, or a PWA install flow.** Delivery already runs through email, web push, SMS, and webhook. Those are the mobile strategy.

**Do not build a marketing site beyond one page.** One page: what the platform does, the Fast Mover evidence including what it does not prove, the pricing table straight from the entitlements grid, and signup. No blog, no case studies, no about page, no testimonial section, no logo wall. Fabricated social proof at zero subscribers is both dishonest and transparent.

**Do not design a settings surface beyond the minimum.** Email, password, notification channels, followed industries, unsubscribe. No themes, no layout preferences, no dashboard customization, no saved views. Every preference is a permanent maintenance cost and a new way for two subscribers to see different things, which undermines the "identical for everyone who can see it" property of the report.

**Do not visually differentiate the four uncalibrated strategies from each other.** They share one status: provisional. Giving each its own identity implies four products and four bodies of evidence. There is one body of evidence and it belongs to Fast Mover.

**Do not build an onboarding tour, tooltip walkthrough, or progress checklist.** Gamified onboarding is the consumer-app register. If the per-stock report needs a tour, the report is wrong.

---

## 6. Open questions for the creative director

1. **Band cutoffs and count.** Five bands and their words are proposed here; the numeric cutoffs are the engine's. Are cutoffs identical across all five strategies, or per-strategy? If per-strategy, the band word alone is no longer comparable across tabs and the design needs a comparability rule.

2. **Does the engine produce a range, or only a point estimate?** §2.5 depends on this. If a range exists, it should be the primary display; if not, the `~` convention carries the whole load.

3. **Coverage thresholds.** The three-segment bar needs two cutoffs. What component-presence ratios define full, partial, and thin?

4. **Is `signal` versus `candidate` acceptable as a product-wide vocabulary split?** It is the strongest disclosure mechanism proposed here and the most invasive, since it touches email subjects, webhook payloads, and every table header.

5. **Print stylesheet priority.** Argued for in §4.7 as cheap acquisition. Worth the half hour before the first subscriber, or after?
