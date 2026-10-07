import React, { useEffect, useState } from "react";
import { api, cached, getToken, toast } from "../api.js";
import { Link, navigate } from "../lib/router.jsx";
import { useMe } from "../lib/me.jsx";
import { coverage, dateTime, delta, deltaTone, industriesLabel, pct, price, score as fmtScore, shortDate } from "../lib/fmt.js";
import ScoreBadge from "../components/ScoreBadge.jsx";
import { Empty, ErrorCard, Skeleton } from "../components/ui.jsx";

// One industry: what it covers, how its benchmark has moved, and (when the
// subscriber follows it) its top names on the ranking strategy. Names in an
// industry outside the plan are never listed; only the count is.
export default function Industry({ industryKey }) {
  const { me, refresh } = useMe();
  const [d, setD] = useState(null);
  const [all, setAll] = useState([]);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    setErr(null);
    api(`/industries/${encodeURIComponent(industryKey)}`)
      .then((x) => alive && setD(x))
      .catch((e) => alive && setErr(e));
    cached("/industries")
      .then((x) => alive && setAll(x.industries))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [industryKey, reload]);

  const toggleFollow = async () => {
    if (!getToken()) {
      navigate(`/login?next=${encodeURIComponent(`/industries/${industryKey}`)}`);
      return;
    }
    setBusy(true);
    try {
      if (d.followed) await api(`/me/industries/${industryKey}`, { method: "DELETE" });
      else await api("/me/industries", { method: "POST", json: { key: industryKey } });
      await refresh();
      setReload((n) => n + 1);
    } catch (e) {
      toast(e.detail || "Couldn't change that.");
    } finally {
      setBusy(false);
    }
  };

  const tz = me && me.settings ? me.settings.timezone : undefined;
  const limit = me && me.tier ? me.tier.industries_limit : 1;
  const following = me ? me.industries_following_count : 0;
  const atLimit = me && !d?.followed && limit < 999 && following >= limit;

  if (err) {
    return (
      <div className="wrap wrap-narrow">
        <Link to="/board" className="backlink">
          ← Board
        </Link>
        {err.status === 404 ? <Empty title="No such industry." /> : <ErrorCard error={err} onRetry={() => setReload((n) => n + 1)} />}
      </div>
    );
  }
  if (!d) {
    return (
      <div className="wrap">
        <Skeleton rows={4} height={80} />
      </div>
    );
  }

  return (
    <div className="wrap">
      <Link to="/board" className="backlink">
        ← Board
      </Link>
      <div className="pagehead">
        <div>
          <h1 className="ind-head">
            {d.label}
            {d.benchmark && (
              <span className="ind-bench" title={d.benchmark.label}>
                <span className="mono">{d.benchmark.symbol}</span>
                {d.benchmark.last_close != null && <span className="mono">{price(d.benchmark.last_close)}</span>}
                {d.benchmark.chg_30d != null && (
                  <span className={`mono ${d.benchmark.chg_30d > 0 ? "pos" : d.benchmark.chg_30d < 0 ? "neg" : ""}`}>{pct(d.benchmark.chg_30d)} 30d</span>
                )}
                {d.benchmark.chg_90d != null && (
                  <span className={`mono ${d.benchmark.chg_90d > 0 ? "pos" : d.benchmark.chg_90d < 0 ? "neg" : ""}`}>{pct(d.benchmark.chg_90d)} 90d</span>
                )}
              </span>
            )}
          </h1>
          <div className="meta">
            {d.description} · {d.universe_count} names in the universe · benchmark {d.benchmark_etf}
            {d.benchmark && d.benchmark.last_date ? ` · ETF close ${shortDate(d.benchmark.last_date)}` : ""}
          </div>
        </div>
        <div className="actions">
          <button className={`btn ${d.followed ? "btn-secondary" : "btn-primary"} btn-sm`} disabled={busy || atLimit} onClick={toggleFollow}>
            {busy ? "…" : d.followed ? "Stop following" : getToken() ? "Follow" : "Sign in to follow"}
          </button>
        </div>
      </div>

      {atLimit && (
        <p className="small muted">
          Your plan follows {industriesLabel(limit)}. Drop one in <Link to="/settings#industries">your account</Link>, or{" "}
          <Link to="/pricing">see plans</Link> that follow more.
        </p>
      )}

      {d.names ? (
        <>
          <div className="boardhead">
            <b>Fast Mover</b>
            <span>
              top {d.names.length} of {d.universe_count} names
            </span>
            {d.run_as_of && <span>run {dateTime(d.run_as_of, tz)}</span>}
          </div>
          {d.names.length === 0 ? (
            <Empty title="No scored names in this industry on the latest run." />
          ) : (
            <div className="table-card cards">
              <table className="data comfortable">
                <thead>
                  <tr>
                    <th className="rank" scope="col">
                      #
                    </th>
                    <th scope="col">Name</th>
                    <th scope="col" className="num">
                      Score
                    </th>
                    <th scope="col">Band</th>
                    <th scope="col" className="num">
                      Coverage
                    </th>
                    <th scope="col" className="num">
                      Δ run
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {d.names.map((r) => {
                    const cov = coverage(r.components_present, r.components_total);
                    return (
                      <tr key={r.symbol} className="rowlink" onClick={() => navigate(`/stock/${r.symbol}`)}>
                        <td className="rank c-rank">{r.rank}</td>
                        <td className="name-cell c-sym">
                          <Link className="sym" to={`/stock/${r.symbol}`} onClick={(e) => e.stopPropagation()}>
                            {r.symbol}
                          </Link>
                          <span className="theme">{r.theme}</span>
                        </td>
                        <td className="num c-score c-hide">{fmtScore(r.value, r.components_present, r.components_total)}</td>
                        <td className="c-band">
                          <ScoreBadge band={r.band} value={r.value} present={r.components_present} total={r.components_total} />
                        </td>
                        <td className="num cov-cell c-cov" data-label="Coverage">
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
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="footnote">
            Shown: the top {d.names_shown_limit} your plan includes. <Link to={`/board?industry=${d.key}`}>Open on the Board</Link> for every
            lens and sort.
          </p>
        </>
      ) : (
        <div className="card locked-panel">
          <p className="state-title">{getToken() ? "This industry is outside your plan's followed set." : "Sign in to see this industry's names."}</p>
          <p className="muted">
            {d.universe_count} names are scored here on every run. Follow it to put them on your Board
            {me && me.tier && limit < 999 ? ` (your plan follows ${industriesLabel(limit)})` : ""}.
          </p>
          {!getToken() && (
            <Link to={`/login?next=${encodeURIComponent(`/industries/${industryKey}`)}`} className="btn btn-primary">
              Log in
            </Link>
          )}
        </div>
      )}

      {all.length > 1 && (
        <div className="section">
          <h2>Other industries</h2>
          <div className="row">
            {all
              .filter((i) => i.key !== d.key)
              .map((i) => (
                <Link key={i.key} to={`/industries/${i.key}`} className="chip chip-plain" style={{ height: 28, textTransform: "none", letterSpacing: 0 }}>
                  {i.label}
                </Link>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
