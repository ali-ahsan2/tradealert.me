import React, { useEffect, useState } from "react";
import { api, cached, getToken, toast } from "../api.js";
import { Link, navigate } from "../lib/router.jsx";
import { useMe } from "../lib/me.jsx";
import { useMode } from "../lib/mode.js";
import { coverage, dateTime, delta, industriesLabel, pct, plural, price, score as fmtScore, shortDate } from "../lib/fmt.js";
import ScoreBadge from "../components/ScoreBadge.jsx";
import BandBar from "../components/BandBar.jsx";
import { EVIDENCE } from "../lib/evidence.js";
import { Empty, ErrorCard, Skeleton } from "../components/ui.jsx";
import { IndustryPlainLine } from "../components/Plain.jsx";

// One industry, plain first (DESIGN_V6 §8): what is in it, why it moves,
// what tends to fire there (measured from the alert record, never written),
// the month in numbers, then its top names on Fast Mover when the viewer's
// plan follows it. Simple mode shows one sentence where Full shows a card.
// Names in an industry outside the plan are never listed; only the count is.
export default function Industry({ industryKey }) {
  const { me, refresh } = useMe();
  const { simple } = useMode();
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

  const shape = d.shape || {};
  const dist = shape.distribution || {};
  const month = d.month || {};
  const whatIsInIt = (d.plain && d.plain.what_is_in_it) || d.description;
  const rx = d.reactions;

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
            {whatIsInIt ? `${whatIsInIt} ` : ""}
            {plural(d.universe_count, "name")}, measured against {d.benchmark_etf}
            {d.benchmark && d.benchmark.last_date ? ` (close ${shortDate(d.benchmark.last_date)})` : ""}.
          </div>
        </div>
        <div className="actions">
          <button className={`btn ${d.followed ? "btn-secondary" : "btn-primary"}`} disabled={busy || atLimit} onClick={toggleFollow}>
            {busy ? "…" : d.followed ? "Stop following" : getToken() ? "Follow this for me" : "Sign in to follow"}
          </button>
        </div>
      </div>

      <IndustryPlainLine industry={d} className="plain-opener-line" />
      {month.fired > 0 && (
        <p className="plain-note" style={{ marginTop: 6 }}>
          The month in numbers: <b>{month.fired}</b> {month.fired === 1 ? "alert" : "alerts"} fired here, <b>{month.measured}</b> measured so far,{" "}
          <b>{month.moved_10}</b> moved 10% or more within five sessions.
        </p>
      )}

      {atLimit && (
        <p className="small muted" style={{ marginTop: "var(--s-3)" }}>
          Your plan follows {industriesLabel(limit)}. Drop one in <Link to="/settings#industries">your account</Link>, or{" "}
          <Link to="/pricing">see plans</Link> that follow more.
        </p>
      )}

      {shape.scored > 0 && simple && (
        <section className="section" aria-labelledby="shape-h">
          <h2 id="shape-h">This morning</h2>
          <p className="plain-note">
            <b>{plural(shape.scored, "name")}</b> were rated on Fast Mover: <b>{dist.strong || 0}</b> strong, <b>{dist.elevated || 0}</b> elevated;{" "}
            <b>{shape.cleared}</b> passed every must-pass rule.
          </p>
          {d.themes && d.themes.length > 0 && (
            <div className="row" style={{ marginTop: "var(--s-3)", gap: "var(--s-2)" }}>
              {d.themes.map((t) => (
                <Link key={t.theme} to={`/screen?industries=${d.key}&q=${encodeURIComponent(t.theme)}`} className="fchip" title={`Find ${t.theme} in ${d.label}`}>
                  {t.theme} <span className="mono">{t.n}</span>
                </Link>
              ))}
            </div>
          )}
        </section>
      )}

      {shape.scored > 0 && !simple && (
        <section className="card" aria-labelledby="shape-h">
          <div className="card-title">
            <h2 id="shape-h">The industry this morning</h2>
            <span className="muted small">Fast Mover · all {shape.scored} rated names{shape.run_as_of ? ` · ${dateTime(shape.run_as_of, tz)}` : ""}</span>
          </div>
          <BandBar distribution={shape.distribution} />
          <div className="ovind-facts small" style={{ marginTop: "var(--s-3)" }}>
            <span>
              average score <b>{shape.mean_score != null ? Math.round(shape.mean_score) : "—"}</b>
            </span>
            <span>
              <b>{shape.cleared}</b> passed every must-pass rule
            </span>
            {Object.entries(shape.lanes || {}).map(([l, n]) => (
              <span key={l}>
                <b>{n}</b> {l === "unassigned" ? "no stage" : l.toLowerCase() === "early" ? "no date set yet" : l.toLowerCase() === "event" ? "a date is set" : `${l} stage`}
              </span>
            ))}
          </div>
          {d.themes && d.themes.length > 0 && (
            <div className="row" style={{ marginTop: "var(--s-3)", gap: "var(--s-2)" }}>
              {d.themes.map((t) => (
                <Link key={t.theme} to={`/screen?industries=${d.key}&q=${encodeURIComponent(t.theme)}`} className="fchip" title={`Find ${t.theme} in ${d.label}`}>
                  {t.theme} <span className="mono">{t.n}</span>
                </Link>
              ))}
            </div>
          )}
        </section>
      )}

      {rx && rx.n > 0 && (
        <section className={simple ? "section" : "card"} aria-labelledby="rx-h">
          {simple ? (
            <>
              <h2 id="rx-h">After past dated events</h2>
              <p className="plain-note">
                Across <b>{plural(rx.n, "past dated event")}</b> in this industry, <b>{rx.hits}</b> {rx.hits === 1 ? "was" : "were"} followed by{" "}
                {EVIDENCE.hitDefinition}. Measured across the whole industry, not a forecast and not specific to any name.
              </p>
              <details className="plain-more">
                <summary>More detail</summary>
                <ReactionsTable reactions={rx} />
              </details>
            </>
          ) : (
            <>
              <div className="card-title">
                <h2 id="rx-h">How this industry's names moved after dated events</h2>
                <span className="muted small">
                  {rx.n} real, resolved events · a hit is {EVIDENCE.hitDefinition}
                </span>
              </div>
              <ReactionsTable reactions={rx} />
              <p className="muted small" style={{ marginBottom: 0 }}>
                Measured movement after past events across the whole industry, not a forecast and not specific to any name shown above.
              </p>
            </>
          )}
        </section>
      )}

      {d.names ? (
        <>
          <div className="boardhead" style={{ marginTop: "var(--s-5)" }}>
            <b>Fast Mover</b>
            <span>
              top {d.names.length} of {d.universe_count} names
            </span>
            {d.run_as_of && <span>{dateTime(d.run_as_of, tz)}</span>}
          </div>
          {d.names.length === 0 ? (
            <Empty title="No rated names in this industry this morning." />
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
                    <th scope="col">Rating</th>
                    <th scope="col" className="num">
                      Data
                    </th>
                    <th scope="col" className="num">
                      Since last run
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
                        <td className="num cov-cell c-cov" data-label="Data">
                          <span className="covbar" aria-hidden="true">
                            {[0, 1, 2].map((i) => (
                              <span key={i} className={i < cov.segments ? "filled" : ""} />
                            ))}
                          </span>
                          {r.components_present}/{r.components_total}
                        </td>
                        <td className="num c-delta" data-label="Since last run">
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
            strategy and sort, or <Link to={`/screen?industries=${d.key}`}>find names in this industry</Link> on the market data on file.
          </p>
        </>
      ) : (
        <div className="card locked-panel" style={{ marginTop: "var(--s-5)" }}>
          <p className="state-title">{getToken() ? "Your plan does not follow this industry yet." : "Sign in to see this industry's names."}</p>
          <p className="muted">
            {plural(d.universe_count, "name")} are rated here every morning. Follow it to put them on your Board
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

function ReactionsTable({ reactions }) {
  return (
    <div className="tscroll">
      <table className="hf reactions">
        <thead>
          <tr>
            <th scope="col">Event</th>
            <th scope="col" className="num">
              Events
            </th>
            <th scope="col" className="num">
              Names
            </th>
            <th scope="col" className="num">
              Moved
            </th>
            <th scope="col" className="num">
              Share that moved
            </th>
            <th scope="col" className="num">
              Average biggest move
            </th>
            <th scope="col" className="num">
              Average close move
            </th>
          </tr>
        </thead>
        <tbody>
          {reactions.by_kind.map((k) => (
            <tr key={k.kind}>
              <td>{k.kind.replace(/_/g, " ")}</td>
              <td className="num">{k.n}</td>
              <td className="num">{k.names}</td>
              <td className="num">{k.hits}</td>
              <td className="num">{k.hit_rate != null ? `${Math.round(k.hit_rate * 100)}%` : <span className="faint" title="Fewer than ten events; no rate is shown">too few</span>}</td>
              <td className="num">{pct(k.mean_max_move_pct)}</td>
              <td className={`num ${k.mean_close_move_pct > 0 ? "pos" : k.mean_close_move_pct < 0 ? "neg" : ""}`}>{pct(k.mean_close_move_pct)}</td>
            </tr>
          ))}
          <tr>
            <td>
              <b>All</b>
            </td>
            <td className="num">{reactions.n}</td>
            <td className="num" />
            <td className="num">{reactions.hits}</td>
            <td className="num">{reactions.hit_rate != null ? `${Math.round(reactions.hit_rate * 100)}%` : <span className="faint">too few</span>}</td>
            <td className="num" />
            <td className="num" />
          </tr>
        </tbody>
      </table>
    </div>
  );
}
