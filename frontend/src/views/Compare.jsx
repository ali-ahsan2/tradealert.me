import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { Link, navigate, useQuery } from "../lib/router.jsx";
import { useMe } from "../lib/me.jsx";
import { coverage, dateTime, delta, score as fmtScore } from "../lib/fmt.js";
import { SNAPSHOT_LABELS, HARD_FILTER_FORMAT } from "../lib/evidence.js";
import ScoreBadge from "../components/ScoreBadge.jsx";
import SearchBar from "../components/SearchBar.jsx";
import { Empty, Monogram, Skeleton, StatusChip } from "../components/ui.jsx";

const MAX = 4;

// Up to four names side by side, each fetched through the same dossier
// endpoint the report uses, so nothing is compared that the subscriber
// could not open on its own. The URL is the state: a comparison is a link.
export default function Compare() {
  const { me } = useMe();
  const q = useQuery();
  const symbols = useMemo(
    () => (q.get("symbols") || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, MAX),
    [q]
  );
  const strategy = q.get("strategy") || "fast_mover";
  const [data, setData] = useState({});
  const [strategies, setStrategies] = useState(null);

  useEffect(() => {
    api("/strategies").then((d) => setStrategies(d.strategies)).catch(() => setStrategies([]));
  }, []);

  useEffect(() => {
    let alive = true;
    symbols.forEach((s) => {
      if (data[s] && data[s].strategy && data[s].strategy.key === strategy) return;
      api(`/stock/${encodeURIComponent(s)}?strategy=${encodeURIComponent(strategy)}`)
        .then((d) => alive && setData((x) => ({ ...x, [s]: d })))
        .catch((e) => alive && setData((x) => ({ ...x, [s]: { error: e } })));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbols.join(","), strategy]);

  const setSymbols = (next) =>
    navigate(`/compare?symbols=${next.join(",")}${strategy !== "fast_mover" ? `&strategy=${strategy}` : ""}`, {
      replace: true,
    });
  const add = (r) => {
    if (symbols.includes(r.symbol) || symbols.length >= MAX) return;
    setSymbols([...symbols, r.symbol]);
  };
  const remove = (s) => setSymbols(symbols.filter((x) => x !== s));

  const loaded = symbols.map((s) => data[s]).filter((d) => d && !d.error);
  const componentKeys = useMemo(() => {
    const keys = new Map();
    loaded.forEach((d) => (d.score?.components || []).forEach((c) => keys.set(c.key, c.label)));
    return [...keys.entries()];
  }, [loaded]);
  const snapshotKeys = useMemo(() => {
    const keys = new Set();
    loaded.forEach((d) => Object.keys(d.snapshot || {}).forEach((k) => keys.add(k)));
    return Object.keys(SNAPSHOT_LABELS).filter((k) => keys.has(k));
  }, [loaded]);
  const filterKeys = useMemo(() => {
    const keys = new Map();
    loaded.forEach((d) => (d.score?.hard_filters || []).forEach((f) => keys.set(f.key, f.label)));
    return [...keys.entries()];
  }, [loaded]);
  const tz = me && me.settings ? me.settings.timezone : undefined;

  return (
    <div className="wrap">
      <div className="pagehead">
        <div>
          <h1>Compare</h1>
          <div className="meta">Up to four names, side by side, through one lens. The address bar is the comparison; share it as a link.</div>
        </div>
        <div className="actions">
          {strategies && (
            <select
              className="inline"
              value={strategy}
              onChange={(e) =>
                navigate(`/compare?symbols=${symbols.join(",")}${e.target.value !== "fast_mover" ? `&strategy=${e.target.value}` : ""}`, { replace: true })
              }
              aria-label="Strategy lens"
            >
              {strategies.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                  {s.calibrated ? "" : " (provisional)"}
                </option>
              ))}
            </select>
          )}
          {symbols.length < MAX && <SearchBar onPick={add} placeholder={`Add a name (${symbols.length}/${MAX})`} />}
        </div>
      </div>

      {symbols.length === 0 && (
        <Empty title="Pick up to four names to compare." action={<Link to="/board" className="btn btn-secondary">Choose from the Board</Link>}>
          Search above, or tick names on the Board and choose “Compare”.
        </Empty>
      )}

      {symbols.length > 0 && (
        <div className={`compare n${symbols.length}`}>
          {symbols.map((s) => {
            const d = data[s];
            return (
              <div className="card cmp-col" key={s}>
                <div className="cmp-head">
                  <div>
                    <Link className="sym" to={`/stock/${s}${strategy !== "fast_mover" ? `?strategy=${strategy}` : ""}`}>
                      {s}
                    </Link>
                    {d && !d.error && <span className="theme">{d.theme}</span>}
                  </div>
                  <button className="btn-quiet" onClick={() => remove(s)} aria-label={`Remove ${s}`}>
                    Remove
                  </button>
                </div>
                {!d && <Skeleton rows={6} height={36} />}
                {d && d.error && (
                  <p className="muted small">
                    {d.error.status === 404 ? `No report available for ${s}.` : "Couldn't load this name."}
                  </p>
                )}
                {d && !d.error && (
                  <>
                    <div className="row">
                      {d.score ? (
                        <ScoreBadge
                          band={d.score.band}
                          value={d.score.value}
                          present={d.score.components_present}
                          total={d.score.components_total}
                          strategy={d.strategy}
                        />
                      ) : (
                        <span className="chip chip-plain">No score</span>
                      )}
                      <span className="small muted">
                        <Monogram size={18}>{d.strategy.monogram}</Monogram> {d.strategy.label}{" "}
                        <StatusChip calibrated={d.strategy.calibrated} short />
                      </span>
                    </div>
                    <div className="cmp-row">
                      <span className="k">Industry</span>
                      <span className="small">{d.industry.label}</span>
                    </div>
                    <div className="cmp-row">
                      <span className="k">Since last run</span>
                      <span className="mono">{d.score ? delta(d.score.delta_1d) : "—"}</span>
                    </div>
                    <div className="cmp-row">
                      <span className="k">Coverage</span>
                      <span className="mono">
                        {d.score ? `${d.score.components_present}/${d.score.components_total} · ${coverage(d.score.components_present, d.score.components_total).state}` : "—"}
                      </span>
                    </div>

                    {filterKeys.length > 0 && (
                      <div className="cmp-section">
                        <h4>Hard filters</h4>
                        {filterKeys.map(([k, label]) => {
                          const f = (d.score?.hard_filters || []).find((x) => x.key === k);
                          return (
                            <div className={`cmp-row ${f ? "" : "missing"}`} key={k}>
                              <span className="k">{label}</span>
                              <span className="mono">
                                {f ? (
                                  <>
                                    <span className={`verdict ${f.pass ? "pass" : "fail"}`}>{f.pass ? "PASS" : "FAIL"}</span>{" "}
                                    <span className="muted">{(HARD_FILTER_FORMAT[k] || String)(f.value)}</span>
                                  </>
                                ) : (
                                  "no data"
                                )}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {componentKeys.length > 0 && (
                      <div className="cmp-section">
                        <h4>Components</h4>
                        {componentKeys.map(([k, label]) => {
                          const c = (d.score?.components || []).find((x) => x.key === k);
                          return (
                            <div className={`cmp-row ${c ? "" : "missing"}`} key={k} title={c && c.value != null ? String(c.value) : ""}>
                              <span className="k">{label}</span>
                              {c ? (
                                <>
                                  <span className="cmp-track" aria-hidden="true">
                                    <span style={{ width: `${Math.round((c.score || 0) * 100)}%` }} />
                                  </span>
                                  <span className="mono">{(c.score ?? 0).toFixed(2)}</span>
                                </>
                              ) : (
                                <span className="mono faint">no data</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {snapshotKeys.length > 0 && (
                      <div className="cmp-section">
                        <h4>Data on file</h4>
                        {snapshotKeys.map((k) => {
                          const v = d.snapshot?.[k];
                          const [label, fmt] = SNAPSHOT_LABELS[k];
                          return (
                            <div className={`cmp-row ${v ? "" : "missing"}`} key={k}>
                              <span className="k">{label}</span>
                              <span className="mono">{v ? fmt(v.value) : "—"}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <p className="footnote">Run {dateTime(d.run.as_of, tz)}</p>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
      {loaded.length > 1 && (
        <p className="footnote">
          Band words are only comparable within one strategy; this view holds the lens fixed for
          that reason. Scores rank; they are not probabilities.
        </p>
      )}
    </div>
  );
}
