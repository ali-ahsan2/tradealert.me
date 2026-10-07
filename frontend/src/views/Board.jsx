import React, { useEffect, useMemo, useState } from "react";
import { api, cached } from "../api.js";
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
  industriesLabel,
  plural,
  score as fmtScore,
  shortDate,
} from "../lib/fmt.js";
import { EVIDENCE, nounFor } from "../lib/evidence.js";
import SearchBar from "../components/SearchBar.jsx";
import ScoreBadge from "../components/ScoreBadge.jsx";
import Pin from "../components/Pin.jsx";
import { Empty, ErrorCard, Help, Monogram, Notice, Skeleton, StatusChip } from "../components/ui.jsx";

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
};

const HELP = {
  score:
    "A 0 to 100 composite of the inputs that had data. Thin coverage shrinks it toward neutral (40) and marks the number with ~.",
  band: "Where the score landed on this strategy's fixed cutoffs. The word carries the meaning; the colour only repeats it.",
  coverage:
    "How many scoring inputs had data on this run. 2 of 3 segments: some inputs missing, score shrunk toward neutral.",
  delta: "Change in the score since the previous run. 'new' means the name was not scored last run.",
};

function nextTierFor(tiers, current) {
  if (!tiers || !current) return null;
  const sorted = [...tiers].sort((a, b) => a.price_monthly_cents - b.price_monthly_cents);
  return sorted.find((t) => t.price_monthly_cents > (current.price_monthly_cents || 0)) || null;
}

export default function Board() {
  const { me } = useMe();
  const q = useQuery();
  const [strategies, setStrategies] = useState(null);
  const [industriesAll, setIndustriesAll] = useState([]);
  const [tiers, setTiers] = useState(null);
  const [strategy, setStrategy] = useState(
    q.get("strategy") || ls.get("ta_board_strategy") || "fast_mover"
  );
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [industry, setIndustry] = useState("all");
  const [sort, setSort] = useState("score");
  const [compact, setCompact] = useState(ls.get("ta_board_density") === "compact");
  const [pins, setPins] = useState(null);
  const [strip, setStrip] = useState(
    () => q.get("first_run") === "1" || ls.get("ta_board_intro_hidden") !== "1"
  );
  const [provHidden, setProvHidden] = useState({});
  const [upgradeHidden, setUpgradeHidden] = useState(ss.get("ta_upgrade_hidden") === "1");

  useEffect(() => {
    cached("/strategies")
      .then((d) => setStrategies(d.strategies))
      .catch(() => setStrategies([]));
    cached("/industries")
      .then((d) => setIndustriesAll(d.industries))
      .catch(() => setIndustriesAll([]));
    cached("/entitlements")
      .then((d) => setTiers(d.tiers))
      .catch(() => setTiers(null));
    api("/me/picks")
      .then((d) => setPins(new Set(d.picks.map((p) => p.symbol))))
      .catch(() => setPins(new Set()));
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr(null);
    ls.set("ta_board_strategy", strategy);
    window.history.replaceState(
      {},
      "",
      strategy === "fast_mover" ? "/board" : `/board?strategy=${encodeURIComponent(strategy)}`
    );
    api(`/board?strategy=${encodeURIComponent(strategy)}`)
      .then((d) => {
        if (!alive) return;
        setData(d);
        setIndustry(ls.get(`ta_board_ind_${strategy}`) || "all");
      })
      .catch((e) => alive && setErr(e))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [strategy, reload]);

  const tz = me && me.settings ? me.settings.timezone : undefined;
  const strat = (data && data.strategy) ||
    (strategies || []).find((s) => s.key === strategy) || { key: strategy, label: "Board", calibrated: false };
  const rows = data ? data.rows : [];

  const followed = useMemo(() => {
    if (!data) return [];
    const keys = data.meta.industries || [];
    return keys
      .map((k) => industriesAll.find((i) => i.key === k) || rows.find((r) => r.industry.key === k)?.industry)
      .filter(Boolean)
      .map((i) => ({ key: i.key, label: i.label, etf: i.benchmark_etf }));
  }, [data, industriesAll, rows]);

  const view = useMemo(() => {
    const filtered = industry === "all" ? rows : rows.filter((r) => r.industry.key === industry);
    const ranked = [...filtered].sort(SORTS.score.cmp).map((r, i) => ({ ...r, viewRank: i + 1 }));
    return ranked.sort(SORTS[sort].cmp);
  }, [rows, industry, sort]);

  const pickIndustry = (k) => {
    setIndustry(k);
    ls.set(`ta_board_ind_${strategy}`, k);
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

  const onPinChange = (sym, on) => {
    setPins((p) => {
      const n = new Set(p || []);
      if (on) n.add(sym);
      else n.delete(sym);
      return n;
    });
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

  return (
    <div className="wrap">
      <div className="pagehead">
        <div>
          <h1>Board</h1>
          <div className="meta">
            Ranked names in the industries you follow, through one scoring lens at a time.
          </div>
        </div>
        <div className="actions">
          <SearchBar />
        </div>
      </div>

      {me && !me.verified && (
        <Notice tone="warn">
          Verify your email to receive alerts and digests. The link is in the message we sent to{" "}
          <b>{me.email}</b>; the Board works without it.
        </Notice>
      )}

      <div className="tabs" role="tablist" aria-label="Strategy">
        {(strategies || [{ key: "fast_mover", label: "Fast Mover", monogram: "FM", calibrated: true }]).map(
          (s) => (
            <button
              key={s.key}
              role="tab"
              className="tab"
              aria-selected={s.key === strategy}
              onClick={() => setStrategy(s.key)}
            >
              <Monogram size={20}>{s.monogram}</Monogram>
              {s.label}
              {!s.calibrated && <span className="chip chip-prov">Provisional</span>}
            </button>
          )
        )}
      </div>

      {data && !strat.calibrated && rows.length > 0 && !provHidden[strategy] && (
        <Notice
          tone="warn"
          onDismiss={() => setProvHidden((h) => ({ ...h, [strategy]: true }))}
        >
          <b>{strat.label}</b> weights are provisional. Not enough resolved outcomes exist to
          calibrate them yet ({strat.resolved_outcomes_count ?? 0} of{" "}
          {EVIDENCE.calibrationThreshold} needed), so these are candidates, not signals.
        </Notice>
      )}

      {stale && (
        <Notice tone="warn">
          Last successful run was {shortDate(data.as_of, tz)}. Scores may be stale.
        </Notice>
      )}

      {strip && (
        <div className="strip">
          <span>
            Scores update daily. Click any row for the full evaluation report; the coverage column
            shows how much data backed each score. Pin a name to add it to your weekly digest.
          </span>
          <button className="btn-quiet" onClick={hideStrip}>
            Got it
          </button>
        </div>
      )}

      <div className="toolbar">
        {followed.length > 1 && (
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
        )}
        {followed.length === 1 && (
          <span className="ctl">
            {followed[0].label} <span className="mono faint">{followed[0].etf}</span>
          </span>
        )}
        <span className="spacer" />
        <label className="ctl">
          Sort
          <select className="inline" value={sort} onChange={(e) => setSort(e.target.value)}>
            {Object.entries(SORTS).map(([k, s]) => (
              <option key={k} value={k}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <button className="btn-quiet" onClick={toggleDensity} aria-pressed={compact}>
          {compact ? "Comfortable rows" : "Compact rows"}
        </button>
      </div>

      {data && (
        <div className="boardhead">
          <b>{strat.label}</b>
          <StatusChip calibrated={strat.calibrated} short />
          <span>
            {view.length} of {data.meta.shown} names · {scopeLabel}
          </span>
          <span>run {dateTime(data.as_of, tz)}</span>
        </div>
      )}

      {err && err.status !== 404 && (
        <ErrorCard error={err} onRetry={() => setReload((n) => n + 1)} title="Couldn't load the board." />
      )}

      {loading && !err && <Skeleton rows={8} height={compact ? 32 : 48} />}

      {!loading && (err?.status === 404 || (data && rows.length === 0)) && (
        <BoardEmpty me={me} strat={strat} onFastMover={() => setStrategy("fast_mover")} />
      )}

      {!loading && data && rows.length > 0 && view.length === 0 && (
        <Empty
          title="No names match."
          action={
            <button className="btn btn-secondary" onClick={() => pickIndustry("all")}>
              Clear filters
            </button>
          }
        />
      )}

      {!loading && data && view.length > 0 && (
        <>
          <div className="table-card cards">
            <table className={`data ${compact ? "compact" : "comfortable"}`}>
              <thead>
                <tr>
                  <th className="rank" scope="col">
                    #
                  </th>
                  <SortTh k="symbol" sort={sort} setSort={setSort}>
                    Name
                  </SortTh>
                  <th scope="col">Industry</th>
                  <SortTh k="score" sort={sort} setSort={setSort} num help={HELP.score}>
                    Score
                  </SortTh>
                  <th scope="col">
                    Band
                    <Help text={HELP.band} />
                  </th>
                  <SortTh k="coverage" sort={sort} setSort={setSort} num help={HELP.coverage}>
                    Coverage
                  </SortTh>
                  <SortTh k="delta" sort={sort} setSort={setSort} num help={HELP.delta}>
                    Δ run
                  </SortTh>
                  <th scope="col">
                    <span className="sr-only">Pin</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {view.map((r) => {
                  const cov = coverage(r.components_present, r.components_total);
                  return (
                    <tr
                      key={r.symbol}
                      className="rowlink"
                      onClick={() => navigate(`/stock/${r.symbol}`)}
                    >
                      <td className="rank c-rank">{r.viewRank}</td>
                      <td className="name-cell c-sym">
                        <Link className="sym" to={`/stock/${r.symbol}`} onClick={(e) => e.stopPropagation()}>
                          {r.symbol}
                        </Link>
                        <span className="theme" title={r.theme}>
                          {r.theme}
                        </span>
                      </td>
                      <td className="c-ind">
                        <span className="ind">
                          {r.industry.label} · {r.industry.benchmark_etf}
                        </span>
                      </td>
                      <td className="num c-score c-hide">
                        {fmtScore(r.value, r.components_present, r.components_total)}
                      </td>
                      <td className="c-band">
                        <ScoreBadge
                          band={r.band}
                          value={r.value}
                          present={r.components_present}
                          total={r.components_total}
                          strategy={strat}
                        />
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
                      <td className="c-pin">
                        {pins && (
                          <Pin symbol={r.symbol} pinned={pins.has(r.symbol)} onChange={onPinChange} />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {data.meta.truncated && nextTier && me && me.tier && !upgradeHidden && (
            <div className="upgrade-card">
              <div className="copy">
                You're seeing the top <b>{data.meta.shown}</b> names in {scopeLabel}.{" "}
                <b>{nextTier.label}</b> shows the top {nextTier.names_shown_limit}, follows{" "}
                {industriesLabel(nextTier.industries_limit)}, and includes{" "}
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
            Scores from the run at {dateTime(data.as_of, tz)}. {strat.label}{" "}
            {noun}s rank names for a human to review; nothing on this board is a recommendation.
          </p>
        </>
      )}

      <details className="howto">
        <summary>How to read this board</summary>
        <div className="howbody">
          <dl>
            <dt>Band</dt>
            <dd>
              The score's bracket on this strategy's fixed cutoffs: strong, elevated, neutral,
              weak, or excluded. The word is the claim; the number beside it is detail. Band
              words are never comparable across strategies.
            </dd>
            <dt>Coverage</dt>
            <dd>
              How many scoring inputs had data. Missing inputs shrink the score toward neutral
              (40) rather than counting as zero, and a thin-coverage score carries a{" "}
              <span className="mono">~</span>.
            </dd>
            <dt>Provisional</dt>
            <dd>
              Four of the five strategies have working inputs but weights that no resolved
              outcomes back yet. They produce candidates, not signals, until{" "}
              {EVIDENCE.calibrationThreshold} outcomes resolve. Fast Mover is the one calibrated
              strategy: {EVIDENCE.hits} of {EVIDENCE.events} filter-passing events moved.
            </dd>
            <dt>Δ run</dt>
            <dd>Change in the score since the previous run. "new" means the name was not scored last run.</dd>
          </dl>
        </div>
      </details>
    </div>
  );
}

function SortTh({ k, sort, setSort, children, num, help }) {
  const active = sort === k;
  return (
    <th
      scope="col"
      className={`sortable ${num ? "num" : ""}`}
      aria-sort={active ? (k === "symbol" ? "ascending" : "descending") : undefined}
    >
      <button onClick={() => setSort(k)} title={`Sort by ${children}`}>
        {children}
      </button>
      {help && <Help text={help} />}
    </th>
  );
}

function BoardEmpty({ me, strat, onFastMover }) {
  if (!strat.calibrated) {
    return (
      <Empty title={`No scored run for ${strat.label} yet.`}
        action={
          <button className="btn btn-secondary" onClick={onFastMover}>
            Open the Fast Mover board
          </button>
        }
      >
        Its inputs are wired and its weights are provisional until {EVIDENCE.calibrationThreshold}{" "}
        outcomes resolve. Fast Mover is the calibrated board today.
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
      Scores regenerate on the daily run. Try another industry in Account settings, or check back
      after the next run.
    </Empty>
  );
}
