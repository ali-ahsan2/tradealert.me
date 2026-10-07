import React, { useEffect, useMemo, useState } from "react";
import { api, toast } from "../api.js";
import { Link, navigate, useQuery } from "../lib/router.jsx";
import { useMe } from "../lib/me.jsx";
import { dateTime, inDays, pct, plural, shortDate, weekStart, weekday } from "../lib/fmt.js";
import { EVIDENCE } from "../lib/evidence.js";
import ScoreBadge from "../components/ScoreBadge.jsx";
import { AgeChip, Empty, ErrorCard, Notice, Skeleton } from "../components/ui.jsx";

// Dated events ahead for the names the subscriber can see, grouped by week,
// with the current score beside each, how the name moved after its past
// real events, and a one-click catalyst alert. Below it: what happened in
// the last 45 days and how those names moved, measured not predicted.

const WINDOWS = [14, 30, 60, 90];

export default function Calendar() {
  const { me } = useMe();
  const q = useQuery();
  const days = WINDOWS.includes(Number(q.get("days"))) ? Number(q.get("days")) : 60;
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [reload, setReload] = useState(0);
  const [arming, setArming] = useState("");

  useEffect(() => {
    let alive = true;
    setErr(null);
    setD(null);
    api(`/calendar?days=${days}`)
      .then((x) => alive && setD(x))
      .catch((e) => alive && setErr(e));
    return () => {
      alive = false;
    };
  }, [days, reload]);

  const weeks = useMemo(() => {
    if (!d) return [];
    const m = new Map();
    d.upcoming.forEach((r) => {
      const k = weekStart(r.date);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    });
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [d]);

  const tz = me && me.settings ? me.settings.timezone : undefined;
  const alertsLocked = Boolean(me && me.tier && me.tier.alerts_limit === 0);

  const arm = async (r) => {
    setArming(r.symbol);
    try {
      await api("/me/alerts/rules", { method: "POST", json: { symbol: r.symbol, trigger_key: "catalyst_dated", channels: ["email"] } });
      setD((x) => ({ ...x, upcoming: x.upcoming.map((u) => (u.symbol === r.symbol ? { ...u, armed: true } : u)) }));
      toast(`Armed a catalyst alert on ${r.symbol}.`);
    } catch (e) {
      toast(e.detail || "Couldn't arm that alert.");
    } finally {
      setArming("");
    }
  };

  return (
    <div className="wrap">
      <div className="pagehead">
        <div>
          <h1>Calendar</h1>
          <div className="meta">Dated events ahead for the names you can see, with the current score beside each, and how those names moved after past events.</div>
        </div>
        <div className="actions">
          <div className="seg" role="group" aria-label="Window">
            {WINDOWS.map((w) => (
              <button key={w} aria-pressed={days === w} onClick={() => navigate(`/calendar${w === 60 ? "" : `?days=${w}`}`, { replace: true })}>
                {w} days
              </button>
            ))}
          </div>
        </div>
      </div>

      {err && <ErrorCard error={err} onRetry={() => setReload((n) => n + 1)} title="Couldn't load the calendar." />}
      {!err && !d && <Skeleton rows={6} height={56} />}

      {d && (
        <>
          {d.meta.truncated && (
            <Notice tone="info">
              {d.meta.total - d.meta.shown} more dated {d.meta.total - d.meta.shown === 1 ? "event" : "events"} in your industries inside this window. Your plan shows the top{" "}
              {d.meta.names_shown_limit}. <Link to="/pricing">See plans</Link>.
            </Notice>
          )}

          {d.upcoming.length === 0 ? (
            <Empty title={`No dated events on file for your names in the next ${days} days.`}>
              Dates come from each name's latest market snapshot. A name with no earnings date on file is not listed, which is not the same as having no event.
            </Empty>
          ) : (
            <div className="stack">
              {weeks.map(([wk, rows]) => (
                <section className="card" key={wk} aria-label={`Week of ${shortDate(wk)}`}>
                  <div className="card-title">
                    <h2>Week of {shortDate(wk)}</h2>
                    <span className="muted small">{plural(rows.length, "event")}</span>
                  </div>
                  <div className="cal-list">
                    {rows.map((r) => (
                      <div className="cal-row" key={`${r.symbol}-${r.date}`}>
                        <div className="cal-when">
                          <span className="cal-day">{weekday(r.date)}</span>
                          <span className="cal-date mono">{r.date.slice(5)}</span>
                          <span className={`xs ${r.days >= 0 && r.days <= 3 ? "soon" : "faint"}`}>{inDays(r.days)}</span>
                        </div>
                        <div className="cal-who">
                          <Link className="sym" to={`/stock/${r.symbol}`}>
                            {r.symbol}
                          </Link>
                          <span className="theme muted small" title={r.theme}>
                            {r.theme}
                          </span>
                          <span className="xs faint">
                            <Link to={`/industries/${r.industry.key}`}>{r.industry.label}</Link>
                            {r.lane ? ` · ${r.lane}` : ""}
                            {r.pinned ? " · pinned" : ""} · earnings{r.confidence ? ` (${r.confidence})` : ""} <AgeChip asOf={r.as_of} prefix="dated " />
                          </span>
                        </div>
                        <div className="cal-score">
                          {r.band ? <ScoreBadge band={r.band} value={r.value} present={r.components_present} total={r.components_total} /> : <span className="chip chip-plain">No score</span>}
                          {r.hf_pass != null && <span className={`verdict ${r.hf_pass ? "pass" : "fail"}`}>{r.hf_pass ? "PASS" : "FAIL"}</span>}
                        </div>
                        <div className="cal-past xs">
                          {r.past.n > 0 ? (
                            <>
                              Past earnings: {r.past.hits} of {r.past.n} moved
                              {r.past.avg_max_move_pct != null ? ` · avg max ${pct(r.past.avg_max_move_pct, 0)}` : ""}
                            </>
                          ) : (
                            <span className="faint">No measured past reaction on file</span>
                          )}
                        </div>
                        <div className="cal-act">
                          {r.armed ? (
                            <Link to={`/alerts?tab=armed&symbol=${r.symbol}`} className="chip chip-cal">
                              Alert armed
                            </Link>
                          ) : alertsLocked ? (
                            <Link to="/pricing" className="btn-quiet xs" title="Alerts are included from Basic">
                              Alerts from Basic
                            </Link>
                          ) : (
                            <button className="btn btn-secondary btn-sm" disabled={arming === r.symbol || (me && !me.verified)} onClick={() => arm(r)}>
                              {arming === r.symbol ? "…" : "Arm catalyst alert"}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}

          {d.flagged.length > 0 && (
            <section className="card" aria-labelledby="fl-h" style={{ marginTop: "var(--s-5)" }}>
              <div className="card-title">
                <h2 id="fl-h">Catalysts flagged in the last 30 days</h2>
                <span className="muted small">catalyst_dated alerts on your names</span>
              </div>
              <ul className="namelist">
                {d.flagged.map((f) => (
                  <li className="nameline" key={`${f.symbol}-${f.fired_at}`}>
                    <Link className="sym" to={`/stock/${f.symbol}`}>
                      {f.symbol}
                    </Link>
                    <span className="small">{f.detail}</span>
                    <span className="spacer" />
                    <span className="xs faint mono">{shortDate(f.fired_at, tz)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="card" aria-labelledby="rc-h" style={{ marginTop: "var(--s-5)" }}>
            <div className="card-title">
              <h2 id="rc-h">What happened: last 45 days</h2>
              <span className="muted small">measured, not predicted · a hit is {EVIDENCE.hitDefinition}</span>
            </div>
            {d.recent.length === 0 ? (
              <p className="muted small" style={{ marginBottom: 0 }}>
                No real dated event on your names resolved in the last 45 days.
              </p>
            ) : (
              <div className="tscroll">
<table className="hf reactions">
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Name</th>
                    <th scope="col">Event</th>
                    <th scope="col" className="num">
                      Max move
                    </th>
                    <th scope="col" className="num">
                      Close move
                    </th>
                    <th scope="col">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {d.recent.map((r) => (
                    <tr key={`${r.symbol}-${r.date}-${r.kind}`}>
                      <td className="mono">{shortDate(r.date)}</td>
                      <td>
                        <Link className="sym" to={`/stock/${r.symbol}`}>
                          {r.symbol}
                        </Link>{" "}
                        <span className="muted small">{r.theme}</span>
                      </td>
                      <td>{r.kind.replace(/_/g, " ")}</td>
                      <td className={`num ${r.max_move_pct > 0 ? "pos" : r.max_move_pct < 0 ? "neg" : ""}`}>{pct(r.max_move_pct)}</td>
                      <td className={`num ${r.close_move_pct > 0 ? "pos" : r.close_move_pct < 0 ? "neg" : ""}`}>{pct(r.close_move_pct)}</td>
                      <td>
                        {!r.resolved ? (
                          <span className="faint">window open</span>
                        ) : (
                          <span className={`verdict ${r.hit ? "pass" : "fail"}`}>
                            {r.hit ? "HIT" : "MISS"}
                            {r.days_to_move != null ? ` · ${r.days_to_move}d` : ""}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
</div>
            )}
          </section>

          <p className="footnote">
            {d.source} {d.run_as_of ? `Scores from the run at ${dateTime(d.run_as_of, tz)}.` : ""} Nothing here is a recommendation.
          </p>
        </>
      )}
    </div>
  );
}
