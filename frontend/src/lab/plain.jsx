/*
 * The Lab's plain-language layer (DESIGN_V6 §2, §7, §9).
 *
 * Everything here is additive: plain words beside technical ones, a term
 * tooltip, a panel head with "what / why / how to read", the glossary, the
 * intro panel and the "Start here" path. Nothing in this file changes data
 * or controls; main.jsx and Reports.jsx import from it so the two screens
 * share one dictionary.
 *
 *   LabUI            context: openGlossary(term, trigger), floors
 *   Term             click/focus tooltip on an abbreviated header or label
 *   Help             the old "?" popover, now built on Term
 *   PanelHead        .sec-head + plain label + collapsible explanation
 *   GlossaryDrawer   the right-hand glossary, Escape to close
 *   LabIntro         "What this lab is" + Start here
 *   StartHereList    the eight-step path, shared with the Walkthrough
 *   *_PLAIN maps     plain (technical) renderings of stored enumerations
 *   fmtRule/fmtBand  sentences for stored rule values; raw JSON stays behind
 *                    <RawValues>
 */
import React, {
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

// --------------------------------------------------------------------------
// Floors and shared context
// --------------------------------------------------------------------------

// Served by GET /api/admin/lab/strategies as `floors`; these literals are the
// fallback when the field is absent (app/lab.py MIN_GROUP_FLOOR etc.).
export const DEFAULT_FLOORS = { min_group: 10, small_sample: 30, min_instruments: 5 };

export const LabUI = createContext({
  openGlossary: () => {},
  floors: DEFAULT_FLOORS,
});

export function withFloors(f) {
  return { ...DEFAULT_FLOORS, ...(f || {}) };
}

export function floorsSentence(f) {
  const x = withFloors(f);
  return (
    `Under ${x.min_group} cases: no rate is shown. ` +
    `Under ${x.small_sample}: the rate is shown but counts as nothing. ` +
    `Fewer than ${x.min_instruments} different stocks: flagged. ` +
    "A difference needs p below 0.05 after the family adjustment."
  );
}

// --------------------------------------------------------------------------
// localStorage flags (per-browser conveniences only)
// --------------------------------------------------------------------------

export function readFlag(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeFlag(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private window: the flag just will not persist */
  }
}

export function useLocalFlag(key, fallback) {
  const [v, setV] = useState(() => {
    const s = readFlag(key);
    return s == null ? fallback : s === "1";
  });
  const set = (next) => {
    setV(next);
    writeFlag(key, next ? "1" : "0");
  };
  return [v, set];
}

// --------------------------------------------------------------------------
// Plain words beside stored enumerations: "plain (technical)"
// --------------------------------------------------------------------------

export const GRADE_PLAIN = {
  none: "no evidence yet",
  weak: "weak evidence",
  moderate: "moderate evidence",
  strong: "strong evidence",
};

export const STATUS_PLAIN = {
  hypothesis: "idea, untested",
  tested: "tested",
  held_up: "held up on new data",
  failed: "did not hold up",
  superseded: "replaced by a newer finding",
};

export const KIND_PLAIN = {
  filter: "a must-pass rule",
  weight: "an ingredient weight",
  band: "a rating cutoff",
  component: "an ingredient",
  other: "other",
};

export const RELATION_PLAIN = {
  supports: "backs it",
  contradicts: "argues against it",
  replicates: "repeats it on other data",
};

export const QUERY_STATUS_PLAIN = {
  running: "still running",
  completed: "finished",
  failed: "failed",
  cancelled: "cancelled",
};

export const EXCLUSION_PLAIN = {
  universe_filter: "outside your selection",
  data_incomplete: "a required input was missing",
};

export const SOURCE_STATUS_PLAIN = {
  ok: "ran clean",
  partial: "some symbols failed",
  failed: "the run failed",
  "never run": "has not run yet",
  "not built": "planned, not running",
};

export const VERSION_STATE_PLAIN = {
  draft: "editable",
  tested: "frozen",
  shadow: "on trial",
  live: "live",
  retired: "retired",
};

export function warnPlain(code, floors) {
  const f = withFloors(floors);
  switch (code) {
    case "GROUP_TOO_SMALL":
      return `too few cases to report a rate (under ${f.min_group})`;
    case "SMALL_SAMPLE":
      return `small sample (under ${f.small_sample}); rate is rough`;
    case "FEW_INSTRUMENTS":
      return `fewer than ${f.min_instruments} different stocks; may not generalise`;
    case "SYNTHETIC_DATA":
      return "made-up sandbox data; cannot be cited";
    case "ASSUMED_VERSION":
      return "some scores predate version tracking; exact rules unconfirmed";
    default:
      return null;
  }
}

/** "held up on new data (held_up)"; the stored value stays visible. */
export function plainTech(map, value) {
  if (value == null || value === "") return "—";
  const p = map[value];
  if (!p || p === value) return String(value);
  return `${p} (${value})`;
}

/** A warning badge with its plain text printed beside the code. */
export function WarnBadge({ w, floors }) {
  const plain = warnPlain(w.code, floors);
  return (
    <span className="warnline">
      <span className={`badge ${w.severity || "warn"}`} title={w.text}>{w.code}</span>
      {plain && <span className="warnline-text">{plain}</span>}
    </span>
  );
}

// --------------------------------------------------------------------------
// Sentences for stored rule values
// --------------------------------------------------------------------------

export function fmtNum(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return String(n);
  const abs = Math.abs(n);
  const f = (div, suffix) => `${Math.round((n / div) * 100) / 100}${suffix}`;
  if (abs >= 1e12) return f(1e12, "T");
  if (abs >= 1e9) return f(1e9, "B");
  if (abs >= 1e6) return f(1e6, "M");
  if (abs >= 1e4) return f(1e3, "k");
  return String(n);
}

const OPS = {
  ">": "more than",
  ">=": "at least",
  "<": "less than",
  "<=": "at most",
  "=": "exactly",
  "==": "exactly",
  "!=": "not",
  between: "between",
  in: "one of",
  not_in: "none of",
};

/** "between 300M and 3B USD", "more than 10% of float". null when the shape
 *  is unknown, so the caller can fall back to the raw value. */
export function fmtRule(op, value, unit) {
  const u = unit ? (unit.startsWith("%") ? unit : ` ${unit}`) : "";
  const withUnit = (v) => `${fmtNum(v)}${u}`;
  if (op === "between" && Array.isArray(value) && value.length === 2) {
    return `between ${fmtNum(value[0])} and ${withUnit(value[1])}`;
  }
  if ((op === "in" || op === "not_in") && Array.isArray(value)) {
    return `${OPS[op]} ${value.map(String).join(", ")}${unit ? ` (${unit})` : ""}`;
  }
  if (typeof value === "boolean") return value ? "must be true" : "must be false";
  if (op in OPS && (typeof value === "number" || typeof value === "string")) {
    return `${OPS[op]} ${withUnit(value)}`;
  }
  return null;
}

export const BAND_ORDER = ["strong", "elevated", "neutral", "weak"];

/** "score 72 and above" for a number, "score 40 to 51" for [lo, hi]. */
export function fmtBand(value) {
  if (typeof value === "number") return `score ${value} and above`;
  if (Array.isArray(value) && value.length === 2 && value.every((x) => typeof x === "number")) {
    return `score ${value[0]} to ${value[1]}`;
  }
  return null;
}

/** One stored value from a version diff, as words where the shape allows. */
export function fmtValue(v, kind) {
  if (v == null) return "not set";
  if (kind === "bands") return fmtBand(v) ?? null;
  if (kind === "weights" && typeof v === "number") return `weight ${v}`;
  if (typeof v === "object" && !Array.isArray(v) && "op" in v) {
    const s = fmtRule(v.op, v.value, v.unit);
    return s ? `${v.label || v.key || ""} ${s}`.trim() : null;
  }
  if (typeof v === "number" || typeof v === "string") return String(v);
  if (typeof v === "boolean") return v ? "yes" : "no";
  return null;
}

/** Raw JSON behind a toggle, with one sentence above it. */
export function RawValues({ data, sentence, label }) {
  return (
    <details className="rawjson">
      <summary>{label || "Show raw values"}</summary>
      <p className="rawjson-note">{sentence || "The stored value, exactly as the engine reads it."}</p>
      <pre className="mono rawjson-pre">{JSON.stringify(data, null, 2)}</pre>
    </details>
  );
}

// --------------------------------------------------------------------------
// The matched comparison spec (Versions): one source for the run and the
// sentence that discloses it.
// --------------------------------------------------------------------------

export const MATCHED_SPEC = {
  window: { from: null, to: null },
  event_kinds: ["earnings"],
  hit_definition: { price_move_pct: 20, volume_spike_x: 3, combine: "or", window: "tight" },
  baselines: ["all_events"],
};

const BASELINE_WORDS = { all_events: "all selected events", random_day: "random trading days" };

export function matchedSpecSentence(spec = MATCHED_SPEC) {
  const h = spec.hit_definition;
  return (
    `Runs both versions on every ${spec.event_kinds.join(" and ")} event in the sandbox, ` +
    `counting a hit as a ${h.price_move_pct}% move ${h.combine === "and" ? "and" : "or"} ` +
    `${h.volume_spike_x}× normal volume, with ${spec.baselines.map((b) => BASELINE_WORDS[b] || b).join(" and ")} ` +
    "as the baseline, and records both runs in the Log."
  );
}

export function matchedSpecShort(spec = MATCHED_SPEC) {
  const h = spec.hit_definition;
  return (
    `${spec.event_kinds.join(", ")} events, full universe, ` +
    `hit = ${h.price_move_pct}% move ${h.combine === "and" ? "and" : "or"} ${h.volume_spike_x}× volume, ` +
    `baseline ${spec.baselines.map((b) => BASELINE_WORDS[b] || b).join(" and ")}`
  );
}

// --------------------------------------------------------------------------
// Term tooltips
// --------------------------------------------------------------------------

// id → { text, g } where g names the glossary entry the "more" link opens.
export const TERMS = {
  rule: { text: "A must-pass rule (hard filter). A stock that fails it is out, whatever it scores.", g: "hard filter (must-pass rule)" },
  source: { text: "The data feed the rule reads, and how stale that feed is when the rule uses it (its vintage lag).", g: "vintage lag" },
  cov: { text: "Coverage: the share of test events where this input was actually present.", g: "coverage" },
  evidence: { text: "The best evidence grade from a finding that names this input. 'Never tested' means no finding names it yet.", g: "evidence grade" },
  component: { text: "An ingredient of the score. Its weight says how much it counts.", g: "component / weight" },
  declared: { text: "The weight the version says it uses, before any re-scaling for missing data.", g: "declared vs median effective weight" },
  median_eff: { text: "Median effective weight: the typical weight after missing inputs were dropped and the rest re-scaled to total 1.00. A big gap from 'declared' means the score is not doing what the recipe says.", g: "declared vs median effective weight" },
  band: { text: "The rating word subscribers see: strong, elevated, neutral or weak.", g: "band / band cutoffs" },
  cutoff: { text: "The score at which that word starts. A label, never a gate: it never excludes a stock.", g: "band / band cutoffs" },
  n: { text: "Number of cases (events) in the group.", g: "n / cases" },
  hits: { text: "How many cases moved sharply by the hit definition.", g: "hit / hit definition" },
  hit_rate: { text: "Hits divided by cases: how often the stock moved sharply by the hit definition.", g: "hit rate" },
  hit_rate_default: { text: "Hits divided by events, using the default hit definition: a 20% move or 3× normal volume.", g: "hit rate" },
  ci95: { text: "95% confidence interval: the range the true rate is likely in, by the Wilson score interval. Wider means less certain.", g: "95% CI (likely range)" },
  group: { text: "Stocks split by whether they passed every must-pass rule.", g: "backtest" },
  baseline: { text: "A comparison group: all events of the chosen kinds, or random trading days for the same stocks.", g: "baseline" },
  instruments: { text: "How many different stocks are in the group. Fewer than five may not generalise.", g: "instrument / ticker / symbol" },
  warnings: { text: "The floors and data caveats that apply to this row, as machine codes with their meaning beside them.", g: "warning codes" },
  difference: { text: "Pass-group hit rate minus the baseline hit rate, in percentage points.", g: "lift / difference" },
  test: { text: "Two-proportion z-test: the standard check for whether two rates differ.", g: "two-proportion z-test / p-value" },
  p: { text: "The chance of seeing a gap this big if nothing is going on. Below 0.05 counts.", g: "two-proportion z-test / p-value" },
  p_holm: { text: "p corrected for how many tests share the same family (line of inquiry) in the last 90 days.", g: "Holm adjustment / p (Holm)" },
  family: { text: "The line of inquiry this run belongs to, and how many earlier tests share it.", g: "family key (line of inquiry)" },
  family_key: { text: "A name you give repeated tests of one idea so the correction can count them.", g: "family key (line of inquiry)" },
  hypothesis: { text: "What you expected before running, stored with the run.", g: "hypothesis" },
  hash: { text: "A fingerprint of the run settings. Identical settings share one hash; a rerun is served from cache but still logged.", g: "spec hash / cached" },
  query_status: { text: "Whether the run finished, failed, was cancelled or is still running.", g: "query / query id" },
  query_id: { text: "One recorded run. Every cited number traces to a query id.", g: "query / query id" },
  by: { text: "The admin account that made the run." },
  at: { text: "When the run was recorded." },
  strategy: { text: "The recipe the run tested.", g: "strategy (lens)" },
  version: { text: "One numbered, frozen copy of a strategy's rules.", g: "version" },
  synthetic: { text: "Made-up sandbox rows. Every number from them is a rehearsal and cannot be cited.", g: "fixture / synthetic data" },
  complete: { text: "Events where every required input was present.", g: "provenance" },
  events: { text: "Dated moments for one stock: earnings, random day, FDA decision, contract award, SEC filing, macro.", g: "event / event kind" },
  industry: { text: "The industry the stock is filed under." },
  key: { text: "The setting's machine name, as stored." },
  before: { text: "The stored value in the earlier version." },
  after: { text: "The stored value in the later version." },
  // Reports
  feed: { text: "A data source: where a field comes from.", g: "data source (feed)" },
  provides: { text: "What the feed supplies: prices, market cap, short interest, event dates." },
  last_run: { text: "When the feed last fetched data." },
  result: { text: "How the last fetch ended: ran clean, some symbols failed, the run failed, or it has not run yet.", g: "data source (feed)" },
  rows: { text: "How many rows the feed has stored in total." },
  every: { text: "The refresh interval, in hours." },
  next: { text: "When the next fetch is due." },
  symbols_hist: { text: "How many stocks have at least one daily price bar stored." },
  bars: { text: "A bar is one trading day: open, high, low, close and volume, drawn as a candle.", g: "bar / daily bar / candle" },
  earliest: { text: "The date of the oldest bar stored." },
  latest: { text: "The date of the newest bar stored." },
  real_or_synthetic: { text: "Whether the rows are real recorded events or synthetic sandbox fixtures.", g: "fixture / synthetic data" },
  kind: { text: "The type of dated event: earnings, random day, FDA decision, contract award, SEC filing, macro.", g: "event / event kind" },
  count: { text: "How many events of that kind are recorded." },
  instruments_count: { text: "How many stocks the industry has in the universe.", g: "universe" },
  with_bars: { text: "Stocks in the industry that have price history stored." },
  real_events: { text: "Recorded events that are not synthetic fixtures.", g: "fixture / synthetic data" },
  bench_kind: { text: "Index, sector or macro benchmark.", g: "benchmark / sector benchmark" },
  last: { text: "Last close price." },
  chg30: { text: "Change in close over the last 30 calendar days." },
  chg90: { text: "Change in close over the last 90 calendar days." },
  bars_stored: { text: "How many daily bars are stored for this stock.", g: "bar / daily bar / candle" },
  latest_bar: { text: "The date of the newest bar. A missing recent bar means an outcome cannot resolve." },
  events_count: { text: "How many dated events are recorded for this stock.", g: "event / event kind" },
  sector_benchmark: { text: "The sector ETF this stock's move is judged against.", g: "benchmark / sector benchmark" },
};

const POP_WIDTH = 280;

/**
 * An inline term with a tooltip. Opens on click and on focus, closes on
 * Escape, outside click and scroll; the popover is position: fixed so it is
 * never clipped by a scrolling table, and it is right-aligned when it would
 * cross the right edge. `help` renders the round "?" button instead of the
 * dotted term.
 */
export function Term({ k, text, g, children, help, className }) {
  const def = k ? TERMS[k] : null;
  const body = text || def?.text || "";
  const glossaryTerm = g || def?.g || null;
  const { openGlossary } = useContext(LabUI);
  const id = useId();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const wrap = useRef(null);
  const btn = useRef(null);
  const pop = useRef(null);
  const focusedAt = useRef(0);
  const openedAt = useRef(0);

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const vw = window.innerWidth;
    let left = r.left;
    let flip = false;
    if (left + POP_WIDTH > vw - 12) {
      left = Math.max(8, r.right - POP_WIDTH);
      flip = true;
    }
    let top = r.bottom + 6;
    const h = pop.current ? pop.current.offsetHeight : 0;
    if (h && top + h > window.innerHeight - 8 && r.top - h - 6 > 0) top = r.top - h - 6;
    setPos({ left, top, flip });
  }, [open]);

  useEffect(() => {
    if (!open) {
      setPos(null);
      return undefined;
    }
    openedAt.current = Date.now();
    const onKey = (e) => {
      if (e.key === "Escape") {
        setOpen(false);
        btn.current?.focus();
      }
    };
    const onDown = (e) => {
      if (wrap.current && !wrap.current.contains(e.target)) setOpen(false);
    };
    const onScroll = () => {
      if (Date.now() - openedAt.current > 400) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  const onFocus = () => {
    focusedAt.current = Date.now();
    setOpen(true);
  };
  const onClick = () => {
    // A mouse click focuses first; do not let that click close what focus
    // just opened.
    if (Date.now() - focusedAt.current < 350) {
      setOpen(true);
      return;
    }
    setOpen((o) => !o);
  };
  // Keyboard: leaving the term (Tab) closes it. A null relatedTarget is a
  // click on something unfocusable, which the outside-click handler judges.
  const onBlur = (e) => {
    const next = e.relatedTarget;
    if (next && wrap.current && !wrap.current.contains(next)) setOpen(false);
  };

  return (
    <span
      className={`${help ? "labhelp" : "labterm"}${className ? ` ${className}` : ""}`}
      ref={wrap}
      onBlur={onBlur}
    >
      <button
        type="button"
        className={help ? "labhelp-btn" : "labterm-btn"}
        ref={btn}
        aria-label={help ? "What does this mean?" : undefined}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onFocus={onFocus}
        onClick={onClick}
      >
        {help ? "?" : children}
      </button>
      {open && (
        <span
          className={`labhelp-pop labterm-pop${pos?.flip ? " flip" : ""}`}
          id={id}
          role="tooltip"
          ref={pop}
          style={pos ? { left: pos.left, top: pos.top } : { visibility: "hidden" }}
        >
          {body}
          {glossaryTerm && (
            <>
              {" "}
              <button
                type="button"
                className="labterm-more"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setOpen(false);
                  openGlossary(glossaryTerm, btn.current);
                }}
              >
                more ›
              </button>
            </>
          )}
        </span>
      )}
    </span>
  );
}

export function Help({ text, g }) {
  return <Term help text={text} g={g} />;
}

// --------------------------------------------------------------------------
// Panel heads: technical title, plain label, "Explain" (what / why / how)
// --------------------------------------------------------------------------

// Copy per panel id (reader's report, drafts.panel_headers), lightly edited.
export const PANELS = {
  strategies: {
    plain: "the recipes",
    shows: "Every scoring strategy the product runs, its live version and whether its weights rest on measured results.",
    why: "Everything else in the Lab is about one of these.",
    read: "'Calibrated' means measured; 'provisional' means starting guesses. 'Outcomes' counts past alerts whose result is known.",
  },
  version: {
    plain: "which rule set you are looking at",
    shows: "The version subscribers are scored with today and the reason it was created.",
    why: "Every table below describes this version only.",
    read: "The amber note, when present, is the strategy's own caveat about its score.",
  },
  filters: {
    plain: "must-pass rules",
    shows: "Each rule a stock must satisfy, the data feed it reads, how often that feed was present, and whether a finding has ever tested it.",
    why: "A stock that fails one rule is out, whatever it scores; these rules carry most of the result.",
    read: "'Cov.' is the share of events where the input existed. 'Vintage lag' is how stale the feed is when used. 'Never tested' means no finding names it yet.",
  },
  components: {
    plain: "ingredients and how much each counts",
    shows: "Each ingredient of the score, the weight the version declares, and the weight it ended up with once missing inputs were dropped.",
    why: "If declared and effective weights differ a lot, the score is not doing what the recipe says.",
    read: "'Median eff.' is the typical re-scaled weight across events. A low 'Cov.' explains a big gap.",
  },
  bands: {
    plain: "the score thresholds behind the rating words",
    shows: "Where the score turns into strong, elevated, neutral or weak.",
    why: "Subscribers see the word, not the number; this is the only place the number lives.",
    read: "A cutoff is a label, never a gate: it never excludes a stock. Raw values are shown as stored.",
  },
  related: {
    plain: "what has been concluded about this strategy",
    shows: "Written claims about this strategy and the grade of evidence behind each.",
    why: "A rule with no finding has never been tested, whatever anyone remembers.",
    read: "Grade is computed from linked runs; status is where the claim is in its life.",
  },
  coverage_inputs: {
    plain: "how much history there is to test on",
    shows: "How many stocks and dated events are recorded, how many are complete, and how many per industry are synthetic.",
    why: "A test can only be as good as the history behind it.",
    read: "'Complete' means every required input was present. 'Synthetic' rows are sandbox fixtures and cannot be cited.",
  },
  oneline: {
    plain: "the server's own verdict",
    shows: "One sentence on the live version: working, not working, or can't tell yet, with the numbers that decide it.",
    why: "It is the shortest honest answer to 'does this strategy work?'",
    read: "'Working' needs 30 or more pass cases and a gap from ordinary days that chance would not explain. The note says when the data is synthetic.",
  },
  history: {
    plain: "every version, newest first",
    shows: "Each numbered rule set, when it took effect, why it was made and by whom.",
    why: "A result is only meaningful against the version that produced it.",
    read: "'In effect' is today's live version. Dates run from effective_from to effective_to or now.",
  },
  compare: {
    plain: "what changed between two rule sets",
    shows: "Setting-by-setting differences in rules, weights and cutoffs, then performance on one shared set of events.",
    why: "Two versions tested on different events will always 'differ'; only a matched comparison means anything.",
    read: "Before/after are the stored values. If no matched runs exist, the button runs both on the same events and records both in the Log.",
  },
  performance: {
    plain: "did the change help?",
    shows: "Hit rate, count and likely range for each version on the identical events, plus the difference and its p-value.",
    why: "This is the fairest answer the Lab can give about a change.",
    read: "Under 30 cases per side the difference is shown but counts as nothing. A gap counts only if p is below 0.05.",
  },
  diff: {
    plain: "the settings that differ",
    shows: "Each setting whose stored value changed between the two versions, before and after.",
    why: "A performance gap can only be attributed to what actually changed.",
    read: "Values are shown in words where the shape allows; the stored JSON is behind 'Show raw values'.",
  },
  step1: {
    plain: "which rule set",
    shows: "The versions available; default is the live one.",
    why: "A test is always of one specific rule set.",
    read: "Older versions run exactly as they stood then.",
  },
  step2: {
    plain: "the universe",
    shows: "Filters that narrow the stocks and dates: symbols, size band, internal group, theme pattern, date window, industries.",
    why: "Narrowing answers a sharper question with less data; the floors below decide if that is still an answer.",
    read: "Leave everything empty to use every stock the strategy can see. Size is in USD millions.",
  },
  step3: {
    plain: "the definition of 'moved sharply'",
    shows: "Which event kinds to include and the price and volume thresholds that count as a hit.",
    why: "Every rate on the result depends on this definition; change it and nothing is comparable.",
    read: "The sentence under the fields restates your rule in words.",
  },
  step4: {
    plain: "baselines",
    shows: "The comparison groups: all events of the chosen kinds, and random trading days for the same stocks.",
    why: "A 30% hit rate is only good if ordinary days do worse.",
    read: "Random trading days is the honest floor; all events shows whether the rules add anything beyond the event itself.",
  },
  step5: {
    plain: "your hypothesis and its line of inquiry",
    shows: "Optional text stored with the run, and a family key that groups repeated tests of one idea.",
    why: "Run five tests of one idea and one will look good by chance; the family key lets the maths correct for that.",
    read: "Fill this in if the result might become a finding.",
  },
  result: {
    plain: "what the test found",
    shows: "Hit rate per group with its likely range and warnings, the baselines, the pass-versus-baseline gap with raw and corrected p, and where the data came from.",
    why: "This is the only kind of number a finding may cite.",
    read: "Read the warnings first. Under 10 cases: no rate. Under 30: rough. Fewer than 5 stocks: may not generalise. The footer applies to every number.",
  },
  record: {
    plain: "write down a conclusion",
    shows: "Title, a claim that must contain a number and a data size, what kind of rule it is about, and the run ids that back it.",
    why: "A conclusion without a traceable run is a rumour.",
    read: "Status starts as 'tested'; the evidence grade is computed from the linked runs and cannot be typed.",
  },
  findings: {
    plain: "the ledger of conclusions",
    shows: "Every finding with its grade, status, kind, strategy and title; filters by strategy and status.",
    why: "A tested finding with no evidence stops the same dead end being explored again.",
    read: "Grade is strength (how much survived); status is process (where it is in its life).",
  },
  finding: {
    plain: "the claim and the runs behind it",
    shows: "The claim, its status, its grade, and each linked run with how it relates: backs it, argues against it, repeats it on other data.",
    why: "Linking or unlinking a run changes the grade immediately.",
    read: "'Replicates' is what lifts weak to strong.",
  },
  log: {
    plain: "every run anyone made",
    shows: "Each run's id, strategy, status, author, family, hypothesis, settings fingerprint and time.",
    why: "Every cited number must trace to a row here.",
    read: "Identical settings share a hash; a rerun is served from cache but still logged.",
  },
  // Reports
  reporting: {
    plain: "is the data behind the Lab healthy?",
    shows: "Four levels: the feeds, the stock universe, market benchmarks, one stock.",
    why: "A strategy result is only as good as the bars and events under it.",
    read: "Start at Sources; drill to Stock when a symbol looks wrong.",
  },
  sources: {
    plain: "the feeds",
    shows: "Each feed, what it supplies, when it last ran, how it ended, rows stored, refresh interval, next due.",
    why: "A stale or failed feed quietly makes every downstream number wrong.",
    read: "'Partial' means some symbols failed; 'not built' means the feed is planned, not running.",
  },
  coverage: {
    plain: "how much price history and how many events exist",
    shows: "Symbols with price history, daily bars, date span, and events by kind with their hit rate.",
    why: "Thin history means wide ranges and 'can't tell' verdicts.",
    read: "A bar is one trading day. Hit rate here uses the default definition: 20% move or 3× volume.",
  },
  universe: {
    plain: "which industries have usable data",
    shows: "Per industry: stocks, stocks with price bars, non-synthetic events, and symbols with no data.",
    why: "An industry with no real events cannot be tested honestly yet.",
    read: "Symbols with no data are usually delisted or renamed; they are kept visible on purpose.",
  },
  market: {
    plain: "the benchmarks",
    shows: "Index and sector ETFs with last close, 30- and 90-day change and bar count.",
    why: "A stock's move only means something against its sector.",
    read: "Click a row to chart it.",
  },
  chart: {
    plain: "one stock's price with its events",
    shows: "Candles with volume; circles mark recorded events, filled when the stock moved.",
    why: "Seeing the event on the chart is the fastest sanity check of a hit.",
    read: "Drag to pan, scroll to zoom; 3M/1Y/2Y set the range.",
  },
  health: {
    plain: "is this stock's data complete?",
    shows: "Bars stored, latest bar, events, sector benchmark and the last fetch error.",
    why: "A missing recent bar means the stock cannot resolve an outcome.",
    read: "An ingest error names the feed and the reason.",
  },
};

/**
 * Extends .sec-head: the technical title, a plain label beside it, and the
 * three explanation lines behind "Explain" (closed by default, remembered
 * per panel). `children` is the panel's existing one-line <p>; `actions`
 * keeps a button on the title row (the result card's "Cite this run").
 */
export function PanelHead({ id, title, plain, shows, why, read, actions, children, className }) {
  const copy = PANELS[id] || {};
  const p = plain ?? copy.plain;
  const s = shows ?? copy.shows;
  const w = why ?? copy.why;
  const r = read ?? copy.read;
  const [open, setOpen] = useLocalFlag(`lab_explain:${id}`, false);
  const bodyId = `explain-${id}`;
  const has = !!(s || w || r);
  return (
    <div className={`sec-head panelhead${className ? ` ${className}` : ""}`}>
      <div className="panelhead-row">
        <h3>{title}</h3>
        {p && <span className="panelhead-plain">{p}</span>}
        {has && (
          <button
            type="button"
            className="panelhead-toggle"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen(!open)}
          >
            {open ? "Hide" : "Explain"}
          </button>
        )}
        {actions && <span className="panelhead-actions">{actions}</span>}
      </div>
      {children}
      {has && open && (
        <dl className="panelhead-body" id={bodyId}>
          {s && <div><dt>What this shows</dt><dd>{s}</dd></div>}
          {w && <div><dt>Why it matters</dt><dd>{w}</dd></div>}
          {r && <div><dt>How to read it</dt><dd>{r}</dd></div>}
        </dl>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------
// Glossary
// --------------------------------------------------------------------------

export const GLOSSARY = [
  { term: "Lab", plain: "The admin-only workbench behind the strategies. Nothing here reaches subscribers." },
  { term: "strategy (lens)", plain: "A named recipe: must-pass rules plus weighted ingredients that produce a score and a rating word." },
  { term: "version", plain: "One numbered, frozen copy of a strategy's rules. Results are always about one version." },
  { term: "in effect / live", plain: "The version subscribers are scored with today." },
  { term: "draft, frozen (tested), on trial (shadow), live, retired", plain: "The life of a version: editable; locked; scored quietly beside live for 60 days; the one subscribers see; replaced. Stored as draft/tested/shadow/live/retired." },
  { term: "release / promote / roll back (restore)", plain: "Make a trial version live; put a retired version back. Each writes an audit row with a 40-character reason." },
  { term: "hard filter (must-pass rule)", plain: "A rule a stock must satisfy or it is excluded, whatever it scores." },
  { term: "component / weight", plain: "An ingredient of the score and how much it counts; weights total 1.00." },
  { term: "declared vs median effective weight", plain: "The weight the recipe says, and the typical weight after missing inputs were dropped and the rest re-scaled." },
  { term: "coverage", plain: "The share of events where an input was actually present." },
  { term: "band / band cutoffs", plain: "The rating word (strong, elevated, neutral, weak) and the score thresholds that assign it. A label, never a gate." },
  { term: "score / shrinkage", plain: "The 0-100 composite; shrinkage pulls it toward neutral (40) in proportion to missing inputs." },
  { term: "haircut", plain: "A documented manual deduction from a score, recorded in haircut_json." },
  { term: "calibrated / provisional", plain: "Weights backed by measured outcomes / starting guesses not yet measured." },
  { term: "resolved outcome", plain: "A past alert whose result is now known." },
  { term: "vintage lag", plain: "How stale a data feed is when a rule reads it (FINRA short interest: 11 days). Ignoring it is lookahead bias." },
  { term: "untagged at ingest", plain: "The feed was not recorded when the data was loaded, so its lag is unknown." },
  { term: "event / event kind", plain: "A dated moment for one stock: earnings, random day, FDA decision, contract award, SEC filing, macro. Only earnings and random days exist in the sandbox." },
  { term: "fixture / synthetic data", plain: "Made-up sandbox rows seeded by db/seed_lab.py. Every number from them is a rehearsal and cannot be cited." },
  { term: "universe", plain: "The set of stocks and dates a test looks at. Empty filters mean every stock the strategy can see." },
  { term: "instrument / ticker / symbol", plain: "A stock in the universe, its exchange code, and that code as text." },
  { term: "instrument group", plain: "An internal list a stock belongs to (default Scan)." },
  { term: "theme regex", plain: "A text pattern matched against a stock's theme tag, e.g. uranium|nuclear." },
  { term: "market cap band", plain: "A company-size range; the stored field is USD millions." },
  { term: "window", plain: "The date range of events in a test." },
  { term: "hit / hit definition", plain: "'Moved sharply': by default a 20% move or 3× normal volume inside a tight window after the event." },
  { term: "hit rate", plain: "Hits divided by cases." },
  { term: "n / cases", plain: "How many events are in a group." },
  { term: "95% CI (likely range)", plain: "The range the true rate is likely in, by the Wilson score interval." },
  { term: "baseline", plain: "A comparison group: all events of the chosen kinds, or random trading days for the same stocks." },
  { term: "lift / difference", plain: "Pass-group hit rate minus the baseline hit rate, in percentage points." },
  { term: "two-proportion z-test / p-value", plain: "The standard check for whether two rates differ; p is the chance of a gap this big if nothing is going on." },
  { term: "Holm adjustment / p (Holm)", plain: "p corrected for how many tests share the same line of inquiry in the last 90 days." },
  { term: "family key (line of inquiry)", plain: "A name you give repeated tests of one idea so the correction can count them." },
  { term: "hypothesis", plain: "What you expected before running, stored with the run." },
  { term: "backtest", plain: "Running a version's rules over recorded events and counting hits against baselines." },
  { term: "query / query id", plain: "One recorded run. Every cited number traces to a query id." },
  { term: "audit log", plain: "Every run, in order, with author, settings fingerprint and status." },
  { term: "spec hash / cached", plain: "A fingerprint of the run settings; identical settings return the earlier result but still log a new row." },
  { term: "provenance", plain: "What went into a run: events in scope, exclusions, sources, synthetic flag, assumed-version count." },
  { term: "universe_filter / data_incomplete", plain: "Excluded because outside your selection / because a required input was missing." },
  { term: "assumed version", plain: "A score made before version tracking; the exact rules behind it cannot be confirmed." },
  { term: "floors (10 / 30 / 5)", plain: "Under 10 cases: no rate is reported. Under 30: shown but counts as nothing. Fewer than 5 distinct stocks: may not generalise." },
  { term: "warning codes", plain: "GROUP_TOO_SMALL, SMALL_SAMPLE, FEW_INSTRUMENTS, SYNTHETIC_DATA, ASSUMED_VERSION: the floors and data caveats, in machine form." },
  { term: "finding", plain: "A written conclusion: a claim with a number and a data size, linked to the runs that back it." },
  { term: "claim kind", plain: "What the claim is about: a must-pass rule, an ingredient weight, a rating cutoff, an ingredient, other." },
  { term: "status (finding)", plain: "hypothesis = idea, untested; tested; held_up = survived new data; failed; superseded = replaced." },
  { term: "evidence grade", plain: "Computed strength: none, weak, moderate, strong. Weak needs one supporting run with adjusted p < 0.05 or a range excluding zero; strong needs replication." },
  { term: "relation (supports / contradicts / replicates)", plain: "How a linked run bears on the claim: backs it, argues against it, repeats it on other data." },
  { term: "cite", plain: "Attach a run to a finding as its evidence." },
  { term: "matched comparison", plain: "Two versions run on the identical events with the identical hit definition; the only fair way to compare them." },
  { term: "holdout", plain: "The newest 25% of event dates, hidden from a draft and used once to check it before a trial." },
  { term: "trial (shadow)", plain: "Sixty days of scoring beside the live version without reaching subscribers." },
  { term: "provisional label (early promotion)", plain: "A version made live before day 60; the label clears at 30 live results." },
  { term: "publishing pause", plain: "Scoring continues but subscribers keep seeing the last published run." },
  { term: "regression", plain: "A model (logistic for yes/no hits, OLS for move size) of which inputs relate to outcomes; guarded by events-per-predictor, VIF, a time holdout and the family correction." },
  { term: "bar / daily bar / candle", plain: "One trading day's open, high, low, close and volume, drawn as a candle." },
  { term: "benchmark / sector benchmark", plain: "An index or sector ETF a stock's move is judged against." },
  { term: "data source (feed)", plain: "Where a field comes from: yfinance for prices and market cap, FINRA biweekly for short interest." },
  { term: "throughput", plain: "How many stocks pass all rules per week; tightening rules raises hit rate by shrinking this." },
  { term: "concentration", plain: "Whether one stock supplies most of the hits." },
  { term: "near miss / attribution", plain: "Stocks that failed one rule narrowly; and hit rate with each rule removed, to see which rules carry the result." },
];

export function GlossaryDrawer({ open, term, onClose }) {
  const [q, setQ] = useState("");
  const closeBtn = useRef(null);
  const list = useRef(null);

  useEffect(() => {
    if (open) {
      setQ("");
      closeBtn.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !term || !list.current) return;
    const el = Array.from(list.current.querySelectorAll("[data-term]"))
      .find((n) => n.getAttribute("data-term") === term);
    el?.scrollIntoView({ block: "center" });
  }, [open, term, q]);

  if (!open) return null;
  const ql = q.trim().toLowerCase();
  const items = GLOSSARY.filter(
    (g) => !ql || g.term.toLowerCase().includes(ql) || g.plain.toLowerCase().includes(ql),
  );
  return (
    <aside className="labglossary" role="dialog" aria-label="Glossary">
      <div className="labglossary-head">
        <h2>Glossary</h2>
        <button ref={closeBtn} type="button" className="btn" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="labglossary-lead">
        Plain words for the Lab's terms, in the order you meet them. Escape closes this.
      </p>
      <input
        className="labglossary-search"
        type="search"
        placeholder="Find a term"
        aria-label="Find a term"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <dl className="labglossary-list" ref={list}>
        {items.length === 0 && <p className="muted">No term matches.</p>}
        {items.map((g) => (
          <div key={g.term} data-term={g.term} className={g.term === term ? "hit" : undefined}>
            <dt>{g.term}</dt>
            <dd>{g.plain}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}

// --------------------------------------------------------------------------
// "What this lab is" and the Start-here path
// --------------------------------------------------------------------------

export const START_HERE = [
  { n: 1, label: "Strategies", screen: "strategies",
    do: "Read one card. Note the version, the calibrated/provisional word, and how many outcomes have resolved." },
  { n: 2, label: "Inputs", screen: "inputs", strat: true,
    do: "Learn the vocabulary: must-pass rules (hard filters), ingredients and their weights (components), rating cutoffs (bands). This screen describes; it never judges." },
  { n: 3, label: "Reports › Sources", screen: "reports",
    do: "See where the data comes from, when it last ran, and that today's events are synthetic. Then open Stock, type SPY, and look at a chart with event markers." },
  { n: 4, label: "Backtest", screen: "backtest", strat: true,
    do: "Run it with the defaults. Read the pass group against the two baselines, open the warnings, then open Provenance to see what was excluded." },
  { n: 5, label: "Findings", screen: "findings",
    do: "Read the three seeded findings. Notice status and evidence grade are separate: a tested finding with no evidence is a valuable record." },
  { n: 6, label: "Versions", screen: "versions", strat: true,
    do: "Compare the two most recent versions. Understand why a performance comparison is only offered on the same events." },
  { n: 7, label: "Log", screen: "log",
    do: "Find the run you just made. Every number anyone ever cites must trace back to a row here." },
  { n: 8, label: "Glossary", glossary: true,
    do: "Skim the terms once; come back to them from any tooltip's 'more' link." },
];

export function StartHereList({ onGo }) {
  return (
    <ol className="starthere">
      {START_HERE.map((s) => (
        <li key={s.n}>
          <button type="button" className="starthere-go" onClick={() => onGo(s)}>
            {s.label}
          </button>
          <span className="starthere-do">{s.do}</span>
        </li>
      ))}
    </ol>
  );
}

export function LabIntro({ onDismiss, onGo }) {
  return (
    <section className="card labintro" aria-labelledby="labintro-title">
      <div className="sec-head panelhead">
        <div className="panelhead-row">
          <h3 id="labintro-title">What this lab is</h3>
          <span className="panelhead-plain">read once, two minutes</span>
          <span className="panelhead-actions">
            <button type="button" className="btn" onClick={onDismiss}>
              Got it, hide this
            </button>
          </span>
        </div>
      </div>
      <div className="labintro-body">
        <p>
          tradealert.me scores stocks every morning with a handful of named strategies:
          recipes made of must-pass rules and weighted ingredients. The Lab is the workbench
          behind those recipes. It shows what each one does, tests a recipe against recorded
          history, keeps a ledger of what the tests showed, and records every run so nothing
          can be cited that cannot be traced. Nothing here reaches subscribers.
        </p>
        <p>
          Right now the history it tests on is a sandbox set of synthetic (made-up) events,
          so every number is a rehearsal, not evidence; the amber banners say so.
        </p>
        <dl className="labintro-ideas">
          <div>
            <dt>Strategy</dt>
            <dd>Must-pass rules plus weighted ingredients, kept in numbered versions.</dd>
          </div>
          <div>
            <dt>Backtest</dt>
            <dd>Of the stocks that passed the rules, how often did they then move sharply, compared with ordinary days?</dd>
          </div>
          <div>
            <dt>Finding</dt>
            <dd>A sentence with a number in it, linked to the runs that back it.</dd>
          </div>
        </dl>
        <h4 className="labintro-start">Start here</h4>
        <StartHereList onGo={onGo} />
      </div>
    </section>
  );
}
