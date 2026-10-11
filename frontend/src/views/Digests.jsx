import React, { useEffect, useState } from "react";
import { api, toast } from "../api.js";
import { Link, navigate } from "../lib/router.jsx";
import { useMe } from "../lib/me.jsx";
import { DAYS, dateTime, plural, score as fmtScore, shortDate } from "../lib/fmt.js";
import { CTA } from "../lib/plain.js";
import { HOME_ROWS } from "../lib/caps.js";
import { useMode } from "../lib/mode.js";
import ScoreBadge from "../components/ScoreBadge.jsx";
import ScreenHead from "../components/ScreenHead.jsx";
import FinePrint from "../components/FinePrint.jsx";
import { Empty, ErrorCard, Notice, Skeleton } from "../components/ui.jsx";

// My week, by email: the on-site twin of the weekly brief. Simple shows
// three rows before "Show all" (DESIGN_V6 §7); Full shows the whole table.
function DigestTable({ rows, truncated, tz, cap = null }) {
  const [all, setAll] = useState(false);
  if (!rows || rows.length === 0) {
    return <p className="muted small">No rated names were in your industries that morning.</p>;
  }
  const shown = cap && !all ? rows.slice(0, cap) : rows;
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
            <th scope="col">Rating</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
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
      {shown.length < rows.length && (
        <button type="button" className="btn-quiet" style={{ margin: "var(--s-2) var(--s-3) var(--s-3)", minHeight: 44 }} onClick={() => setAll(true)}>
          {CTA.SHOW_ALL(rows.length)}
        </button>
      )}
      {truncated && <p className="footnote" style={{ padding: "0 var(--s-3) var(--s-3)" }}>That morning rated more names than your plan's brief shows.</p>}
    </div>
  );
}

// The on-site twin of the weekly email (UX_SPEC A8). The preview is built by
// the same function the cron job uses, so what you see is what will send.
export default function Digests() {
  const { me } = useMe();
  const { simple } = useMode();
  const [list, setList] = useState(null);
  const [preview, setPreview] = useState(null);
  const [settings, setSettings] = useState(null);
  const [err, setErr] = useState(null);
  const [reload, setReload] = useState(0);
  const [allSent, setAllSent] = useState(false);
  const [busy, setBusy] = useState(false);

  // "Send me the brief" turns the weekly email on in place; the day and
  // hour stay what My account holds.
  const turnOn = async () => {
    setBusy(true);
    try {
      const next = await api("/me/settings", { method: "PATCH", json: { digest_enabled: true } });
      setSettings(next);
      toast("Your weekly brief is on.");
    } catch (e) {
      toast(e.detail || "Couldn't turn the brief on.");
    } finally {
      setBusy(false);
    }
  };

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
  const on = Boolean(settings && settings.digest_enabled);
  const line = !settings
    ? "Checking when your next brief goes out…"
    : on
      ? `Your next brief goes out ${DAYS[settings.digest_day]} ${String(settings.digest_hour).padStart(2, "0")}:00 to ${me && me.email ? me.email : "you"}.`
      : "Your weekly brief is off; nothing sends until you turn it on.";
  const sentRows = list ? (simple && !allSent ? list.slice(0, HOME_ROWS) : list) : [];

  return (
    <div className="wrap">
      <ScreenHead
        title="My week"
        line={line}
        action={
          settings && !on ? (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={turnOn}>
              {busy ? "One moment…" : CTA.SEND_BRIEF}
            </button>
          ) : (
            <a href="#next-brief" className="btn btn-primary">
              Preview my next brief
            </a>
          )
        }
        secondary={
          <Link to="/settings#digest" className="btn btn-secondary btn-sm">
            Change the day or hour
          </Link>
        }
      />

      {me && !me.verified && settings && <Notice tone="warn">Verify your email before the first brief can go out.</Notice>}

      <section className="section" id="next-brief" style={{ marginTop: 0 }}>
        <h2>My next brief</h2>
        <p className="section-lead">Built from this morning's scoring with your current plan and industries. Exactly what the email will contain.</p>
        {!preview && <Skeleton rows={5} height={44} />}
        {preview && preview.unavailable && <p className="muted small">No completed scoring is available to preview yet.</p>}
        {preview && !preview.unavailable && (
          <>
            <div className="digest-head">
              <span>Rated {dateTime(preview.run_as_of, tz)}</span>
              <span>{plural(preview.rows.length, "name")}</span>
            </div>
            <DigestTable rows={preview.rows} truncated={preview.truncated} tz={tz} cap={simple ? HOME_ROWS : null} />
          </>
        )}
      </section>

      <section className="section">
        <h2>Past briefs</h2>
        {err && <ErrorCard error={err} onRetry={() => setReload((n) => n + 1)} title="Couldn't load past briefs." />}
        {!err && !list && <Skeleton rows={4} height={44} />}
        {list && list.length === 0 && <Empty title="No brief has been sent yet.">The first one goes out on your scheduled day once your email is verified.</Empty>}
        {list && list.length > 0 && (
          <div className="table-card">
            <table className="data comfortable">
              <thead>
                <tr>
                  <th scope="col">Sent</th>
                  <th scope="col">Rated</th>
                  <th scope="col" className="num">
                    Names
                  </th>
                  <th scope="col">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sentRows.map((d) => (
                  <tr key={d.id} className="rowlink" onClick={() => navigate(`/digests/${d.id}`)}>
                    <td>{dateTime(d.sent_at, tz)}</td>
                    <td className="muted">{shortDate(d.run_as_of, tz)}</td>
                    <td className="num">{d.rows}</td>
                    <td style={{ textAlign: "right" }}>
                      <Link to={`/digests/${d.id}`} onClick={(e) => e.stopPropagation()}>
                        Read it →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {sentRows.length < list.length && (
              <button type="button" className="btn-quiet" style={{ margin: "var(--s-2) var(--s-3) var(--s-3)", minHeight: 44 }} onClick={() => setAllSent(true)}>
                {CTA.SHOW_ALL(list.length)}
              </button>
            )}
          </div>
        )}
      </section>
      <FinePrint short />
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
        ← My week
      </Link>
      {err && (err.status === 404 ? <Empty title="That brief isn't yours or doesn't exist." /> : <ErrorCard error={err} />)}
      {!err && !d && <Skeleton rows={6} height={44} />}
      {d && (
        <>
          <div className="pagehead">
            <div>
              <h1>My week · {shortDate(d.sent_at, tz)}</h1>
              <div className="meta">
                Sent {dateTime(d.sent_at, tz)} · rated {dateTime(d.run_as_of, tz)} · frozen at send; this page never changes.
              </div>
            </div>
            <div className="actions">
              <button className="btn-quiet" onClick={() => window.print()}>
                Print
              </button>
            </div>
          </div>
          <DigestTable rows={d.rows} truncated={d.truncated} tz={tz} />
          <p className="footnote">Scores rank names for a human to review.</p>
          <FinePrint short />
        </>
      )}
    </div>
  );
}
