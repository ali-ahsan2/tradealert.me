// Formatting rules shared by every screen. Scores are integers, never
// decimals or percentages (PRODUCT_DESIGN §2.2); thin coverage carries a
// "~" (§2.4); every figure derived from an external source shows its age.

export function fmtMoney(m, decimals = 0) {
  if (m == null) return "—";
  if (Math.abs(m) >= 1000) return `$${(m / 1000).toFixed(1)}B`;
  return `$${m.toFixed(decimals)}M`;
}

export function dollars(cents) {
  return `$${Math.round((cents || 0) / 100)}`;
}

// Coverage thresholds from BUILD_SPEC §4.3.
export function coverage(present, total) {
  if (present == null || !total) return { state: "full", segments: 3, present, total };
  if (present >= total) return { state: "full", segments: 3, present, total };
  if (present >= Math.ceil(total / 2)) return { state: "partial", segments: 2, present, total };
  return { state: "thin", segments: 1, present, total };
}

export function isThin(present, total) {
  return coverage(present, total).state === "thin";
}

export function score(value, present, total) {
  if (value == null) return "—";
  const n = Math.round(value);
  return isThin(present, total) ? `~${n}` : String(n);
}

export function delta(v) {
  if (v == null) return "new";
  const r = Math.round(v);
  if (r === 0) return "0";
  return (r > 0 ? "+" : "−") + Math.abs(r);
}

export function deltaTone(v) {
  if (v == null) return "";
  const r = Math.round(v);
  return r > 0 ? "pos" : r < 0 ? "neg" : "";
}

export function age(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const hours = Math.max(0, (Date.now() - t) / 36e5);
  const label =
    hours < 1 ? "<1h" : hours < 48 ? `${Math.round(hours)}h` : `${Math.round(hours / 24)}d`;
  const cls = hours < 36 ? "fresh" : hours < 96 ? "aging" : "stale";
  return { hours, label, cls };
}

export function shortDate(iso, tz) {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return iso || "—";
  return t.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(tz ? { timeZone: tz } : {}),
  });
}

export function dateTime(iso, tz) {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return iso || "—";
  return t.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
    ...(tz ? { timeZone: tz } : {}),
  });
}

export function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export function industriesLabel(limit) {
  if (limit == null) return "—";
  return limit >= 999 ? "all industries" : plural(limit, "industry", "industries");
}

export function alertsLabel(limit) {
  if (limit === 0) return "no alerts";
  if (limit == null) return "unlimited alerts";
  return plural(limit, "alert");
}

export function tzGuess() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
  } catch {
    return "America/New_York";
  }
}

export function tzList() {
  try {
    if (typeof Intl.supportedValuesOf === "function") return Intl.supportedValuesOf("timeZone");
  } catch {
    /* fall through */
  }
  return [
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "America/Toronto",
    "Europe/London",
    "Europe/Berlin",
    "Asia/Dubai",
    "Asia/Karachi",
    "Asia/Kolkata",
    "Asia/Singapore",
    "Asia/Tokyo",
    "Australia/Sydney",
    "UTC",
  ];
}

export const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function pct(v, digits = 1) {
  if (v == null || Number.isNaN(Number(v))) return "—";
  const n = Number(v);
  const s = n.toFixed(digits);
  return (n > 0 ? "+" : "") + s + "%";
}

export function price(v) {
  if (v == null) return "—";
  const n = Number(v);
  return n >= 1000 ? `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : `$${n.toFixed(2)}`;
}

export function compact(n) {
  if (n == null) return "—";
  const v = Number(n);
  if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(v);
}

// Change between the first and last close of a bar series, in percent.
export function seriesChange(bars, key = "c") {
  if (!bars || bars.length < 2) return null;
  const a = Number(bars[0][key]);
  const b = Number(bars[bars.length - 1][key]);
  if (!a) return null;
  return ((b - a) / a) * 100;
}

// Minimal CSV: quotes any field containing a comma, quote or newline.
export function toCsv(rows, columns) {
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map((c) => esc(c.label)).join(",");
  const body = rows.map((r) => columns.map((c) => esc(c.get(r))).join(",")).join("\n");
  return `${head}\n${body}\n`;
}

export function downloadText(filename, text, type = "text/csv") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Signed number with a fixed number of decimals; "—" for nothing.
export function signed(v, digits = 1, suffix = "") {
  if (v == null || Number.isNaN(Number(v))) return "—";
  const n = Number(v);
  const s = Math.abs(n).toFixed(digits);
  return (n > 0 ? "+" : n < 0 ? "−" : "") + s + suffix;
}

export function tone(v) {
  if (v == null) return "";
  const n = Number(v);
  return n > 0 ? "pos" : n < 0 ? "neg" : "";
}

// "today", "tomorrow", "in 12d", "3d ago" for a day offset from today.
export function inDays(days) {
  if (days == null) return "—";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days}d` : `${-days}d ago`;
}

export function weekday(iso) {
  const t = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(t.getTime())) return "";
  return t.toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" });
}

// Monday-start week key for grouping dated rows.
export function weekStart(iso) {
  const t = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(t.getTime())) return iso;
  const day = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - day);
  return t.toISOString().slice(0, 10);
}

export function rate(v) {
  return v == null ? "—" : `${Math.round(v * 100)}%`;
}
