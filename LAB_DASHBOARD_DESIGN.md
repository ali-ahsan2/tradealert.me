# Lab Dashboard Design

Written 24 Sep 2026, revised the same day after review ("too intimidating"). This is for whoever builds the Lab UI (`frontend/lab.html`, `frontend/src/lab/`). It covers screens, states, flows, charts, copy and tokens. The API, the schema and the statistics stay as defined in `STRATEGY_ANALYSIS_TOOL.md`.

**Authority.** Behavior comes from `STRATEGY_ANALYSIS_TOOL.md` section 10. Where section 10 says nothing, sections 5 and 6 of that file set the guardrails. This document covers how it all looks and reads. Section 14 lists the gaps it fills, for the operator to confirm.

**Mockups.** Static HTML in `design/lab/`, one stylesheet, no build step. Append `#open` to any mockup URL to expand every disclosure.

| File | Screen |
|---|---|
| `index.html` | Strategies home |
| `performance.html` | Fast Mover, Performance view |
| `draft.html` | v5 draft: result, changed settings, all settings behind a disclosure |
| `shadow.html` | v4 on trial (Shadow), day 23 of 60 |
| `shadow-promote.html` | The same page with the early-promotion confirmation open |
| `versions.html` | Versions: live status, version list, history, compare |
| `lab.css` | Every token and component the mockups use |
| `v1/` | The first, denser round, kept for comparison |

The Fast Mover group rates, counts and per-ticker table are the real figures from `test_results.md`. All other figures are sample data, and each page's footnote says which.

---

## 1. Direction

Each screen answers one question in one plain sentence, set large, before anything else. At most one simple visual comes next, then at most one primary action. Ranges, sample sizes, tables, breakdowns and slicing all sit behind quiet disclosures ("Show the numbers", a list of question rows, "Show all 20 settings"). The rigor is still there, one click away, but it is not on the surface.

**Surface: light, with a dark header.** The page is warm paper (`#f6f5f1`) with near-black ink. The header bar is the only dark element (`#1f1e1b`). It is sticky and always reads `Internal. Subscribers never see this.` Because the bar is sticky, every viewport screenshot includes it, so the screenshot-guard purpose of section 2.3's dark surface still holds. The subscriber product uses a cool off-white with a navy accent, so the warm paper and the black bar still tell the two apart at a glance. The all-dark surface in `v1/` was the main reason the Lab felt heavy.

---

## 2. Information architecture

### 2.1 Routes

```
/lab                                    Strategies home
/lab/s/:key                             redirects to /performance
/lab/s/:key/performance                 Performance (default)
/lab/s/:key/versions                    Versions: live status, list, history, compare
/lab/s/:key/v/:n                        One version; layout depends on state (section 5)
/lab/s/:key/v/:a..:b                    Setting-by-setting diff of two versions
/lab/s/:key/inputs                      Input map (analysis spec 5.2)
/lab/s/:key/regression                  Regression builder (analysis spec 5.4)
/lab/findings, /lab/findings/:id        Findings ledger (analysis spec 5.6)
/lab/audit                              History across all five strategies
```

The analysis spec's `/backtest` route is folded in. Version-against-version backtests live on the draft and frozen views, and group rates for a version live on Performance. Old links redirect to Performance.

### 2.2 Header

48px, `--lab-bar-bg`, sticky. Left: `tradealert.me` (600) and `Lab` (muted). Then the text links `Strategies`, `Findings` and `History`. Right: `Internal. Subscribers never see this.` in `--lab-bar-ink`, then the admin's first name. Dialogs dim the page but leave the bar undimmed, so the internal line stays visible.

### 2.3 Strategy pages

- Title: the strategy name in the display serif, 32px.
- Under it, four text links: `Performance`, `Versions`, `Inputs`, `Regression`. The current one is ink and 500 weight, the rest muted. No boxes, no underline, no bar.
- Version pages get a one-line crumb (`Fast Mover / Versions`), the title `v5` and a state label.

### 2.4 Layout

- One column, 880px max, centered. 64px top padding, 64px between sections. 16px gutters under 560px.
- No cards on the surface. Hairline rules separate rows. The only boxed element is a dialog.

---

## 3. Vocabulary

Plain words on the surface. The technical term appears inside disclosures, table headers, the audit log and the API. Section 10 state names stay unchanged in the data. Only the display words change.

| Concept | Surface | Inside details |
|---|---|---|
| Hit | moved sharply | hit |
| Hit rate | how often it moved, `81%` | hit rate, `81.2%` |
| n | `32 cases`, `based on 14 results` | `n`, cases, results |
| 95% interval | `likely between 65% and 91%` | `95% range 64.7 to 91.1` |
| Lift over random days | compared with ordinary days | lift, points |
| Resolved outcome | result | outcome |
| Filter pass | case | pass |
| Draft | Draft | Draft |
| Tested | Frozen | Tested |
| Shadow | On trial, trial | Shadow |
| Live | Live | Live |
| Retired | Retired | Retired |
| Roll back | Restore | rolled_back |
| Audit log | History | audit log |
| Holdout check | the check on recent events it has not seen | holdout |

Percentages on the surface are whole numbers. Inside details they carry one decimal.

---

## 4. Shared states

### 4.1 The answer

Every screen opens with one sentence. It is in the display serif at 30px (25px on phones), up to 34 characters per line, with the verdict word in 500 weight. The verdict word always comes first:

| Screen | Verdict words |
|---|---|
| Home, per strategy | `Working.` `Not working.` `Can't tell yet.` `Collecting data.` |
| Performance | same as home |
| Draft or frozen comparison | `Can't tell yet.` `Too few to compare.` `Possibly better.` `Possibly worse.` `Better.` `Worse.` |
| Trial | `Not ready yet.` `Ready to promote.` `Worse than live.` |
| Versions | `v3 is live.` then what else exists |

The Performance verdict is computed from the lift range (analysis spec 6.1 floors apply):

| Verdict | Rule |
|---|---|
| Working | Lower end of the lift range above zero, at least 30 cases |
| Not working | Upper end of the lift range at or below zero, at least 30 cases |
| Can't tell yet | Range spans zero, or 10 to 29 cases |
| Collecting data | Under 30 resolved outcomes, or no hit definition |

The follow-up sentence uses numbers the reader can picture: `moved sharply about twice as often as on ordinary days` for a ratio of 1.8 to 2.4, `about three times` for 2.5 to 3.4, and the two percentages otherwise.

### 4.2 Can't tell yet

This is the normal state, not a warning. It uses the answer style, ink color, and no icon or tint. The note under it says what the data shows and what would settle it. Example: `A trial on live data is the way to find out more.`

### 4.3 Too few for a rate

This covers groups under 10. On the surface the text reads `Too few cases to compare` or `4 cases in 90 days`. Inside tables the rate and range cells merge into `Too few for a rate`.

### 4.4 Collecting data

This is for the four strategies with no resolved outcomes. Home shows `Collecting data. 0 of 30 results so far.` in muted ink, with no chart and no action. Their Performance view shows the same sentence as its answer, then: `Market Shift has scored daily since 18 Sep 2026. It needs a definition of moving sharply and 30 results before anything here can be measured.` The page renders no metrics, no zeros and no Run button (analysis spec 5.5).

### 4.5 Loading and progress

A static skeleton, with no shimmer. Runs longer than a second show a counted line in place of the answer: `Scoring 143 events. 88 done.` This line is `aria-live="polite"`, and the page title changes when the run finishes.

### 4.6 Error

The answer slot shows the error in the same answer style, in `--warn`. Example: `The comparison stopped.` A muted note follows: `The scoring job timed out at event 88 of 143. Nothing was saved.` Then a `Run again` button. Red is never used for errors.

### 4.7 Data problem

Synthetic or stale inputs (analysis spec 6.7) show one `--warn-fill` line directly under the answer: `34 of 191 events use seeded values. These numbers cannot be cited.`

### 4.8 Out of date

If a draft's settings change after a comparison, the answer is replaced by `Settings changed since the last comparison.` The primary button becomes `Compare with live`.

---

## 5. Screens

### 5.1 Strategies home

Mockup: `index.html`.

- Title `Strategies`, then one line: last update time and publishing status (`All five are publishing.` or `Fast Mover publishing is paused.`).
- One row per strategy, five rows, hairline rules between them. Columns: name (190px), status sentence, and one pending action on the right.
- The status sentence is the section 4.1 answer, in 15px sans with the verdict word in 500 weight.
- The pending action is the single most urgent item for that strategy. Priority: a trial at day 60 or later (`Promote v4, trial complete`), paused publishing (`Publishing paused`), a trial in progress (`Review v4 trial, day 23 of 60`), then an uncompared draft (`Compare v5 with live`). No action means an empty cell.
- Strategies with outcomes have a `Show the numbers` disclosure under the sentence. It holds a facts list: passes and rate with its likely range, any earnings day, ordinary days, new cases per period, last 90 days, and the largest single stock. It ends with a link to Full performance.
- Strategies collecting data are muted and have no disclosure.
- At 390px the columns stack: name, sentence, disclosure, action.

### 5.2 Performance

Mockup: `performance.html`.

1. **Answer.** Example: `Working. Stocks that passed all six filters moved sharply 81% of the time. On ordinary days the same stocks did so 37% of the time.`
2. **One visual.** Two plain bars (section 9.1): `Passed the filters, 32 cases` and `Ordinary days, 232 days, same stocks`.
3. **Note.** Sample size, a trust statement and the likely range in words: `Two years of earnings dates on 27 stocks. Enough to trust that the filters help. The true rate is likely somewhere between 65% and 91%.`
4. **Show the numbers.** Group table with cases, moved, hit rate and 95% range, including all earnings events. Then lift over random days and over all earnings with ranges, throughput, and the hit definition. These are metrics 1 and 2.
5. **Other checks.** A list of question rows. Each row is a `<details>` with the question on the left and a one-line answer on the right. Expanding a row shows a short explanation and its table.

| Question | Section 10.5 metric | Example answer |
|---|---|---|
| Still working lately? | 8 | `Can't tell yet. 4 cases in 90 days.` |
| Does the score add anything beyond the filters? | 3 | `Not that we can see.` |
| Which filters matter most? | 4 | `Short interest and revenue growth.` |
| Are any thresholds too tight? | 5 | `No sign of it.` |
| Is one stock carrying it? | 10 | `No. The largest is a quarter of cases.` |
| Up or down? | 6, 7 | `Mostly up, 21 of 26.` |
| Does it differ by industry? | slicing | `Too few cases to compare.` |
| Is the data complete? | 9 | `Yes, all 191 events used.` |
| Do reviewers override it? | 11 | `Not measured yet.` |

6. **Narrow down or pick another version.** A disclosure at the bottom holding the version select and the five slice selects: industry, company size (market cap band), exchange, region and event type (catalyst). Exchange shows `Not collected yet` and is disabled until it is ingested. Event type shows `Earnings only` and is disabled while only one type exists. A selection filters every answer on the page and is written to the URL. While a slice is active, a line under the answer reads `Showing defense, drones and space only. Show all.`, so a narrowed view is never mistaken for the whole.

The answers in the question rows are generated from the numbers using the templates in section 8.

### 5.3 Versions

Mockup: `versions.html`.

1. **Answer.** Example: `v3 is live. v4 is on trial and v5 is a draft.`
2. **Publishing line.** `Subscribers see v3. Last published 24 Sep at 06:10 ET.` followed by the text button `Pause publishing`. When paused, the line reads `Publishing paused since 14 Jul at 18:30. The Board shows the 14 Jul run.` in `--warn`, with `Resume publishing`.
3. **Version list.** One row per version. Columns: number (display serif), state word, one-line plain summary, one link. Links: Draft `Open`, Frozen `Open`, On trial `Review`, Live `Performance`, Retired `Restore`. Retired rows are muted. A Provisional version shows the label after its state word.
4. **Primary action.** `Start a new draft`, which copies live. Other versions offer `Copy to new draft` on their own page.
5. **History.** A question row whose answer is the latest change. It expands to the audit table: when, who, change, reason, evidence, six rows, then `Show 9 older changes`. Pauses show in `--warn`.
6. **Compare two versions.** A question row with two selects and a `Compare` button. It opens the setting-by-setting diff (analysis spec 5.3). Each change is shown as `old → new` with a `+` or `−` prefix, and unchanged settings sit behind `Show 17 unchanged`.

### 5.4 Draft

Mockup: `draft.html`.

1. Crumb, then `v5` with the `Draft` label, then `A copy of v3 with three changes. Saved 24 Sep at 14:32.`
2. **Answer** from the comparison with live on the same events. Example: `Can't tell yet. v5 looks slightly better than live, but there isn't enough data to be sure.` Before the first comparison: `Not compared with live yet.`, with the primary button `Compare with live`.
3. **One visual.** Two bars: `v3, live now, 24 cases` and `v5, this draft, 19 cases`.
4. **Note** stating the practical effect: `v5 is pickier. On the same past events it would have skipped 5 stocks, and 3 of those moved sharply.`
5. **Primary action.** `Freeze v5` (Draft → Tested), with `Locks these settings so v5 can go on trial.` beside it. It is disabled with a stated reason if the weights do not total 1.00, the cutoffs are out of order, the reason is under 40 characters, or the comparison is out of date.
6. **Show the numbers.** Event base and holdout note, then a table of v3 against v5 (passes, moved, hit rate, 95% ranges, passes a week, largest stock share). Then the difference and its range, the skipped and added events table, and the multiple-comparisons line (`Test 2 in this line of inquiry, so a difference needs p below 0.025 to count.`). The slice selects are also here. Slicing a comparison counts as a new test.
7. **What v5 changes.** Only the settings that differ from live, as editable rows: plain label, input, and `live: 10%`. A changed input has an `--info` border. That is the whole treatment.
8. **Show all 20 settings.** The full editor in four groups: filters a stock must pass, score weights (total 1.00), score bands, and what counts as moving sharply. Unchanged rows say `same as live`. A strategy with no hit definition shows `No definition yet. Set one once the strategy has results.` in the last group.
9. **Why this draft.** A textarea with a 40-character minimum.
10. `Discard this draft` as a muted text button at the bottom.

There is no Save button. Drafts autosave on blur, and the subtitle shows the save time.

### 5.5 Frozen (Tested)

Same layout as the draft. Settings show as text, not disabled inputs. The primary action is `Start trial`, which runs the holdout check (section 6.2). The secondary action, in text, is `Copy to new draft`. Once the check has run, its result sits in Show the numbers: `2 Sep, on the 48 held-back events: v3 passed 8, v4 passed 11. Too few to compare, so v4 was not shown to be worse.`

### 5.6 On trial (Shadow)

Mockups: `shadow.html`, `shadow-promote.html`.

1. Crumb, `v4` with the `On trial` label, then `Scoring quietly beside v3 since 2 Sep. Nothing from v4 reaches subscribers.`
2. **Answer.** Before day 60: `Not ready yet. After 23 of 60 days, v4 and the live version are doing about the same.` The second clause follows the comparison verdict. From day 60: `Ready to promote.` followed by that verdict. If the verdict is a confirmed Worse, the answer reads `Worse than live.`
3. **One visual.** A progress bar for the 60 days, labelled `Day 23 of 60` and `37 days left, ends 31 Oct`.
4. **Note.** Result counts in words and the projection to 30 results: `At this pace v4 has 30 results around day 49.`
5. **Action.** Before day 60 this is a secondary button, `Promote early`, with `Needs a written reason until day 60.` It is deliberately not styled as primary, since waiting is the default. From day 60 it becomes the primary button, `Promote v4`.
6. **Show the numbers.** A table of live against trial with results, moved, hit rate and 95% range, plus the difference row. A facts list: picked by both, picked by v4 only, picked by v3 only, still waiting, and the pre-trial check. Then the results timeline (section 9.2).
7. **Question rows.** `What does v4 change?` (diff table), `Latest results` (outcome table and `All 14 results`), and `Stop the trial` (explanation and an `End trial` button).

### 5.7 Live and Retired

Live links to Performance with its version selected. Retired shows the answer `v2 was live from 11 Feb to 2 Jun 2026.`, then its Performance figures for that period behind Show the numbers, with `Restore v2` as the only button.

### 5.8 Provisional label

A version promoted early carries `Provisional` (amber on `--warn-fill`) after its state word wherever the version appears. On hover or focus it reads `Promoted early on day 23. Clears at 30 live results (12 so far).` At 30 the label clears and History gets a system row.

---

## 6. Flows

The dialog shell is 560px wide, white, with a 1px `--border-strong` border, 6px radius and 32px padding. The heading is a question in the display serif. The body is plain sentences. The cancel action is a text button on the left, and the primary is on the right. Focus goes to the first field, `Esc` cancels, and focus returns to the trigger. The scrim is `rgba(31,30,27,0.42)`.

Every flow writes a History row.

### 6.1 Freeze

Heading `Freeze v5?` Body: `Every setting locks. The comparison with live stays attached. To change anything later, copy v5 into a new draft.` Buttons `Keep editing` and `Freeze v5`. Event: `frozen`.

### 6.2 Start trial (Tested → Shadow)

Heading `Put v5 on trial?` Body: `First v5 is checked once on the 48 most recent events, which it has never seen. The check cannot be re-run.` Primary: `Run the check`.

The result replaces the body:

- **Not shown worse:** `v5 was not shown to be worse on recent events. The trial starts with tomorrow's update.` Primary: `Start trial`.
- **Confirmed worse:** `v5 did worse than live on recent events: 58% against 79%, and the gap is too large to be chance. It cannot go on trial.` The only button is `Close`. Show the numbers inside the dialog holds the ranges and the adjusted p.

Only one trial runs per strategy. If one is already running, the button reads `v4 is on trial` and is disabled. Events: `holdout_checked`, then `shadow_started`.

### 6.3 Promote at day 60

Heading `Make v4 live?` Body: the same two result lines as 6.4, then what happens. No reason field. Primary: `Promote v4`. Event: `promoted`.

### 6.4 Promote early

Mockup: `shadow-promote.html`. This dialog meets the section 10.2 content requirement in plain words:

1. Heading `Promote v4 before its trial ends?`
2. `v4 has run for 23 of 60 days. So far there is not enough data to tell it apart from the live version.` The second sentence follows the comparison verdict.
3. Two result lines, each with its confidence range in words: `v4, on trial: Moved in 10 of 14 results, 71% (likely 45 to 88%)`, then the same for v3.
4. `Why promote now`, a textarea with a live count and a 40-character minimum. The primary button stays disabled until the minimum is met.
5. `v4 goes live at the next update, 25 Sep at 06:10 ET. v3 is kept and can be restored in one step. v4 shows a Provisional label in the Lab until it has 30 results as live.`
6. Buttons: `Keep the trial going` and `Promote v4`.

If either side has under 10 results, its line reads `9 results, too few for a rate` and the verdict sentence reads `Too few results to compare yet.` The button stays enabled, because section 10.2 makes Provisional a label, not a block. Event: `promoted_early`, which stores the reason, the day count, and both sides' counts and rates.

### 6.5 Restore (roll back)

Heading `Restore v2?` Body: v2's live period and how often it moved in that period, with the likely range. Then `What changes back` (up to four settings, and `and N more`). Then `v2 goes live at the next update. v3 is kept as Retired.` If a trial is running: `v4's trial continues against v2.` A reason is required, 40-character minimum. Primary: `Restore v2`. Event: `rolled_back`. A restored version never carries Provisional.

### 6.6 Pause and resume

Pause: `Pause Fast Mover publishing?` Body: `Scoring keeps running. Subscribers keep seeing the 24 Sep update, marked paused, until you resume.` A reason is required, 10-character minimum. Event: `paused`.

Resume: `Resume publishing?` Body: `The next update publishes normally. Updates made while paused are not sent.` The reason is optional. Event: `resumed`.

### 6.7 End trial, discard draft

- `End trial`: the version returns to Frozen and keeps its check and its results. The reason is optional. Event: `shadow_ended`.
- `Discard this draft`: `Discard v5? Its comparison runs stay in the query log.` Event: `draft_discarded`.

---

## 7. Numbers

### 7.1 Formatting

| Value | Surface | Details |
|---|---|---|
| Rate | `81%` | `81.2%` |
| Range | `likely between 65% and 91%` | `64.7 to 91.1` |
| Difference | in words (`slightly better`, `about the same`) | `+5.0`, `−3.6` (U+2212) |
| Count | `32 cases`, `14 results` | `32` |
| Frequency | `about one every three weeks` | `0.3 a week` |
| Date | `24 Sep 2026` | ISO in event tables, `2025-01-08` |
| Time | `06:10 ET` | same |

Never use an en dash or hyphen as a range separator. Numbers in tables use the mono face.

`About the same` is used when the difference is under 5 points. `Slightly` covers 5 to 10 points, and anything larger says `better` or `worse` with both percentages. These words only describe the point estimate. The verdict word carries the certainty.

### 7.2 Comparison verdicts

Computed from the difference, its range, the Holm-adjusted p (analysis spec 6.3) and the section 6.1 floors:

| Verdict | Condition |
|---|---|
| Too few to compare | Either group under 10 |
| Can't tell yet | Range includes zero, or adjusted p at or above the family threshold |
| Possibly better / Possibly worse | Range excludes zero and adjusted p passes, but a group is under 30 |
| Better / Worse | Range excludes zero, adjusted p passes, both groups 30 or more |

### 7.3 Intervals

Rates use the Wilson score interval at 95%. Differences use the Newcombe hybrid score interval at 95%. In matched comparisons the two versions share events, so the true interval is narrower and the displayed range errs wide, which is the safe direction. For example, 26 of 32 gives 64.7 to 91.1, and the lift over random days gives +26.9 to +56.1.

---

## 8. Copy

### 8.1 Rules

- One idea per sentence. Put the verdict first, then the numbers a person can picture, then what would settle it.
- Use the section 3 vocabulary on the surface.
- Sentence case everywhere. No uppercase labels and no small text above headings.
- Buttons say what happens: `Freeze v5`, `Restore v2`, `Promote v4`. Never `Submit` or `OK`.
- No exclamation marks, no intensifiers, no em or en dashes.

### 8.2 Question-row templates (Performance)

| Row | Answer templates |
|---|---|
| Still working lately? | `Can't tell yet. {n} cases in 90 days.` / `Yes, {r}% in the last 90 days.` / `Slipping: {r}% lately against {a}% overall.` |
| Score adds anything? | `Not that we can see.` / `Yes. Strong scores moved {a}%, Elevated {b}%.` |
| Which filters matter most? | `{A} and {B}.` / `{A}.` |
| Thresholds too tight? | `No sign of it.` / `Maybe {filter}. Near misses moved {r}%.` |
| One stock carrying it? | `No. The largest is {fraction} of cases.` / `Yes. {T} is {s}% of cases.` |
| Up or down? | `Mostly up, {u} of {h}.` / `Mostly down, {d} of {h}.` / `Split, {u} up and {d} down.` |
| By industry? | `Too few cases to compare.` / `{k} industries have enough cases.` |
| Data complete? | `Yes, all {n} events used.` / `{x} of {n} events used.` |
| Reviewer overrides? | `Not measured yet.` / `{k} of {n} names held back.` |

Use fractions a person says aloud: a quarter, a third, half.

---

## 9. Visuals

### 9.1 Plain bars (surface)

This is the only chart on the surface. It is a grid of a 200px label (a bold name over a muted count), a 10px track on `--surface-raised`, and the value at 18px. The fill is `--series-live` for live or the group under test, `--series-candidate` for a draft or trial, and `--series-baseline` for ordinary days. The axis always runs 0 to 100%, with no gridlines and no range marks. At most two bars per screen. The trial page uses the same component as a progress bar.

### 9.2 Inside details

- **Tables** are the default detail view: 13px, a header in `--ink-faint` over a 1px `--border-strong` rule, 1px `--border` row rules, mono numbers aligned right, and ranges in `--ink-faint`.
- **Results timeline** (trial): a 4px track with one 7px mark per result, placed on the day it resolved. A filled `--pos` mark means it moved, a `--neg` ring means it did not. Labelled `day 1` and `day 60`.
- **Interval chart** (dot plus range line) is optional inside details, for the rare case where overlap needs to be seen. It is never used on the surface.
- **Direction split**: a 320px two-part bar in `--pos` and `--neg`, the one place green and red appear outside outcome words.

### 9.3 Disclosure

- **Question row:** a native `<details>` with a 1px `--border` rule above. The summary is a grid of the question (500 weight), the answer (muted, right-aligned) and a 7px chevron drawn with two borders. 16px vertical padding. The detail area has 24px between blocks.
- **Link disclosure** (`Show the numbers`, `Show all 20 settings`): 13px `--info` text with a matching chevron and no rules.
- All disclosures are closed on load. Open state is not persisted. The one exception is the slice disclosure, which opens automatically while a slice is active.

---

## 10. Tokens

### 10.1 Palette

This replaces the `html[data-surface="lab"]` block now in `frontend/src/lab/lab.css`. Put it in `frontend/public/theme-override.css`, where analysis spec 2.3 placed the Lab palette. The token names match `tokens.css`, so product components inherit the palette.

```css
html[data-surface="lab"] {
  --bg: #f6f5f1;
  --surface: #ffffff;
  --surface-raised: #efeee9;
  --surface-sunken: #fbfaf7;
  --border: #e4e1d9;
  --border-strong: #cfcbc1;
  --ink: #1f1e1b;
  --ink-muted: #5f5c55;
  --ink-faint: #6e6a62;

  --info: #3b5b7e;
  --info-hover: #2f4a68;
  --info-active: #263d56;
  --pos: #2f6b45;
  --neg: #a14434;
  --warn: #8a5a00;
  --warn-fill: #f7eed8;

  --series-live: #1f1e1b;
  --series-candidate: #3b5b7e;
  --series-baseline: #8f8a7f;

  --lab-bar-bg: #1f1e1b;
  --lab-bar-ink: #f1efe9;
  --lab-bar-muted: #b8b4aa;

  --shadow: none;
}
```

The band tokens stay at the product values from `tokens.css`, since the surface is light again.

Measured contrast on `--bg`: ink 15.3, ink-muted 6.1, ink-faint 4.9, info 6.5, pos 5.8, neg 5.7, warn 5.4, warn on warn-fill 5.1. On the header: bar-ink 14.5, bar-muted 8.1. All text passes 4.5:1. `--series-baseline` is for bars only.

### 10.2 Structural tokens

Add to `tokens.css` `:root` (they are specified in `PRODUCT_DESIGN.md` 4.1 but missing from the file): `--s-7: 48px; --s-8: 64px;`

Lab-only, in `frontend/src/lab/lab.css`:

```css
html[data-surface="lab"] {
  --lab-fs-answer: 30px;
  --lab-measure: 880px;
  --lab-font-display: "Source Serif 4", Georgia, "Times New Roman", serif;
  --font-sans: "IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
}
```

### 10.3 Fonts

Self-host the WOFF2 files under `frontend/public/lab-fonts/` with `font-display: swap`. All three families are SIL OFL. The mockups load them from Google Fonts for convenience. The build must not, because an external font request from an admin page reveals the Lab to a third party.

| Family | Weights | Use |
|---|---|---|
| Source Serif 4 | 400, 500 | Titles, the answer sentence, version numbers, dialog headings |
| IBM Plex Sans | 400, 500, 600 | Everything else on the surface |
| IBM Plex Mono | 400 | Numbers in tables, tickers, ISO dates, numeric inputs |

### 10.4 Type scale

12 (footnotes, `live:` hints), 13 (tables, links, labels, buttons), 15 (body), 18 (section headings, bar values), 24 (dialog headings, version numbers), 30 (the answer), 32 (page titles). Line height is 1.6 for prose and 1.25 for the answer.

### 10.5 Radii and elevation

3px for labels, buttons and inputs. 6px for dialogs. No shadows anywhere.

---

## 11. Components

| Component | Spec |
|---|---|
| State label | 12px, 500 weight, 18px line height, 6px side padding, 3px radius, 1px border, sentence case. Live: ink fill, white text. On trial: `--info` text, `#b9c6d4` border. Draft, Frozen, Retired: muted text, `--border-strong`. Provisional, Paused: `--warn` on `--warn-fill`, `#e6d5ad` border |
| Primary button | 38px high, 18px side padding, ink fill, white text, 13px 500. At most one per screen |
| Secondary button | Same geometry, white fill, 1px `--border-strong` |
| Text button | `--info` text, no border. Used for Pause, Restore, Discard (muted) |
| Disabled | 45% opacity, with the reason in words beside it |
| Input | 34 to 36px, white, 1px `--border-strong`, 3px radius, mono 13px, numbers right-aligned. A changed input has a `--info` border. Focus: 2px `--info` outline |
| Settings row | Grid of a plain label, a 120px input and a 120px hint (`live: 10%` or `same as live`), 1px rules |
| Facts list | Two-column `dl`, `--ink-faint` terms, 13px |

---

## 12. Accessibility

Analysis spec section 7 applies. For these screens:

- Disclosures are native `<details>`/`<summary>`, so they are keyboard and screen-reader operable with no script.
- Each bar group has an `aria-label` that states every value and count.
- The answer sentence carries `role="status"` when it updates after a run.
- Changed inputs use `aria-describedby` to point at their `live:` hint.
- Result marks on the timeline have a text equivalent in `Latest results`.
- Dialogs trap focus and return it to the trigger.

---

## 13. Anti-patterns the build must avoid

1. Putting ranges, n, tables or breakdowns on the surface. They go behind a disclosure.
2. More than one chart or more than one primary button per screen.
3. Statistical terms in answers, summaries or buttons (lift, n=, CI, p, hit rate). They are allowed inside details.
4. Cards around content on the surface. Use rules and whitespace.
5. Accent bars or colored rules on the side or top of any element.
6. Dashed, dotted or hatched borders, including dotted tooltip underlines.
7. Small uppercase text above headings.
8. Pills. Every label and button is a 3px rectangle.
9. Gradients, glows, blur, glass and shadows.
10. Decorative sparklines, trend arrows and icons. The only glyphs are the disclosure chevron and the dialog close.
11. Red for errors or green for good. Green and red mean price outcome only.
12. Zeros, dashes or empty charts for strategies with no outcomes.
13. Spinners or pulsing skeletons.
14. One merged quality score per strategy (analysis spec 6.4). Filter evidence and score evidence stay separate, as two question rows.

---

## 14. Decisions to confirm

1. **Tested → Shadow gate:** blocked only by a confirmed loss on the holdout. Too few to compare lets the version through. Requiring a confirmed gain would block every draft at current sample sizes.
2. **One trial per strategy at a time.**
3. **Day-60 promotion still shows a one-click confirmation**, with no reason field.
4. **Vocabulary:** Shadow shows as "On trial", Tested as "Frozen", and roll back as "Restore". The data keeps the section 10 names. "Provisional" in the Lab means early-promoted only. The four empty strategies read "Collecting data".
5. **The pause reason minimum is 10 characters,** not 40, because pausing is often urgent.
6. **Seven more audit event types:** `draft_created`, `draft_discarded`, `frozen`, `holdout_checked`, `shadow_started`, `shadow_ended`, `provisional_cleared`.
7. **Strategies with no outcomes can go on trial.** Their holdout is empty, so the check records `No events to check`.
8. **Drafts autosave.** There is no Save button.
9. **The analysis spec's example interval for 26 of 32** should read 64.7 to 91.1 (Wilson), not 64.6 to 91.8.

## 15. Section 10 items that are hard to show honestly

- **The holdout is too small for Fast Mover drafts.** 48 held-back events hold about 8 passes per version, which is under the 10 floor. The check will almost always return Too few to compare, and under decision 1 that lets the draft through. The UI says exactly that rather than calling it a pass.
- **A 60-day trial may not reach 30 results.** At the backtest pass rate (0.3 a week) that is about 3 results. The 401-instrument live universe should produce more, but nothing measures it yet. If the live rate turns out close to the backtest rate, the Provisional label would stay for about two years. Consider tying the threshold to the measured rate.
- **Still working lately? (metric 8)** will read Can't tell yet for Fast Mover until more than earnings dates are collected.
- **Event type slicing has one value.** All 191 events are earnings dates.
