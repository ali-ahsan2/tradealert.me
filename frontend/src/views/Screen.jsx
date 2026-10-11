import React, { useEffect, useMemo, useRef, useState } from "react";
import { api, cached, toast } from "../api.js";
import { Link, navigate, useQuery } from "../lib/router.jsx";
import { useMe } from "../lib/me.jsx";
import { alertsLabel, coverage, dateTime, delta, dollars, downloadText, fmtMoney, inDays, pct, plural, score as fmtScore, shortDate, toCsv, tone } from "../lib/fmt.js";
import { nounFor } from "../lib/evidence.js";
import { PLAIN_FIELD } from "../lib/glossary.js";
import { CTA, bandWord } from "../lib/plain.js";
import { useRowNav } from "../lib/rownav.js";
import { useMode } from "../lib/mode.js";
import { openUpgrade } from "../lib/upgrade.js";
import { FIND_PRESETS, LIST_CARDS } from "../lib/caps.js";
import { FINE_PRINT_SHORT } from "../lib/legal.js";
import ScoreBadge from "../components/ScoreBadge.jsx";
import NameCard, { ShowAll } from "../components/NameCard.jsx";
import Pin from "../components/Pin.jsx";
import Spark, { Move } from "../components/Spark.jsx";
import Explain from "../components/Explain.jsx";
import NotifyButton from "../components/NotifyButton.jsx";
import ScreenHead from "../components/ScreenHead.jsx";
import FinePrint from "../components/FinePrint.jsx";
import { PlainStatusChip } from "../components/Plain.jsx";
import { STRATEGY_STATUS } from "../lib/glossary.js";

// measured / provisional / not_running for the strategy picker: the plain
// status when the API carries it, else the calibration flag. Simple hides
// the strategies that put no score on any name (DESIGN_V6 §7).
const pickerStatus = (s) => (s && s.plain && s.plain.status) || (s && s.calibrated ? "measured" : "provisional");
import { Empty, ErrorCard, Monogram, Skeleton } from "../components/ui.jsx";
import "./board.css";

// Find: every filter is a query-string parameter, so a screen is a link you
// can keep or send. Results are the names in the subscriber's industries
// and watchlist, clamped to the plan's names_shown_limit; what was left out
// is reported as a count, never as a name.

const PARAMS = [
  "strategy", "bands", "min_score", "max_score", "coverage", "hf", "industries", "lane", "group", "q",
  "min_delta", "max_delta", "new", "cap_min", "cap_max", "si_min", "si_max", "float_max", "fee_min",
  "volx_min", "run3m_min", "run3m_max", "offhigh_max", "earnings_within", "pinned", "sort", "dir",
];

// `plain` finishes the sentence "Find names that…" and says only what the
// screen's own limits do (the user's limits, not the strategy's recipe);
// `simpleLabel` is the button title in Simple mode. `rich` is the same
// sentence with its trader words tappable. The Simple order puts the
// screens about a dated event or a measured fact first (DESIGN_V6 §7).
const SHORTING = " (short sellers borrow shares to bet the price falls)";
const PRESETS = [
  {
    key: "earnings", label: "Earnings within 14 days", simpleLabel: "Report earnings soon", desc: "A dated earnings print inside two weeks",
    plain: "have an earnings date inside the next 14 days. A dated event the alerts can watch for you.",
    params: { earnings_within: "14", sort: "earnings" },
  },
  {
    key: "squeeze", label: "Tight float, high short interest", simpleLabel: "Small float, heavily shorted", desc: "Float under 30M shares and short interest over 15%",
    plain: "have under 30M shares that trade and more than 15% of them sold short. A crowded bet against a small float.",
    rich: (
      <>
        have under 30M <Explain term="float">shares that trade</Explain> and more than 15% of them <Explain term="short_interest">sold short</Explain>
        {SHORTING}. A crowded bet against a small <Explain term="float">float</Explain>.
      </>
    ),
    params: { float_max: "30", si_min: "15", sort: "si" },
  },
  {
    key: "fee", label: "Expensive to borrow", simpleLabel: "Are costly to borrow", desc: "Borrow fee at 20% or more",
    plain: "cost 20% a year or more to borrow. Shares are getting hard to find.",
    rich: (
      <>
        cost 20% a year or more <Explain term="borrow_fee">to borrow</Explain>
        {SHORTING}. Shares are getting hard to find.
      </>
    ),
    params: { fee_min: "20", sort: "fee" },
  },
  {
    key: "volume", label: "Volume at 3x+", simpleLabel: "Traded unusual volume", desc: "Volume above three times its 20-day average",
    plain: "traded at three times their normal volume or more. Something drew attention that day.",
    params: { volx_min: "3", sort: "volx" },
  },
  {
    key: "up", label: "Up 5+ since last scoring", simpleLabel: "Rose 5 points or more", desc: "Score rose five points or more",
    plain: "scored five points or more above their last scoring. Something in their inputs changed.",
    params: { min_delta: "5", sort: "delta" },
  },
  {
    key: "cleared", label: "Passed every rule", simpleLabel: "Passed every rule", desc: "Every must-pass rule passed",
    plain: "passed every one of the strategy's must-pass rules this morning. The names its setup fully applies to.",
    params: { hf: "pass", sort: "score" },
  },
  {
    key: "down", label: "Down 5+ since last scoring", simpleLabel: "Fell 5 points or more", desc: "Score fell five points or more",
    plain: "scored five points or more below their last scoring. Something in their inputs weakened.",
    params: { max_delta: "-5", sort: "delta", dir: "asc" },
  },
  {
    key: "new", label: "New this morning", simpleLabel: "Are new this morning", desc: "Not scored last time",
    plain: "were not scored last time. The newest arrivals in your industries.",
    params: { new: "1" },
  },
  {
    key: "thin", label: "Thin data to verify", simpleLabel: "Have thin data", desc: "Fewer than half the inputs had data",
    plain: "were scored on fewer than half of their inputs, so the number carries a ~. Worth a look before you lean on the score.",
    params: { coverage: "thin", sort: "coverage", dir: "asc" },
  },
  {
    key: "pinned", label: "On my watchlist", simpleLabel: "Are on my watchlist", desc: "Only your watchlist",
    plain: "are on your watchlist, with this morning's scores.",
    params: { pinned: "1" },
  },
];

// "today", "tomorrow", "in 12 days"; null for a past or missing date.
function daysWords(n) {
  if (n == null || n < 0) return null;
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  return `in ${n} days`;
}

// "up 6 since the last scoring", "new this morning".
function changeWords(d) {
  if (d == null) return "new this morning";
  const r = Math.round(d);
  if (r === 0) return "unchanged since the last scoring";
  return `${r > 0 ? "up" : "down"} ${Math.abs(r)} since the last scoring`;
}

// The one figure a screen is about, in words, from the fields each row
// already carries. Falls back to the change since the last scoring.
const FIGURE = {
  earnings: (r) => (r.earnings ? `earnings ${daysWords(r.earnings.days) || `on ${shortDate(r.earnings.date, "UTC")}`}` : "no earnings date on file"),
  squeeze: (r) => {
    const sn = r.snapshot || {};
    const parts = [];
    if (sn.si_pct_float != null) parts.push(`${sn.si_pct_float}% of the float sold short`);
    if (sn.float_m != null) parts.push(`${sn.float_m}M shares trade`);
    return parts.join(" · ") || null;
  },
  fee: (r) => (r.snapshot && r.snapshot.fee_pct != null ? `costs ${r.snapshot.fee_pct}% a year to borrow` : null),
  volume: (r) => (r.snapshot && r.snapshot.volx20d != null ? `volume ${r.snapshot.volx20d}x normal` : null),
  up: (r) => changeWords(r.delta_1d),
  down: (r) => changeWords(r.delta_1d),
  new: () => "new this morning",
  thin: (r) => `${r.components_present} of ${r.components_total} inputs had data`,
  cleared: () => "passed every must-pass rule",
  pinned: () => "on my watchlist",
};

function figureFor(presetKey, r) {
  const f = presetKey && FIGURE[presetKey] ? FIGURE[presetKey](r) : null;
  return f || changeWords(r.delta_1d);
}

const SORTS = [
  ["score", "Score"], ["delta", "Change since the last scoring"], ["coverage", "Coverage"], ["symbol", "Symbol"],
  ["industry", "Industry"], ["cap", "Market cap"], ["si", "Short interest"], ["float", "Float"], ["fee", "Borrow fee"],
  ["volx", "Volume vs 20-day"], ["run3m", "3-month move"], ["chg30", "30-day price move"], ["earnings", "Next earnings"],
];

// Plain names for the sort menu and the facet chips in Simple mode.
const SORT_PLAIN = {
  coverage: "How much data", symbol: "Name", cap: PLAIN_FIELD.cap_usd_m, si: PLAIN_FIELD.si_pct_float, float: PLAIN_FIELD.float_m,
  fee: PLAIN_FIELD.fee_pct, volx: PLAIN_FIELD.volx20d, run3m: PLAIN_FIELD.run3m_pct, earnings: PLAIN_FIELD.earnings,
};
const COV_PLAIN = { full: "full data", partial: "some data missing", thin: "thin data" };

const BANDS = ["strong", "elevated", "neutral", "weak", "excluded"];
const MAX_COMPARE = 4;

function qs(obj) {
  const p = new URLSearchParams();
  PARAMS.forEach((k) => {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== "" && v !== false) p.set(k, String(v));
  });
  const s = p.toString();
  return s ? `?${s}` : "";
}

const wide = () => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(min-width: 1000px)").matches;

// Whether an element scrolls sideways, and whether it is scrolled to the
// end, so the swipe hint and the edge fade show only while there are
// columns left to reach. Measured from the element, never assumed from
// the viewport: a phone card list does not scroll and gets neither.
function useSideScroll(deps) {
  const ref = useRef(null);
  const [state, setState] = useState({ can: false, end: true });
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const can = el.scrollWidth > el.clientWidth + 1;
      const end = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
      setState((s) => (s.can === can && s.end === end ? s : { can, end }));
    };
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    let ro = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(measure);
      ro.observe(el);
      Array.from(el.children).forEach((c) => ro.observe(c));
    } else {
      window.addEventListener("resize", measure);
    }
    return () => {
      el.removeEventListener("scroll", measure);
      if (ro) ro.disconnect();
      else window.removeEventListener("resize", measure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return [ref, state];
}

// When the run happened, in words that hold for the viewer's own clock.
function runWhen(iso, tz) {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "in the latest scoring";
  const opts = tz ? { timeZone: tz } : {};
  const day = (d) => d.toLocaleDateString("en-CA", opts);
  const now = new Date();
  if (day(t) === day(now)) {
    const hour = Number(t.toLocaleTimeString("en-GB", { ...opts, hour: "2-digit", hour12: false }));
    return hour < 12 ? "this morning" : "today";
  }
  if (day(t) === day(new Date(now.getTime() - 864e5))) return "yesterday";
  return `on ${shortDate(iso, tz)}`;
}

function Num({ id, label, value, onChange, step = 1, unit }) {
  return (
    <label className="fnum" htmlFor={id}>
      <span>{label}</span>
      <span className="fnum-in">
        <input id={id} type="number" inputMode="decimal" step={step} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
        {unit && <span className="faint xs">{unit}</span>}
      </span>
    </label>
  );
}


// A column header: the plain name in Simple, today's short one in Full, and
// a tap-to-open definition where the word is jargon.
function Th({ children, plain, simple, term, text, num }) {
  const label = simple && plain ? plain : children;
  return (
    <th scope="col" className={num ? "num" : undefined}>
      {label}
      {(term || text) && <Explain term={term} text={text} title={term ? undefined : String(label)} />}
    </th>
  );
}

// The screen's one line (DESIGN_V6 §7), fourteen words at most, from meta:
// what matched, out of what, and what the plan lists. `universe` is the
// unfiltered match count for the same strategy and scoring, or null when it
// is not yet known; the line then leaves it out.
function findLine(data, universe, activeCount, strat, tz) {
  if (!data) return "Pick a ready-made screen or set your own limits.";
  const { matched, truncated, names_shown_limit } = data.meta;
  if (activeCount === 0) {
    if (matched === 0) return `No names in your industries were scored on ${strat.label} ${runWhen(data.as_of, tz)}.`;
    return `${plural(matched, "name")} in your industries; pick a ready-made screen or set your own limits.`;
  }
  if (matched === 0) return "Nothing in your industries matches this screen; loosen a limit or pick another.";
  const verb = matched === 1 ? "matches" : "match";
  const count = universe != null ? `${matched} of ${universe} names` : plural(matched, "name");
  if (truncated) return `${count} ${verb} this screen; your plan lists ${names_shown_limit} of them.`;
  return `${count} ${verb} this screen.`;
}

export default function Screen() {
  const { me } = useMe();
  const { simple, full } = useMode();
  const q = useQuery();
  const filters = useMemo(() => {
    const f = {};
    PARAMS.forEach((k) => {
      const v = q.get(k);
      if (v != null && v !== "") f[k] = v;
    });
    return f;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.toString()]);
  const [draft, setDraft] = useState(filters);
  const [strategies, setStrategies] = useState(null);
  const [industriesAll, setIndustriesAll] = useState([]);
  const [tiers, setTiers] = useState(null);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [pins, setPins] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  // The Advanced filters accordion: open by default in Full on a wide
  // screen (today's sidebar), closed in Simple and on phones (today's drawer).
  const [adv, setAdv] = useState(() => full && wide());
  const [universe, setUniverse] = useState({});
  const [showAll, setShowAll] = useState(false);
  const [morePresets, setMorePresets] = useState(false);
  const asked = useRef(new Set());
  const [tableRef, tableScroll] = useSideScroll([data, loading, simple]);

  useEffect(() => setDraft(filters), [filters]);
  useEffect(() => setAdv(full && wide()), [full]);

  // The tab title matches the nav word and the heading; restored on leave.
  useEffect(() => {
    const prev = document.title;
    document.title = "Find names for me · tradealert.me";
    return () => {
      document.title = prev;
    };
  }, [simple]);

  useEffect(() => {
    cached("/strategies").then((d) => setStrategies(d.strategies)).catch(() => setStrategies([]));
    cached("/industries").then((d) => setIndustriesAll(d.industries)).catch(() => setIndustriesAll([]));
    cached("/entitlements").then((d) => setTiers(d.tiers)).catch(() => setTiers(null));
    api("/me/picks")
      .then((d) => setPins(new Set(d.picks.map((p) => p.symbol))))
      .catch(() => setPins(new Set()));
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr(null);
    setShowAll(false);
    api(`/screen${qs(filters)}`)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setErr(e))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [filters, reload]);

  const activeCount = PARAMS.filter((k) => !["strategy", "sort", "dir"].includes(k) && filters[k]).length;
  const stratKey = filters.strategy || "fast_mover";

  // The unfiltered match count for "matched N of M": free when no filter is
  // on, otherwise one extra call per strategy and run through the same
  // endpoint with no filters. Never guessed.
  useEffect(() => {
    if (!data) return undefined;
    const key = `${stratKey}@${data.as_of}`;
    if (activeCount === 0) {
      asked.current.add(key);
      setUniverse((u) => (u[key] === data.meta.matched ? u : { ...u, [key]: data.meta.matched }));
      return undefined;
    }
    if (asked.current.has(key)) return undefined;
    asked.current.add(key);
    let alive = true;
    api(`/screen${qs({ strategy: filters.strategy })}`)
      .then((d) => alive && setUniverse((u) => ({ ...u, [key]: d.meta.matched })))
      .catch(() => asked.current.delete(key));
    return () => {
      alive = false;
    };
  }, [data, activeCount, stratKey, filters.strategy]);

  const go = (next) => navigate(`/screen${qs(next)}`, { replace: true });
  const apply = () => {
    go(draft);
    if (simple || !wide()) setAdv(false);
  };
  const clear = () => go({ strategy: filters.strategy });
  const preset = (p) => go({ strategy: filters.strategy, ...p.params });
  const presetOn = (p) => Object.entries(p.params).every(([k, v]) => (filters[k] || "") === v);
  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const toggleIn = (k, v) => {
    const cur = (draft[k] || "").split(",").filter(Boolean);
    const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
    set(k, next.join(","));
  };
  const facetGo = (k, v) => {
    const cur = (filters[k] || "").split(",").filter(Boolean);
    const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
    go({ ...filters, [k]: next.join(",") });
  };

  const rows = data ? data.rows : [];
  const cards = simple && !showAll ? rows.slice(0, LIST_CARDS) : rows;
  const navRows = simple ? cards : rows;
  const strat = (data && data.strategy) || (strategies || []).find((s) => s.key === stratKey) || { key: "fast_mover", label: "Fast Mover", calibrated: true };
  const tz = me && me.settings ? me.settings.timezone : undefined;
  const scopeInds = data ? data.meta.scope : [];
  const scopeList = scopeInds.map((k) => industriesAll.find((i) => i.key === k)).filter(Boolean);
  const nextTier =
    tiers && me && me.tier
      ? [...tiers].sort((a, b) => a.price_monthly_cents - b.price_monthly_cents).find((t) => t.price_monthly_cents > me.tier.price_monthly_cents)
      : null;
  const universeFor = data ? universe[`${stratKey}@${data.as_of}`] : null;
  const onPinChange = (sym, on) =>
    setPins((p) => {
      const n = new Set(p || []);
      if (on) n.add(sym);
      else n.delete(sym);
      return n;
    });
  const toggleSelect = (sym) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(sym)) n.delete(sym);
      else if (n.size < MAX_COMPARE) n.add(sym);
      else toast(`Compare holds up to ${MAX_COMPARE} names.`);
      return n;
    });
  const hrefFor = (r) => `/stock/${r.symbol}${strat.key !== "fast_mover" ? `?strategy=${strat.key}` : ""}`;
  const openRow = (r) => navigate(hrefFor(r));
  const cursor = useRowNav(navRows.length, {
    onOpen: (i) => navRows[i] && openRow(navRows[i]),
    onPin: (i) => {
      const r = navRows[i];
      if (!r || !pins) return;
      const on = pins.has(r.symbol);
      api(`/me/picks${on ? `/${encodeURIComponent(r.symbol)}` : ""}`, on ? { method: "DELETE" } : { method: "POST", json: { symbol: r.symbol } })
        .then(() => {
          onPinChange(r.symbol, !on);
          toast(on ? `Removed ${r.symbol} from your watchlist.` : `Watching ${r.symbol} for you.`);
        })
        .catch((e) => toast(e.detail || "That didn't work."));
    },
  });

  const exportCsv = () => {
    const cols = [
      { label: "rank", get: (r) => r.rank },
      { label: "symbol", get: (r) => r.symbol },
      { label: "theme", get: (r) => r.theme },
      { label: "industry", get: (r) => r.industry.label },
      { label: "lane", get: (r) => r.lane },
      { label: "strategy", get: () => strat.label },
      { label: "score", get: (r) => Math.round(r.value) },
      { label: "band", get: (r) => r.band },
      { label: "coverage", get: (r) => `${r.components_present}/${r.components_total}` },
      { label: "delta_since_last_run", get: (r) => (r.delta_1d == null ? "new" : Math.round(r.delta_1d)) },
      { label: "hard_filters", get: (r) => (r.hf_pass == null ? "" : r.hf_pass ? "pass" : "fail") },
      { label: "cap_usd_m", get: (r) => r.snapshot.cap_usd_m ?? "" },
      { label: "si_pct_float", get: (r) => r.snapshot.si_pct_float ?? "" },
      { label: "float_m", get: (r) => r.snapshot.float_m ?? "" },
      { label: "fee_pct", get: (r) => r.snapshot.fee_pct ?? "" },
      { label: "volx20d", get: (r) => r.snapshot.volx20d ?? "" },
      { label: "run3m_pct", get: (r) => r.snapshot.run3m_pct ?? "" },
      { label: "px_chg_30d", get: (r) => r.price.chg_30d ?? "" },
      { label: "px_rel_30d_vs_etf", get: (r) => r.price.rel_30d ?? "" },
      { label: "next_earnings", get: (r) => (r.earnings ? r.earnings.date : "") },
      { label: "run_as_of", get: () => data.as_of },
    ];
    downloadText(
      `tradealert-screen-${data.as_of.slice(0, 10)}.csv`,
      toCsv(rows, cols) + `\n# ${FINE_PRINT_SHORT} Scores rank names for a human to review.\n`
    );
  };

  const noun = nounFor(strat);

  // Facet chips over the whole matched set. Plain words in Simple mode.
  const facetChips = (plain) =>
    data && data.meta.matched > 0 ? (
      <div className="facets">
        {BANDS.filter((b) => data.facets.band[b]).map((b) => (
          <button key={b} type="button" className="fchip" aria-pressed={(filters.bands || "").split(",").includes(b)} onClick={() => facetGo("bands", b)}>
            {bandWord(b)} <span className="count">{data.facets.band[b]}</span>
          </button>
        ))}
        {Object.entries(data.facets.industry).length > 1 &&
          Object.entries(data.facets.industry).map(([k, v]) => (
            <button key={k} type="button" className="fchip" aria-pressed={(filters.industries || "").split(",").includes(k)} onClick={() => facetGo("industries", k)}>
              {v.label} <span className="count">{v.n}</span>
            </button>
          ))}
        {(data.facets.hf.pass > 0 || data.facets.hf.fail > 0) && (
          <>
            <button type="button" className="fchip" aria-pressed={filters.hf === "pass"} onClick={() => go({ ...filters, hf: filters.hf === "pass" ? "" : "pass" })}>
              {plain ? "passed every rule" : "cleared"} <span className="count">{data.facets.hf.pass}</span>
            </button>
            <button type="button" className="fchip" aria-pressed={filters.hf === "fail"} onClick={() => go({ ...filters, hf: filters.hf === "fail" ? "" : "fail" })}>
              {plain ? "failed a rule" : "failed"} <span className="count">{data.facets.hf.fail}</span>
            </button>
          </>
        )}
        {["full", "partial", "thin"]
          .filter((c) => data.facets.coverage[c])
          .map((c) => (
            <button key={c} type="button" className="fchip" aria-pressed={filters.coverage === c} onClick={() => go({ ...filters, coverage: filters.coverage === c ? "" : c })}>
              {plain ? COV_PLAIN[c] : `${c} coverage`} <span className="count">{data.facets.coverage[c]}</span>
            </button>
          ))}
      </div>
    ) : null;

  const Panel = (
    <aside className="fpanel card" aria-label="Filters">
      <div className="fpanel-head">
        <span className="muted small">{simple ? "Set your own limits. Leave a box empty to ignore it." : "Empty boxes are ignored."}</span>
        <button className="btn-quiet" onClick={clear}>
          Clear all
        </button>
      </div>
      {simple && data && data.meta.matched > 0 && (
        <div className="fgroup">
          <span className="fgroup-label">Narrow what matched</span>
          {facetChips(true)}
        </div>
      )}
      <div className="fgroup">
        <span className="fgroup-label">
          {simple ? "Rating word" : "Band"} <Explain term="band" />
        </span>
        <div className="chips">
          {BANDS.map((b) => (
            <button key={b} type="button" className="fchip" aria-pressed={(draft.bands || "").split(",").includes(b)} onClick={() => toggleIn("bands", b)}>
              {bandWord(b)}
            </button>
          ))}
        </div>
      </div>
      <div className="fgroup two">
        <Num id="f-min" label="Score at least" value={draft.min_score} onChange={(v) => set("min_score", v)} />
        <Num id="f-max" label="at most" value={draft.max_score} onChange={(v) => set("max_score", v)} />
      </div>
      <div className="fgroup">
        <span className="fgroup-label">
          {simple ? "How much data" : "Coverage"} <Explain term="coverage" />
        </span>
        <div className="chips">
          {[["", "Any"], ["full", "Full"], ["partial", "Partial"], ["thin", "Thin"]].map(([v, l]) => (
            <button key={v} type="button" className="fchip" aria-pressed={(draft.coverage || "") === v} onClick={() => set("coverage", v)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="fgroup">
        <span className="fgroup-label">
          Must-pass rules{" "}
          <Explain
            title="Must-pass rules (hard filters)"
            text="Fast Mover's four must-pass rules: company size, shares that trade, short interest, revenue growth. Pass or fail only; the exact lines stay in the Lab. Other strategies store no verdict."
          />
        </span>
        <div className="chips">
          {[["", "Any"], ["pass", "All passed"], ["fail", "Any failed"]].map(([v, l]) => (
            <button key={v} type="button" className="fchip" aria-pressed={(draft.hf || "") === v} onClick={() => set("hf", v)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      {scopeList.length > 1 && (
        <div className="fgroup">
          <span className="fgroup-label">Industry</span>
          <div className="chips">
            {scopeList.map((i) => (
              <button key={i.key} type="button" className="fchip" aria-pressed={(draft.industries || "").split(",").includes(i.key)} onClick={() => toggleIn("industries", i.key)}>
                {i.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="fgroup two">
        <label className="fnum" htmlFor="f-lane">
          <span>
            {simple ? "Dated event" : "Stage"} <Explain term="lane" />
          </span>
          <select id="f-lane" value={draft.lane || ""} onChange={(e) => set("lane", e.target.value)}>
            <option value="">Any</option>
            <option value="Early">{simple ? "No date set yet" : "Early"}</option>
            <option value="Event">{simple ? "A date is set" : "Event"}</option>
          </select>
        </label>
        <label className="fnum" htmlFor="f-group">
          <span>
            Group <Explain term="group" />
          </span>
          <select id="f-group" value={draft.group || ""} onChange={(e) => set("group", e.target.value)}>
            <option value="">Any</option>
            <option value="A">A list</option>
            <option value="Bench">Bench</option>
            <option value="Scan">Scan</option>
          </select>
        </label>
      </div>
      <div className="fgroup">
        <label className="fnum" htmlFor="f-q">
          <span>Words in the symbol, theme or notes</span>
          <input id="f-q" value={draft.q || ""} onChange={(e) => set("q", e.target.value)} placeholder="e.g. HALEU, drone, GLP" />
        </label>
      </div>
      <div className="fgroup two">
        <Num id="f-dmin" label={simple ? "Change since the last scoring, at least" : "Δ run at least"} value={draft.min_delta} onChange={(v) => set("min_delta", v)} />
        <Num id="f-dmax" label="at most" value={draft.max_delta} onChange={(v) => set("max_delta", v)} />
      </div>
      <label className="check" style={{ padding: 0 }}>
        <input type="checkbox" checked={draft.new === "1"} onChange={(e) => set("new", e.target.checked ? "1" : "")} />
        <span>New this morning only</span>
      </label>
      <label className="check" style={{ padding: 0 }}>
        <input type="checkbox" checked={draft.pinned === "1"} onChange={(e) => set("pinned", e.target.checked ? "1" : "")} />
        <span>Only names I watch</span>
      </label>
      <h3 className="fgroup-label" style={{ marginTop: "var(--s-4)" }}>
        Market data on file
      </h3>
      <div className="fgroup two">
        <Num id="f-capmin" label={simple ? `${PLAIN_FIELD.cap_usd_m} at least` : "Cap at least"} value={draft.cap_min} unit="$M" onChange={(v) => set("cap_min", v)} />
        <Num id="f-capmax" label="at most" value={draft.cap_max} unit="$M" onChange={(v) => set("cap_max", v)} />
      </div>
      <div className="fgroup two">
        <Num id="f-simin" label={simple ? `${PLAIN_FIELD.si_pct_float} at least` : "Short interest at least"} value={draft.si_min} unit="% float" onChange={(v) => set("si_min", v)} />
        <Num id="f-simax" label="at most" value={draft.si_max} unit="%" onChange={(v) => set("si_max", v)} />
      </div>
      <div className="fgroup two">
        <Num id="f-float" label={simple ? `${PLAIN_FIELD.float_m} at most` : "Float at most"} value={draft.float_max} unit="M sh" onChange={(v) => set("float_max", v)} />
        <Num id="f-fee" label={simple ? `${PLAIN_FIELD.fee_pct} at least` : "Borrow fee at least"} value={draft.fee_min} unit="%" onChange={(v) => set("fee_min", v)} />
      </div>
      <div className="fgroup two">
        <Num id="f-volx" label={simple ? `${PLAIN_FIELD.volx20d} at least` : "Volume at least"} value={draft.volx_min} unit="x 20d" step={0.5} onChange={(v) => set("volx_min", v)} />
        <Num id="f-offhigh" label={simple ? "Within % of yearly high" : "Within % of 52w high"} value={draft.offhigh_max} unit="%" onChange={(v) => set("offhigh_max", v)} />
      </div>
      <div className="fgroup two">
        <Num id="f-r3min" label="3-month move at least" value={draft.run3m_min} unit="%" onChange={(v) => set("run3m_min", v)} />
        <Num id="f-r3max" label="at most" value={draft.run3m_max} unit="%" onChange={(v) => set("run3m_max", v)} />
      </div>
      <div className="fgroup">
        <Num id="f-earn" label="Earnings within" value={draft.earnings_within} unit="days" onChange={(v) => set("earnings_within", v)} />
      </div>
      <div className="fpanel-foot">
        <button className="btn btn-primary btn-block" onClick={apply}>
          Show me what matches
        </button>
      </div>
    </aside>
  );

  const anyPresetOn = PRESETS.some(presetOn);
  // The figure on each card follows the screen whose limits are on, whatever
  // the sort: /screen?hf=pass is the "passed every rule" screen.
  const activePreset = PRESETS.find((p) => Object.entries(p.params).every(([k, v]) => k === "sort" || k === "dir" || (filters[k] || "") === v));
  const presetsShown = simple && !morePresets && !PRESETS.slice(FIND_PRESETS).some(presetOn) ? PRESETS.slice(0, FIND_PRESETS) : PRESETS;

  const sortControl = (
    <label className="ctl">
      Sort
      <select className="inline" value={filters.sort || "score"} onChange={(e) => go({ ...filters, sort: e.target.value, dir: "" })}>
        {SORTS.map(([k, l]) => (
          <option key={k} value={k}>
            {simple ? SORT_PLAIN[k] || l : l}
          </option>
        ))}
      </select>
    </label>
  );

  // The one action: the screen of names that passed every must-pass rule,
  // or every name again once that screen is on.
  const clearedPreset = PRESETS.find((p) => p.key === "cleared");
  const clearedOn = presetOn(clearedPreset);

  return (
    <div className="wrap screen-v">
      <ScreenHead
        title="Find names for me"
        line={findLine(data, universeFor, activeCount, strat, tz)}
        action={
          clearedOn ? (
            <button type="button" className="btn btn-primary" onClick={clear}>
              Show me every name
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={() => preset(clearedPreset)}>
              Show me names that passed every rule
            </button>
          )
        }
        secondary={
          <>
            <select
              className="inline"
              value={stratKey}
              aria-label="Strategy"
              onChange={(e) => go({ ...filters, strategy: e.target.value === "fast_mover" ? "" : e.target.value })}
            >
              {(strategies || [{ key: "fast_mover", label: "Fast Mover", calibrated: true }])
                .filter((s) => !simple || pickerStatus(s) !== "not_running" || s.key === stratKey)
                .map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                    {pickerStatus(s) === "measured" ? "" : ` (${(STRATEGY_STATUS[pickerStatus(s)] || STRATEGY_STATUS.provisional).chip.toLowerCase()})`}
                  </option>
                ))}
            </select>
            <button className="btn btn-secondary btn-sm fpanel-toggle full-only" onClick={() => setAdv((a) => !a)} aria-expanded={adv}>
              Filters{activeCount ? ` · ${activeCount}` : ""}
            </button>
          </>
        }
      />

      <section className="find simple-only" aria-labelledby="find-h">
        <h2 id="find-h" className="find-h">
          Find names that…
        </h2>
        <div className="find-grid">
          {presetsShown.map((p) => {
            const on = presetOn(p);
            const toggle = () => (on ? clear() : preset(p));
            // The whole card toggles; the title is the focusable control.
            // The explainers in the sentence stop their own taps, so a tap
            // on a term opens its definition instead of the screen.
            return (
              <div key={p.key} className={`pcard ${on ? "on" : ""}`} onClick={toggle}>
                <button
                  type="button"
                  className="pcard-btn"
                  aria-pressed={on}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle();
                  }}
                >
                  <b className="pcard-t">{p.simpleLabel || p.label}</b>
                </button>
                <span className="pcard-d">… {p.rich || p.plain}</span>
              </div>
            );
          })}
        </div>
        {presetsShown.length < PRESETS.length && (
          <button type="button" className="btn btn-secondary find-more" onClick={() => setMorePresets(true)}>
            More ways to find
          </button>
        )}
        <p className="hint">{anyPresetOn ? "Tap the screen again to clear it, or set your own limits below." : "Pick one to start. The results update as you go."}</p>
      </section>

      <div className="presets full-only" role="group" aria-label="Preset screens">
        {PRESETS.map((p) => (
          <button key={p.key} className="preset" aria-pressed={presetOn(p)} title={p.desc} onClick={() => preset(p)}>
            {p.label}
          </button>
        ))}
      </div>

      <div className={`screen ${simple ? "screen-simple" : ""}`}>
        <details className="acc adv" open={adv} onToggle={(e) => setAdv(e.currentTarget.open)}>
          <summary>
            {simple ? "Set my own limits" : "Advanced filters"}
            <span className="sum-note">{activeCount ? `${activeCount} on` : "none on"}</span>
          </summary>
          <div className="acc-body">{Panel}</div>
        </details>
        <div className="screen-main">
          {data && full && (
            <div className="boardhead">
              <Monogram size={20}>{strat.monogram}</Monogram>
              <b>{strat.label}</b>
              <PlainStatusChip status={(strat.plain && strat.plain.status) || (strat.calibrated ? "measured" : "provisional")} />
              <span>
                <b>{data.meta.matched}</b> {data.meta.matched === 1 ? "name matches" : "names match"} · showing {data.meta.shown}
              </span>
              <span>scored {dateTime(data.as_of, tz)}</span>
              <span className="spacer" />
              {sortControl}
              <button className="btn-quiet" onClick={() => go({ ...filters, dir: data.meta.dir === "asc" ? "desc" : "asc" })} title="Flip sort direction">
                {data.meta.dir === "asc" ? "↑ asc" : "↓ desc"}
              </button>
              {rows.length > 0 && (
                <button className="btn-quiet" onClick={exportCsv}>
                  Export CSV
                </button>
              )}
              <button
                className="btn-quiet"
                title="Copy a link to this exact screen"
                onClick={() => {
                  const url = window.location.href;
                  const done = () => toast("Link copied. Anyone on your plan opens this screen with it.");
                  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done).catch(() => toast(url));
                  else toast(url);
                }}
              >
                Copy link
              </button>
            </div>
          )}

          {full && facetChips(false)}

          {err && <ErrorCard error={err} onRetry={() => setReload((n) => n + 1)} title="Couldn't run the screen." />}
          {loading && !err && <Skeleton rows={simple ? 5 : 8} height={simple ? 96 : 56} />}
          {!loading && data && rows.length === 0 && (
            <Empty
              title={
                activeCount
                  ? "Nothing in your industries matches this screen."
                  : strat.key !== "fast_mover"
                    ? `No ${strat.label} ${noun}s were rated in the latest scoring.`
                    : "No names were rated in the latest scoring."
              }
              action={
                activeCount ? (
                  <button className="btn btn-secondary" onClick={clear}>
                    Clear the screen
                  </button>
                ) : strat.key !== "fast_mover" ? (
                  <button className="btn btn-secondary" onClick={() => go({})}>
                    Back to Fast Mover
                  </button>
                ) : (
                  <Link to="/board" className="btn btn-secondary">
                    {CTA.BOARD}
                  </Link>
                )
              }
            >
              {activeCount ? "Loosen one limit, or pick a different screen above." : "Scores regenerate each morning."}
            </Empty>
          )}

          {!loading && data && rows.length > 0 && simple && (
            <>
              {rows.length > 1 && <div className="find-sort">{sortControl}</div>}
              <ol className="bcards" aria-label="Names that match">
                {cards.map((r, i) => (
                  <NameCard
                    key={r.symbol}
                    index={i}
                    cursor={cursor === i}
                    symbol={r.symbol}
                    sub={r.industry.label}
                    to={hrefFor(r)}
                    sentence={r.theme}
                    meta={
                      <>
                        <b>{bandWord(r.band)}</b> <span className="num">{fmtScore(r.value, r.components_present, r.components_total)}</span> ·{" "}
                        {figureFor(activePreset && activePreset.key, r)}
                      </>
                    }
                    action={<NotifyButton symbol={r.symbol} compact />}
                  />
                ))}
              </ol>
              <ShowAll total={rows.length} shown={cards.length} open={showAll} onToggle={() => setShowAll((v) => !v)} />
            </>
          )}

          {!loading && data && rows.length > 0 && full && (
            <>
              {tableScroll.can && <p className="hint tscroll-hint">Swipe sideways for more columns.</p>}
              <div className={`tscroll-wrap ${tableScroll.can && !tableScroll.end ? "fade" : ""}`}>
                <div className="table-card cards" ref={tableRef}>
                  <table className="data compact screen-table">
                    <thead>
                      <tr>
                        <th scope="col" className="c-sel">
                          <span className="sr-only">Select for compare</span>
                        </th>
                        <th className="rank" scope="col">
                          #
                        </th>
                        <th scope="col">Name</th>
                        <Th term="band">Rating</Th>
                        <Th term="coverage" num>
                          Data
                        </Th>
                        <Th term="delta_run" num>
                          Δ run
                        </Th>
                        <Th text="The must-pass rules' verdict stored with the score. A name flagged FAIL is still rated. — means the strategy stores none.">Rules</Th>
                        <Th term="market_cap" num>
                          Cap
                        </Th>
                        <Th term="short_interest" num>
                          SI %
                        </Th>
                        <Th term="float" num>
                          Float
                        </Th>
                        <Th term="borrow_fee" num>
                          Fee
                        </Th>
                        <Th term="volume_x" num>
                          Vol×
                        </Th>
                        <Th term="run3m" num>
                          3m
                        </Th>
                        <Th text="Price change over 30 days from daily closes, with the gap to the industry's ETF beneath." num>
                          30d
                        </Th>
                        <Th term="catalyst">Earnings</Th>
                        <th scope="col">
                          <span className="sr-only">Watch</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => {
                        const cov = coverage(r.components_present, r.components_total);
                        const sn = r.snapshot;
                        return (
                          <tr key={r.symbol} data-rownav={i} className={`rowlink ${cursor === i ? "cursor" : ""}`} onClick={() => openRow(r)}>
                            <td className="c-sel c-hide" onClick={(e) => e.stopPropagation()}>
                              <input type="checkbox" checked={selected.has(r.symbol)} onChange={() => toggleSelect(r.symbol)} aria-label={`Select ${r.symbol} for compare`} />
                            </td>
                            <td className="rank c-rank">{r.rank}</td>
                            <td className="name-cell c-sym">
                              <Link className="sym" to={`/stock/${r.symbol}`} onClick={(e) => e.stopPropagation()}>
                                {r.symbol}
                              </Link>
                              <span className="theme" title={r.theme}>
                                {r.theme}
                              </span>
                              <span className="xs faint">
                                {r.industry.label}
                                {r.lane ? ` · ${r.lane}` : ""}
                              </span>
                            </td>
                            <td className="c-band">
                              <ScoreBadge band={r.band} value={r.value} present={r.components_present} total={r.components_total} strategy={strat} />
                            </td>
                            <td className="num c-cov cov-cell" data-label="Data" title={`${cov.present} of ${cov.total} inputs had data`}>
                              <span className="covbar" aria-hidden="true">
                                {[0, 1, 2].map((k) => (
                                  <span key={k} className={k < cov.segments ? "filled" : ""} />
                                ))}
                              </span>
                              {r.components_present}/{r.components_total}
                            </td>
                            <td className="num c-delta" data-label="Δ">
                              {delta(r.delta_1d)}
                            </td>
                            <td className="c-hide">
                              {r.hf_pass == null ? (
                                <span className="faint">—</span>
                              ) : (
                                <span className={`verdict ${r.hf_pass ? "pass" : "fail"}`}>{r.hf_pass ? "PASS" : `FAIL${r.hf_fails > 1 ? ` ×${r.hf_fails}` : ""}`}</span>
                              )}
                            </td>
                            <td className="num c-hide">{fmtMoney(sn.cap_usd_m)}</td>
                            <td className="num c-hide">{sn.si_pct_float == null ? "—" : `${sn.si_pct_float}%`}</td>
                            <td className="num c-hide">{sn.float_m == null ? "—" : `${sn.float_m}M`}</td>
                            <td className="num c-hide">{sn.fee_pct == null ? "—" : `${sn.fee_pct}%`}</td>
                            <td className="num c-hide">{sn.volx20d == null ? "—" : `${sn.volx20d}x`}</td>
                            <td className={`num c-hide ${tone(sn.run3m_pct)}`}>{pct(sn.run3m_pct, 0)}</td>
                            <td className="c-move" data-label="30d">
                              <span className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
                                <Spark closes={r.price.closes} width={72} height={24} />
                                <Move value={r.price.chg_30d} />
                              </span>
                              {r.price.rel_30d != null && (
                                <span className="xs faint" style={{ display: "block" }} title={`vs ${r.price.benchmark}${r.industry && r.industry.label ? ` (${r.industry.label} ETF)` : ""}`}>
                                  {pct(r.price.rel_30d)} vs {r.price.benchmark}
                                  {r.industry && r.industry.label && <span className="bench-ind"> ({r.industry.label} ETF)</span>}
                                </span>
                              )}
                            </td>
                            <td className="c-hide">
                              {r.earnings ? (
                                <span className={`chip chip-plain ${r.earnings.days != null && r.earnings.days >= 0 && r.earnings.days <= 14 ? "soon" : ""}`} title={`${r.earnings.date}${r.earnings.confidence ? ` · ${r.earnings.confidence}` : ""}`}>
                                  {inDays(r.earnings.days)}
                                </span>
                              ) : (
                                <span className="faint">—</span>
                              )}
                            </td>
                            <td className="c-pin">{pins && <Pin symbol={r.symbol} pinned={pins.has(r.symbol)} onChange={onPinChange} />}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {selected.size > 0 && (
                <div className="selbar" role="status">
                  <span>
                    {selected.size} of {MAX_COMPARE} selected: <span className="num">{[...selected].join(", ")}</span>
                  </span>
                  <span className="spacer" />
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={selected.size < 2}
                    onClick={() => navigate(`/compare?symbols=${[...selected].join(",")}${strat.key !== "fast_mover" ? `&strategy=${strat.key}` : ""}`)}
                  >
                    Compare{selected.size < 2 ? " (pick 2+)" : ""}
                  </button>
                  <button className="btn-quiet" onClick={() => setSelected(new Set())}>
                    Clear
                  </button>
                </div>
              )}
            </>
          )}

          {!loading && data && rows.length > 0 && (
            <>
              {data.meta.truncated && (
                <div className="upgrade-card">
                  <div className="copy">
                    <b>{data.meta.matched - data.meta.shown}</b> more {data.meta.matched - data.meta.shown === 1 ? "name" : "names"} in your industries{" "}
                    {data.meta.matched - data.meta.shown === 1 ? "matches" : "match"} this screen than this list reaches; your plan lists{" "}
                    <b>{data.meta.names_shown_limit}</b>.
                    {nextTier && (
                      <>
                        {" "}
                        On <b>{nextTier.label}</b> this list would reach {nextTier.names_shown_limit} names and we would tell you which of them changed rating
                        each morning
                        {nextTier.alerts_limit === 0 ? (
                          "."
                        ) : (
                          <>
                            , with {alertsLabel(nextTier.alerts_limit)} on{" "}
                            {nextTier.picks_limit == null || nextTier.picks_limit >= 999 ? "the names you watch" : `up to ${plural(nextTier.picks_limit, "watched name")}`}.
                          </>
                        )}
                      </>
                    )}
                  </div>
                  {nextTier && (
                    <div className="actions">
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => openUpgrade("names")}>
                        Show me the plans — {dollars(nextTier.price_monthly_cents)}/mo
                      </button>
                    </div>
                  )}
                </div>
              )}

              <p className="footnote">
                {full ? (
                  <>
                    Market data columns show the latest snapshot on file per name; each figure carries its own date on the report. <kbd className="kbd">j</kbd>/
                    <kbd className="kbd">k</kbd> move, <kbd className="kbd">↵</kbd> open, <kbd className="kbd">p</kbd> watch.{" "}
                  </>
                ) : (
                  <>Each figure is the latest on file for that name; its date is on the report. </>
                )}
                {strat.label} {noun}s rank names for you to look into; nothing here is a recommendation.
              </p>
            </>
          )}
        </div>
      </div>

      <FinePrint short />
    </div>
  );
}
