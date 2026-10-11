import { coverage } from "./fmt.js";
import { GLOSSARY, PLAIN_COMPONENT, TRIGGER_PLAIN } from "./glossary.js";
import { TRIGGERS } from "./evidence.js";

// Plain-English sentences built from the engine's own fields. Every sentence
// states a recorded fact (PRODUCT_DESIGN §2): the score, its rating word,
// how many inputs had data, whether missing data pulled it toward neutral,
// which must-pass rules failed. None of them says what the price will do,
// and none of them quotes a weight: the API orders inputs by rank.

// The button vocabulary (DESIGN_V6 §2: a button is a request from me to the
// product, four words or fewer where possible). One map so every screen and
// toast asks in the same words; nothing here is a product-internal noun
// (no pick, arm, disarm, drop or pin in user-facing text, aria included).
export const CTA = {
  ALERT_ME: "Alert me",
  ALERTING: "Alerting me",
  MY_ALERTS: "My alerts",
  ALERT_ME_ON: (sym) => `Alert me on ${sym}`,
  ALERT_ME_BEFORE: (sym) => `Alert me before ${sym}`,
  WATCH: "Watch",
  WATCHING: "Watching",
  WATCH_FOR_ME: "Watch this for me",
  WATCH_SYM_FOR_ME: (sym) => `Watch ${sym} for me`,
  STOP_WATCHING: "Stop watching",
  STOP_WATCHING_SYM: (sym) => `Stop watching ${sym}`,
  MY_WATCHLIST: "My watchlist",
  SHOW_PLANS: "Show me every plan",
  NEXT_PLAN: "Show me the next plan",
  PLANS_WITH_ALERTS: "Show me plans with alerts",
  REPORT: "Show me the report",
  RECORD: "Show me the record",
  BOARD: "Show me the Board",
  CHECKOUT: "Take me to checkout",
  SWITCH_NOW: "Switch me now",
  START_ON: (plan) => `Start me on ${plan}`,
  MOVE_TO: (plan) => `Move me to ${plan}`,
  MOVE_DOWN_TO: (plan) => `Move me down to ${plan}`,
  MY_PLAN: "My plan",
  OPEN_HOME: "Open my Home",
  START_FREE: "Start free",
  SEND_BRIEF: "Send me the brief",
  SHOW_ALL: (n) => `Show all ${n}`,
  SHOW_FEWER: "Show fewer",
  TOUR_AGAIN: "Show me the tour again",
};

// The jargon table (DESIGN_V6 §7): the plain phrase shown first outside Full
// mode; the technical word may follow in parentheses at most once a screen.
// plainWord("band") → "rating"; plainWord("band", true) → "rating (band)".
export const PLAIN_WORD = {
  band: "rating",
  coverage: "how much data the score had",
  shrinkage: "pulled toward neutral for missing data",
  lens: "strategy",
  calibrated: "has a measured record",
  provisional: "no measured record yet",
  hard_filter: "must-pass rule",
  run: "this morning's scoring",
  last_run: "the last scoring",
  stage_early: "no date set yet",
  stage_event: "a date is set",
  catalyst: "a dated event",
  short_interest: "short interest: the share of the float sold short",
  borrow_fee_2x: "the cost to borrow the stock doubled",
  universe: "the names in your industries and your watchlist",
  pin: "watch",
  arm: "turn on",
  trigger: "fact",
};

const TECH_WORD = {
  band: "band",
  coverage: "coverage",
  shrinkage: "shrinkage",
  lens: "lens",
  calibrated: "calibrated",
  provisional: "provisional",
  hard_filter: "hard filter",
  run: "run",
  last_run: "run",
  stage_early: "early stage",
  stage_event: "event stage",
  catalyst: "catalyst",
  short_interest: "SI",
  borrow_fee_2x: "borrow fee 2x",
  universe: "universe",
  pin: "pin",
  arm: "arm",
  trigger: "trigger",
};

export function plainWord(key, withTech = false) {
  const plain = PLAIN_WORD[key];
  if (!plain) return key;
  return withTech && TECH_WORD[key] ? `${plain} (${TECH_WORD[key]})` : plain;
}

const BAND_PHRASE = {
  strong: "near the top of the strategy's range this morning",
  elevated: "above the strategy's usual range",
  neutral: "inside the usual range, so nothing stands out",
  weak: "below the usual range",
  excluded: "set aside",
};

export function bandPhrase(band) {
  return BAND_PHRASE[band] || "";
}

export function bandWord(band) {
  const g = GLOSSARY[band];
  return g ? g.term : band ? band.charAt(0).toUpperCase() + band.slice(1) : "";
}

function filterName(f) {
  return f.label || f.name || f.key || "a must-pass rule";
}

// { headline, detail[] } for a score object as the dossier and board carry it:
// { value, band, components_present, components_total, shrinkage_applied,
//   shrinkage_from, hard_filters:[{key,label,pass}], haircuts:[{label,points}] }
export function verdict(score, strategy, symbol) {
  const sym = symbol || "This name";
  const stratLabel = strategy ? strategy.label : "this strategy";
  if (!score || (score.value == null && score.band !== "excluded")) {
    return { headline: `No score for ${sym} this morning.`, detail: ["The engine had no inputs for it yet."] };
  }
  const detail = [];
  const failed = (score.hard_filters || []).filter((f) => f.pass === false);
  if (score.band === "excluded") {
    const why = failed.length
      ? `it failed ${failed.length === 1 ? "a must-pass rule" : `${failed.length} must-pass rules`} (${failed.map(filterName).join(", ")})`
      : "it carries a penalty large enough to set it aside";
    return {
      headline: `${sym} is set aside on ${stratLabel} because ${why}.`,
      detail: ["A name set aside is not rated, whatever its other inputs say."],
    };
  }
  const n = Math.round(score.value);
  const cov = coverage(score.components_present, score.components_total);
  const approx = cov.state === "thin" ? "about " : "";
  const headline = `${sym} scores ${approx}${n} on the 0 to 100 ${stratLabel} scale, ${bandPhrase(score.band)}.`;
  if (score.components_total) {
    if (cov.state === "full") detail.push(`All ${score.components_total} inputs had data.`);
    else detail.push(`${score.components_present} of ${score.components_total} inputs had data${cov.state === "thin" ? ", so read the number as approximate" : ""}.`);
  }
  if (score.shrinkage_applied != null && Math.abs(score.shrinkage_applied) >= 0.5) {
    const from = Math.round(score.shrinkage_from != null ? score.shrinkage_from : score.value + score.shrinkage_applied);
    detail.push(`Missing data pulled it toward neutral, from ${from} to ${n}.`);
  }
  if (score.haircuts && score.haircuts.length) {
    const pts = score.haircuts.reduce((a, h) => a + Math.abs(Number(h.points) || 0), 0);
    detail.push(`${Math.round(pts)} points were taken off for ${score.haircuts.map((h) => h.label || h.key).join(", ")}.`);
  }
  if (failed.length) {
    detail.push(`Flagged FAIL on ${failed.length === 1 ? "a must-pass rule" : `${failed.length} must-pass rules`} (${failed.map(filterName).join(", ")}) and still rated.`);
  }
  const status = strategy && strategy.plain ? strategy.plain.status : strategy && strategy.calibrated === false ? "provisional" : null;
  if (status === "provisional") {
    detail.push(`${stratLabel} has no measured record yet, so treat this as a candidate.`);
  }
  return { headline, detail };
}

// An input's plain name: the PLAIN_COMPONENT phrase for its key, else the
// label the engine stored.
export function inputName(c) {
  if (!c) return "";
  return PLAIN_COMPONENT[c.key] || c.label || c.key;
}

// Rank as the API sends it (1 did most to lift the score). Older payloads
// without a rank fall back to the input's own 0-1 score.
function byRank(a, b) {
  const ra = a.rank != null ? a.rank : Infinity;
  const rb = b.rank != null ? b.rank : Infinity;
  if (ra !== rb) return ra - rb;
  return (b.score ?? 0) - (a.score ?? 0);
}


// Inputs that scored below the halfway mark of their 0-1 scale: they weighed
// on the number rather than lifting it.
export function heldBackInputs(components, n = 2) {
  return [...(components || [])]
    .filter((c) => c.score != null && c.backed !== false && Number(c.score) < 0.5)
    .sort((a, b) => Number(a.score) - Number(b.score))
    .slice(0, n)
    .map(inputName);
}

export function missingInputs(components) {
  return (components || []).filter((c) => c.score == null || c.backed === false).map(inputName);
}


export function list(items) {
  const a = items.filter(Boolean);
  if (a.length <= 1) return a.join("");
  if (a.length === 2) return `${a[0]} and ${a[1]}`;
  return `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`;
}

// Plain change line for a since-the-last-scoring value ("run" stays a Full-mode word).
export function changeSentence(delta, band, prevBand) {
  if (delta == null) return "New on the board this morning.";
  const r = Math.round(delta);
  if (r === 0) return "Unchanged since the last scoring.";
  const dir = r > 0 ? "up" : "down";
  const move = `${dir} ${Math.abs(r)} point${Math.abs(r) === 1 ? "" : "s"} since the last scoring`;
  if (prevBand && band && prevBand !== band) return `${capital(move)}, from ${prevBand} to ${band}.`;
  return `${capital(move)}.`;
}

// What an alert trigger will tell you, as a full sentence.
export function triggerSentence(key, symbol) {
  const t = TRIGGER_PLAIN[key];
  if (!t) return `We will tell you when ${key} fires${symbol ? ` on ${symbol}` : ""}.`;
  return `We will tell you when ${t[1]}${symbol ? ` on ${symbol}` : ""}.`;
}

// What a sent alert told you, as a full sentence in the past tense.
export function firedSentence(key, symbol) {
  const t = TRIGGER_PLAIN[key];
  const on = symbol ? ` on ${symbol}` : "";
  if (!t || !t[2]) return `This fired${on}: ${t ? t[0].toLowerCase() : key}.`;
  return `This fired${on} because ${t[2]}.`;
}

export function triggerLabel(key) {
  const t = TRIGGER_PLAIN[key];
  return t ? t[0] : key;
}

// The plain label for a trigger when only the engine's own label is known
// (the public pulse carries no key): "S-3 or 424B filing" → "A share-sale
// filing". Unknown labels pass through unchanged.
export function plainTriggerFromLabel(label) {
  if (!label) return label;
  const hit = TRIGGERS.find(([, l]) => l === label);
  return hit && TRIGGER_PLAIN[hit[0]] ? TRIGGER_PLAIN[hit[0]][0] : label;
}

// A measured rate as a percentage with one decimal, truncated rather than
// rounded so a record is never restated more favourably than its source
// (DESIGN_V5 §2): 26 of 32 reads 81.2, as published.
export function ratePct(hits, n) {
  if (!n) return null;
  return Math.floor((hits / n) * 1000) / 10;
}

// The record sentence for an industry's month, from /api/industries[].month:
// measured from the alert record, written only when there is enough of it.
export function firesSentence(month, min = 10) {
  if (!month || !month.fired || month.fired < min) return "Too few alerts here yet to say what tends to fire.";
  const top = (month.top_triggers || []).slice(0, 2).map((t) => triggerLabel(t.key).toLowerCase());
  const days = month.days || 30;
  if (!top.length) return `${month.fired} alerts in the last ${days} days.`;
  return `What tends to fire here: ${list(top)} (${month.fired} alerts in the last ${days} days).`;
}

// One suggested next step for a name, given what the subscriber already did.
export function nextStep({ pinned, armed, band, verified, alertsLimit, armedKeys }) {
  if (!pinned) return { text: "Watch it to keep it in view and in your weekly brief.", kind: "pin" };
  const canAlert = alertsLimit !== 0 && verified !== false;
  if (!armed && canAlert) return { text: "Turn on alerts so you hear the moment something changes.", kind: "notify" };
  if (band === "strong" || band === "elevated") return { text: "Read the Why section before you rely on the number: it lists the inputs behind it.", kind: "why" };
  if (!canAlert) return { text: "Nothing to do. Your weekly brief carries its latest rating word.", kind: "wait" };
  // Unknown rules (still loading): say only what is always true.
  if (!armedKeys) return { text: "Nothing to do. We keep watching; your weekly brief carries its latest rating word.", kind: "wait" };
  if (!armedKeys.has("band_change")) return { text: "Nothing to do. Add 'the rating word changes' to your alerts if you want to hear when it moves.", kind: "wait" };
  return { text: "Nothing to do. We keep watching and will tell you when its rating word changes.", kind: "wait" };
}

export function wordCount(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean).length;
}

// The first sentence of a paragraph when the whole would run past the
// fourteen-word cap a card or a screen head is held to (DESIGN_V6 §2).
export function firstSentence(text, max = 14) {
  const t = String(text || "").trim();
  if (!t || wordCount(t) <= max) return t;
  const m = t.match(/^[^.!?]+[.!?]/);
  return m && wordCount(m[0]) <= max ? m[0].trim() : t;
}

function capital(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
