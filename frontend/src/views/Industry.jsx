import React, { useEffect, useState } from "react";
import { api, cached, getToken, toast } from "../api.js";
import { Link, navigate } from "../lib/router.jsx";
import { useMe } from "../lib/me.jsx";
import { useMode } from "../lib/mode.js";
import { coverage, dateTime, delta, industriesLabel, pct, plural, price, score as fmtScore, shortDate } from "../lib/fmt.js";
import { CTA, bandWord, changeSentence, firesSentence, firstSentence } from "../lib/plain.js";
import { LIST_CARDS } from "../lib/caps.js";
import { openUpgrade } from "../lib/upgrade.js";
import ScoreBadge from "../components/ScoreBadge.jsx";
import BandBar from "../components/BandBar.jsx";
import ScreenHead from "../components/ScreenHead.jsx";
import FinePrint from "../components/FinePrint.jsx";
import NameCard, { ShowAll } from "../components/NameCard.jsx";
import NotifyButton from "../components/NotifyButton.jsx";
import { EVIDENCE } from "../lib/evidence.js";
import { Empty, ErrorCard, Skeleton } from "../components/ui.jsx";
import "./board.css";

// One industry, plain first (DESIGN_V6 §7, §8): one line on why it moves
// and one action (watch it for me), then what is in it, what tends to fire
// there (measured from the alert record, never written), the month in
// numbers, then its top names on Fast Mover when the viewer's plan follows
// it: cards in Simple (LIST_CARDS, then "Show all"), the table in Full.
// Simple mode shows one sentence where Full shows a card. Names in an
// industry outside the plan are never listed; only the count is.
export default function Industry({ industryKey }) {
  const { me, refresh } = useMe();
  const { simple } = useMode();
  const [d, setD] = useState(null);
  const [all, setAll] = useState([]);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  // Simple shows LIST_CARDS names before "Show all" (lib/caps.js); Full shows the table
  const [allNames, setAllNames] = useState(false);

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

  // A visitor's one action on this screen is Start free, which brings them
  // back here; the kicker leads to the start, since Explore needs a session.
  const signedIn = Boolean(getToken());
  const startHere = `/signup?next=${encodeURIComponent(`/industries/${industryKey}`)}`;
  const back = signedIn ? ["/board", "← Explore"] : ["/", "← tradealert.me"];

  const toggleFollow = async () => {
    if (!signedIn) {
      navigate(startHere);
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
        <Link to={back[0]} className="backlink">
          {back[1]}
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
  const why = d.plain && d.plain.why_it_moves ? firstSentence(d.plain.why_it_moves) : "";
  const rx = d.reactions;

  return (
    <div className="wrap">
      <ScreenHead
        kicker={
          <Link to={back[0]} className="backlink">
            {back[1]}
          </Link>
        }
        title={d.label}
        line={why || firstSentence(whatIsInIt)}
        action={
          signedIn ? (
            <button className={`btn ${d.followed ? "btn-secondary" : "btn-primary"}`} disabled={busy || atLimit} onClick={toggleFollow}>
              {busy ? "…" : d.followed ? CTA.STOP_WATCHING : "Watch this industry for me"}
            </button>
          ) : null
        }
      />

      <p className="plain-note">
        {whatIsInIt && why ? `${whatIsInIt} ` : ""}
        {plural(d.universe_count, "name")}, measured against {d.benchmark_etf}
        {d.benchmark && d.benchmark.last_date ? ` (close ${shortDate(d.benchmark.last_date)})` : ""}.
        {d.benchmark && (d.benchmark.chg_30d != null || d.benchmark.chg_90d != null) && (
          <span className="ind-bench" title={d.benchmark.label}>
            {" "}
            {d.benchmark.symbol}
            {d.benchmark.last_close != null && ` ${price(d.benchmark.last_close)}`}
            {d.benchmark.chg_30d != null && (
              <>
                {" "}
                <span className={d.benchmark.chg_30d > 0 ? "pos" : d.benchmark.chg_30d < 0 ? "neg" : ""}>{pct(d.benchmark.chg_30d)}</span> in 30 days
              </>
            )}
            {d.benchmark.chg_90d != null && (
              <>
                {", "}
                <span className={d.benchmark.chg_90d > 0 ? "pos" : d.benchmark.chg_90d < 0 ? "neg" : ""}>{pct(d.benchmark.chg_90d)}</span> in 90 days
              </>
            )}
            .
          </span>
        )}
      </p>
      {month.fired > 0 && (
        <p className="plain-note" style={{ marginTop: 6 }}>
          The month in numbers: <b>{month.fired}</b> {month.fired === 1 ? "alert" : "alerts"} fired here, <b>{month.measured}</b> measured so far,{" "}
          <b>{month.moved_10}</b> moved 10% or more within five sessions.{month.fired >= 10 ? ` ${firesSentence(month)}` : ""}
        </p>
      )}

      {atLimit && (
        <p className="small muted" style={{ marginTop: "var(--s-3)" }}>
          Your plan watches {industriesLabel(limit)}. Stop watching one in <Link to="/settings#industries">My account</Link>, or{" "}
          <button type="button" className="linkbtn" onClick={() => openUpgrade("industries", { key: d.key, label: d.label })}>
            {CTA.NEXT_PLAN.toLowerCase()}
          </button>
          .
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
            <b>{simple ? "Top names on Fast Mover" : "Fast Mover"}</b>
            <span>
              top {d.names.length} of {d.universe_count} names
            </span>
            {d.run_as_of && <span>{simple ? "scored " : ""}{dateTime(d.run_as_of, tz)}</span>}
          </div>
          {d.names.length === 0 ? (
            <Empty title="No rated names in this industry this morning." />
          ) : simple ? (
            <>
              <ol className="bcards" aria-label={`Top names in ${d.label}`}>
                {(allNames ? d.names : d.names.slice(0, LIST_CARDS)).map((r, i) => (
                  <NameCard
                    key={r.symbol}
                    index={i}
                    symbol={r.symbol}
                    sub={r.theme}
                    to={`/stock/${r.symbol}`}
                    sentence={changeSentence(r.delta_1d, r.band)}
                    meta={
                      <>
                        <b>{bandWord(r.band)}</b> <span className="num">{fmtScore(r.value, r.components_present, r.components_total)}</span>
                      </>
                    }
                    action={<NotifyButton symbol={r.symbol} compact />}
                  />
                ))}
              </ol>
              <ShowAll total={d.names.length} shown={allNames ? d.names.length : Math.min(LIST_CARDS, d.names.length)} open={allNames} onToggle={() => setAllNames((a) => !a)} />
            </>
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
                      Since the last scoring
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
                        <td className="num c-delta" data-label="Since the last scoring">
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
            Shown: the top {d.names_shown_limit} your plan includes. <Link to={`/board?industry=${d.key}`}>{CTA.BOARD}</Link> for every strategy and
            sort, or <Link to={`/screen?industries=${d.key}`}>find me names in this industry</Link> on the market data on file.
          </p>
        </>
      ) : (
        <div className="card locked-panel" style={{ marginTop: "var(--s-5)" }}>
          <p className="state-title">{signedIn ? "Your plan does not watch this industry yet." : "Start free to see this industry's names."}</p>
          <p className="muted">
            {plural(d.universe_count, "name")} are rated here every morning.{" "}
            {signedIn ? (
              <>
                Watch it for me and they join your Explore
                {me && me.tier && limit < 999 ? ` (your plan watches ${industriesLabel(limit)})` : ""}.
              </>
            ) : (
              <>Free plan, no card; pick this industry and they join your Explore.</>
            )}
          </p>
          {!signedIn && (
            <Link to={startHere} className="btn btn-primary">
              {CTA.START_FREE}
            </Link>
          )}
        </div>
      )}

      <FinePrint short />

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
