import React, { useEffect, useState } from "react";
import { api, cached, toast } from "../api.js";
import { Link } from "../lib/router.jsx";
import { useMe } from "../lib/me.jsx";
import { DAYS, delta, deltaTone, dollars, plural, score as fmtScore, shortDate } from "../lib/fmt.js";
import ScoreBadge from "../components/ScoreBadge.jsx";
import { Empty, ErrorCard, Notice, Skeleton } from "../components/ui.jsx";

export default function Watchlist() {
  const { me } = useMe();
  const [picks, setPicks] = useState(null);
  const [settings, setSettings] = useState(null);
  const [tiers, setTiers] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    setErr(null);
    api("/me/picks")
      .then((d) => alive && setPicks(d.picks))
      .catch((e) => alive && setErr(e));
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

  const tier = me && me.tier;
  const limit = tier ? tier.picks_limit : null;
  const used = picks ? picks.length : 0;
  const atQuota = limit != null && used >= limit;
  const nextTier =
    tiers && tier
      ? [...tiers]
          .sort((a, b) => a.price_monthly_cents - b.price_monthly_cents)
          .find((t) => t.price_monthly_cents > tier.price_monthly_cents)
      : null;
  const tz = me && me.settings ? me.settings.timezone : undefined;

  return (
    <div className="wrap">
      <div className="pagehead">
        <div>
          <h1>Watchlist</h1>
          <div className="meta">
            {tier ? `${used} of ${limit} picks used · ${tier.label}` : "Your pinned names"} · the on-site twin
            of your weekly digest
          </div>
        </div>
        <div className="actions">
          <Link to="/board" className="btn btn-secondary btn-sm">
            Pin more from the Board
          </Link>
        </div>
      </div>

      {settings && (
        <Notice tone="info">
          {settings.digest_enabled ? (
            <>
              Weekly digest: {DAYS[settings.digest_day]} at {String(settings.digest_hour).padStart(2, "0")}:00{" "}
              {settings.timezone}, to {me ? me.email : "you"}.
            </>
          ) : (
            <>Your weekly digest is off.</>
          )}{" "}
          <Link to="/settings#digest">Change</Link>
          {me && !me.verified && <> · Verify your email before the first one can send.</>}
        </Notice>
      )}

      {atQuota && picks && picks.length > 0 && (
        <Notice tone="warn">
          You're using all {limit} picks on {tier.label}.
          {nextTier ? (
            <>
              {" "}
              Unpin one, or {nextTier.label} includes {plural(nextTier.picks_limit, "pick")} for{" "}
              {dollars(nextTier.price_monthly_cents)}/mo. <Link to="/pricing">See plans</Link>
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
          {picks.map((p, i) => {
            const since = p.value != null && p.score_at_pin != null ? p.value - p.score_at_pin : null;
            return (
              <article className="card wl-card" key={p.symbol} aria-label={p.symbol}>
                <div className="order" aria-label="Reorder">
                  <button disabled={busy || i === 0} onClick={() => move(i, -1)} aria-label={`Move ${p.symbol} up`}>
                    ↑
                  </button>
                  <button
                    disabled={busy || i === picks.length - 1}
                    onClick={() => move(i, 1)}
                    aria-label={`Move ${p.symbol} down`}
                  >
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
                    {p.industry.label} · {p.industry.benchmark_etf}
                    {p.lane ? ` · lane ${p.lane}` : ""}
                  </span>
                </div>
                <div className="act">
                  {p.band ? <ScoreBadge band={p.band} value={p.value} /> : <span className="chip chip-plain">No run</span>}
                </div>
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
                  <span className="spacer" />
                  <Link to={`/stock/${p.symbol}`}>Open full report</Link>
                  <button className="btn-quiet" onClick={() => unpin(p.symbol)}>
                    Unpin
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
