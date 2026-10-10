import React, { useEffect, useMemo, useRef, useState } from "react";
import { api, cached, toast } from "../api.js";
import { Link, navigate, useQuery } from "../lib/router.jsx";
import { useMe } from "../lib/me.jsx";
import { alertsLabel, coverage, dateTime, delta, dollars, downloadText, fmtMoney, inDays, pct, plural, shortDate, toCsv, tone } from "../lib/fmt.js";
import { nounFor } from "../lib/evidence.js";
import { PLAIN_FIELD } from "../lib/glossary.js";
import { changeSentence } from "../lib/plain.js";
import { useRowNav } from "../lib/rownav.js";
import { useMode } from "../lib/mode.js";
import ScoreBadge from "../components/ScoreBadge.jsx";
import Pin from "../components/Pin.jsx";
import Spark, { Move } from "../components/Spark.jsx";
import Explain from "../components/Explain.jsx";
import NotifyButton from "../components/NotifyButton.jsx";
import { Empty, ErrorCard, Monogram, Skeleton, StatusChip } from "../components/ui.jsx";
import "./board.css";

// The screener: every filter is a query-string parameter, so a screen is a
// link you can keep or send. Results are the subscriber's visible universe
// clamped to the plan's names_shown_limit; what was left out is reported as
// a count, never as a name.

const PARAMS = [
  "strategy", "bands", "min_score", "max_score", "coverage", "hf", "industries", "lane", "group", "q",
  "min_delta", "max_delta", "new", "cap_min", "cap_max", "si_min", "si_max", "float_max", "fee_min",
  "volx_min", "run3m_min", "run3m_max", "offhigh_max", "earnings_within", "pinned", "sort", "dir",
];

// `plain` finishes the sentence "Find names that…" and says only what the
// preset's own filters do; `simpleLabel` is the card title in Simple mode.
// `rich` is the same sentence with its trader words tappable.
const SHORTING = " (short sellers borrow shares to bet the price falls)";
const PRESETS = [
  {
    key: "cleared", label: "Cleared the screen", simpleLabel: "Cleared the filters", desc: "Every hard filter passed",
    plain: "passed every one of the strategy's pass-or-fail rules on this run. The names its setup fully applies to.",
    params: { hf: "pass", sort: "score" },
  },
  {
    key: "thin", label: "Thin coverage to verify", simpleLabel: "Have thin data", desc: "Fewer than half the inputs had data",
    plain: "were scored on fewer than half of their inputs, so the number carries a ~. Worth a look before you lean on the score.",
    params: { coverage: "thin", sort: "coverage", dir: "asc" },
  },
  {
    key: "new", label: "New this run", simpleLabel: "Are new this run", desc: "Not scored on the previous run",
    plain: "were not scored on the previous run. The newest arrivals in your universe.",
    params: { new: "1" },
  },
  {
    key: "up", label: "Up 5+ since last run", simpleLabel: "Rose 5 points or more", desc: "Score rose five points or more",
    plain: "scored five points or more above their previous run. Something in their inputs changed.",
    params: { min_delta: "5", sort: "delta" },
  },
  {
    key: "down", label: "Down 5+ since last run", simpleLabel: "Fell 5 points or more", desc: "Score fell five points or more",
    plain: "scored five points or more below their previous run. Something in their inputs weakened.",
    params: { max_delta: "-5", sort: "delta", dir: "asc" },
  },
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
    key: "fee", label: "Expensive to borrow", simpleLabel: "Are expensive to borrow", desc: "Borrow fee at 20% or more",
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
    key: "pinned", label: "My pinned names", simpleLabel: "Are on my watchlist", desc: "Only your watchlist",
    plain: "are pinned to your watchlist, with their scores on this run.",
    params: { pinned: "1" },
  },
];

const SORTS = [
  ["score", "Score"], ["delta", "Change since last run"], ["coverage", "Coverage"], ["symbol", "Symbol"],
  ["industry", "Industry"], ["cap", "Market cap"], ["si", "Short interest"], ["float", "Float"], ["fee", "Borrow fee"],
  ["volx", "Volume vs 20-day"], ["run3m", "3-month move"], ["chg30", "30-day price move"], ["earnings", "Next earnings"],
];

// Plain names for the sort menu and the facet chips in Simple mode.
const SORT_PLAIN = {
  coverage: "Data coverage", symbol: "Name", cap: PLAIN_FIELD.cap_usd_m, si: PLAIN_FIELD.si_pct_float, float: PLAIN_FIELD.float_m,
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

// "up 6", "down 3", "new", "unchanged": the Simple table's change column.
function shortChange(d) {
  if (d == null) return "new";
  const r = Math.round(d);
  if (r === 0) return "unchanged";
  return `${r > 0 ? "up" : "down"} ${Math.abs(r)}`;
}

// When the run happened, in words that hold for the viewer's own clock.
function runWhen(iso, tz) {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "on the latest run";
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

// One sentence from meta: what matched, out of what, and what the plan lists.
// `universe` is the unfiltered match count for the same strategy and run,
// or null when it is not yet known; the sentence then leaves it out.
function ScreenUtility({ data, universe, activeCount, strat, tz }) {
  const { matched, shown, truncated, names_shown_limit } = data.meta;
  const when = runWhen(data.as_of, tz);
  const names = matched === 1 ? "name" : "names";
  const showing =
    shown === matched ? (
      <>
        showing all <b>{shown}</b>
      </>
    ) : (
      <>
        showing <b>{shown}</b>
      </>
    );
  let lead;
  if (activeCount === 0) {
    lead =
      matched === 0 ? (
        <>
          No names in your universe were scored on {strat.label} {when}.
        </>
      ) : (
        <>
          <b>{matched}</b> {names} in your universe scored on {strat.label} {when}; {showing}.
        </>
      );
  } else if (universe != null) {
    lead =
      matched === 0 ? (
        <>
          Nothing matched among the <b>{universe}</b> names in your universe.
        </>
      ) : (
        <>
          Matched <b>{matched}</b> of <b>{universe}</b> names in your universe; {showing}.
        </>
      );
  } else {
    lead =
      matched === 0 ? (
        <>Nothing in your universe matched these filters.</>
      ) : (
        <>
          Matched <b>{matched}</b> {names} in your universe; {showing}.
        </>
      );
  }
  return (
    <p className="utility">
      {lead}
      {truncated && (
        <>
          {" "}
          Your plan lists <b>{names_shown_limit}</b>; the other <b>{matched - shown}</b> are counted here, not shown.
        </>
      )}
    </p>
  );
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
  const asked = useRef(new Set());
  const [tableRef, tableScroll] = useSideScroll([data, loading, simple]);

  useEffect(() => setDraft(filters), [filters]);
  useEffect(() => setAdv(full && wide()), [full]);

  // The tab title matches the nav word and the heading; restored on leave.
  useEffect(() => {
    const prev = document.title;
    document.title = `${simple ? "Find names" : "Screener"} · tradealert.me`;
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
  const openRow = (r) => navigate(`/stock/${r.symbol}${strat.key !== "fast_mover" ? `?strategy=${strat.key}` : ""}`);
  const cursor = useRowNav(rows.length, {
    onOpen: (i) => rows[i] && openRow(rows[i]),
    onPin: (i) => {
      const r = rows[i];
      if (!r || !pins) return;
      const on = pins.has(r.symbol);
      api(`/me/picks${on ? `/${encodeURIComponent(r.symbol)}` : ""}`, on ? { method: "DELETE" } : { method: "POST", json: { symbol: r.symbol } })
        .then(() => {
          onPinChange(r.symbol, !on);
          toast(on ? `Removed ${r.symbol} from your watchlist.` : `Pinned ${r.symbol}.`);
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
      toCsv(rows, cols) + "\n# Research and information only; not investment advice. Scores rank names for a human to review.\n"
    );
  };

  const noun = nounFor(strat);

  // Facet chips over the whole matched set. Plain words in Simple mode.
  const facetChips = (plain) =>
    data && data.meta.matched > 0 ? (
      <div className="facets">
        {BANDS.filter((b) => data.facets.band[b]).map((b) => (
          <button key={b} type="button" className="fchip" aria-pressed={(filters.bands || "").split(",").includes(b)} onClick={() => facetGo("bands", b)}>
            {b} <span className="mono">{data.facets.band[b]}</span>
          </button>
        ))}
        {Object.entries(data.facets.industry).length > 1 &&
          Object.entries(data.facets.industry).map(([k, v]) => (
            <button key={k} type="button" className="fchip" aria-pressed={(filters.industries || "").split(",").includes(k)} onClick={() => facetGo("industries", k)}>
              {v.label} <span className="mono">{v.n}</span>
            </button>
          ))}
        {(data.facets.hf.pass > 0 || data.facets.hf.fail > 0) && (
          <>
            <button type="button" className="fchip" aria-pressed={filters.hf === "pass"} onClick={() => go({ ...filters, hf: filters.hf === "pass" ? "" : "pass" })}>
              {plain ? "cleared the filters" : "cleared"} <span className="mono">{data.facets.hf.pass}</span>
            </button>
            <button type="button" className="fchip" aria-pressed={filters.hf === "fail"} onClick={() => go({ ...filters, hf: filters.hf === "fail" ? "" : "fail" })}>
              {plain ? "failed a filter" : "failed"} <span className="mono">{data.facets.hf.fail}</span>
            </button>
          </>
        )}
        {["full", "partial", "thin"]
          .filter((c) => data.facets.coverage[c])
          .map((c) => (
            <button key={c} type="button" className="fchip" aria-pressed={filters.coverage === c} onClick={() => go({ ...filters, coverage: filters.coverage === c ? "" : c })}>
              {plain ? COV_PLAIN[c] : `${c} coverage`} <span className="mono">{data.facets.coverage[c]}</span>
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
          Band <Explain term="band" />
        </span>
        <div className="chips">
          {BANDS.map((b) => (
            <button key={b} type="button" className="fchip" aria-pressed={(draft.bands || "").split(",").includes(b)} onClick={() => toggleIn("bands", b)}>
              {b}
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
          {simple ? "Data coverage" : "Coverage"} <Explain term="coverage" />
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
          Hard filters{" "}
          <Explain
            title="Hard filters"
            text="Fast Mover's four filters: cap $300M-$3B, float under 50M, short interest over 10%, growth over 40%. Other strategies store no verdict."
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
            Stage <Explain term="lane" />
          </span>
          <select id="f-lane" value={draft.lane || ""} onChange={(e) => set("lane", e.target.value)}>
            <option value="">Any</option>
            <option value="Early">Early</option>
            <option value="Event">Event</option>
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
          <span>Text in symbol, theme, hook or thesis</span>
          <input id="f-q" value={draft.q || ""} onChange={(e) => set("q", e.target.value)} placeholder="e.g. HALEU, drone, GLP" />
        </label>
      </div>
      <div className="fgroup two">
        <Num id="f-dmin" label={simple ? "Change since last run at least" : "Δ run at least"} value={draft.min_delta} onChange={(v) => set("min_delta", v)} />
        <Num id="f-dmax" label="at most" value={draft.max_delta} onChange={(v) => set("max_delta", v)} />
      </div>
      <label className="check" style={{ padding: 0 }}>
        <input type="checkbox" checked={draft.new === "1"} onChange={(e) => set("new", e.target.checked ? "1" : "")} />
        <span>New this run only</span>
      </label>
      <label className="check" style={{ padding: 0 }}>
        <input type="checkbox" checked={draft.pinned === "1"} onChange={(e) => set("pinned", e.target.checked ? "1" : "")} />
        <span>My pinned names only</span>
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
          Apply filters
        </button>
      </div>
    </aside>
  );

  const anyPresetOn = PRESETS.some(presetOn);

  return (
    <div className="wrap screen-v">
      <div className="pagehead">
        <div>
          <h1>{simple ? "Find names" : "Screener"}</h1>
          {data ? (
            <ScreenUtility data={data} universe={universeFor} activeCount={activeCount} strat={strat} tz={tz} />
          ) : (
            <div className="meta">Filter your universe on score, coverage, the hard filters and the market data on file. The address is the screen; share it as a link.</div>
          )}
        </div>
        <div className="actions">
          <select
            className="inline"
            value={stratKey}
            aria-label="Strategy lens"
            onChange={(e) => go({ ...filters, strategy: e.target.value === "fast_mover" ? "" : e.target.value })}
          >
            {(strategies || [{ key: "fast_mover", label: "Fast Mover", calibrated: true }]).map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
                {s.calibrated ? "" : " (provisional)"}
              </option>
            ))}
          </select>
          <button className="btn btn-secondary btn-sm fpanel-toggle full-only" onClick={() => setAdv((a) => !a)} aria-expanded={adv}>
            Filters{activeCount ? ` · ${activeCount}` : ""}
          </button>
        </div>
      </div>

      <section className="find simple-only" aria-labelledby="find-h">
        <h2 id="find-h" className="find-h">
          Find names that…
        </h2>
        <div className="find-grid">
          {PRESETS.map((p) => {
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
        <p className="hint">{anyPresetOn ? "Tap the card again to clear it, or open Advanced filters to go further." : "Pick one to start. The results update as you go."}</p>
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
            Advanced filters
            <span className="sum-note">{activeCount ? `${activeCount} on` : "none on"}</span>
          </summary>
          <div className="acc-body">{Panel}</div>
        </details>
        <div className="screen-main">
          {data && (
            <div className="boardhead">
              <Monogram size={20}>{strat.monogram}</Monogram>
              <b>{strat.label}</b>
              <StatusChip calibrated={strat.calibrated} short />
              <span className="full-only">
                <b>{data.meta.matched}</b> {data.meta.matched === 1 ? "name matches" : "names match"} · showing {data.meta.shown}
              </span>
              <span>run {dateTime(data.as_of, tz)}</span>
              <span className="spacer" />
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
              <button className="btn-quiet" onClick={() => go({ ...filters, dir: data.meta.dir === "asc" ? "desc" : "asc" })} title="Flip sort direction">
                {data.meta.dir === "asc" ? (simple ? "↑ lowest first" : "↑ asc") : simple ? "↓ highest first" : "↓ desc"}
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

          <div className="full-only">{facetChips(false)}</div>

          {err && <ErrorCard error={err} onRetry={() => setReload((n) => n + 1)} title="Couldn't run the screen." />}
          {loading && !err && <Skeleton rows={8} height={40} />}
          {!loading && data && rows.length === 0 && (
            <Empty
              title={
                activeCount
                  ? "Nothing in your universe matches these filters."
                  : strat.key !== "fast_mover"
                    ? `No ${strat.label} ${noun}s were scored on the latest run.`
                    : "No names were scored on the latest run."
              }
              action={
                activeCount ? (
                  <button className="btn btn-secondary" onClick={clear}>
                    Clear filters
                  </button>
                ) : strat.key !== "fast_mover" ? (
                  <button className="btn btn-secondary" onClick={() => go({})}>
                    Back to Fast Mover
                  </button>
                ) : (
                  <Link to="/board" className="btn btn-secondary">
                    Open the Board
                  </Link>
                )
              }
            >
              {activeCount ? "Loosen one filter, or pick a different card above." : "Scores regenerate each morning."}
            </Empty>
          )}

          {!loading && data && rows.length > 0 && (
            <>
              {tableScroll.can && <p className="hint tscroll-hint">Swipe sideways for more columns.</p>}
              <div className={`tscroll-wrap ${tableScroll.can && !tableScroll.end ? "fade" : ""}`}>
                <div className={`table-card cards ${simple ? "simple-table" : ""}`} ref={tableRef}>
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
                        <Th simple={simple} plain="Score" term={simple ? "score" : "band"}>
                          Band
                        </Th>
                        <Th simple={simple} plain="Inputs with data" term="coverage" num>
                          Cov
                        </Th>
                        <Th simple={simple} plain="Since last run" term="delta_run" num>
                          Δ run
                        </Th>
                        <Th simple={simple} plain="Passed filters?" text="Hard-filter verdict stored with the score. — means the strategy stores none.">
                          Screen
                        </Th>
                        <Th simple={simple} plain={PLAIN_FIELD.cap_usd_m} term="market_cap" num>
                          Cap
                        </Th>
                        <Th simple={simple} plain={PLAIN_FIELD.si_pct_float} term="short_interest" num>
                          SI %
                        </Th>
                        <Th simple={simple} plain={PLAIN_FIELD.float_m} term="float" num>
                          Float
                        </Th>
                        <Th simple={simple} plain={PLAIN_FIELD.fee_pct} term="borrow_fee" num>
                          Fee
                        </Th>
                        <Th simple={simple} plain={PLAIN_FIELD.volx20d} term="volume_x" num>
                          Vol×
                        </Th>
                        <Th simple={simple} plain={PLAIN_FIELD.run3m_pct} term="run3m" num>
                          3m
                        </Th>
                        <Th simple={simple} plain="30 days" text="Price change over 30 days from daily closes, with the gap to the industry's ETF beneath." num>
                          30d
                        </Th>
                        <Th simple={simple} plain={PLAIN_FIELD.earnings} term="catalyst">
                          Earnings
                        </Th>
                        <th scope="col">
                          <span className="sr-only">{simple ? "Actions" : "Pin"}</span>
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
                            <td className="num c-cov cov-cell" data-label={simple ? "Inputs with data" : "Coverage"} title={`${cov.present} of ${cov.total} inputs had data`}>
                              <span className="covbar" aria-hidden="true">
                                {[0, 1, 2].map((k) => (
                                  <span key={k} className={k < cov.segments ? "filled" : ""} />
                                ))}
                              </span>
                              {r.components_present}/{r.components_total}
                            </td>
                            {simple ? (
                              <td className="num c-delta" data-label="Since last run" title={changeSentence(r.delta_1d)}>
                                {shortChange(r.delta_1d)}
                              </td>
                            ) : (
                              <td className="num c-delta" data-label="Δ">
                                {delta(r.delta_1d)}
                              </td>
                            )}
                            <td className="c-hide">
                              {r.hf_pass == null ? (
                                <span className="faint">—</span>
                              ) : (
                                <span className={`verdict ${r.hf_pass ? "pass" : "fail"}`}>{r.hf_pass ? "✓ PASS" : `✕ ${r.hf_fails} FAIL`}</span>
                              )}
                            </td>
                            <td className="num c-hide">{fmtMoney(sn.cap_usd_m)}</td>
                            <td className="num c-hide">{sn.si_pct_float == null ? "—" : `${sn.si_pct_float}%`}</td>
                            <td className="num c-hide">{sn.float_m == null ? "—" : `${sn.float_m}M`}</td>
                            <td className="num c-hide">{sn.fee_pct == null ? "—" : `${sn.fee_pct}%`}</td>
                            <td className="num c-hide">{sn.volx20d == null ? "—" : `${sn.volx20d}x`}</td>
                            <td className={`num c-hide ${tone(sn.run3m_pct)}`}>{pct(sn.run3m_pct, 0)}</td>
                            <td className="c-move" data-label={simple ? "30 days" : "30d"}>
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
                            {simple ? (
                              <td className="c-act" onClick={(e) => e.stopPropagation()}>
                                <span className="act">
                                  {pins && <Pin symbol={r.symbol} pinned={pins.has(r.symbol)} onChange={onPinChange} />}
                                  <NotifyButton symbol={r.symbol} compact />
                                </span>
                              </td>
                            ) : (
                              <td className="c-pin">{pins && <Pin symbol={r.symbol} pinned={pins.has(r.symbol)} onChange={onPinChange} />}</td>
                            )}
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
                    {selected.size} of {MAX_COMPARE} selected: <span className="mono">{[...selected].join(", ")}</span>
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

              {data.meta.truncated && (
                <div className="upgrade-card">
                  <div className="copy">
                    <b>{data.meta.matched - data.meta.shown}</b> more {data.meta.matched - data.meta.shown === 1 ? "name" : "names"} in your universe{" "}
                    {data.meta.matched - data.meta.shown === 1 ? "matches" : "match"} this screen than this list reaches; your plan lists{" "}
                    <b>{data.meta.names_shown_limit}</b>.
                    {nextTier && (
                      <>
                        {" "}
                        On <b>{nextTier.label}</b> this list would reach {nextTier.names_shown_limit} names and we would tell you which of them changed band
                        each morning
                        {nextTier.alerts_limit === 0 ? (
                          "."
                        ) : (
                          <>
                            , with {alertsLabel(nextTier.alerts_limit)} on{" "}
                            {nextTier.picks_limit == null || nextTier.picks_limit >= 999 ? "the names you pin" : `up to ${plural(nextTier.picks_limit, "pinned name")}`}.
                          </>
                        )}
                      </>
                    )}
                  </div>
                  {nextTier && (
                    <div className="actions">
                      <Link to="/pricing" className="btn btn-primary btn-sm">
                        See plans — {dollars(nextTier.price_monthly_cents)}/mo
                      </Link>
                    </div>
                  )}
                </div>
              )}

              <p className="footnote">
                Market data columns show the latest snapshot on file per name; each figure carries its own date on the report. <kbd className="kbd">j</kbd>/<kbd className="kbd">k</kbd>{" "}
                move, <kbd className="kbd">↵</kbd> open, <kbd className="kbd">p</kbd> pin. {strat.label} {noun}s rank names for a human to review; nothing here is a recommendation.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
