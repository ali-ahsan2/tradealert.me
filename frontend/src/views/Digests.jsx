import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { Link } from "../lib/router.jsx";
import { useMe } from "../lib/me.jsx";
import { DAYS, dateTime, score as fmtScore, shortDate } from "../lib/fmt.js";
import ScoreBadge from "../components/ScoreBadge.jsx";
import { Empty, ErrorCard, Notice, Skeleton } from "../components/ui.jsx";

function DigestTable({ rows, truncated, tz }) {
  if (!rows || rows.length === 0) {
    return <p className="muted small">No scored names were in your universe for this run.</p>;
  }
  return (
    <div className="table-card">
      <table className="data comfortable">
        <thead>
          <tr>
            <th className="rank" scope="col">
              #
            </th>
            <th scope="col">Name</th>
            <th scope="col">Industry</th>
            <th scope="col" className="num">
              Score
            </th>
            <th scope="col">Band</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.symbol}>
              <td className="rank">{r.rank}</td>
              <td className="name-cell">
                <Link className="sym" to={`/stock/${r.symbol}`}>
                  {r.symbol}
                </Link>
                <span className="theme">{r.theme}</span>
              </td>
              <td className="ind">{r.industry}</td>
              <td className="num">{fmtScore(r.value)}</td>
              <td>
                <ScoreBadge band={r.band} value={r.value} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {truncated && <p className="footnote" style={{ padding: "0 var(--s-3) var(--s-3)" }}>The run held more names than your plan's digest shows.</p>}
    </div>
  );
}

// The on-site twin of the weekly email (UX_SPEC A8). The preview is built by
// the same function the cron job uses, so what you see is what will send.
export default function Digests() {
  const { me } = useMe();
  const [list, setList] = useState(null);
  const [preview, setPreview] = useState(null);
  const [settings, setSettings] = useState(null);
  const [err, setErr] = useState(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    setErr(null);
    api("/me/digests")
      .then((d) => alive && setList(d.digests))
      .catch((e) => alive && setErr(e));
    api("/me/digests/preview")
      .then((d) => alive && setPreview(d))
      .catch(() => alive && setPreview({ rows: [], unavailable: true }));
    api("/me/settings")
      .then((d) => alive && setSettings(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [reload]);

  const tz = me && me.settings ? me.settings.timezone : undefined;

  return (
    <div className="wrap">
      <div className="pagehead">
        <div>
          <h1>Digests</h1>
          <div className="meta">Your board as it was frozen into each email, and a live preview of the next one.</div>
        </div>
        <div className="actions">
          <Link to="/settings#digest" className="btn btn-secondary btn-sm">
            Digest settings
          </Link>
        </div>
      </div>

      {settings && (
        <Notice tone={settings.digest_enabled ? "info" : "warn"}>
          {settings.digest_enabled
            ? `Next digest: ${DAYS[settings.digest_day]} at ${String(settings.digest_hour).padStart(2, "0")}:00 ${settings.timezone}, by email.`
            : "Your digest is turned off; nothing will send until you turn it on."}
          {me && !me.verified ? " Verify your email before the first one can go out." : ""}
        </Notice>
      )}

      <section className="section" style={{ marginTop: 0 }}>
        <h2>Preview of the next digest</h2>
        <p className="section-lead">Built from the latest run with your current plan and industries. Exactly what the email will contain.</p>
        {!preview && <Skeleton rows={5} height={44} />}
        {preview && preview.unavailable && <p className="muted small">No completed run is available to preview yet.</p>}
        {preview && !preview.unavailable && (
          <>
            <div className="digest-head">
              <span>Run {dateTime(preview.run_as_of, tz)}</span>
              <span>{preview.rows.length} names</span>
            </div>
            <DigestTable rows={preview.rows} truncated={preview.truncated} tz={tz} />
          </>
        )}
      </section>

      <section className="section">
        <h2>Sent digests</h2>
        {err && <ErrorCard error={err} onRetry={() => setReload((n) => n + 1)} title="Couldn't load digests." />}
        {!err && !list && <Skeleton rows={4} height={44} />}
        {list && list.length === 0 && <Empty title="No digests have been sent yet.">The first one goes out on your scheduled day once your email is verified.</Empty>}
        {list && list.length > 0 && (
          <div className="table-card">
            <table className="data comfortable">
              <thead>
                <tr>
                  <th scope="col">Sent</th>
                  <th scope="col">Run</th>
                  <th scope="col" className="num">
                    Names
                  </th>
                  <th scope="col">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.map((d) => (
                  <tr key={d.id} className="rowlink" onClick={() => (window.location.href = `/digests/${d.id}`)}>
                    <td>{dateTime(d.sent_at, tz)}</td>
                    <td className="muted">{shortDate(d.run_as_of, tz)}</td>
                    <td className="num">{d.rows}</td>
                    <td style={{ textAlign: "right" }}>
                      <Link to={`/digests/${d.id}`} onClick={(e) => e.stopPropagation()}>
                        Open →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export function DigestView({ id }) {
  const { me } = useMe();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let alive = true;
    api(`/me/digests/${id}`)
      .then((x) => alive && setD(x))
      .catch((e) => alive && setErr(e));
    return () => {
      alive = false;
    };
  }, [id]);
  const tz = me && me.settings ? me.settings.timezone : undefined;
  return (
    <div className="wrap">
      <Link to="/digests" className="backlink">
        ← Digests
      </Link>
      {err && (err.status === 404 ? <Empty title="That digest isn't yours or doesn't exist." /> : <ErrorCard error={err} />)}
      {!err && !d && <Skeleton rows={6} height={44} />}
      {d && (
        <>
          <div className="pagehead">
            <div>
              <h1>Digest · {shortDate(d.sent_at, tz)}</h1>
              <div className="meta">
                Sent {dateTime(d.sent_at, tz)} · run {dateTime(d.run_as_of, tz)} · frozen at send; this page never changes.
              </div>
            </div>
            <div className="actions">
              <button className="btn-quiet" onClick={() => window.print()}>
                Print
              </button>
            </div>
          </div>
          <DigestTable rows={d.rows} truncated={d.truncated} tz={tz} />
          <p className="footnote">Scores rank names for a human to review. Not investment advice.</p>
        </>
      )}
    </div>
  );
}
