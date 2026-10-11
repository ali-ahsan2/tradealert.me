import React, { useEffect, useState } from "react";
import { api, cached } from "../api.js";
import { Link } from "../lib/router.jsx";
import { useMe } from "../lib/me.jsx";
import { dateTime, plural, shortDate } from "../lib/fmt.js";
import { ErrorCard, Monogram, Notice, Skeleton } from "../components/ui.jsx";
import { PlainStatusChip, RecordLine, StrategyPlainCard } from "../components/Plain.jsx";

// The strategies in human terms (DESIGN_V6 §8). Each one is a plain card:
// what it hunts, what it looks for, the move it tries to catch, what it
// ignores, its record. The recipe (weights, thresholds, cutoffs) is not on
// this page and not in the payload behind it; an admin reaches it in the Lab.

const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
const word = (n) => WORDS[n] || String(n);

function statusOf(s) {
  return (s && s.plain && s.plain.status) || (s && s.calibrated ? "measured" : "provisional");
}

function boardLink(key) {
  return `/board?strategy=${encodeURIComponent(key)}`;
}

function openerLine(list) {
  const n = list.length;
  const m = list.filter((s) => statusOf(s) === "measured").length;
  const has = m === 0 ? "None has" : m === 1 ? "One has" : `${word(m)} have`;
  return `${word(n)} ${n === 1 ? "strategy" : "strategies"}. ${has} a measured record.`;
}

export default function Strategies() {
  const { me } = useMe();
  const [list, setList] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    cached("/strategies").then((d) => setList(d.strategies)).catch((e) => setErr(e));
  }, []);
  const lead = list && (list.find((s) => statusOf(s) === "measured") || list.find((s) => statusOf(s) !== "not_running"));
  return (
    <div className="wrap">
      <div className="pagehead">
        <div>
          <h1>Strategies</h1>
          <div className="meta">What each one looks for, in plain words, and what its record is.</div>
        </div>
      </div>
      {err && <ErrorCard error={err} title="Couldn't load the strategies." onRetry={() => window.location.reload()} />}
      {!err && !list && <Skeleton rows={3} height={120} />}
      {list && (
        <>
          <div className="plain-opener">
            <p>{openerLine(list)}</p>
            {lead && (
              <Link to={boardLink(lead.key)} className="btn btn-primary">
                Show me {lead.label}'s names
              </Link>
            )}
          </div>
          <div className="plain-list">
            {list.map((s) => {
              const status = statusOf(s);
              return (
                <article className="plain-row" key={s.key} aria-labelledby={`st-${s.key}`}>
                  <div className="plain-row-top">
                    <Monogram>{s.monogram}</Monogram>
                    <h3 id={`st-${s.key}`}>
                      <Link to={`/strategies/${s.key}`}>{s.label}</Link>
                    </h3>
                    <PlainStatusChip status={status} />
                  </div>
                  <StrategyPlainCard strategy={{ ...s, label: null }} compact />
                  {s.plain && <RecordLine plain={s.plain} className="plain-note" />}
                  <div className="plain-row-actions">
                    <Link to={`/strategies/${s.key}`} className="btn btn-secondary btn-sm">
                      How it looks
                    </Link>
                    {status !== "not_running" && (
                      <Link to={boardLink(s.key)} className="btn btn-primary btn-sm">
                        Show me its names
                      </Link>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
          {me && me.is_admin && (
            <p className="plain-note" style={{ marginTop: "var(--s-5)" }}>
              <Link to="/lab">The recipe, in the Lab</Link>
            </p>
          )}
        </>
      )}
      <p className="footnote">
        A record is measured, never predicted: whether a large move followed, not its direction, and no profit is claimed.
      </p>
    </div>
  );
}

export function StrategyDetail({ strategyKey }) {
  const { me } = useMe();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    setD(null);
    setErr(null);
    api(`/strategies/${encodeURIComponent(strategyKey)}`)
      .then((x) => alive && setD(x))
      .catch((e) => alive && setErr(e));
    return () => {
      alive = false;
    };
  }, [strategyKey, reload]);

  if (err) {
    return (
      <div className="wrap wrap-narrow">
        <Link to="/strategies" className="backlink">
          ← Strategies
        </Link>
        {err.status === 404 ? (
          <div className="card state-card">
            <p className="state-title">No such strategy.</p>
          </div>
        ) : (
          <ErrorCard error={err} onRetry={() => setReload((n) => n + 1)} />
        )}
      </div>
    );
  }
  if (!d) {
    return (
      <div className="wrap">
        <Skeleton rows={4} height={100} />
      </div>
    );
  }

  const status = statusOf(d);
  const p = d.plain || {};
  const n = p.record_numbers;
  const live = d.calibration || {};
  const run = d.latest_run;

  return (
    <div className="wrap wrap-narrow">
      <Link to="/strategies" className="backlink">
        ← Strategies
      </Link>
      <div className="pagehead">
        <div>
          <h1 className="row">
            <Monogram size={28}>{d.monogram}</Monogram>
            {d.label}
            <PlainStatusChip status={status} />
          </h1>
          <div className="meta">
            {status === "measured"
              ? `Measured record${d.calibrated_at ? `, published ${shortDate(d.calibrated_at)}` : ""}`
              : status === "not_running"
                ? "Being built. Not scoring yet."
                : "No measured record yet"}
          </div>
        </div>
        <div className="actions">
          {status !== "not_running" && (
            <Link to={boardLink(d.key)} className="btn btn-primary">
              Show me its names
            </Link>
          )}
        </div>
      </div>

      {d.publishing_paused && (
        <Notice tone="warn">
          Publishing is paused for this strategy{d.publishing_paused_reason ? `: ${d.publishing_paused_reason}` : "."} Scores
          still compute; nothing new is sent.
        </Notice>
      )}

      <div className="stack">
        <StrategyPlainCard strategy={d} record={false} />

        <section className="plain plain-card" aria-labelledby="record-h">
          <h4 id="record-h">Its record</h4>
          <RecordLine plain={p} big />
          {status === "measured" && n && (
            <>
              <ul className="plain-caveats">
                <li>It measures whether a large move happened, not its direction.</li>
                <li>No trades are simulated and no profit is claimed.</li>
                <li>{n.n} events is a small sample across a limited set of market conditions.</li>
              </ul>
              {p.record_definition && (
                <p className="plain-note" style={{ marginTop: 12, fontSize: 15 }}>
                  A hit is {p.record_definition}.{d.record_source ? ` Source: ${d.record_source}.` : ""}
                </p>
              )}
            </>
          )}
          {live.resolved >= 10 && live.hit_rate != null && (
            <p className="plain-note" style={{ marginTop: 12 }}>
              Since going live: <b>{live.hits}</b> of <b>{live.resolved}</b> measured events moved.
            </p>
          )}
          {run && status !== "not_running" && (
            <p className="plain-note" style={{ marginTop: 12 }}>
              This morning it rated <b>{plural(run.scored, "name")}</b>
              {run.as_of ? ` (${shortDate(run.as_of)})` : ""}.
            </p>
          )}
        </section>

        <section className="plain plain-card" aria-labelledby="history-h">
          <h4 id="history-h">History</h4>
          {!d.timeline || d.timeline.length === 0 ? (
            <p className="plain-note">No calibration events recorded yet. A record changes only by a dated human decision, never automatically.</p>
          ) : (
            <ul className="timeline">
              {d.timeline.map((t, i) => (
                <li key={i}>
                  <div className="tl-when">{dateTime(t.at)}</div>
                  <div>
                    <b>{t.type.replace(/_/g, " ")}</b>
                    {t.resolved_outcomes != null ? ` · ${plural(t.resolved_outcomes, "outcome")}` : ""}
                  </div>
                  {t.reason && <div className="muted">{t.reason}</div>}
                </li>
              ))}
            </ul>
          )}
        </section>

        {me && me.is_admin && (
          <p className="plain-note">
            <Link to="/lab">The recipe, in the Lab</Link>
            {d.version ? ` · version ${d.version.number} (${d.version.state})` : ""}
          </p>
        )}
      </div>
    </div>
  );
}
