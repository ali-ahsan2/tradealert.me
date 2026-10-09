import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { Link } from "../lib/router.jsx";
import { useMe } from "../lib/me.jsx";
import { DAYS, age, dateTime, delta, deltaTone, inDays, plural, score as fmtScore, shortDate, signed } from "../lib/fmt.js";
import ScoreBadge from "../components/ScoreBadge.jsx";
import BandBar from "../components/BandBar.jsx";
import Spark, { Move, MoveChip } from "../components/Spark.jsx";
import Icon from "../components/Icons.jsx";
import { AgeChip, Empty, ErrorCard, Skeleton } from "../components/ui.jsx";

// Home (DESIGN_V4.md §2.5): one number and one chart first, then movers,
// then the industries, then the lists. The hero index is equal-weight and
// rebased to 100, labelled as relative movement: the product holds no
// positions and shows no dollar figure.

const RANGES = [
  ["1M", 30],
  ["3M", 90],
  ["1Y", 365],
];

function IndexChart({ series, ghost, label }) {
  const pts = series || [];
  if (pts.length < 2) return null;
  const W = 800;
  const H = 240;
  const all = pts.concat(ghost || []).map((p) => p.v);
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const span = hi - lo || 1;
  const x = (i, n) => (i / (n - 1)) * W;
  const y = (v) => H - 8 - ((v - lo) / span) * (H - 16);
  const path = (s) => s.map((p, i) => `${i ? "L" : "M"}${x(i, s.length).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const d = path(pts);
  const up = pts[pts.length - 1].v >= pts[0].v;
  const base = y(100);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <line x1="0" x2={W} y1={base} y2={base} stroke="var(--border-strong)" strokeDasharray="0" strokeWidth="1" />
      {ghost && ghost.length > 1 && <path d={path(ghost)} fill="none" stroke="var(--ink-faint)" strokeWidth="1.5" opacity="0.6" />}
      <path d={`${d} L${W},${H} L0,${H} Z`} fill={up ? "var(--pos)" : "var(--neg)"} opacity="0.12" />
      <path d={d} fill="none" stroke={up ? "var(--pos)" : "var(--neg)"} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={W} cy={y(pts[pts.length - 1].v)} r="4" fill={up ? "var(--pos)" : "var(--neg)"} />
    </svg>
  );
}

function Hero({ me }) {
  const [days, setDays] = useState(90);
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let alive = true;
    api(`/me/watchlist/series?days=${days}`)
      .then((x) => alive && setD(x))
      .catch((e) => alive && setErr(e));
    return () => {
      alive = false;
    };
  }, [days]);
  if (err) return null;
  if (!d) return <Skeleton rows={1} height={320} />;
  const hasWatch = d.watchlist.points.length > 1;
  const bench = d.benchmarks.filter((b) => b.points.length > 1);
  const main = hasWatch ? d.watchlist.points : bench[0] ? bench[0].points : [];
  const chg = hasWatch ? d.watchlist.change_pct : bench[0] ? bench[0].change_pct : null;
  const ghost = hasWatch && bench[0] ? bench[0].points : null;
  const title = hasWatch ? "Your watchlist" : bench[0] ? bench[0].industry_label : "Your universe";
  return (
    <section className="card hero" aria-labelledby="hero-h">
      <div className="hero-top">
        <div>
          <div className="hero-label" id="hero-h">
            {title} · {RANGES.find(([, v]) => v === days)[0]}
          </div>
          <div className="hero-num">
            {chg == null ? "—" : <Move value={chg} digits={1} />}
          </div>
          <div className="hero-sub">
            {hasWatch ? (
              <>
                <span>
                  {plural(d.watchlist.symbols.length, "pinned name")}, equal-weight
                </span>
                {bench[0] && bench[0].change_pct != null && (
                  <span>
                    vs {bench[0].symbol} <Move value={bench[0].change_pct} />
                  </span>
                )}
              </>
            ) : bench[0] ? (
              <span>
                {bench[0].symbol} · {bench[0].label}. Pin names to track your own list here.
              </span>
            ) : (
              <span>No bars on file yet.</span>
            )}
          </div>
        </div>
        <div className="seg" role="group" aria-label="Range">
          {RANGES.map(([l, v]) => (
            <button key={v} aria-pressed={days === v} onClick={() => setDays(v)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      {main.length > 1 ? (
        <div className="hero-chart">
          <IndexChart series={main} ghost={ghost} label={`${title}, rebased to 100, ${days} days`} />
        </div>
      ) : (
        <p className="muted small" style={{ marginTop: "var(--s-4)" }}>
          Nothing to chart yet. <Link to="/board">Pin a few names from the Board</Link> and this becomes your list.
        </p>
      )}
      <div className="hero-foot">
        <span className="hero-legend">
          <i /> {hasWatch ? "your watchlist" : title}
        </span>
        {ghost && (
          <span className="hero-legend">
            <i className="ghost" /> {bench[0].symbol}
          </span>
        )}
        <span>rebased to 100 at the start of the window · relative movement, not a balance</span>
        {bench.length > 1 && (
          <span>
            also following:{" "}
            {bench.slice(hasWatch ? 1 : 1).map((b) => (
              <span key={b.symbol} style={{ marginRight: 10 }}>
                {b.symbol} <Move value={b.change_pct} />
              </span>
            ))}
          </span>
        )}
      </div>
    </section>
  );
}

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
  const [screen, setScreen] = useState(null);
  const [err, setErr] = useState(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    setErr(null);
    api("/overview")
      .then((x) => alive && setD(x))
      .catch((e) => alive && setErr(e));
    // movers: the biggest 30-day price moves among the names on the board
    api("/screen?sort=chg30&limit=40")
      .then((x) => alive && setScreen(x))
      .catch(() => alive && setScreen({ rows: [] }));
    return () => {
      alive = false;
    };
  }, [reload]);

  const movers = useMemo(() => {
    if (!screen) return [];
    const rows = screen.rows.filter((r) => r.price && r.price.chg_30d != null);
    const up = rows.slice(0, 6);
    const down = [...rows].reverse().filter((r) => r.price.chg_30d < 0).slice(0, 4);
    return [...up, ...down];
  }, [screen]);

  const tz = me && me.settings ? me.settings.timezone : undefined;
  const first = me && (me.name || me.email || "").split("@")[0];

  if (err) {
    return (
      <div className="wrap wrap-narrow">
        <ErrorCard error={err} onRetry={() => setReload((n) => n + 1)} title="Couldn't load your home screen." />
      </div>
    );
  }
  if (!d) {
    return (
      <div className="wrap">
        <Skeleton rows={1} height={320} />
        <Skeleton rows={2} height={84} />
      </div>
    );
  }

  const run = d.run;
  const w = d.watchlist;
  const a = d.alerts;
  const c = d.changes;
  const K = d.tier ? d.tier.names_shown_limit : 5;

  return (
    <div className="wrap">
      <div className="pagehead">
        <div>
          <h1>{first ? `Hi ${first}` : "Home"}</h1>
          <div className="meta">
            {run ? (
              <>
                Run {dateTime(run.as_of, tz)} <AgeChip asOf={run.as_of} /> · {run.visible_names} names in your universe
              </>
            ) : (
              "No completed run yet."
            )}
          </div>
        </div>
        <div className="actions">
          <Link to="/screen" className="btn btn-secondary btn-sm">
            <Icon name="screen" size={16} /> Screen
          </Link>
          <Link to="/board" className="btn btn-primary btn-sm">
            Open the Board <Icon name="arrow" size={16} />
          </Link>
        </div>
      </div>

      {!run && <Empty title="No scored run yet.">Scores appear after the first daily run completes.</Empty>}

      {run && (
        <>
          <Hero me={me} />

          {movers.length > 0 && (
            <>
              <div className="section-head">
                <h2>Movers, 30 days</h2>
                <span className="muted small">biggest price moves among your names · daily closes</span>
              </div>
              <div className="movers-row">
                {movers.map((r) => (
                  <Link key={r.symbol} to={`/stock/${r.symbol}`} className="mover-card">
                    <span className="sym">{r.symbol}</span>
                    <span className="theme">{r.theme}</span>
                    <Spark closes={r.price.closes} width={140} height={36} />
                    <Move value={r.price.chg_30d} />
                    <span className="xs faint">
                      {r.band} {fmtScore(r.value, r.components_present, r.components_total)}
                    </span>
                  </Link>
                ))}
              </div>
            </>
          )}

          <div className="tiles">
            <Tile
              label="Watchlist"
              value={w.limit != null ? `${w.count} / ${w.limit}` : w.count}
              sub={w.count ? `${w.strong_or_elevated} strong or elevated · ${delta(w.mean_delta_since_pin)} since pinned` : "Pin names from the Board"}
              to="/watchlist"
            />
            <Tile
              label="Alerts"
              value={a.limit === 0 ? "—" : a.unread}
              sub={a.limit === 0 ? "Included from Basic" : `unread · ${a.fired_7d} fired in 7d · ${a.armed} armed`}
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
              sub={c ? `band moves · ${c.summary.new} new · mean Δ ${delta(c.summary.mean_delta)}` : "One run on record"}
              to="/changes"
            />
          </div>

          <section className="section" aria-labelledby="ov-ind" style={{ marginTop: 0 }}>
            <div className="section-head">
              <h2 id="ov-ind">Your industries</h2>
              <span className="muted small">Fast Mover on the latest run · names are your top {Math.min(3, K)}</span>
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
                      {ind.benchmark && (
                        <span className="row" style={{ gap: 8 }}>
                          <Spark closes={ind.benchmark.closes} width={64} height={22} />
                          <span className="xs faint">{ind.benchmark.symbol}</span>
                          <MoveChip value={ind.benchmark.chg_30d} />
                        </span>
                      )}
                    </div>
                    <BandBar distribution={ind.distribution} />
                    <div className="ovind-facts xs faint">
                      <span>{ind.scored} scored</span>
                      <span>mean {ind.mean_score != null ? Math.round(ind.mean_score) : "—"}</span>
                      <span>{ind.cleared} cleared the screen</span>
                      {ind.new > 0 && <span>{ind.new} new</span>}
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
                      <Link to={`/industries/${ind.key}`}>Industry</Link>
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
                  {[["Band up", c.band_up], ["Band down", c.band_down]].map(([title, rows]) =>
                    rows.length ? (
                      <React.Fragment key={title}>
                        <h4 className="minihead">{title}</h4>
                        <ul className="namelist">
                          {rows.map((r) => (
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
                      </React.Fragment>
                    ) : null
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
            Scores from the run at {dateTime(run.as_of, tz)}; price moves from daily closes. Research and information only; nothing on this page is a
            recommendation.
          </p>
        </>
      )}
    </div>
  );
}
