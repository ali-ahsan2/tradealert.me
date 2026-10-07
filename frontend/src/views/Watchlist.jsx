import React, { useEffect, useMemo, useState } from "react";
import { api, cached, toast } from "../api.js";
import { Link } from "../lib/router.jsx";
import { useMe } from "../lib/me.jsx";
import { DAYS, delta, deltaTone, dollars, downloadText, inDays, plural, score as fmtScore, shortDate, signed, toCsv, tone } from "../lib/fmt.js";
import ScoreBadge from "../components/ScoreBadge.jsx";
import { Empty, ErrorCard, Notice, Skeleton } from "../components/ui.jsx";

const SORTS = {
  order: ["Your order", null],
  score: ["Score", (a, b) => (b.value ?? -1) - (a.value ?? -1)],
  since_pin: ["Score since pinned", (a, b) => ((b.value ?? 0) - (b.score_at_pin ?? 0)) - ((a.value ?? 0) - (a.score_at_pin ?? 0))],
  px: ["Price since pinned", (a, b) => ((b.st && b.st.chg_since_pin) ?? -Infinity) - ((a.st && a.st.chg_since_pin) ?? -Infinity)],
  earnings: ["Next earnings", (a, b) => ((a.st && a.st.earnings && a.st.earnings.days) ?? Infinity) - ((b.st && b.st.earnings && b.st.earnings.days) ?? Infinity)],
};

function NoteEditor({ pick, onSaved }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(pick.note || "");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api(`/me/picks/${encodeURIComponent(pick.symbol)}`, { method: "PATCH", json: { note: v } });
      onSaved(pick.symbol, v);
      setOpen(false);
    } catch (e) {
      toast(e.detail || "Couldn't save the note.");
    } finally {
      setBusy(false);
    }
  };
  if (!open) {
    return (
      <span className="small" style={{ flexBasis: "100%", color: pick.note ? "var(--ink)" : "var(--ink-faint)" }}>
        {pick.note || "No note."}{" "}
        <button className="btn-quiet" onClick={() => setOpen(true)}>
          {pick.note ? "Edit" : "Add a note"}
        </button>
      </span>
    );
  }
  return (
    <div className="notebox" style={{ flexBasis: "100%" }}>
      <textarea value={v} maxLength={280} onChange={(e) => setV(e.target.value)} placeholder="Why you pinned it, what would change your mind…" />
      <div className="row" style={{ marginTop: "var(--s-2)" }}>
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button className="btn-quiet" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <span className="xs faint">{v.length}/280 · private to you</span>
      </div>
    </div>
  );
}

export default function Watchlist() {
  const { me } = useMe();
  const [picks, setPicks] = useState(null);
  const [settings, setSettings] = useState(null);
  const [tiers, setTiers] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [stats, setStats] = useState(null);
  const [sort, setSort] = useState("order");

  useEffect(() => {
    let alive = true;
    setErr(null);
    api("/me/picks")
      .then((d) => alive && setPicks(d.picks))
      .catch((e) => alive && setErr(e));
    api("/me/watchlist/stats")
      .then((d) => alive && setStats(d))
      .catch(() => {});
    api("/me/settings")
      .then((d) => alive && setSettings(d))
      .catch(() => {});
    cached("/entitlements")
      .then((d) => alive && setTiers(d.tiers))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [reload]);

  const move = async (i, dir) => {
    setBusy(true);
    try {
      const syms = picks.map((p) => p.symbol);
      const j = i + dir;
      [syms[i], syms[j]] = [syms[j], syms[i]];
      const { order } = await api("/me/picks/order", { method: "PUT", json: { symbols: syms } });
      const bySym = Object.fromEntries(picks.map((p) => [p.symbol, p]));
      setPicks(order.map((s) => bySym[s]).filter(Boolean));
    } catch (e) {
      toast(e.detail || "Couldn't reorder. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const unpin = async (sym) => {
    try {
      await api(`/me/picks/${encodeURIComponent(sym)}`, { method: "DELETE" });
      setPicks((p) => p.filter((x) => x.symbol !== sym));
      toast(`Removed ${sym} from your watchlist.`);
    } catch (e) {
      toast(e.detail || "Couldn't unpin. Try again.");
    }
  };

  const bySym = useMemo(() => Object.fromEntries(((stats && stats.picks) || []).map((p) => [p.symbol, p])), [stats]);
  const ordered = useMemo(() => {
    if (!picks) return [];
    const withStats = picks.map((p) => ({ ...p, st: bySym[p.symbol] }));
    const cmp = SORTS[sort][1];
    return cmp ? [...withStats].sort(cmp) : withStats;
  }, [picks, bySym, sort]);
  const summary = stats && stats.summary;

  const exportCsv = () => {
    const cols = [
      { label: "symbol", get: (p) => p.symbol },
      { label: "theme", get: (p) => p.theme },
      { label: "industry", get: (p) => p.industry.label },
      { label: "pinned_at", get: (p) => p.pinned_at },
      { label: "score_at_pin", get: (p) => (p.score_at_pin == null ? "" : Math.round(p.score_at_pin)) },
      { label: "score_now", get: (p) => (p.value == null ? "" : Math.round(p.value)) },
      { label: "band", get: (p) => p.band || "" },
      { label: "price_since_pin_pct", get: (p) => (p.st && p.st.chg_since_pin != null ? p.st.chg_since_pin : "") },
      { label: "benchmark", get: (p) => (p.st && p.st.benchmark) || "" },
      { label: "benchmark_since_pin_pct", get: (p) => (p.st && p.st.benchmark_chg_since_pin != null ? p.st.benchmark_chg_since_pin : "") },
      { label: "next_earnings", get: (p) => (p.st && p.st.earnings ? p.st.earnings.date : "") },
      { label: "hard_filters", get: (p) => (p.st && p.st.hf_pass != null ? (p.st.hf_pass ? "pass" : "fail") : "") },
      { label: "note", get: (p) => p.note || "" },
    ];
    downloadText(`tradealert-watchlist-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(ordered, cols) + "\n# Research and information only; not investment advice.\n");
  };

  const tier = me && me.tier;
  const limit = tier ? tier.picks_limit : null;
  const used = picks ? picks.length : 0;
  const atQuota = limit != null && used >= limit;
  const nextTier =
    tiers && tier ? [...tiers].sort((a, b) => a.price_monthly_cents - b.price_monthly_cents).find((t) => t.price_monthly_cents > tier.price_monthly_cents) : null;
  const tz = me && me.settings ? me.settings.timezone : undefined;

  return (
    <div className="wrap">
      <div className="pagehead">
        <div>
          <h1>Watchlist</h1>
          <div className="meta">
            {tier ? `${used} of ${limit} picks used · ${tier.label}` : "Your pinned names"} · the on-site twin of your weekly digest
          </div>
        </div>
        <div className="actions">
          {picks && picks.length > 1 && (
            <label className="ctl">
              Sort
              <select className="inline" value={sort} onChange={(e) => setSort(e.target.value)}>
                {Object.entries(SORTS).map(([k, [l]]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          )}
          {picks && picks.length > 1 && (
            <Link to={`/compare?symbols=${picks.slice(0, 4).map((p) => p.symbol).join(",")}`} className="btn btn-secondary btn-sm">
              Compare {Math.min(4, picks.length)}
            </Link>
          )}
          {picks && picks.length > 0 && (
            <button className="btn-quiet" onClick={exportCsv}>
              Export CSV
            </button>
          )}
          <Link to="/screen?pinned=1" className="btn btn-secondary btn-sm">
            Screen my picks
          </Link>
          <Link to="/board" className="btn btn-secondary btn-sm">
            Pin more from the Board
          </Link>
        </div>
      </div>

      {summary && summary.count > 0 && (
        <div className="tiles">
          <div className="tile card">
            <span className="tile-label">Score since pinned</span>
            <span className={`tile-value ${deltaTone(summary.mean_score_delta_since_pin)}`}>{delta(summary.mean_score_delta_since_pin)}</span>
            <span className="tile-sub">mean across {plural(summary.count, "pick")}</span>
          </div>
          <div className="tile card">
            <span className="tile-label">Price since pinned</span>
            <span className={`tile-value ${tone(summary.mean_chg_since_pin)}`}>{signed(summary.mean_chg_since_pin, 1, "%")}</span>
            <span className="tile-sub">
              {summary.mean_rel_since_pin != null ? `${signed(summary.mean_rel_since_pin, 1, "%")} vs each name's industry ETF` : "no benchmark bars yet"}
            </span>
          </div>
          <div className="tile card">
            <span className="tile-label">Cleared the screen</span>
            <span className="tile-value">{summary.cleared}</span>
            <span className="tile-sub">every Fast Mover hard filter passed</span>
          </div>
          <div className="tile card">
            <span className="tile-label">Earnings in 14 days</span>
            <span className="tile-value">{summary.earnings_14d}</span>
            <span className="tile-sub">
              {summary.unread} unread {summary.unread === 1 ? "alert" : "alerts"} · {summary.armed} armed
            </span>
          </div>
        </div>
      )}

      {settings && (
        <Notice tone="info">
          {settings.digest_enabled ? (
            <>
              Weekly digest: {DAYS[settings.digest_day]} at {String(settings.digest_hour).padStart(2, "0")}:00 {settings.timezone}, to {me ? me.email : "you"}.
            </>
          ) : (
            <>Your weekly digest is off.</>
          )}{" "}
          <Link to="/digests">Preview and past digests</Link> · <Link to="/settings#digest">Change</Link>
          {me && !me.verified && <> · Verify your email before the first one can send.</>}
        </Notice>
      )}

      {atQuota && picks && picks.length > 0 && (
        <Notice tone="warn">
          You're using all {limit} picks on {tier.label}.
          {nextTier ? (
            <>
              {" "}
              Unpin one, or {nextTier.label} includes {plural(nextTier.picks_limit, "pick")} for {dollars(nextTier.price_monthly_cents)}/mo.{" "}
              <Link to="/pricing">See plans</Link>
            </>
          ) : (
            " Unpin one to make room."
          )}
        </Notice>
      )}

      {err && <ErrorCard error={err} onRetry={() => setReload((n) => n + 1)} title="Couldn't load your watchlist." />}
      {!err && !picks && <Skeleton rows={3} height={96} />}

      {picks && picks.length === 0 && (
        <Empty
          title="Your watchlist is empty."
          action={
            <Link to="/board" className="btn btn-primary">
              Go to the Board
            </Link>
          }
        >
          Pin names from the Board to track them here and get them in your weekly digest.
          {tier && limit != null && (
            <>
              {" "}
              {tier.label} includes {plural(limit, "pick")}
              {nextTier ? `; ${nextTier.label} includes ${nextTier.picks_limit}.` : "."}
            </>
          )}
        </Empty>
      )}

      {picks && picks.length > 0 && (
        <div className="wl-list">
          {ordered.map((p) => {
            const i = picks.findIndex((x) => x.symbol === p.symbol);
            const since = p.value != null && p.score_at_pin != null ? p.value - p.score_at_pin : null;
            const st = p.st;
            return (
              <article className="card wl-card" key={p.symbol} aria-label={p.symbol}>
                <div className="order" aria-label="Reorder">
                  <button disabled={busy || sort !== "order" || i === 0} onClick={() => move(i, -1)} aria-label={`Move ${p.symbol} up`}>
                    ↑
                  </button>
                  <button disabled={busy || sort !== "order" || i === picks.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${p.symbol} down`}>
                    ↓
                  </button>
                </div>
                <div className="who">
                  <Link className="sym" to={`/stock/${p.symbol}`}>
                    {p.symbol}
                  </Link>
                  <span className="theme" title={p.theme}>
                    {p.theme}
                  </span>
                  <span className="xs faint">
                    <Link to={`/industries/${p.industry.key}`}>{p.industry.label}</Link> · {p.industry.benchmark_etf}
                    {p.lane ? ` · lane ${p.lane}` : ""}
                  </span>
                </div>
                <div className="act">{p.band ? <ScoreBadge band={p.band} value={p.value} /> : <span className="chip chip-plain">No run</span>}</div>
                <div className="facts">
                  <span>
                    Pinned {shortDate(p.pinned_at, tz)}
                    {p.score_at_pin != null && (
                      <>
                        {" "}
                        at <b>{fmtScore(p.score_at_pin)}</b>
                      </>
                    )}
                  </span>
                  <span>
                    Now <b>{fmtScore(p.value)}</b>
                  </span>
                  <span>
                    Since pinned <b className={deltaTone(since)}>{since == null ? "—" : delta(since)}</b>
                  </span>
                  <span>
                    Since last run <b className={deltaTone(p.delta_1d)}>{delta(p.delta_1d)}</b>
                  </span>
                  {st && st.chg_since_pin != null && (
                    <span title={st.last_date ? `close ${shortDate(st.last_date)}` : ""}>
                      Price since pinned <b className={tone(st.chg_since_pin)}>{signed(st.chg_since_pin, 1, "%")}</b>
                      {st.benchmark_chg_since_pin != null && (
                        <span className="xs faint">
                          {" "}
                          vs {st.benchmark} <span className={tone(st.benchmark_chg_since_pin)}>{signed(st.benchmark_chg_since_pin, 1, "%")}</span>
                        </span>
                      )}
                    </span>
                  )}
                  {st && st.hf_pass != null && (
                    <span>
                      Screen <b className={`verdict ${st.hf_pass ? "pass" : "fail"}`}>{st.hf_pass ? "PASS" : "FAIL"}</b>
                    </span>
                  )}
                  {st && st.earnings && (
                    <span>
                      Earnings{" "}
                      <b className={st.earnings.days >= 0 && st.earnings.days <= 14 ? "soon" : ""}>
                        {inDays(st.earnings.days)}
                      </b>
                      <span className="xs faint"> {st.earnings.date}</span>
                    </span>
                  )}
                  {st && st.unread > 0 && (
                    <Link to={`/alerts?symbol=${p.symbol}&unread=1`} className="chip chip-plain">
                      {st.unread} unread {st.unread === 1 ? "alert" : "alerts"}
                    </Link>
                  )}
                  <span className="spacer" />
                  <Link to={`/stock/${p.symbol}`}>Open full report</Link>
                  <button className="btn-quiet" onClick={() => unpin(p.symbol)}>
                    Unpin
                  </button>
                  <NoteEditor pick={p} onSaved={(sym, note) => setPicks((xs) => xs.map((x) => (x.symbol === sym ? { ...x, note } : x)))} />
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
