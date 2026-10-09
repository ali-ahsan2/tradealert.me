import React, { useEffect, useMemo, useState } from "react";
import { api, cached, toast } from "../api.js";
import { Link, navigate, useQuery } from "../lib/router.jsx";
import { useMe } from "../lib/me.jsx";
import {
  age,
  alertsLabel,
  coverage,
  dateTime,
  delta,
  deltaTone,
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
import { changeSentence } from "../lib/plain.js";
import SearchBar from "../components/SearchBar.jsx";
import ScoreBadge from "../components/ScoreBadge.jsx";
import Pin from "../components/Pin.jsx";
import Spark, { Move } from "../components/Spark.jsx";
import Explain from "../components/Explain.jsx";
import NotifyButton from "../components/NotifyButton.jsx";
import { Empty, ErrorCard, Monogram, Notice, Skeleton, StatusChip } from "../components/ui.jsx";
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
    label: "Change since last run",
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
const SORT_PLAIN = { coverage: "Data coverage", symbol: "Name", px30: "30-day price move", rel30: "30-day move vs the sector ETF" };

const HELP = {
  score:
    "A 0 to 100 composite of the inputs that had data. Thin coverage shrinks it toward neutral (40) and marks the number with ~.",
  band: "Where the score landed on this strategy's fixed cutoffs. The word carries the meaning; the colour only repeats it.",
  coverage:
    "How many scoring inputs had data on this run. 2 of 3 segments: some inputs missing, score shrunk toward neutral.",
  delta: "Change in the score since the previous run. 'new' means the name was not scored last run.",
  screen: "Hard-filter verdict stored with the score: every filter passed, or at least one failed. Only Fast Mover stores one.",
  px: "Price change over the last 30 days from daily closes, and the gap to the industry's ETF over the same window.",
  why: "The theme the engine files this name under, and whether it cleared the strategy's pass-or-fail rules on this run. Open the row for the inputs behind the number.",
};

const BANDS = ["strong", "elevated", "neutral", "weak", "excluded"];
const MAX_COMPARE = 4;

function nextTierFor(tiers, current) {
  if (!tiers || !current) return null;
  const sorted = [...tiers].sort((a, b) => a.price_monthly_cents - b.price_monthly_cents);
  return sorted.find((t) => t.price_monthly_cents > (current.price_monthly_cents || 0)) || null;
}

// "up 6", "down 3", "new", "unchanged": the Simple table's change column.
function shortChange(d) {
  if (d == null) return "new";
  const r = Math.round(d);
  if (r === 0) return "unchanged";
  return `${r > 0 ? "up" : "down"} ${Math.abs(r)}`;
}

// The one dated event the board carries per row. Past dates are not a
// next event, so they read as nothing rather than as "3d ago".
function nextEvent(r) {
  if (r.earnings_in == null || r.earnings_in < 0) return null;
  return `earnings ${inDays(r.earnings_in)}`;
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


// One sentence with real figures from the rows the board returned. Nothing
// here is derived from data the payload does not carry: the board has no
// previous band, so the movement figure is points, not band changes.
function BoardUtility({ data, rows, followed, tz }) {
  const n = rows.length;
  const keys = data.meta.industries && data.meta.industries.length ? data.meta.industries : [...new Set(rows.map((r) => r.industry.key))];
  const m = keys.length;
  const one = m === 1 ? followed.find((f) => f.key === keys[0]) || rows.find((r) => r.industry.key === keys[0])?.industry : null;
  const scope = one ? one.label : `your ${plural(m, "industry", "industries")}`;
  const strong = rows.filter((r) => r.band === "strong").length;
  const elevated = rows.filter((r) => r.band === "elevated").length;
  const fresh = rows.filter((r) => r.delta_1d == null).length;
  const moved = rows.filter((r) => r.delta_1d != null && Math.abs(Math.round(r.delta_1d)) >= 5).length;
  return (
    <p className="utility">
      {data.meta.truncated ? (
        <>
          The top <b>{n}</b> names scored
        </>
      ) : (
        <>
          <b>{n}</b> {n === 1 ? "name" : "names"} scored
        </>
      )}{" "}
      across {scope} {runWhen(data.as_of, tz)}: <b>{strong}</b> strong, <b>{elevated}</b> elevated,{" "}
      {n > 0 && fresh === n ? (
        "all new this run."
      ) : (
        <>
          <b>{moved}</b> moved 5 points or more since the last run
          {fresh ? (
            <>
              , <b>{fresh}</b> new
            </>
          ) : null}
          .
        </>
      )}
    </p>
  );
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

  // A new run never moves rows under the cursor: it shows up as a strip the
  // subscriber chooses to act on.
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
  const strat = (data && data.strategy) ||
    (strategies || []).find((s) => s.key === strategy) || { key: strategy, label: "Board", calibrated: false };
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
  const laneCounts = useMemo(() => {
    const c = {};
    rows.forEach((r) => {
      if (r.lane) c[r.lane] = (c[r.lane] || 0) + 1;
    });
    return c;
  }, [rows]);
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

  const openRow = (r) => navigate(`/stock/${r.symbol}${strategy !== "fast_mover" ? `?strategy=${strategy}` : ""}`);
  const cursor = useRowNav(view.length, {
    onOpen: (i) => view[i] && openRow(view[i]),
    onPin: (i) => {
      const r = view[i];
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
    const csv = toCsv(view, cols) + `\n# Research and information only; not investment advice. Scores rank names for a human to review.\n`;
    downloadText(`tradealert-board-${strategy}-${data.as_of.slice(0, 10)}.csv`, csv);
  };

  const runAge = data ? age(data.as_of) : null;
  const stale = runAge && runAge.hours > 36;
  const nextTier = nextTierFor(tiers, me && me.tier);
  const noun = nounFor(strat);
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
  const moreNote = [
    industry !== "all" ? followed.find((f) => f.key === industry)?.label : null,
    sort !== "score" ? `sorted by ${(SORT_PLAIN[sort] || SORTS[sort].label).toLowerCase()}` : null,
    compact ? "compact rows" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const industryControl =
    followed.length > 1 ? (
      <div className="seg" role="group" aria-label="Industry">
        <button aria-pressed={industry === "all"} onClick={() => pickIndustry("all")}>
          All followed
        </button>
        {followed.map((f) => (
          <button key={f.key} aria-pressed={industry === f.key} onClick={() => pickIndustry(f.key)}>
            {f.label}
          </button>
        ))}
      </div>
    ) : followed.length === 1 ? (
      <Link to={`/industries/${followed[0].key}`} className="ctl">
        {followed[0].label} <span className="mono faint">{followed[0].etf}</span>
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
      Open in Screener
    </Link>
  );

  return (
    <div className="wrap board-v">
      <div className="pagehead">
        <div>
          <h1>Board</h1>
          {data && rows.length > 0 ? (
            <BoardUtility data={data} rows={rows} followed={followed} tz={tz} />
          ) : (
            <div className="meta">Ranked names in the industries you follow, through one scoring lens at a time.</div>
          )}
        </div>
        <div className="actions">
          <SearchBar />
        </div>
      </div>

      {me && !me.verified && (
        <Notice tone="warn">
          Verify your email to receive alerts and digests. The link is in the message we sent to <b>{me.email}</b>; the Board works without it.
        </Notice>
      )}

      {newRun && (
        <Notice tone="info" onDismiss={() => setNewRun(null)}>
          New scores are available from the run at {dateTime(newRun.as_of, tz)}.{" "}
          <button className="btn btn-primary btn-sm" onClick={() => setReload((n) => n + 1)}>
            Refresh the Board
          </button>
        </Notice>
      )}

      <div className="tabs" role="tablist" aria-label="Strategy">
        {(strategies || [{ key: "fast_mover", label: "Fast Mover", monogram: "FM", calibrated: true }]).map((s) => (
          <button key={s.key} role="tab" className="tab" aria-selected={s.key === strategy} onClick={() => setStrategy(s.key)}>
            <Monogram size={20}>{s.monogram}</Monogram>
            {s.label}
            {!s.calibrated && <span className="chip chip-prov">Provisional</span>}
          </button>
        ))}
      </div>

      {data && !strat.calibrated && rows.length > 0 && !provHidden[strategy] && (
        <Notice tone="warn" onDismiss={() => setProvHidden((h) => ({ ...h, [strategy]: true }))}>
          <b>{strat.label}</b> weights are provisional. Not enough resolved outcomes exist to calibrate them yet (
          {strat.resolved_outcomes_count ?? 0} of {EVIDENCE.calibrationThreshold} needed), so these are candidates, not signals.{" "}
          <Link to={`/strategies/${strategy}`}>Evidence page</Link>
        </Notice>
      )}

      {stale && <Notice tone="warn">Last successful run was {shortDate(data.as_of, tz)}. Scores may be stale.</Notice>}

      {strip && (
        <div className="strip">
          <span>
            {simple
              ? "Scores update each trading morning. Tap a name for its full report, pin it to keep it in view, or turn on alerts to be told when something changes. Tick two to four names to compare them."
              : "Scores update daily. Click any row for the full evaluation report; the coverage column shows how much data backed each score. Pin a name to add it to your weekly digest; tick names to compare them."}
          </span>
          <button className="btn-quiet" onClick={hideStrip}>
            Got it
          </button>
        </div>
      )}

      {simple ? (
        <>
          <div className="pillrow" role="group" aria-label="Show">
            <button type="button" className="fchip" aria-pressed={allOn} onClick={resetFilters}>
              All <span className="mono">{rows.length}</span>
            </button>
            {hasVerdicts && (
              <>
                <button type="button" className="fchip" aria-pressed={cleared} onClick={() => setCleared((c) => !c)}>
                  Cleared the filters <span className="mono">{clearedCount}</span>
                </button>
                <Explain term="hard_filter" />
              </>
            )}
            {lanes.length > 1 &&
              lanes.map((l) => (
                <button key={l} type="button" className="fchip" aria-pressed={lane === l} onClick={() => setLane(lane === l ? "all" : l)}>
                  {l} <span className="mono">{laneCounts[l]}</span>
                </button>
              ))}
            {lanes.length > 1 && <Explain term="lane" />}
            {earningsSoon > 0 && (
              <Link to="/calendar?days=14" className="fchip" title="Names with a dated earnings print inside 14 days">
                Earnings in 14 days <span className="mono">{earningsSoon}</span>
              </Link>
            )}
          </div>
          <details className="acc morefilters">
            <summary>
              More filters{moreNote && <span className="sum-note">{moreNote}</span>}
            </summary>
            <div className="acc-body">
              <div className="toolbar">
                {industryControl}
                {sortControl}
                <button className="btn-quiet" onClick={toggleDensity} aria-pressed={compact}>
                  {compact ? "Comfortable rows" : "Compact rows"}
                </button>
                {screenerLink}
                {data && view.length > 0 && (
                  <button className="btn-quiet" onClick={exportCsv} title="Download the visible rows as CSV">
                    Export CSV
                  </button>
                )}
              </div>
              <p className="hint">Every column and control is in the Full view, one tap away at the top of the page.</p>
            </div>
          </details>
        </>
      ) : (
        <div className="toolbar">
          {industryControl}
          {lanes.length > 1 && (
            <div className="seg" role="group" aria-label="Lane">
              <button aria-pressed={lane === "all"} onClick={() => setLane("all")}>
                Any lane
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
              Cleared the screen <span className="mono">{clearedCount}</span>
            </button>
          )}
          {earningsSoon > 0 && (
            <Link to="/calendar?days=14" className="fchip" title="Names with a dated earnings print inside 14 days">
              Earnings in 14d <span className="mono">{earningsSoon}</span>
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

      {data && (
        <div className="boardhead">
          <b>{strat.label}</b>
          <StatusChip calibrated={strat.calibrated} short />
          <span>
            {view.length} of {data.meta.shown} names · {scopeLabel}
          </span>
          <span>run {dateTime(data.as_of, tz)}</span>
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
      {loading && !err && <Skeleton rows={8} height={compact ? 32 : 48} />}

      {!loading && (err?.status === 404 || (data && rows.length === 0)) && (
        <BoardEmpty me={me} strat={strat} onFastMover={() => setStrategy("fast_mover")} />
      )}

      {!loading && data && rows.length > 0 && view.length === 0 && (
        <Empty
          title="No names match."
          action={
            <button className="btn btn-secondary" onClick={resetFilters}>
              Clear filters
            </button>
          }
        >
          {simple ? "Every name is back with the All pill." : null}
        </Empty>
      )}

      {!loading && data && view.length > 0 && (
        <>
          {movers && full && (
            <div className="movers">
              <MoverCard title="Up most since last run" rows={movers.up} />
              <MoverCard title="Down most since last run" rows={movers.down} />
              <MoverCard title="New on the board" rows={movers.fresh} fresh />
            </div>
          )}

          {simple ? (
            <div className="table-card cards simple-table">
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
                    <SortTh k="score" sort={sort} setSort={setSort} term="score">
                      Score
                    </SortTh>
                    <th scope="col">
                      Why
                      <Explain title="Why" text={HELP.why} />
                    </th>
                    <SortTh k="delta" sort={sort} setSort={setSort} term="delta_run">
                      Since last run
                    </SortTh>
                    <SortTh k="earnings" sort={sort} setSort={setSort} term="catalyst">
                      Next event
                    </SortTh>
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {view.map((r, i) => {
                    const ev = nextEvent(r);
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
                          <Link to={`/industries/${r.industry.key}`} className="ind" onClick={(e) => e.stopPropagation()}>
                            {r.industry.label}
                          </Link>
                        </td>
                        <td className="c-band">
                          <ScoreBadge band={r.band} value={r.value} present={r.components_present} total={r.components_total} strategy={strat} />
                        </td>
                        <td className="c-why" title={r.hook || r.theme || undefined}>
                          <span className="why">
                            <span className="why-t">{r.hook || r.theme || <span className="faint">—</span>}</span>
                            {r.hf_pass != null && (
                              <span className={`verdict ${r.hf_pass ? "pass" : "fail"}`} title={r.hf_pass ? "Cleared every hard filter" : "Failed a hard filter"}>
                                {r.hf_pass ? "PASS" : "FAIL"}
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="c-delta" data-label="Since last run" title={changeSentence(r.delta_1d)}>
                          {shortChange(r.delta_1d)}
                        </td>
                        <td className="c-next" data-label="Next event">
                          {ev ? <span className={r.earnings_in <= 14 ? "soon" : ""}>{ev}</span> : <span className="faint">—</span>}
                        </td>
                        <td className="c-act" onClick={(e) => e.stopPropagation()}>
                          <span className="act">
                            {pins && <Pin symbol={r.symbol} pinned={pins.has(r.symbol)} onChange={onPinChange} />}
                            <NotifyButton symbol={r.symbol} compact />
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
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
                      Band
                      <Explain text={HELP.band} title="Band" />
                    </th>
                    <SortTh k="coverage" sort={sort} setSort={setSort} num help={HELP.coverage} title="Coverage">
                      Coverage
                    </SortTh>
                    <SortTh k="delta" sort={sort} setSort={setSort} num help={HELP.delta} title="Δ run">
                      Δ run
                    </SortTh>
                    <th scope="col" className="c-spark">
                      <span className="sr-only">30-day sparkline</span>
                    </th>
                    <SortTh k="px30" sort={sort} setSort={setSort} num help={HELP.px} title="30-day move">
                      30d
                    </SortTh>
                    {hasVerdicts && (
                      <th scope="col">
                        Screen
                        <Explain text={HELP.screen} title="Screen" />
                      </th>
                    )}
                    {priceCols && (
                      <>
                        <SortTh k="rel30" sort={sort} setSort={setSort} num>
                          vs ETF
                        </SortTh>
                        <SortTh k="earnings" sort={sort} setSort={setSort}>
                          Earnings
                        </SortTh>
                      </>
                    )}
                    <th scope="col">
                      <span className="sr-only">Pin</span>
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
                              ER {inDays(r.earnings_in)}
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
                          data-label="Coverage"
                          title={`Coverage ${cov.present} of ${cov.total}${cov.state !== "full" ? ": some inputs missing, score shrunk toward neutral" : ""}`}
                        >
                          <span className="covbar" aria-hidden="true">
                            {[0, 1, 2].map((i) => (
                              <span key={i} className={i < cov.segments ? "filled" : ""} />
                            ))}
                          </span>
                          {r.components_present}/{r.components_total}
                        </td>
                        <td className={`num c-delta ${deltaTone(r.delta_1d)}`} data-label="Δ">
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
                            <td className={`num c-hide ${tone(r.price && r.price.rel_30d)}`} title={r.price && r.price.benchmark ? `vs ${r.price.benchmark}` : ""}>
                              {pct(r.price && r.price.rel_30d)}
                            </td>
                            <td className="c-hide">{r.earnings_in == null ? <span className="faint">—</span> : <span className="mono">{inDays(r.earnings_in)}</span>}</td>
                          </>
                        )}
                        <td className="c-pin">{pins && <Pin symbol={r.symbol} pinned={pins.has(r.symbol)} onChange={onPinChange} />}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {selected.size > 0 && (
            <div className="selbar" role="status">
              <span>
                {selected.size} of {MAX_COMPARE} selected: <span className="mono">{[...selected].join(", ")}</span>
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

          {data.meta.truncated && nextTier && me && me.tier && !upgradeHidden && (
            <div className="upgrade-card">
              <div className="copy">
                These are the top <b>{data.meta.shown}</b> names in {scopeLabel}; more were scored than your plan lists. On <b>{nextTier.label}</b> we would
                watch and explain the top {nextTier.names_shown_limit}, follow {industriesLabel(nextTier.industries_limit)}, and keep{" "}
                {plural(nextTier.picks_limit, "pick")} with {alertsLabel(nextTier.alerts_limit)}.
              </div>
              <div className="actions">
                <Link to="/pricing" className="btn btn-primary btn-sm">
                  See plans — {dollars(nextTier.price_monthly_cents)}/mo
                </Link>
                <span>
                  Currently on {me.tier.label}, {dollars(me.tier.price_monthly_cents)}/mo
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
            Scores from the run at {dateTime(data.as_of, tz)}. {strat.label} {noun}s rank names for a human to review; nothing on this board is a
            recommendation. <Link to={`/strategies/${strategy}`}>How {strat.label} scores</Link>.
          </p>
        </>
      )}

      <details className="howto">
        <summary>How to read this board</summary>
        <div className="howbody">
          <dl>
            <dt>Band</dt>
            <dd>
              The score's bracket on this strategy's fixed cutoffs: strong, elevated, neutral, weak, or excluded. The word is the claim; the
              number beside it is detail. Band words are never comparable across strategies.
            </dd>
            <dt>Coverage</dt>
            <dd>
              How many scoring inputs had data. Missing inputs shrink the score toward neutral (40) rather than counting as zero, and a
              thin-coverage score carries a <span className="mono">~</span>.
            </dd>
            <dt>Provisional</dt>
            <dd>
              Four of the five strategies have working inputs but weights that no resolved outcomes back yet. They produce candidates, not
              signals, until {EVIDENCE.calibrationThreshold} outcomes resolve. Fast Mover is the one calibrated strategy: {EVIDENCE.hits} of{" "}
              {EVIDENCE.events} filter-passing events moved.
            </dd>
            <dt>{simple ? "Since last run" : "Δ run"}</dt>
            <dd>Change in the score since the previous run. "new" means the name was not scored last run.</dd>
            <dt>{simple ? "PASS and FAIL" : "Screen"}</dt>
            <dd>The hard-filter verdict stored with each Fast Mover score. PASS means every filter passed; the Screener can isolate those names.</dd>
            <dt>Compare</dt>
            <dd>Tick up to four rows and choose Compare to see their filters, components and data side by side.</dd>
            <dt>Keyboard</dt>
            <dd>
              <span className="mono">j</span>/<span className="mono">k</span> move through rows, <span className="mono">Enter</span> opens the report,{" "}
              <span className="mono">p</span> pins.
            </dd>
          </dl>
        </div>
      </details>
    </div>
  );
}

function MoverCard({ title, rows, fresh }) {
  return (
    <div className="card mover">
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <p className="xs faint" style={{ margin: 0 }}>
          none this run
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
              <span className={`mono r ${fresh ? "" : deltaTone(r.delta_1d)}`}>{fresh ? fmtScore(r.value) : delta(r.delta_1d)}</span>
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

function BoardEmpty({ me, strat, onFastMover }) {
  if (!strat.calibrated) {
    return (
      <Empty
        title={`No scored run for ${strat.label} yet.`}
        action={
          <button className="btn btn-secondary" onClick={onFastMover}>
            Open the Fast Mover board
          </button>
        }
      >
        Its inputs are wired and its weights are provisional until {EVIDENCE.calibrationThreshold} outcomes resolve. Fast Mover is the calibrated
        board today.
      </Empty>
    );
  }
  if (me && me.industries_following_count === 0) {
    return (
      <Empty
        title="You're not following any industries yet."
        action={
          <Link to="/onboarding" className="btn btn-primary">
            Choose industries
          </Link>
        }
      >
        Your Board is built from the industries you follow.
      </Empty>
    );
  }
  return (
    <Empty title={`No scored names in your followed industries for ${strat.label} on the latest run.`}>
      Scores regenerate on the daily run. Try another industry in Account settings, or check back after the next run.
    </Empty>
  );
}
