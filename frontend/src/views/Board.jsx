import React, { useEffect, useMemo, useRef, useState } from "react";
import { api, cached, toast } from "../api.js";
import { Link, navigate, useQuery } from "../lib/router.jsx";
import { useMe } from "../lib/me.jsx";
import {
  age,
  alertsLabel,
  coverage,
  dateTime,
  delta,
  dollars,
  downloadText,
  inDays,
  industriesLabel,
  pct,
  plural,
  score as fmtScore,
  shortDate,
  toCsv,
  tone,
} from "../lib/fmt.js";
import { EVIDENCE, nounFor } from "../lib/evidence.js";
import { useRowNav } from "../lib/rownav.js";
import { useMode } from "../lib/mode.js";
import { CTA, bandWord, changeSentence } from "../lib/plain.js";
import { openUpgrade } from "../lib/upgrade.js";
import { LIST_CARDS } from "../lib/caps.js";
import { FINE_PRINT_SHORT } from "../lib/legal.js";
import SearchBar from "../components/SearchBar.jsx";
import ScoreBadge from "../components/ScoreBadge.jsx";
import NameCard, { ShowAll } from "../components/NameCard.jsx";
import Pin from "../components/Pin.jsx";
import Spark, { Move } from "../components/Spark.jsx";
import Explain from "../components/Explain.jsx";
import NotifyButton from "../components/NotifyButton.jsx";
import ScreenHead from "../components/ScreenHead.jsx";
import FinePrint from "../components/FinePrint.jsx";
import { PlainStatusChip, StrategyPlainCard } from "../components/Plain.jsx";
import { AgeChip, Empty, ErrorCard, Monogram, Notice, Skeleton } from "../components/ui.jsx";
import "./board.css";

// Storage access throws in Safari private browsing; preferences degrade to
// defaults rather than taking the board down.
const store = (kind) => ({
  get(k) {
    try {
      return window[kind].getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      window[kind].setItem(k, v);
    } catch {
      /* preference just won't persist */
    }
  },
});
const ls = store("localStorage");
const ss = store("sessionStorage");

const SORTS = {
  score: { label: "Score", cmp: (a, b) => b.value - a.value },
  delta: {
    label: "Change since the last scoring",
    cmp: (a, b) => (b.delta_1d ?? -Infinity) - (a.delta_1d ?? -Infinity),
  },
  symbol: { label: "Symbol", cmp: (a, b) => a.symbol.localeCompare(b.symbol) },
  coverage: {
    label: "Coverage",
    cmp: (a, b) =>
      b.components_present / Math.max(1, b.components_total) -
      a.components_present / Math.max(1, a.components_total),
  },
  px30: {
    label: "30-day price move",
    cmp: (a, b) => ((b.price && b.price.chg_30d) ?? -Infinity) - ((a.price && a.price.chg_30d) ?? -Infinity),
  },
  rel30: {
    label: "30-day move vs ETF",
    cmp: (a, b) => ((b.price && b.price.rel_30d) ?? -Infinity) - ((a.price && a.price.rel_30d) ?? -Infinity),
  },
  earnings: {
    label: "Next earnings",
    cmp: (a, b) => (a.earnings_in ?? Infinity) - (b.earnings_in ?? Infinity),
  },
};

// Plain names for the sort menu in Simple mode; Full keeps the originals.
const SORT_PLAIN = { coverage: "How much data", symbol: "Name", px30: "30-day price move", rel30: "30-day move vs the sector ETF" };

// Column explainers, in the words of DESIGN_V6 §7: plain word first.
const HELP = {
  score:
    "A 0 to 100 number saying how well a name fits this strategy's setup this morning. Thin data pulls it toward neutral and marks it with ~.",
  band: "The rating word (band): strong, elevated, neutral or weak. The word carries the meaning; the colour only repeats it.",
  coverage:
    "How much data the score had (coverage). Two of three segments: some inputs missing, so the score was pulled toward neutral.",
  delta: "Change in the score since the last scoring. 'new' means the name was not scored last time.",
  screen:
    "The must-pass rules: PASS when every rule passed, FAIL when one did not. A name flagged FAIL is still rated. Only Fast Mover stores a verdict.",
  px: "Price change over the last 30 days from daily closes, and the gap to the industry's ETF over the same window.",
};

const BANDS = ["strong", "elevated", "neutral", "weak", "excluded"];
const MAX_COMPARE = 4;

const FALLBACK_STRATEGIES = [{ key: "fast_mover", label: "Fast Mover", monogram: "FM", calibrated: true }];

// measured / provisional / not_running, from the plain copy when the API
// carries it, else from the calibration flag.
function statusOf(s) {
  if (s && s.plain && s.plain.status) return s.plain.status;
  return s && s.calibrated ? "measured" : "provisional";
}

// Whether an element scrolls sideways, and whether it is scrolled to the
// end, so a fade shows only while there is something left to reach.
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

// A filter pill whose word carries its own explainer: the main button
// toggles the filter, the "?" inside the pill opens the definition.
function SplitPill({ on, onClick, term, count, children }) {
  return (
    <span className={`fchip split ${on ? "on" : ""}`}>
      <button type="button" className="fchip-main" aria-pressed={on} onClick={onClick}>
        {children} <span className="count">{count}</span>
      </button>
      <Explain term={term} />
    </span>
  );
}

function nextTierFor(tiers, current) {
  if (!tiers || !current) return null;
  const sorted = [...tiers].sort((a, b) => a.price_monthly_cents - b.price_monthly_cents);
  return sorted.find((t) => t.price_monthly_cents > (current.price_monthly_cents || 0)) || null;
}

// "up to 10 watched names", or "the names you watch" when the plan sets no cap.
function watchedLabel(limit) {
  if (limit == null || limit >= 999) return "the names you watch";
  return `up to ${plural(limit, "watched name")}`;
}

// "today", "tomorrow", "in 12 days": the one dated event, in words. Past
// dates are not a next event, so they read as nothing.
export function daysWords(n) {
  if (n == null || n < 0) return null;
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  return `in ${n} days`;
}

function nextEventWords(r) {
  const w = daysWords(r.earnings_in);
  return w ? `earnings ${w}` : null;
}

// When the scoring happened, in words that hold for the viewer's own clock:
// "this morning", "today", "yesterday", "on Aug 9".
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
  return `on ${t.toLocaleDateString(undefined, { month: "short", day: "numeric", ...opts })}`;
}

// The screen's one line (DESIGN_V6 §7), fourteen words at most, from the
// rows the board returned: "50 names in your 3 industries, rated this
// morning: 7 strong, 30 elevated." Nothing here is derived from data the
// payload does not carry.
function boardLine(data, rows, tz) {
  const keys = data.meta.industries && data.meta.industries.length ? data.meta.industries : [...new Set(rows.map((r) => r.industry.key))];
  const scope = keys.length === 1 ? "your industry" : `your ${keys.length} industries`;
  const strong = rows.filter((r) => r.band === "strong").length;
  const elevated = rows.filter((r) => r.band === "elevated").length;
  return `${plural(rows.length, "name")} in ${scope}, rated ${runWhen(data.as_of, tz)}: ${strong} strong, ${elevated} elevated.`;
}

export default function Board() {
  const { me } = useMe();
  const { simple, full } = useMode();
  const q = useQuery();
  const [strategies, setStrategies] = useState(null);
  const [industriesAll, setIndustriesAll] = useState([]);
  const [tiers, setTiers] = useState(null);
  const [strategy, setStrategy] = useState(q.get("strategy") || ls.get("ta_board_strategy") || "fast_mover");
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [industry, setIndustry] = useState(q.get("industry") || "all");
  const [sort, setSort] = useState("score");
  const [compact, setCompact] = useState(ls.get("ta_board_density") === "compact");
  const [pins, setPins] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [newRun, setNewRun] = useState(null);
  const [strip, setStrip] = useState(() => q.get("first_run") === "1" || ls.get("ta_board_intro_hidden") !== "1");
  const [provHidden, setProvHidden] = useState({});
  const [upgradeHidden, setUpgradeHidden] = useState(ss.get("ta_upgrade_hidden") === "1");
  const [lane, setLane] = useState(q.get("lane") || "all");
  const [cleared, setCleared] = useState(q.get("cleared") === "1");
  const [priceCols, setPriceCols] = useState(ls.get("ta_board_px") === "1");
  const [howOpen, setHowOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [tabsRef, tabsScroll] = useSideScroll([strategies]);

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
    setNewRun(null);
    setShowAll(false);
    ls.set("ta_board_strategy", strategy);
    window.history.replaceState({}, "", strategy === "fast_mover" ? "/board" : `/board?strategy=${encodeURIComponent(strategy)}`);
    api(`/board?strategy=${encodeURIComponent(strategy)}`)
      .then((d) => {
        if (!alive) return;
        setData(d);
        if (!q.get("industry")) setIndustry(ls.get(`ta_board_ind_${strategy}`) || "all");
      })
      .catch((e) => alive && setErr(e))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strategy, reload]);

  // A new run never moves rows under the cursor: it shows up as a notice
  // the subscriber chooses to act on.
  useEffect(() => {
    if (!data) return undefined;
    const check = () =>
      api("/runs/latest")
        .then((r) => {
          if (r && r.as_of && r.as_of !== data.as_of) setNewRun(r);
        })
        .catch(() => {});
    const t = setInterval(check, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [data]);

  const tz = me && me.settings ? me.settings.timezone : undefined;
  const listed = (strategies || []).find((s) => s.key === strategy);
  const strat = { ...((data && data.strategy) || listed || { key: strategy, label: "Board", calibrated: false }), plain: listed && listed.plain };
  const rows = useMemo(() => (data ? data.rows : []), [data]);

  const followed = useMemo(() => {
    if (!data) return [];
    const keys = data.meta.industries || [];
    return keys
      .map((k) => industriesAll.find((i) => i.key === k) || rows.find((r) => r.industry.key === k)?.industry)
      .filter(Boolean)
      .map((i) => ({ key: i.key, label: i.label, etf: i.benchmark_etf }));
  }, [data, industriesAll, rows]);

  const view = useMemo(() => {
    let filtered = industry === "all" ? rows : rows.filter((r) => r.industry.key === industry);
    if (lane !== "all") filtered = filtered.filter((r) => (r.lane || "") === lane);
    if (cleared) filtered = filtered.filter((r) => r.hf_pass === true);
    const ranked = [...filtered].sort(SORTS.score.cmp).map((r, i) => ({ ...r, viewRank: i + 1 }));
    return ranked.sort(SORTS[sort].cmp);
  }, [rows, industry, lane, cleared, sort]);
  const lanes = useMemo(() => [...new Set(rows.map((r) => r.lane).filter(Boolean))].sort(), [rows]);
  const clearedCount = useMemo(() => rows.filter((r) => r.hf_pass === true).length, [rows]);
  const hasVerdicts = useMemo(() => rows.some((r) => r.hf_pass != null), [rows]);
  const earningsSoon = useMemo(() => rows.filter((r) => r.earnings_in != null && r.earnings_in >= 0 && r.earnings_in <= 14).length, [rows]);

  const movers = useMemo(() => {
    if (view.length < 4) return null;
    const withDelta = view.filter((r) => r.delta_1d != null);
    const up = [...withDelta].filter((r) => r.delta_1d > 0).sort((a, b) => b.delta_1d - a.delta_1d).slice(0, 3);
    const down = [...withDelta].filter((r) => r.delta_1d < 0).sort((a, b) => a.delta_1d - b.delta_1d).slice(0, 3);
    const fresh = view.filter((r) => r.delta_1d == null).slice(0, 3);
    if (!up.length && !down.length && !fresh.length) return null;
    return { up, down, fresh };
  }, [view]);

  const distribution = useMemo(() => {
    const d = {};
    view.forEach((r) => {
      d[r.band] = (d[r.band] || 0) + 1;
    });
    return d;
  }, [view]);

  // Simple shows LIST_CARDS cards before "Show all N"; Full shows the table.
  const cards = simple && !showAll ? view.slice(0, LIST_CARDS) : view;
  const navRows = simple ? cards : view;

  const pickIndustry = (k) => {
    setIndustry(k);
    ls.set(`ta_board_ind_${strategy}`, k);
  };
  const resetFilters = () => {
    pickIndustry("all");
    setLane("all");
    setCleared(false);
  };
  const hideStrip = () => {
    ls.set("ta_board_intro_hidden", "1");
    setStrip(false);
  };
  const openHowto = (e) => {
    e.preventDefault();
    setHowOpen(true);
    requestAnimationFrame(() => {
      const el = document.getElementById("board-howto");
      if (el && el.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };
  const toggleDensity = () => {
    const next = !compact;
    setCompact(next);
    ls.set("ta_board_density", next ? "compact" : "comfortable");
  };
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

  const hrefFor = (r) => `/stock/${r.symbol}${strategy !== "fast_mover" ? `?strategy=${strategy}` : ""}`;
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
  const togglePriceCols = () => {
    const next = !priceCols;
    setPriceCols(next);
    ls.set("ta_board_px", next ? "1" : "0");
  };

  const exportCsv = () => {
    const cols = [
      { label: "rank", get: (r) => r.viewRank },
      { label: "symbol", get: (r) => r.symbol },
      { label: "theme", get: (r) => r.theme },
      { label: "industry", get: (r) => r.industry.label },
      { label: "strategy", get: () => strat.label },
      { label: "score", get: (r) => Math.round(r.value) },
      { label: "band", get: (r) => r.band },
      { label: "coverage", get: (r) => `${r.components_present}/${r.components_total}` },
      { label: "delta_since_last_run", get: (r) => (r.delta_1d == null ? "new" : Math.round(r.delta_1d)) },
      { label: "lane", get: (r) => r.lane || "" },
      { label: "hard_filters", get: (r) => (r.hf_pass == null ? "" : r.hf_pass ? "pass" : "fail") },
      { label: "px_chg_30d", get: (r) => (r.price && r.price.chg_30d != null ? r.price.chg_30d : "") },
      { label: "px_rel_30d_vs_etf", get: (r) => (r.price && r.price.rel_30d != null ? r.price.rel_30d : "") },
      { label: "earnings_in_days", get: (r) => (r.earnings_in == null ? "" : r.earnings_in) },
      { label: "run_as_of", get: () => data.as_of },
    ];
    const csv = toCsv(view, cols) + `\n# ${FINE_PRINT_SHORT} Scores rank names for a human to review.\n`;
    downloadText(`tradealert-board-${strategy}-${data.as_of.slice(0, 10)}.csv`, csv);
  };

  const runAge = data ? age(data.as_of) : null;
  const stale = runAge && runAge.hours > 36;
  const nextTier = nextTierFor(tiers, me && me.tier);
  const noun = nounFor(strat);
  const strongCount = rows.filter((r) => r.band === "strong").length;
  const elevatedCount = rows.filter((r) => r.band === "elevated").length;
  const scopeLabel =
    industry !== "all"
      ? followed.find((f) => f.key === industry)?.label
      : followed.length === 1
        ? followed[0].label
        : followed.length > 1
          ? `${followed.length} followed industries`
          : "your followed industries";
  const distTotal = view.length;
  const allOn = industry === "all" && lane === "all" && !cleared;
  const status = statusOf(strat);
  // the one action: alerts on the top-ranked name in view, whatever the sort
  const topName = view.find((r) => r.viewRank === 1) || view[0] || null;

  // The strategy row: not-running strategies are hidden in Simple and
  // labelled in Full. The chosen one always shows, whatever its state.
  const strategyRow = (strategies || FALLBACK_STRATEGIES).filter((s) => full || statusOf(s) !== "not_running" || s.key === strategy);

  const industryControl =
    followed.length > 1 ? (
      <>
        <div className="seg ind-seg" role="group" aria-label="Industry">
          <button aria-pressed={industry === "all"} onClick={() => pickIndustry("all")}>
            All my industries
          </button>
          {followed.map((f) => (
            <button key={f.key} aria-pressed={industry === f.key} onClick={() => pickIndustry(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
        {simple && (
          <label className="ctl ind-select">
            Industry
            <select className="inline" value={industry} onChange={(e) => pickIndustry(e.target.value)} aria-label="Industry">
              <option value="all">All my industries</option>
              {followed.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </>
    ) : followed.length === 1 ? (
      <Link to={`/industries/${followed[0].key}`} className="ctl">
        {followed[0].label} <span className="faint full-only">{followed[0].etf}</span>
      </Link>
    ) : null;

  const sortControl = (
    <label className="ctl">
      Sort
      <select className="inline" value={sort} onChange={(e) => setSort(e.target.value)}>
        {Object.entries(SORTS).map(([k, s]) => (
          <option key={k} value={k}>
            {simple ? SORT_PLAIN[k] || s.label : s.label}
          </option>
        ))}
      </select>
    </label>
  );

  const screenerLink = (
    <Link
      to={`/screen${strategy !== "fast_mover" ? `?strategy=${strategy}` : ""}${industry !== "all" ? `${strategy !== "fast_mover" ? "&" : "?"}industries=${industry}` : ""}`}
      className="btn-quiet"
    >
      Open in Find
    </Link>
  );

  // One notice at a time in Simple, the most urgent first; Full stacks them.
  const notices = [];
  if (newRun)
    notices.push(
      <Notice key="newrun" tone="info" onDismiss={() => setNewRun(null)}>
        New scores are ready from the scoring at {dateTime(newRun.as_of, tz)}.{" "}
        <button className="btn btn-primary btn-sm" onClick={() => setReload((n) => n + 1)}>
          Show me the new scores
        </button>
      </Notice>
    );
  if (me && !me.verified)
    notices.push(
      <Notice key="verify" tone="warn">
        Verify your email to receive alerts and digests. The link is in the message we sent to <b>{me.email}</b>; the Board works without it.
      </Notice>
    );
  if (stale)
    notices.push(
      <Notice key="stale" tone="warn">
        The last scoring was on {shortDate(data.as_of, tz)}; scores may be out of date.
      </Notice>
    );
  if (data && status === "provisional" && rows.length > 0 && !provHidden[strategy])
    notices.push(
      <Notice key="prov" tone="warn" onDismiss={() => setProvHidden((h) => ({ ...h, [strategy]: true }))}>
        <b>{strat.label}</b> has no measured record yet. Its names are candidates, not signals.{" "}
        <Link to={`/strategies/${strategy}`}>How {strat.label} looks</Link>
      </Notice>
    );

  return (
    <div className="wrap board-v">
      <ScreenHead
        title="Ranked for me"
        line={data && rows.length > 0 ? boardLine(data, rows, tz) : "The names in your industries, rated each morning by one strategy at a time."}
        action={topName ? <NotifyButton symbol={topName.symbol} label={CTA.ALERT_ME_ON(topName.symbol)} /> : null}
        secondary={
          <>
            <SearchBar />
            <Link to={`/strategies/${strategy}`} className="btn-quiet">
              How it hunts
            </Link>
          </>
        }
      />

      {simple ? notices.slice(0, 1) : notices}

      <div className="lens">
        <span className="lens-label">Strategy</span>
        <div
          className="tabs"
          role="tablist"
          aria-label="Strategy"
          ref={tabsRef}
          data-scroll={tabsScroll.can ? "1" : undefined}
          data-end={tabsScroll.end ? "1" : undefined}
        >
          {strategyRow.map((s) => {
            const st = statusOf(s);
            return (
              <span key={s.key} className={`tab ${s.key === strategy ? "on" : ""}`} role="presentation">
                <button type="button" role="tab" className="tab-main" aria-selected={s.key === strategy} onClick={() => setStrategy(s.key)}>
                  <Monogram size={20}>{s.monogram}</Monogram>
                  {s.label}
                </button>
                {full && st === "not_running" && <span className="chip chip-plain">not running yet</span>}
                {full && st === "provisional" && <span className="chip chip-prov">No record yet</span>}
              </span>
            );
          })}
        </div>
      </div>

      {strat.plain && strat.plain.one_line && (
        <div className="lens-plain">
          <PlainStatusChip status={status} />
          <StrategyPlainCard strategy={strat} compact />
        </div>
      )}

      {full && strip && (
        <div className="strip">
          <span>
            {stale ? (
              <>
                Scores update each morning; this one is <AgeChip asOf={data.as_of} words />.
              </>
            ) : (
              "Scores update each morning."
            )}{" "}
            Open any row for the full report; the Data column shows how much data backed each score. Watch a name to keep it in your weekly brief;
            tick names to compare them.{" "}
            <a href="#board-howto" className="strip-link" onClick={openHowto}>
              How to read this board
            </a>
          </span>
          <button className="btn-quiet" onClick={hideStrip}>
            Got it
          </button>
        </div>
      )}

      {simple ? (
        <div className="filterrow" role="group" aria-label="Show">
          <button type="button" className="fchip" aria-pressed={allOn} onClick={resetFilters}>
            All <span className="count">{rows.length}</span>
          </button>
          {hasVerdicts && (
            <SplitPill on={cleared} onClick={() => setCleared((c) => !c)} term="hard_filter" count={clearedCount}>
              Passed every rule
            </SplitPill>
          )}
          {earningsSoon > 0 && (
            <Link to="/calendar?days=14" className="fchip" title="Names with a dated earnings print inside 14 days">
              Earnings in 14 days <span className="count">{earningsSoon}</span>
            </Link>
          )}
          {industryControl}
          {rows.length > 1 && sortControl}
        </div>
      ) : (
        <div className="toolbar">
          {industryControl}
          {lanes.length > 1 && (
            <div className="seg" role="group" aria-label="Stage">
              <button aria-pressed={lane === "all"} onClick={() => setLane("all")}>
                Any stage
              </button>
              {lanes.map((l) => (
                <button key={l} aria-pressed={lane === l} onClick={() => setLane(l)}>
                  {l}
                </button>
              ))}
            </div>
          )}
          {hasVerdicts && (
            <button className="fchip" aria-pressed={cleared} onClick={() => setCleared((c) => !c)} title={HELP.screen}>
              Passed every rule <span className="count">{clearedCount}</span>
            </button>
          )}
          {earningsSoon > 0 && (
            <Link to="/calendar?days=14" className="fchip" title="Names with a dated earnings print inside 14 days">
              Earnings in 14d <span className="count">{earningsSoon}</span>
            </Link>
          )}
          <span className="spacer" />
          {screenerLink}
          <button className="btn-quiet" onClick={togglePriceCols} aria-pressed={priceCols} title={HELP.px}>
            {priceCols ? "Fewer columns" : "More columns"}
          </button>
          {sortControl}
          <button className="btn-quiet" onClick={toggleDensity} aria-pressed={compact}>
            {compact ? "Comfortable rows" : "Compact rows"}
          </button>
          {data && view.length > 0 && (
            <button className="btn-quiet" onClick={exportCsv} title="Download the visible rows as CSV">
              Export CSV
            </button>
          )}
        </div>
      )}

      {full && data && (
        <div className="boardhead">
          <b>{strat.label}</b>
          <span>
            {view.length} of {data.meta.shown} names · {scopeLabel}
          </span>
          <span>scored {dateTime(data.as_of, tz)}</span>
          {distTotal > 0 && (
            <span className="row" style={{ gap: "var(--s-2)" }} title="Band distribution of the visible rows">
              <span className="dist" style={{ width: 120 }} aria-hidden="true">
                {BANDS.map((b) => (distribution[b] ? <span key={b} className={b} style={{ width: `${(distribution[b] / distTotal) * 100}%` }} /> : null))}
              </span>
              <span className="xs faint">{BANDS.filter((b) => distribution[b]).map((b) => `${distribution[b]} ${b}`).join(" · ")}</span>
            </span>
          )}
        </div>
      )}

      {err && err.status !== 404 && <ErrorCard error={err} onRetry={() => setReload((n) => n + 1)} title="Couldn't load the board." />}
      {loading && !err && <Skeleton rows={simple ? 5 : 8} height={simple ? 96 : 56} />}

      {!loading && (err?.status === 404 || (data && rows.length === 0)) && (
        <BoardEmpty me={me} strat={strat} status={status} onFastMover={() => setStrategy("fast_mover")} />
      )}

      {!loading && data && rows.length > 0 && view.length === 0 && (
        <Empty
          title="No names match."
          action={
            <button className="btn btn-secondary" onClick={resetFilters}>
              Show me every name
            </button>
          }
        >
          {simple ? "Every name is back with the All pill." : null}
        </Empty>
      )}

      {!loading && data && view.length > 0 && simple && (
        <>
          <ol className="bcards" aria-label={`${strat.label} names`}>
            {cards.map((r, i) => {
              const ev = nextEventWords(r);
              return (
                <NameCard
                  key={r.symbol}
                  index={i}
                  cursor={cursor === i}
                  symbol={r.symbol}
                  sub={r.industry.label}
                  to={hrefFor(r)}
                  sentence={changeSentence(r.delta_1d, r.band)}
                  meta={
                    <>
                      <b>{bandWord(r.band)}</b> <span className="num">{fmtScore(r.value, r.components_present, r.components_total)}</span>
                      {ev ? <> · {ev}</> : null}
                    </>
                  }
                  action={<NotifyButton symbol={r.symbol} compact />}
                />
              );
            })}
          </ol>
          <ShowAll total={view.length} shown={cards.length} open={showAll} onToggle={() => setShowAll((v) => !v)} />
        </>
      )}

      {!loading && data && view.length > 0 && full && (
        <>
          {movers && (
            <div className="movers">
              <MoverCard title="Up most since the last scoring" rows={movers.up} />
              <MoverCard title="Down most since the last scoring" rows={movers.down} />
              <MoverCard title="New on the board" rows={movers.fresh} fresh />
            </div>
          )}

          <div className="table-card cards">
            <table className={`data ${compact ? "compact" : "comfortable"}`}>
              <thead>
                <tr>
                  <th scope="col" className="c-sel">
                    <span className="sr-only">Select for compare</span>
                  </th>
                  <th className="rank" scope="col">
                    #
                  </th>
                  <SortTh k="symbol" sort={sort} setSort={setSort}>
                    Name
                  </SortTh>
                  <th scope="col">Industry</th>
                  <SortTh k="score" sort={sort} setSort={setSort} num help={HELP.score} title="Score">
                    Score
                  </SortTh>
                  <th scope="col">
                    Rating
                    <Explain text={HELP.band} title="Rating (band)" />
                  </th>
                  <SortTh k="coverage" sort={sort} setSort={setSort} num help={HELP.coverage} title="How much data (coverage)">
                    Data
                  </SortTh>
                  <SortTh k="delta" sort={sort} setSort={setSort} num help={HELP.delta} title="Change since the last scoring">
                    Δ run
                  </SortTh>
                  {hasVerdicts && (
                    <th scope="col">
                      Rules
                      <Explain text={HELP.screen} title="Must-pass rules" />
                    </th>
                  )}
                  <th scope="col" className="c-spark">
                    <span className="sr-only">30-day sparkline</span>
                  </th>
                  <SortTh k="px30" sort={sort} setSort={setSort} num help={HELP.px} title="30-day move">
                    30d
                  </SortTh>
                  {priceCols && (
                    <>
                      <SortTh k="rel30" sort={sort} setSort={setSort} num term="benchmark">
                        vs ETF
                      </SortTh>
                      <SortTh k="earnings" sort={sort} setSort={setSort}>
                        Earnings
                      </SortTh>
                    </>
                  )}
                  <th scope="col">
                    <span className="sr-only">Watch</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {view.map((r, i) => {
                  const cov = coverage(r.components_present, r.components_total);
                  return (
                    <tr key={r.symbol} data-rownav={i} className={`rowlink ${cursor === i ? "cursor" : ""}`} onClick={() => openRow(r)}>
                      <td className="c-sel c-hide" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selected.has(r.symbol)}
                          onChange={() => toggleSelect(r.symbol)}
                          aria-label={`Select ${r.symbol} for compare`}
                        />
                      </td>
                      <td className="rank c-rank">{r.viewRank}</td>
                      <td className="name-cell c-sym">
                        <Link className="sym" to={`/stock/${r.symbol}`} onClick={(e) => e.stopPropagation()}>
                          {r.symbol}
                        </Link>
                        <span className="theme" title={r.theme}>
                          {r.theme}
                        </span>
                        {r.earnings_in != null && r.earnings_in >= 0 && r.earnings_in <= 14 && (
                          <span className="chip chip-plain soon" title="Dated earnings print inside 14 days">
                            Earnings {inDays(r.earnings_in)}
                          </span>
                        )}
                      </td>
                      <td className="c-ind">
                        <Link to={`/industries/${r.industry.key}`} className="ind" onClick={(e) => e.stopPropagation()}>
                          {r.industry.label} · {r.industry.benchmark_etf}
                        </Link>
                      </td>
                      <td className="num c-score c-hide">{fmtScore(r.value, r.components_present, r.components_total)}</td>
                      <td className="c-band">
                        <ScoreBadge band={r.band} value={r.value} present={r.components_present} total={r.components_total} strategy={strat} />
                      </td>
                      <td
                        className="num cov-cell c-cov"
                        data-label="Data"
                        title={`${cov.present} of ${cov.total} inputs had data${cov.state !== "full" ? ": some missing, score pulled toward neutral" : ""}`}
                      >
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
                      {hasVerdicts && (
                        <td className="c-hide">
                          {r.hf_pass == null ? <span className="faint">—</span> : <span className={`verdict ${r.hf_pass ? "pass" : "fail"}`}>{r.hf_pass ? "PASS" : "FAIL"}</span>}
                        </td>
                      )}
                      <td className="c-spark c-hide">
                        <Spark closes={r.price && r.price.closes} width={96} height={28} />
                      </td>
                      <td className="c-move" data-label="30d">
                        <Move value={r.price && r.price.chg_30d} />
                      </td>
                      {priceCols && (
                        <>
                          <td
                            className={`num c-hide ${tone(r.price && r.price.rel_30d)}`}
                            title={r.price && r.price.benchmark ? `vs ${r.price.benchmark}${r.industry && r.industry.label ? ` (${r.industry.label} ETF)` : ""}` : ""}
                          >
                            {pct(r.price && r.price.rel_30d)}
                          </td>
                          <td className="c-hide">{r.earnings_in == null ? <span className="faint">—</span> : <span className="num">{inDays(r.earnings_in)}</span>}</td>
                        </>
                      )}
                      <td className="c-pin">{pins && <Pin symbol={r.symbol} pinned={pins.has(r.symbol)} onChange={onPinChange} />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
                onClick={() => navigate(`/compare?symbols=${[...selected].join(",")}${strategy !== "fast_mover" ? `&strategy=${strategy}` : ""}`)}
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

      {!loading && data && view.length > 0 && (
        <>
          {data.meta.truncated && nextTier && me && me.tier && !upgradeHidden && (
            <div className="upgrade-card">
              <div className="copy">
                Of the <b>{data.meta.shown}</b> names this list reaches in {scopeLabel}, <b>{strongCount}</b> {strongCount === 1 ? "is" : "are"} strong and{" "}
                <b>{elevatedCount}</b> elevated; more were rated {runWhen(data.as_of, tz)} than the list shows. On <b>{nextTier.label}</b> we would tell you
                which of up to {nextTier.names_shown_limit} names changed rating each morning, across {industriesLabel(nextTier.industries_limit)}
                {nextTier.alerts_limit === 0 ? (
                  <>, with {watchedLabel(nextTier.picks_limit)} kept in view.</>
                ) : (
                  <>, and send {alertsLabel(nextTier.alerts_limit)} on {watchedLabel(nextTier.picks_limit)}.</>
                )}
              </div>
              <div className="actions">
                <button type="button" className="btn btn-primary btn-sm" onClick={() => openUpgrade("names")}>
                  Show me the plans — {dollars(nextTier.price_monthly_cents)}/mo
                </button>
                <span>
                  You are on {me.tier.label}, {dollars(me.tier.price_monthly_cents)}/mo
                </span>
                <button
                  className="btn-quiet"
                  onClick={() => {
                    ss.set("ta_upgrade_hidden", "1");
                    setUpgradeHidden(true);
                  }}
                >
                  Hide for now
                </button>
              </div>
            </div>
          )}

          <p className="footnote">
            Scored {dateTime(data.as_of, tz)}. {strat.label} {noun}s rank names for you to look into; nothing on this board is a recommendation.{" "}
            <Link to={`/strategies/${strategy}`}>What {strat.label} looks for</Link>.
          </p>
        </>
      )}

      <details className="howto" id="board-howto" open={howOpen} onToggle={(e) => setHowOpen(e.currentTarget.open)}>
        <summary>How to read this board</summary>
        <div className="howbody">
          <dl>
            <dt>The rating word (band)</dt>
            <dd>
              Where the score landed for this strategy: strong, elevated, neutral, weak, or excluded. The word is the claim; the number beside it is
              detail. Rating words are never comparable across strategies.
            </dd>
            <dt>How much data (coverage)</dt>
            <dd>
              How many of the strategy's inputs had data. Missing inputs pull the score toward neutral rather than counting as zero, and a score built
              on thin data carries a <span className="num">~</span>.
            </dd>
            <dt>Measured record</dt>
            <dd>
              {strategies && strategies.length > 0 ? (
                <>
                  {strategies.filter((s) => s.calibrated).length === 0
                    ? "None of the strategies has a measured record yet."
                    : `${strategies
                        .filter((s) => s.calibrated)
                        .map((s) => s.label)
                        .join(", ")} ${strategies.filter((s) => s.calibrated).length === 1 ? "has" : "have"} a measured record: its setups were checked against what happened next.`}{" "}
                  The others have no measured record yet and produce candidates, not signals, until {EVIDENCE.calibrationThreshold} outcomes resolve.
                </>
              ) : (
                <>
                  A strategy with a measured record has had its setups checked against what happened next. One without produces candidates, not
                  signals, until {EVIDENCE.calibrationThreshold} outcomes resolve.
                </>
              )}
              {strategies && strategies.some((s) => s.key === "fast_mover" && s.calibrated) && (
                <>
                  {" "}
                  Fast Mover's record: {EVIDENCE.hits} of {EVIDENCE.events} events that passed its rules moved.
                </>
              )}
            </dd>
            <dt>{simple ? "Since the last scoring" : "Δ run"}</dt>
            <dd>Change in the score since the last scoring. "new" means the name was not scored last time.</dd>
            <dt>Must-pass rules (hard filters)</dt>
            <dd>
              Each Fast Mover score carries a verdict: PASS means every rule passed, FAIL means one did not. A name flagged FAIL is still rated. The
              "Passed every rule" pill keeps only the names that passed.
            </dd>
            {full && (
              <>
                <dt>Compare</dt>
                <dd>Tick up to four rows and choose Compare to see their rules, inputs and data side by side.</dd>
              </>
            )}
            <dt>Keyboard</dt>
            <dd>
              <kbd className="kbd">j</kbd>/<kbd className="kbd">k</kbd> move through the list, <kbd className="kbd">Enter</kbd> opens the report,{" "}
              <kbd className="kbd">p</kbd> watches.
            </dd>
          </dl>
        </div>
      </details>

      <FinePrint short />
    </div>
  );
}

function MoverCard({ title, rows, fresh }) {
  return (
    <div className="card mover">
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <p className="xs faint" style={{ margin: 0 }}>
          none this time
        </p>
      ) : (
        <ul>
          {rows.map((r) => (
            <li key={r.symbol}>
              <Link className="sym" to={`/stock/${r.symbol}`}>
                {r.symbol}
              </Link>
              <span className="muted small" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.theme}
              </span>
              <span className="num r">{fresh ? fmtScore(r.value) : delta(r.delta_1d)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// A sortable header. `term` opens a glossary definition, `help` a one-off
// text; either way the explainer is a tap target that works on a phone.
function SortTh({ k, sort, setSort, children, num, term, help, title }) {
  const active = sort === k;
  const name = typeof children === "string" ? children : k;
  return (
    <th scope="col" className={`sortable ${num ? "num" : ""}`} aria-sort={active ? (k === "symbol" ? "ascending" : "descending") : undefined}>
      <button type="button" onClick={() => setSort(k)} title={`Sort by ${name}`}>
        {children}
      </button>
      {(term || help) && <Explain term={term} text={help} title={title} />}
    </th>
  );
}

function BoardEmpty({ me, strat, status, onFastMover }) {
  if (status === "not_running") {
    return (
      <Empty
        title={`${strat.label} is not scoring yet.`}
        action={
          <button className="btn btn-secondary" onClick={onFastMover}>
            Show me Fast Mover
          </button>
        }
      >
        Fast Mover is the strategy scoring your industries today.
      </Empty>
    );
  }
  if (!strat.calibrated) {
    return (
      <Empty
        title={`${strat.label} has not scored your names yet.`}
        action={
          <button className="btn btn-secondary" onClick={onFastMover}>
            Show me Fast Mover
          </button>
        }
      >
        It has no measured record yet; its names will be candidates, not signals. Fast Mover is the strategy with a measured record today.
      </Empty>
    );
  }
  if (me && me.industries_following_count === 0) {
    return (
      <Empty
        title="You're not following any industries yet."
        action={
          <Link to="/onboarding" className="btn btn-primary">
            Pick my industries
          </Link>
        }
      >
        Your Board is built from the industries you follow.
      </Empty>
    );
  }
  return (
    <Empty title={`No rated names in your industries for ${strat.label} in the latest scoring.`}>
      Scores regenerate each morning. Try another industry in My account, or check back after the next scoring.
    </Empty>
  );
}
