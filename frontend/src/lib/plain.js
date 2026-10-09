import { coverage } from "./fmt.js";
import { GLOSSARY, TRIGGER_PLAIN } from "./glossary.js";

// Plain-English sentences built from the engine's own fields. Every sentence
// states a recorded fact (PRODUCT_DESIGN §2): the score, its band, how many
// inputs had data, whether shrinkage moved it, which filters failed. None of
// them says what the price will do.

const BAND_PHRASE = {
  strong: "near the top of the strategy's range this run",
  elevated: "above the strategy's typical range",
  neutral: "inside the typical range, so nothing stands out",
  weak: "below the typical range",
  excluded: "excluded",
};

export function bandPhrase(band) {
  return BAND_PHRASE[band] || "";
}

export function bandWord(band) {
  const g = GLOSSARY[band];
  return g ? g.term : band ? band.charAt(0).toUpperCase() + band.slice(1) : "";
}

function filterName(f) {
  return f.label || f.name || f.key || "a hard filter";
}

// { headline, detail[] } for a score object as the dossier and board carry it:
// { value, band, components_present, components_total, shrinkage_applied,
//   shrinkage_from, hard_filters:[{key,label,pass}], haircuts:[{label,points}] }
export function verdict(score, strategy, symbol) {
  const sym = symbol || "This name";
  const stratLabel = strategy ? strategy.label : "this strategy";
  if (!score || (score.value == null && score.band !== "excluded")) {
    return { headline: `No score for ${sym} on this run.`, detail: ["The engine had no inputs for it yet."] };
  }
  const detail = [];
  const failed = (score.hard_filters || []).filter((f) => f.pass === false);
  if (score.band === "excluded") {
    const why = failed.length
      ? `it failed ${failed.length === 1 ? "a hard filter" : `${failed.length} hard filters`} (${failed.map(filterName).join(", ")})`
      : "it carries a disqualifying haircut";
    return {
      headline: `${sym} is excluded on ${stratLabel} because ${why}.`,
      detail: ["Excluded names are not scored, whatever their other inputs say."],
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
    detail.push(`Missing data pulled it toward a neutral 40, from ${from} to ${n}.`);
  }
  if (score.haircuts && score.haircuts.length) {
    const pts = score.haircuts.reduce((a, h) => a + Math.abs(Number(h.points) || 0), 0);
    detail.push(`${Math.round(pts)} points were taken off for ${score.haircuts.map((h) => h.label || h.key).join(", ")}.`);
  }
  if (strategy && strategy.calibrated === false) {
    detail.push(`${stratLabel} is provisional, so this is a candidate rather than a signal.`);
  }
  return { headline, detail };
}

// The inputs that did most to lift the score, by name, for a "Why" line.
export function topInputs(components, n = 3) {
  return [...(components || [])]
    .filter((c) => c.score != null && c.weight != null && c.backed !== false)
    .sort((a, b) => b.score * b.weight - a.score * a.weight)
    .slice(0, n)
    .map((c) => c.label || c.key);
}

export function missingInputs(components) {
  return (components || []).filter((c) => c.score == null || c.backed === false).map((c) => c.label || c.key);
}

export function whySentence(components) {
  const top = topInputs(components);
  const missing = missingInputs(components);
  const parts = [];
  if (top.length) parts.push(`Driven mostly by ${list(top)}.`);
  if (missing.length) parts.push(`No data yet for ${list(missing)}.`);
  return parts.join(" ");
}

export function list(items) {
  const a = items.filter(Boolean);
  if (a.length <= 1) return a.join("");
  if (a.length === 2) return `${a[0]} and ${a[1]}`;
  return `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`;
}

// Plain change line for a Δ run value.
export function changeSentence(delta, band, prevBand) {
  if (delta == null) return "New on the board this run.";
  const r = Math.round(delta);
  if (r === 0) return "Unchanged since the last run.";
  const dir = r > 0 ? "up" : "down";
  const move = `${dir} ${Math.abs(r)} point${Math.abs(r) === 1 ? "" : "s"} since the last run`;
  if (prevBand && band && prevBand !== band) return `${capital(move)}, from ${prevBand} to ${band}.`;
  return `${capital(move)}.`;
}

// What an alert trigger will tell you, as a full sentence.
export function triggerSentence(key, symbol) {
  const t = TRIGGER_PLAIN[key];
  if (!t) return `We will tell you when ${key} fires${symbol ? ` on ${symbol}` : ""}.`;
  return `We will tell you when ${t[1]}${symbol ? ` on ${symbol}` : ""}.`;
}

export function triggerLabel(key) {
  const t = TRIGGER_PLAIN[key];
  return t ? t[0] : key;
}

// One suggested next step for a name, given what the subscriber already did.
export function nextStep({ pinned, armed, band, verified, alertsLimit, armedKeys }) {
  if (!pinned) return { text: "Pin it to keep it in view and in your digest.", kind: "pin" };
  const canAlert = alertsLimit !== 0 && verified !== false;
  if (!armed && canAlert) return { text: "Turn on alerts so you hear the moment something changes.", kind: "notify" };
  if (band === "strong" || band === "elevated") return { text: "Read the Why section before you rely on the number: it lists the inputs behind it.", kind: "why" };
  if (!canAlert) return { text: "Nothing to do. Your digest carries its latest band.", kind: "wait" };
  const hasBand = armedKeys ? armedKeys.has("band_change") : false;
  if (!hasBand) return { text: "Nothing to do. Add the 'Score changes band' trigger if you want to hear when it moves band.", kind: "wait" };
  return { text: "Nothing to do. We keep watching and will tell you when it changes band.", kind: "wait" };
}

function capital(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
