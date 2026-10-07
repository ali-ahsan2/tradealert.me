import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { Link } from "../lib/router.jsx";
import { useMe } from "../lib/me.jsx";
import { DAYS, age, dateTime, delta, deltaTone, inDays, pct, plural, score as fmtScore, shortDate, signed, tone } from "../lib/fmt.js";
import SearchBar from "../components/SearchBar.jsx";
import ScoreBadge from "../components/ScoreBadge.jsx";
import BandBar from "../components/BandBar.jsx";
import { AgeChip, Empty, ErrorCard, Skeleton } from "../components/ui.jsx";

// The first screen after sign-in: the run, each followed industry's shape,
// the watchlist, alerts, the next two weeks of dated events and what moved
// since the previous run. Every number links to the screen that explains it.

function Tile({ label, value, sub, to }) {
  const body = (
    <>
      <span className="tile-label">{label}</span>
      <span className="tile-value">{value}</span>
      {sub && <span className="tile-sub">{sub}</span>}
    </>
  );
  return to ? (
    <Link to={to} className="tile card">
      {body}
    </Link>
  ) : (
    <div className="tile card">{body}</div>
  );
}

function NameLine({ r, right, href }) {
  return (
    <li className="nameline">
      <Link className="sym" to={href || `/stock/${r.symbol}`}>
        {r.symbol}
      </Link>
      <span className="theme muted small" title={r.theme}>
        {r.theme}
      </span>
      <span className="spacer" />
      {right}
    </li>
  );
}

export default function Overview() {
  const { me } = useMe();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    setErr(null);
    api("/overview")
      .then((x) => alive && setD(x))
      .catch((e) => alive && setErr(e));
    return () => {
      alive = false;
    };
  }, [reload]);

  const tz = me && me.settings ? me.settings.timezone : undefined;
  const first = me && (me.name || me.email || "").split("@")[0];

  if (err) {
    return (
      <div className="wrap wrap-narrow">
        <ErrorCard error={err} onRetry={() => setReload((n) => n + 1)} title="Couldn't load your overview." />
      </div>
    );
  }
  if (!d) {
    return (
      <div className="wrap">
        <div className="pagehead">
          <div>
            <h1>Overview</h1>
          </div>
        </div>
        <Skeleton rows={2} height={84} />
        <Skeleton rows={3} height={140} />
      </div>
    );
  }

  const run = d.run;
  const runAge = run ? age(run.as_of) : null;
  const w = d.watchlist;
  const a = d.alerts;
  const c = d.changes;
  const K = d.tier ? d.tier.names_shown_limit : 5;

  return (
    <div className="wrap">
      <div className="pagehead">
        <div>
          <h1>Overview</h1>
          <div className="meta">
            {first ? `${first} · ` : ""}
            {run ? (
              <>
                run {dateTime(run.as_of, tz)} <AgeChip asOf={run.as_of} /> · {run.visible_names} names in your universe · {plural(run.runs_on_record, "run")} on record
              </>
            ) : (
              "No completed run yet."
            )}
          </div>
        </div>
        <div className="actions">
          <SearchBar />
        </div>
      </div>

      {!run && <Empty title="No scored run yet.">Scores appear after the first daily run completes.</Empty>}

      {run && (
        <>
          <div className="tiles">
            <Tile
              label="Watchlist"
              value={w.limit != null ? `${w.count} / ${w.limit}` : w.count}
              sub={
                w.count
                  ? `${w.strong_or_elevated} strong or elevated · mean ${delta(w.mean_delta_since_pin)} since pinned`
                  : "Pin names from the Board or Screener"
              }
              to="/watchlist"
            />
            <Tile
              label="Alerts"
              value={a.limit === 0 ? "—" : a.unread}
              sub={a.limit === 0 ? "Included from Basic" : `${a.unread === 1 ? "unread" : "unread"} · ${a.fired_7d} fired in 7d on ${a.fired_7d_names} names · ${a.armed} armed`}
              to="/alerts"
            />
            <Tile
              label="Catalysts, 14 days"
              value={d.catalysts.next_14d}
              sub={d.catalysts.next_14d ? `next: ${d.catalysts.upcoming[0].symbol} ${inDays(d.catalysts.upcoming[0].days)}` : "No dated events on file"}
              to="/calendar"
            />
            <Tile
              label="Since previous run"
              value={c ? `${c.summary.band_up}↑ ${c.summary.band_down}↓` : "—"}
              sub={c ? `band moves · ${c.summary.new} new · mean Δ ${delta(c.summary.mean_delta)} · vs ${shortDate(c.prev_as_of, tz)}` : "One run on record"}
              to="/changes"
            />
          </div>

          <section className="section" aria-labelledby="ov-ind">
            <div className="section-head">
              <h2 id="ov-ind">Your industries</h2>
              <span className="muted small">
                Fast Mover on the latest run · aggregates cover the whole industry; names are your top {Math.min(3, K)}
              </span>
            </div>
            {d.industries.length === 0 ? (
              <Empty
                title="You're not following any industries yet."
                action={
                  <Link to="/onboarding" className="btn btn-primary">
                    Choose industries
                  </Link>
                }
              />
            ) : (
              <div className="ovgrid">
                {d.industries.map((ind) => (
                  <article className="card ovind" key={ind.key}>
                    <div className="ovind-head">
                      <Link to={`/industries/${ind.key}`} className="ovind-title">
                        {ind.label}
                      </Link>
                      {ind.benchmark && ind.benchmark.chg_30d != null && (
                        <span className="xs faint mono" title={`${ind.benchmark.symbol} ${ind.benchmark.label}`}>
                          {ind.benchmark.symbol} <span className={tone(ind.benchmark.chg_30d)}>{pct(ind.benchmark.chg_30d)}</span> 30d
                          {ind.benchmark.chg_90d != null && (
                            <>
                              {" "}
                              · <span className={tone(ind.benchmark.chg_90d)}>{pct(ind.benchmark.chg_90d)}</span> 90d
                            </>
                          )}
                        </span>
                      )}
                    </div>
                    <BandBar distribution={ind.distribution} />
                    <div className="ovind-facts xs faint">
                      <span>{ind.scored} scored of {ind.universe}</span>
                      <span>mean {ind.mean_score != null ? Math.round(ind.mean_score) : "—"}</span>
                      <span>{ind.cleared} cleared the screen</span>
                      {ind.new > 0 && <span>{ind.new} new</span>}
                      {ind.mean_delta != null && <span className={deltaTone(ind.mean_delta)}>mean Δ {delta(ind.mean_delta)}</span>}
                    </div>
                    <ul className="namelist">
                      {ind.top.map((r) => (
                        <NameLine
                          key={r.symbol}
                          r={r}
                          right={
                            <>
                              <span className={`mono xs ${deltaTone(r.delta_1d)}`}>{delta(r.delta_1d)}</span>
                              <ScoreBadge band={r.band} value={r.value} present={r.components_present} total={r.components_total} />
                            </>
                          }
                        />
                      ))}
                    </ul>
                    <div className="ovind-links small">
                      <Link to={`/board?industry=${ind.key}`}>Board</Link>
                      <Link to={`/screen?industries=${ind.key}`}>Screen</Link>
                      <Link to={`/industries/${ind.key}`}>Industry page</Link>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <div className="ovcols">
            <section className="card" aria-labelledby="ov-chg">
              <div className="card-title">
                <h2 id="ov-chg">Since the previous run</h2>
                <Link to="/changes" className="small">
                  All changes →
                </Link>
              </div>
              {!c ? (
                <p className="muted small">Only one run is on record; changes appear from the second run.</p>
              ) : (
                <>
                  <p className="muted small">
                    {c.summary.compared} names compared with {shortDate(c.prev_as_of, tz)}: {c.summary.up} up, {c.summary.down} down, {c.summary.new} new,{" "}
                    {c.summary.cleared} cleared the screen, {c.summary.failed} failed it.
                  </p>
                  {c.band_up.length > 0 && (
                    <>
                      <h4 className="minihead">Band up</h4>
                      <ul className="namelist">
                        {c.band_up.map((r) => (
                          <NameLine
                            key={r.symbol}
                            r={r}
                            right={
                              <span className="xs">
                                {r.prev.band} → <b>{r.now.band}</b> <span className={`mono ${deltaTone(r.delta)}`}>{delta(r.delta)}</span>
                              </span>
                            }
                          />
                        ))}
                      </ul>
                    </>
                  )}
                  {c.band_down.length > 0 && (
                    <>
                      <h4 className="minihead">Band down</h4>
                      <ul className="namelist">
                        {c.band_down.map((r) => (
                          <NameLine
                            key={r.symbol}
                            r={r}
                            right={
                              <span className="xs">
                                {r.prev.band} → <b>{r.now.band}</b> <span className={`mono ${deltaTone(r.delta)}`}>{delta(r.delta)}</span>
                              </span>
                            }
                          />
                        ))}
                      </ul>
                    </>
                  )}
                  {c.new.length > 0 && (
                    <>
                      <h4 className="minihead">New on the run</h4>
                      <ul className="namelist">
                        {c.new.map((r) => (
                          <NameLine key={r.symbol} r={r} right={<span className="mono xs">{fmtScore(r.now.value, r.now.present, r.now.total)}</span>} />
                        ))}
                      </ul>
                    </>
                  )}
                  {c.band_up.length + c.band_down.length + c.new.length === 0 && <p className="muted small">No band moved and nothing new was scored.</p>}
                </>
              )}
            </section>

            <section className="card" aria-labelledby="ov-cal">
              <div className="card-title">
                <h2 id="ov-cal">Next 14 days</h2>
                <Link to="/calendar" className="small">
                  Calendar →
                </Link>
              </div>
              {d.catalysts.upcoming.length === 0 ? (
                <p className="muted small">No dated event on file for your names in the next two weeks.</p>
              ) : (
                <ul className="namelist">
                  {d.catalysts.upcoming.map((r) => (
                    <NameLine
                      key={`${r.symbol}-${r.date}`}
                      r={r}
                      right={
                        <>
                          <span className="xs faint">
                            {shortDate(r.date)} · {inDays(r.days)}
                            {r.confidence ? ` · ${r.confidence}` : ""}
                          </span>
                          {r.band && <ScoreBadge band={r.band} value={r.value} present={r.components_present} total={r.components_total} />}
                        </>
                      }
                    />
                  ))}
                </ul>
              )}
              {d.catalysts.next_14d > d.catalysts.upcoming.length && (
                <p className="xs faint" style={{ marginTop: "var(--s-2)" }}>
                  {d.catalysts.next_14d - d.catalysts.upcoming.length} more in your industries. <Link to="/calendar">Open the calendar</Link>.
                </p>
              )}
            </section>
          </div>

          <div className="ovcols">
            <section className="card" aria-labelledby="ov-wl">
              <div className="card-title">
                <h2 id="ov-wl">Watchlist</h2>
                <Link to="/watchlist" className="small">
                  Open →
                </Link>
              </div>
              {w.count === 0 ? (
                <p className="muted small">
                  Nothing pinned. Pin from the <Link to="/board">Board</Link> or the <Link to="/screen">Screener</Link>; pinned names go into your weekly digest.
                </p>
              ) : (
                <>
                  <p className="muted small">
                    {plural(w.count, "name")} · {w.up_5} up 5+ and {w.down_5} down 5+ since pinned · {w.cleared} clear the screen now.
                  </p>
                  <ul className="namelist">
                    {w.movers.map((r) => (
                      <NameLine
                        key={r.symbol}
                        r={{ ...r, theme: `${r.band} · now ${fmtScore(r.value)}` }}
                        right={<span className={`mono ${deltaTone(r.delta_since_pin)}`}>{signed(r.delta_since_pin, 0)} since pin</span>}
                      />
                    ))}
                  </ul>
                </>
              )}
            </section>

            <section className="card" aria-labelledby="ov-al">
              <div className="card-title">
                <h2 id="ov-al">Alerts and digest</h2>
                <Link to="/alerts" className="small">
                  Open →
                </Link>
              </div>
              {a.limit === 0 ? (
                <p className="muted small">
                  Alerts are included from Basic. <Link to="/pricing">See plans</Link>. Your weekly digest still goes out.
                </p>
              ) : a.fired_7d === 0 ? (
                <p className="muted small">Nothing fired on your names in the last 7 days. {a.armed} triggers armed.</p>
              ) : (
                <ul className="namelist">
                  {a.by_trigger.map((t) => (
                    <li className="nameline" key={t.trigger}>
                      <span>{t.trigger}</span>
                      <span className="spacer" />
                      <span className="mono">{t.n}</span>
                    </li>
                  ))}
                </ul>
              )}
              {d.digest && (
                <p className="xs faint" style={{ marginTop: "var(--s-3)", marginBottom: 0 }}>
                  {d.digest.enabled
                    ? `Weekly digest: ${DAYS[d.digest.day]} at ${String(d.digest.hour).padStart(2, "0")}:00 ${d.digest.timezone}.`
                    : "Weekly digest is off."}{" "}
                  <Link to="/digests">Preview</Link> · <Link to="/settings#digest">Change</Link>
                </p>
              )}
            </section>
          </div>

          <p className="footnote">
            Scores from the run at {dateTime(run.as_of, tz)}; benchmark moves from daily closes. Research and information only; nothing on this page is
            a recommendation.
          </p>
        </>
      )}
    </div>
  );
}
