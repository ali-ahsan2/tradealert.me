import React, { useEffect, useMemo, useState } from "react";
import { api, toast } from "../api.js";
import { Link, navigate, useQuery } from "../lib/router.jsx";
import { useMe } from "../lib/me.jsx";
import { coverage, dateTime, delta, inDays, pct, plural, price as fmtPrice, score as fmtScore, shortDate, signed, tone } from "../lib/fmt.js";
import { EVIDENCE, HARD_FILTER_FORMAT, SNAPSHOT_LABELS, SNAPSHOT_ORDER, nounFor } from "../lib/evidence.js";
import { FIELD_TERM, GLOSSARY, PLAIN_FIELD } from "../lib/glossary.js";
import { changeSentence, nextStep, verdict, whySentence } from "../lib/plain.js";
import { useMode } from "../lib/mode.js";
import SearchBar from "../components/SearchBar.jsx";
import ScoreBadge from "../components/ScoreBadge.jsx";
import Pin from "../components/Pin.jsx";
import PriceChart from "../components/PriceChart.jsx";
import Sparkline from "../components/Sparkline.jsx";
import { Move } from "../components/Spark.jsx";
import { AlertItem } from "../components/EventList.jsx";
import Explain from "../components/Explain.jsx";
import NotifyButton, { useRulesFor } from "../components/NotifyButton.jsx";
import { AgeChip, ErrorCard, Monogram, Skeleton, StatusChip } from "../components/ui.jsx";
import "./stock.css";

const COVERAGE_SENTENCE = { full: "Full coverage", partial: "Partial coverage", thin: "Thin coverage" };

// Byte-identical for a name outside the subscriber's universe and a name
// that does not exist. No upgrade prompt here, ever.
function NotAvailable({ symbol }) {
  return (
    <div className="wrap wrap-narrow">
      <Link to="/board" className="backlink">
        ← Board
      </Link>
      <div className="card state-card">
        <p className="state-title">No report available for {symbol.toUpperCase()}.</p>
        <p className="muted">Search your universe for another name.</p>
        <div style={{ display: "flex", justifyContent: "center", marginTop: "var(--s-3)" }}>
          <SearchBar />
        </div>
        <Link to="/board" className="btn btn-secondary">
          Back to Board
        </Link>
      </div>
    </div>
  );
}

function topDrivers(components, n = 2) {
  return [...(components || [])]
    .filter((c) => c.score != null && c.weight != null)
    .sort((a, b) => b.score * b.weight - a.score * a.weight)
    .slice(0, n);
}

// Which glossary entry explains a score component. Keys follow the engine's
// component_json; the label match covers strategies that name them differently.
const COMPONENT_TERM = { float: "float", si: "short_interest", dtc: "days_to_cover", fee: "borrow_fee", cap: "market_cap", cat: "catalyst", vol: "volume_x" };

function termFor(key, label) {
  if (COMPONENT_TERM[key]) return COMPONENT_TERM[key];
  if (FIELD_TERM[key]) return FIELD_TERM[key];
  const l = (label || "").toLowerCase();
  if (l.includes("short interest")) return "short_interest";
  if (l.includes("borrow")) return "borrow_fee";
  if (l.includes("float")) return "float";
  if (l.includes("cover")) return "days_to_cover";
  if (l.includes("catalyst")) return "catalyst";
  if (l.includes("volume")) return "volume_x";
  if (l.includes("market cap") || l.includes("size")) return "market_cap";
  return null;
}

// A component's desirability runs 0 to 1 and is multiplied by its weight, so
// above the halfway mark it added more than half its weight, below it less.
// Stated in words, never in colour. A judgment input is the operator's
// reading, so its figure is "not measured data" rather than "no data".
function inputStatus(c) {
  if (c.backed === false) return ["judg", c.value != null ? "not measured data" : "no data"];
  if (c.score == null) return ["none", "no data"];
  if (c.score > 0.5) return ["up", "lifted"];
  if (c.score < 0.5) return ["down", "weighed"];
  return ["even", "even"];
}

// nextStep() reads the triggers armed on the name to pick its "nothing to
// do" sentence. Until the rules have loaded the set is unknown, so the card
// says only what is always true instead of the band-change hint.
function armedSet(rules) {
  return rules ? new Set(rules.map((r) => r.trigger_key)) : undefined;
}

function stepFor(args) {
  const s = nextStep(args);
  if (s.kind === "wait" && args.armedKeys === undefined && args.alertsLimit !== 0 && args.verified !== false) {
    return { text: "Nothing to do. We keep watching; your digest carries its latest band.", kind: "wait" };
  }
  return s;
}

// "XLE" reads as "XLE (Energy ETF)" when the series payload names the fund.
function benchName(code, bench) {
  if (!code) return "";
  if (!bench || bench.symbol !== code || !bench.label) return code;
  return `${code} (${bench.label}${/\bETF\b/i.test(bench.label) ? "" : " ETF"})`;
}

// Whole days from today (UTC calendar date) to an ISO date string.
function daysUntil(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((t - today) / 864e5);
}

function FieldLabel({ k, simple }) {
  const full = SNAPSHOT_LABELS[k] ? SNAPSHOT_LABELS[k][0] : k;
  const text = simple ? PLAIN_FIELD[k] || full : full;
  const term = FIELD_TERM[k];
  return term && GLOSSARY[term] ? <Explain term={term}>{text}</Explain> : <>{text}</>;
}

export default function StockReport({ symbol }) {
  const { me } = useMe();
  const { simple, full } = useMode();
  const q = useQuery();
  const strategyKey = q.get("strategy") || "fast_mover";
  const sym = symbol.toUpperCase();
  const rules = useRulesFor(sym, Boolean(me));
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [reload, setReload] = useState(0);
  const [pinned, setPinned] = useState(false);
  const [cap, setCap] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteBusy, setNoteBusy] = useState(false);
  const [events, setEvents] = useState([]);
  const [fields, setFields] = useState(null);
  const [series, setSeries] = useState(null);

  useEffect(() => {
    let alive = true;
    setFields(null);
    api(`/stock/${encodeURIComponent(symbol)}/fields?strategy=${encodeURIComponent(strategyKey)}`)
      .then((x) => alive && setFields(x))
      .catch(() => alive && setFields({ fields: {}, missing_components: [], since_pin: null }));
    return () => {
      alive = false;
    };
  }, [symbol, strategyKey, pinned]);

  useEffect(() => {
    let alive = true;
    setErr(null);
    setD(null);
    api(`/stock/${encodeURIComponent(symbol)}?strategy=${encodeURIComponent(strategyKey)}`)
      .then((x) => {
        if (!alive) return;
        setD(x);
        setPinned(Boolean(x.pinned));
        setNote(x.note || "");
        setEvents(x.events || []);
      })
      .catch((e) => alive && setErr(e));
    return () => {
      alive = false;
    };
  }, [symbol, strategyKey, reload]);

  useEffect(() => {
    let alive = true;
    // uncached on purpose: the swap button below must reflect a pin or
    // unpin made seconds ago, or it would drop a pick that had room
    api("/entitlements")
      .then((ent) => {
        if (!alive || !ent.current) return;
        setCap({ limit: ent.current.picks_limit, used: ent.usage ? ent.usage.picks_used : 0 });
      })
      .catch(() => setCap(null));
    return () => {
      alive = false;
    };
  }, [symbol, pinned]);

  const history = d ? d.history || [] : [];
  const bandChanges = useMemo(() => {
    let n = 0;
    for (let i = 1; i < history.length; i += 1) if (history[i].band !== history[i - 1].band) n += 1;
    return n;
  }, [history]);

  if (err) {
    if (err.status === 404) return <NotAvailable symbol={symbol} />;
    return (
      <div className="wrap wrap-narrow">
        <Link to="/board" className="backlink">
          ← Board
        </Link>
        <ErrorCard error={err} onRetry={() => setReload((n) => n + 1)} title="Couldn't load this report." />
      </div>
    );
  }

  if (!d) {
    return (
      <div className="wrap">
        <Link to="/board" className="backlink">
          ← Board
        </Link>
        <div className="rhead">
          <h1>{sym}</h1>
        </div>
        <div className="report">
          <div className="report-main stack">
            <Skeleton rows={2} height={72} />
            <Skeleton rows={5} height={40} />
          </div>
          <Skeleton rows={6} height={36} />
        </div>
      </div>
    );
  }

  const s = d.score;
  const strat = d.strategy;
  const tz = me && me.settings ? me.settings.timezone : undefined;
  const noun = nounFor(strat);
  const cov = s ? coverage(s.components_present, s.components_total) : null;
  const atCap = cap && cap.limit != null && cap.used >= cap.limit && !pinned;
  const snaps = Object.entries(d.snapshot || {}).sort(
    ([a], [b]) => (SNAPSHOT_ORDER.indexOf(a) + 1 || 99) - (SNAPSHOT_ORDER.indexOf(b) + 1 || 99)
  );
  const missingComponents = fields ? fields.missing_components || [] : [];
  const snap = d.snapshot || {};
  const bars = series ? series.bars : [];
  const lastBar = bars.length ? bars[bars.length - 1] : null;
  const prevBar = bars.length > 1 ? bars[bars.length - 2] : null;
  const bar30 = bars.length > 21 ? bars[bars.length - 22] : null;
  const dayMove = lastBar && prevBar && prevBar.c ? ((lastBar.c - prevBar.c) / prevBar.c) * 100 : null;
  const move30 = lastBar && bar30 && bar30.c ? ((lastBar.c - bar30.c) / bar30.c) * 100 : null;
  const benchBars = series && series.benchmark ? series.benchmark.bars : [];
  const b30 = benchBars.length > 21 ? benchBars[benchBars.length - 22] : null;
  const bLast = benchBars.length ? benchBars[benchBars.length - 1] : null;
  const bench30 = bLast && b30 && b30.c ? ((bLast.c - b30.c) / b30.c) * 100 : null;
  const KEY_STATS = ["cap_usd_m", "float_m", "si_pct_float", "fee_pct", "dtc", "run3m_pct", "off_high_pct", "earnings"].filter((k) => snap[k]);
  const fieldSeries = fields ? Object.entries(fields.fields || {}).filter(([, pts]) => pts.length >= 2) : [];
  const sincePin = fields && fields.since_pin;
  const missing = s ? Math.max(0, s.components_total - s.components_present) : 0;
  const hardFilters = s && s.hard_filters ? s.hard_filters : [];
  const components = s && s.components ? s.components : [];
  const haircuts = s && s.haircuts ? s.haircuts : [];
  const changes = d.changes;
  const peers = d.peers || [];
  const reactions = d.past_reactions || [];
  const resolvedReactions = reactions.filter((r) => r.hit != null);
  const reactionHits = resolvedReactions.filter((r) => r.hit).length;
  const lensHref = (key) => (key === "fast_mover" ? `/stock/${d.symbol}` : `/stock/${d.symbol}?strategy=${encodeURIComponent(key)}`);
  const compareHref = `/compare?symbols=${encodeURIComponent(d.symbol)}${strat.key !== "fast_mover" ? `&strategy=${strat.key}` : ""}`;
  const armedN = rules ? rules.length : null;
  const v = verdict(s, strat, d.symbol);
  const why = whySentence(components);
  const step = stepFor({
    pinned,
    armed: Boolean(armedN),
    band: s ? s.band : null,
    verified: me ? me.verified : undefined,
    alertsLimit: me && me.tier ? me.tier.alerts_limit : undefined,
    armedKeys: armedSet(rules),
  });
  const earnIso = snap.earnings && typeof snap.earnings.value === "string" ? snap.earnings.value : null;
  const earnDays = earnIso ? daysUntil(earnIso) : null;
  const earnConf = snap.earnings_conf ? String(snap.earnings_conf.value) : "";
  // a confirmed date on file while the score still carries an assumed
  // catalyst: the engine picks the date up on its next run
  const earnConfirmed = Boolean(earnIso) && /^confirmed$/i.test(earnConf.trim());
  const catalystAssumed = components.some(
    (c) => (c.key === "cat" || termFor(c.key, c.label) === "catalyst") && typeof c.value === "string" && c.value.includes("(assumed)")
  );
  const anyChangedInput = Boolean(changes && changes.components.some((c) => c.status !== "kept" || (c.delta != null && Math.abs(c.delta) >= 0.01)));
  const detailLabel = (k) => (SNAPSHOT_LABELS[k] ? SNAPSHOT_LABELS[k][0] : k);

  const swap = async () => {
    setBusy(true);
    try {
      const r = await api("/me/picks/swap", { method: "POST", json: { symbol: d.symbol } });
      toast(r.dropped ? `Dropped ${r.dropped} and pinned ${d.symbol}.` : `Pinned ${d.symbol}.`);
      setPinned(true);
    } catch (e2) {
      toast(e2.detail || "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const saveNote = async () => {
    setNoteBusy(true);
    try {
      await api(`/me/picks/${encodeURIComponent(d.symbol)}`, { method: "PATCH", json: { note } });
      toast("Note saved.");
      setNoteOpen(false);
    } catch (e) {
      toast(e.detail || "Couldn't save the note.");
    } finally {
      setNoteBusy(false);
    }
  };

  return (
    <div className="wrap">
      <Link to="/board" className="backlink">
        ← Board
      </Link>

      <header className="rhead sr-head">
        <div style={{ minWidth: 0, flex: "1 1 auto" }}>
          <h1>
            {d.symbol}
            <span className="company">{d.theme}</span>
          </h1>
          <div className="meta">
            <Link to={`/industries/${d.industry.key}`}>{d.industry.label}</Link>
            <span aria-hidden="true">·</span>
            <span>
              <Explain term="strategy">lens</Explain>{" "}
              <span className="full-only">
                <Monogram size={18}>{strat.monogram}</Monogram>{" "}
              </span>
              <Link to={`/strategies/${strat.key}`} style={{ color: "inherit", fontWeight: 600 }}>
                {strat.label}
              </Link>
            </span>
            <Explain term={strat.calibrated ? "calibrated" : "provisional"}>
              <StatusChip calibrated={strat.calibrated} short />
            </Explain>
            <span aria-hidden="true">·</span>
            <span>
              <Explain term="run">run</Explain> {dateTime(d.run.as_of, tz)} <AgeChip asOf={d.run.as_of} />
            </span>
            {(d.lane || d.group) && (
              <span className="full-only">
                {d.lane ? (
                  <>
                    · <Explain term="lane">stage</Explain> {d.lane}
                  </>
                ) : null}
                {d.group ? (
                  <>
                    {" "}
                    · <Explain term="group">group</Explain> {d.group}
                  </>
                ) : null}
              </span>
            )}
          </div>
          {lastBar && (
            <div className="sr-price" aria-label="Price context">
              <span className="sr-px">{fmtPrice(lastBar.c)}</span>
              <span>
                <Move value={dayMove} /> <span className="xs faint">today</span>
              </span>
              <span>
                <Move value={move30} /> <span className="xs faint">30d</span>
              </span>
              {bench30 != null && series.benchmark && (
                <span>
                  <span className="xs faint">
                    vs <Explain term="benchmark">{benchName(series.benchmark.symbol, series.benchmark)}</Explain>
                  </span>{" "}
                  <Move value={bench30} /> <span className="xs faint">30d</span>
                </span>
              )}
              <span className="xs faint">close {shortDate(lastBar.d)}</span>
            </div>
          )}
        </div>
      </header>

      <p className="utility">
        {history.length ? (
          <>
            We have scored <b>{d.symbol}</b> on <b>{plural(history.length, "run")}</b>
          </>
        ) : (
          <>
            <b>{d.symbol}</b> was not scored on this run
          </>
        )}
        {events.length ? (
          <>
            , and <b>{plural(events.length, "alert")}</b> fired on it in the last 120 days.
          </>
        ) : (
          <>; no alert has fired on it in the last 120 days.</>
        )}{" "}
        {armedN == null ? null : armedN ? (
          <>
            You have <b>{plural(armedN, "trigger")}</b> armed on it.
          </>
        ) : (
          <>Nothing is armed on it yet.</>
        )}
      </p>

      <div className="report">
        <div className="report-main stack">
          <section className="card sr-verdictcard" aria-labelledby="verdict-h">
            <div className="sr-vrow">
              <div className="verdict sr-verdict">
                <h2 id="verdict-h" className="verdict-h">
                  {v.headline}
                </h2>
                {v.detail.map((line) => (
                  <p className="verdict-d" key={line}>
                    {line}
                  </p>
                ))}
                {s && (
                  <p className="verdict-d full-only">
                    <b>{COVERAGE_SENTENCE[cov.state]}</b> · {s.components_present} of {s.components_total} components had data on this run.
                    {s.shrinkage_applied != null && Math.abs(s.shrinkage_applied) >= 0.5 ? (
                      <>
                        {" "}
                        Shrunk toward neutral (40) from <b>{Math.round(s.shrinkage_from ?? s.value)}</b> to <b>{Math.round(s.value)}</b> because {missing} of{" "}
                        {s.components_total} components had no data.
                      </>
                    ) : null}
                  </p>
                )}
              </div>
              {s ? (
                <ScoreBadge size="full" band={s.band} value={s.value} present={s.components_present} total={s.components_total} strategy={strat} />
              ) : null}
            </div>
            <p className="hint">
              {s ? (
                <>
                  The <Explain term="score">score</Explain> says how well {d.symbol} fits the {strat.label} setup on this run; the{" "}
                  <Explain term="band">band</Explain> word is the claim and the number is detail. <Explain term="coverage">Coverage</Explain> is how many of
                  its inputs had data
                  {s.shrinkage_applied != null && Math.abs(s.shrinkage_applied) >= 0.5 ? (
                    <>
                      , and <Explain term="shrinkage">shrinkage</Explain> is the pull toward 40 when data is missing
                    </>
                  ) : null}
                  . It is a {noun}, not a prediction.
                </>
              ) : (
                <>
                  No {strat.label} <Explain term="score">score</Explain> for {d.symbol} on the run at {dateTime(d.run.as_of, tz)}. Other lenses may have
                  one; they are listed under More detail.
                </>
              )}
            </p>
          </section>

          <div className="actrow sticky sr-actrow">
            <NotifyButton symbol={d.symbol} />
            <Pin symbol={d.symbol} pinned={pinned} onChange={(_, on) => setPinned(on)} label />
            {atCap && (
              <button className="btn btn-secondary btn-sm" disabled={busy} onClick={swap} title="Drops your oldest watchlist pick to make room">
                Replace oldest pick ({cap.used}/{cap.limit})
              </button>
            )}
            <Link to={compareHref} className="btn-quiet">
              <span className="simple-only">Compare with another name</span>
              <span className="full-only">Compare</span>
            </Link>
          </div>

          <div className="nextstep sr-next" role="note">
            <span className="nextstep-k">Next step</span>
            <span>{step.text}</span>
            {step.kind === "why" && (
              <>
                <span className="spacer" />
                <button
                  type="button"
                  className="btn-quiet"
                  onClick={() => {
                    const el = document.getElementById("why");
                    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                >
                  Read why ↓
                </button>
              </>
            )}
          </div>

          <section className="card" id="why" aria-labelledby="why-h">
            <div className="card-title">
              <h2 id="why-h">Why this score</h2>
              {s && (
                <span className="muted small">
                  {s.components_present} of {s.components_total} inputs had data
                </span>
              )}
            </div>
            <p className="sr-why">{why || (s ? "No per-component detail was stored for this score." : "Nothing was scored, so there are no inputs to show.")}</p>
            {(components.length > 0 || missingComponents.length > 0) && (
              <ul className="sr-inputs" aria-label="Inputs">
                {components.map((c) => {
                  const [kind, word] = inputStatus(c);
                  const term = termFor(c.key, c.label);
                  const judgment = c.backed === false;
                  const assumed = typeof c.value === "string" && c.value.includes("(assumed)");
                  return (
                    <li key={c.key}>
                      <span className="lbl">
                        {term && GLOSSARY[term] ? <Explain term={term}>{c.label}</Explain> : c.label}
                        {judgment && (
                          <span className="judg">
                            {" "}
                            · <Explain term="judgment">judgment input</Explain>
                          </span>
                        )}
                        {assumed && !judgment && (
                          <span className="judg">
                            {" "}
                            · <Explain term="assumed">assumed</Explain>
                          </span>
                        )}
                      </span>
                      <span className="val">{c.value == null ? "—" : judgment ? `operator reading ${String(c.value)}` : String(c.value)}</span>
                      <span className={`st st-${kind}`}>{word}</span>
                    </li>
                  );
                })}
                {missingComponents
                  .filter((m) => !components.some((c) => c.key === m.key))
                  .map((m) => {
                    const term = termFor(m.key, m.label);
                    return (
                      <li key={`missing-${m.key}`} className="missing">
                        <span className="lbl">
                          {term && GLOSSARY[term] ? <Explain term={term}>{m.label}</Explain> : m.label}
                          {m.source && full && <span className="judg"> · {m.source}</span>}
                        </span>
                        <span className="val">—</span>
                        <span className="st st-none">no data</span>
                      </li>
                    );
                  })}
              </ul>
            )}
            {catalystAssumed && earnConfirmed && (
              <p className="hint">The catalyst input is an assumption until the engine's next run picks up the confirmed date.</p>
            )}
            {components.length > 0 && (
              <p className="hint">
                “Lifted” means the input scored above the halfway mark of its 0 to 1 scale, “weighed” below it. Weights and exact figures are under Full
                breakdown below.
              </p>
            )}

            {hardFilters.length > 0 && (
              <>
                <h3 className="sr-sub">
                  <Explain term="hard_filter">Hard filters</Explain>
                </h3>
                <ul className="sr-hf" aria-label="Hard filters">
                  {hardFilters.map((f) => (
                    <li key={f.key}>
                      <span className="lbl">{f.label}</span>
                      <span className="val">{(HARD_FILTER_FORMAT[f.key] || String)(f.value)}</span>
                      <span className={`verdict ${f.pass ? "pass" : "fail"}`}>{f.pass ? "✓ PASS" : "✕ FAIL"}</span>
                    </li>
                  ))}
                </ul>
                <p className="hint full-only">
                  The filters are the evidenced part of the system: {EVIDENCE.hits} of {EVIDENCE.events} filter-passing events moved ({EVIDENCE.hitRate}%). The
                  score only ranks what passes them.
                </p>
              </>
            )}

            {haircuts.length > 0 && (
              <section className="haircuts sr-haircuts" aria-labelledby="hc-h">
                <h3 id="hc-h">
                  <Explain term="haircut">Haircuts and penalties</Explain>
                </h3>
                <ul>
                  {haircuts.map((h, i) => (
                    <li key={i}>
                      <span className="mono">−{h.points}</span> · {h.label}
                      {h.evidence_url && (
                        <>
                          {" "}
                          <a href={h.evidence_url} target="_blank" rel="noreferrer">
                            source
                          </a>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </section>

          {s && (
            <section className="card" aria-labelledby="chg-h">
              <div className="card-title">
                <h2 id="chg-h">What changed</h2>
                {changes && changes.prev_run && (
                  <span className="muted small">
                    {shortDate(changes.prev_run.as_of, tz)} → {shortDate(d.run.as_of, tz)}
                  </span>
                )}
              </div>
              <p className="sr-chg">
                {changeSentence(s.delta_1d, s.band, changes ? changes.prev_band : null)}
                {changes && changes.prev_value != null ? (
                  <>
                    {" "}
                    Score <b>{fmtScore(changes.prev_value, changes.prev_components_present, changes.prev_components_total)}</b> ({changes.prev_band}) → <b>{fmtScore(s.value, s.components_present, s.components_total)}</b> ({s.band}).
                  </>
                ) : null}
              </p>
              {history.length > 1 && (
                <div className="hist">
                  <Sparkline points={history} label={`${strat.label} score over ${history.length} runs`} />
                  <div className="hist-meta">
                    {plural(history.length, "run")} on record · from {fmtScore(history[0].value, history[0].components_present, history[0].components_total)} to{" "}
                    {fmtScore(
                      history[history.length - 1].value,
                      history[history.length - 1].components_present,
                      history[history.length - 1].components_total
                    )}
                    {bandChanges ? ` · ${plural(bandChanges, "band change")}` : " · no band change"}
                  </div>
                </div>
              )}
              {pinned && sincePin && (
                <div className="sincepin xs">
                  <span>
                    Pinned {shortDate(sincePin.pinned_at, tz)}
                    {sincePin.score_at_pin != null ? (
                      <>
                        {" "}
                        · score <b>{fmtScore(sincePin.score_at_pin)}</b> → <b>{fmtScore(s.value, s.components_present, s.components_total)}</b> (
                        {delta(s.value - sincePin.score_at_pin)})
                      </>
                    ) : null}
                  </span>
                  {sincePin.chg_pct != null && (
                    <span>
                      Price since pinned <b className={tone(sincePin.chg_pct)}>{signed(sincePin.chg_pct, 1, "%")}</b>
                      {sincePin.benchmark_chg_pct != null && (
                        <>
                          {" "}
                          vs {benchName(sincePin.benchmark, series && series.benchmark)}{" "}
                          <span className={tone(sincePin.benchmark_chg_pct)}>{signed(sincePin.benchmark_chg_pct, 1, "%")}</span>
                        </>
                      )}
                      {sincePin.last_date ? ` · close ${shortDate(sincePin.last_date)}` : ""}
                    </span>
                  )}
                </div>
              )}
              {anyChangedInput && (
                <details className="acc" open={full}>
                  <summary>
                    Input by input <span className="sum-note">since the previous run</span>
                  </summary>
                  <div className="acc-body">
                    <p className="hint" style={{ marginTop: 0, marginBottom: "var(--s-2)" }}>
                      Each row is one input's 0 to 1 score before and after, ordered by the size of its move.
                    </p>
                    <div className="delta-list">
                      {changes.components
                        .filter((c) => c.status !== "kept" || (c.delta != null && Math.abs(c.delta) >= 0.01))
                        .slice(0, 8)
                        .map((c) => (
                          <div className="delta-row" key={c.key}>
                            <span>
                              {c.label}
                              {c.status === "added" && <span className="judg xs faint"> · new data</span>}
                              {c.status === "dropped" && <span className="judg xs faint"> · data gone</span>}
                            </span>
                            <span className="vals">
                              {c.prev_value != null ? String(c.prev_value) : "—"} → {c.value != null ? String(c.value) : "—"}
                            </span>
                            <span className="d">{c.delta == null ? "—" : `${c.delta > 0 ? "+" : ""}${c.delta.toFixed(2)}`}</span>
                          </div>
                        ))}
                    </div>
                  </div>
                </details>
              )}
            </section>
          )}

          <section className="card" aria-labelledby="up-h">
            <div className="card-title">
              <h2 id="up-h">Coming up</h2>
              <Link to="/calendar" className="small">
                Calendar →
              </Link>
            </div>
            {earnIso ? (
              <ul className="sr-up" aria-label="Dated events">
                <li>
                  <span className="when">{earnDays == null ? shortDate(earnIso) : inDays(earnDays)}</span>
                  <span>
                    <Explain term="catalyst">Earnings</Explain> {shortDate(earnIso)}
                    {earnConf ? <span className="muted"> · date {earnConf}</span> : null} <AgeChip asOf={snap.earnings.as_of} prefix="checked " suffix=" ago" />
                  </span>
                  <span className="spacer" />
                  <NotifyButton symbol={d.symbol} triggers={["catalyst_dated"]} label="Alert me before it" onLabel="Alert set" compact />
                </li>
              </ul>
            ) : (
              <p className="muted small" style={{ marginBottom: 0 }}>
                No dated event is on file for {d.symbol}. That is not the same as having none: the date comes from the latest market snapshot, and this name
                has no earnings date in it yet.
              </p>
            )}
            {earnIso && earnDays != null && earnDays < 0 && (
              <p className="hint">That date has passed; no later one is on file yet.</p>
            )}
            {reactions.length > 0 && (
              <details className="acc" open={full} style={{ marginTop: "var(--s-3)" }}>
                <summary>
                  How it moved after past dated events <span className="sum-note">{plural(reactions.length, "event")}, measured</span>
                </summary>
                <div className="acc-body">
                  <p className="muted small">
                    Each row is a real past event and the move that followed inside the window. A hit is {EVIDENCE.hitDefinition}.
                    {resolvedReactions.length >= 10 ? ` ${reactionHits} of ${resolvedReactions.length} resolved events moved.` : ""}
                  </p>
                  <div className="tscroll">
                    <table className="hf reactions">
                      <thead>
                        <tr>
                          <th scope="col">Date</th>
                          <th scope="col">Event</th>
                          <th scope="col" className="num">
                            Max move
                          </th>
                          <th scope="col" className="num">
                            Close move
                          </th>
                          <th scope="col" className="num">
                            Volume
                          </th>
                          <th scope="col">Result</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reactions.map((r) => (
                          <tr key={`${r.date}-${r.kind}`}>
                            <td className="mono">{shortDate(r.date)}</td>
                            <td>{r.kind.replace(/_/g, " ")}</td>
                            <td className={`num ${r.max_move_pct > 0 ? "pos" : r.max_move_pct < 0 ? "neg" : ""}`}>{pct(r.max_move_pct)}</td>
                            <td className={`num ${r.close_move_pct > 0 ? "pos" : r.close_move_pct < 0 ? "neg" : ""}`}>{pct(r.close_move_pct)}</td>
                            <td className="num">{r.volume_spike_x != null ? `${r.volume_spike_x.toFixed(1)}x` : "—"}</td>
                            <td>
                              {r.hit == null ? (
                                <span className="faint">open</span>
                              ) : (
                                <span className="outcome">
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
                </div>
              </details>
            )}
          </section>

          <PriceChart symbol={d.symbol} initialDays={90} onData={setSeries} />

          <section className="card sr-details" aria-labelledby="more-h">
            <h2 id="more-h">More detail</h2>

            {s && (
              <details className="acc" open={full}>
                <summary>
                  Full breakdown <span className="sum-note">{components.length} components with data, weights and figures</span>
                </summary>
                <div className="acc-body">
                  <p className="muted small">
                    Weights renormalise over the components that had data.{" "}
                    {missing > 0
                      ? `${plural(missing, "component")} had none on this run; the weight was redistributed, not zeroed, and the total was shrunk toward neutral.`
                      : "Every declared component had data on this run."}
                  </p>
                  {components.length === 0 ? (
                    <p className="muted small" style={{ marginBottom: 0 }}>
                      No per-component detail was stored for this score.
                    </p>
                  ) : (
                    <div className="complist">
                      {components.map((c) => {
                        const judgment = !c.backed;
                        const assumed = typeof c.value === "string" && c.value.includes("(assumed)");
                        return (
                          <div key={c.key} className="comp">
                            <div className="lbl">
                              {c.label}
                              {judgment && (
                                <span className="judg">
                                  {" "}
                                  · <Explain term="judgment">judgment input</Explain>
                                </span>
                              )}
                              {!judgment && assumed && (
                                <span className="judg">
                                  {" "}
                                  · <Explain term="assumed">assumed</Explain>
                                </span>
                              )}
                              {c.value != null && <span className="val">{String(c.value)}</span>}
                            </div>
                            <div className="track" aria-hidden="true">
                              <span className="fill" style={{ width: `${Math.round((c.score || 0) * 100)}%` }} />
                            </div>
                            <div className="w" title="desirability 0–1 × weight">
                              {(c.score ?? 0).toFixed(2)} × {c.weight}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {fields && (missing > 0 || missingComponents.length > 0) && (
                    <>
                      <h3 className="sr-sub">What would complete this score</h3>
                      <p className="muted small">
                        {missingComponents.length} of {s.components_total} components had no input on this run, so their weight was redistributed and the score
                        shrunk toward neutral. Each names the stored field that would fill it; weights are {strat.label}'s live declaration.
                      </p>
                      {missingComponents.length === 0 ? (
                        <p className="muted small" style={{ marginBottom: 0 }}>
                          The declared weights do not name the missing components; the breakdown above lists what did have data.
                        </p>
                      ) : (
                        <div className="weights">
                          {missingComponents.map((c) => (
                            <div className="weight-row" key={c.key}>
                              <span>
                                {c.label}
                                {c.source && <span className="xs faint" style={{ display: "block" }}>{c.source}</span>}
                              </span>
                              <span className="cmp-track" aria-hidden="true">
                                <span style={{ width: `${Math.round((c.share || 0) * 100)}%` }} />
                              </span>
                              <span className="w">{c.share != null ? `${Math.round(c.share * 100)}%` : c.weight}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </details>
            )}

            {KEY_STATS.length > 0 && (
              <details className="acc" open={full}>
                <summary>
                  Key stats <span className="sum-note">latest snapshot on file, each with its age</span>
                </summary>
                <div className="acc-body">
                  <div className="kstats">
                    {KEY_STATS.map((k) => {
                      const [, fmt] = SNAPSHOT_LABELS[k] || [k, (x) => x];
                      return (
                        <div className="kstat" key={k}>
                          <span className="k">
                            <FieldLabel k={k} simple={simple} />
                          </span>
                          <span className="v">
                            {fmt(snap[k].value)}
                            <AgeChip asOf={snap[k].as_of} />
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </details>
            )}

            {fieldSeries.length > 0 && (
              <details className="acc" open={full}>
                <summary>
                  Inputs over time <span className="sum-note">every point is a stored snapshot · last {fields.days} days</span>
                </summary>
                <div className="acc-body">
                  <div className="fieldgrid">
                    {fieldSeries.map(([k, pts]) => {
                      const [, fmt] = SNAPSHOT_LABELS[k] || [k, (x) => x];
                      const label = simple ? PLAIN_FIELD[k] || detailLabel(k) : detailLabel(k);
                      const first = pts[0].value;
                      const last = pts[pts.length - 1].value;
                      const vals = pts.map((p) => p.value);
                      const chg = first ? ((last - first) / Math.abs(first)) * 100 : null;
                      const priceLike = k === "px" || k === "hi52" || k === "lo52";
                      return (
                        <div className="fieldcard" key={k}>
                          <div className="fc-top">
                            <span className="fc-label">
                              <FieldLabel k={k} simple={simple} />
                            </span>
                            <span className="fc-val mono">{fmt(last)}</span>
                          </div>
                          <Sparkline points={vals} min={Math.min(...vals)} max={Math.max(...vals)} neutral={null} width={200} height={32} label={`${label}: ${pts.length} snapshots`} />
                          <div className="fc-foot xs faint">
                            {pts.length} snapshots · from {fmt(first)}
                            {chg != null && Number.isFinite(chg) ? (
                              <>
                                {" "}
                                · <span className={priceLike ? tone(chg) : ""}>{signed(chg, 0, "%")}</span>
                              </>
                            ) : null}{" "}
                            · {shortDate(pts[pts.length - 1].as_of)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </details>
            )}

            <details className="acc" open={full}>
              <summary>
                <span>
                  Other <Explain term="strategy">strategy</Explain> lenses
                </span>{" "}
                <span className="sum-note">{plural(d.strategies.length, "strategy", "strategies")} on this name</span>
              </summary>
              <div className="acc-body">
                <p className="hint" style={{ marginTop: 0, marginBottom: "var(--s-3)" }}>
                  Each strategy scores the same name by its own recipe. Tap one to read this report through that lens.
                </p>
                <div className="lens-tabs" role="group" aria-label="Strategies">
                  {d.strategies.map((l) => {
                    const drivers = topDrivers(l.components);
                    return (
                      <button key={l.key} className="lens-card" aria-pressed={l.key === strat.key} onClick={() => navigate(lensHref(l.key), { replace: true })}>
                        <div className="lc-top">
                          <span className="full-only">
                            <Monogram size={18}>{l.monogram}</Monogram>
                          </span>
                          {l.label}
                          {!l.calibrated && <StatusChip calibrated={false} short />}
                        </div>
                        <div className="lc-score">
                          {l.value != null ? (
                            <>
                              <b>{fmtScore(l.value, l.components_present, l.components_total)}</b>
                              <span>{l.band}</span>
                              <span className="faint">
                                · {l.components_present}/{l.components_total}
                              </span>
                            </>
                          ) : (
                            <span>no run</span>
                          )}
                        </div>
                        {drivers.length > 0 && (
                          <div className="xs faint" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {drivers.map((c) => c.label).join(" · ")}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </details>

            {peers.length > 1 && (
              <details className="acc" open={full}>
                <summary>
                  Also ranked in {d.industry.label} <span className="sum-note">{plural(peers.length, "name")}</span>
                </summary>
                <div className="acc-body">
                  <div className="tscroll">
                    <div className="table-card peers" style={{ boxShadow: "none" }}>
                      <table className="data compact">
                        <thead>
                          <tr>
                            <th className="rank" scope="col">
                              #
                            </th>
                            <th scope="col">Name</th>
                            <th scope="col" className="num">
                              Score
                            </th>
                            <th scope="col">Band</th>
                            <th scope="col" className="num">
                              Δ run
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {peers.map((p) => (
                            <tr key={p.symbol} className={p.self ? "me" : "rowlink"} onClick={() => !p.self && navigate(lensHref(strat.key).replace(d.symbol, p.symbol))}>
                              <td className="rank">{p.rank}</td>
                              <td className="name-cell">
                                <span className="sym">{p.symbol}</span>
                                <span className="theme">{p.theme}</span>
                              </td>
                              <td className="num">{fmtScore(p.value, p.components_present, p.components_total)}</td>
                              <td>
                                <ScoreBadge band={p.band} value={p.value} present={p.components_present} total={p.components_total} />
                              </td>
                              <td className="num">{delta(p.delta_1d)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <p className="hint">
                    <Link to={`/industries/${d.industry.key}`}>Industry page →</Link>
                  </p>
                </div>
              </details>
            )}

            <details className="acc" open={full || events.length > 0}>
              <summary>
                <span>
                  <Explain term="alert">Alerts</Explain> fired on this name
                </span>{" "}
                <span className="sum-note">{events.length ? `${plural(events.length, "alert")} in 120 days` : "none in 120 days"}</span>
              </summary>
              <div className="acc-body">
                {events.length === 0 ? (
                  <p className="muted small">No alert has fired on {d.symbol} in the last 120 days.</p>
                ) : (
                  <div className="alert-list">
                    {events.map((ev) => (
                      <AlertItem
                        key={ev.id}
                        ev={{ ...ev, symbol: d.symbol }}
                        tz={tz}
                        showSymbol={false}
                        onRead={(id) => {
                          setEvents((xs) => xs.map((x) => (x.id === id ? { ...x, read: true } : x)));
                          window.dispatchEvent(new Event("alerts:read"));
                        }}
                      />
                    ))}
                  </div>
                )}
                <p className="hint">
                  <Link to={`/alerts?tab=armed&symbol=${encodeURIComponent(d.symbol)}`}>Choose your own triggers →</Link>
                </p>
              </div>
            </details>

            {(d.hook || d.thesis || pinned) && (
              <details className="acc" open={full || noteOpen || Boolean(note)}>
                <summary>
                  Notes <span className="sum-note">{[d.hook || d.thesis ? "operator note" : null, pinned ? "your note" : null].filter(Boolean).join(" · ")}</span>
                </summary>
                <div className="acc-body stack">
                  {(d.hook || d.thesis) && (
                    <section className="opnote" aria-labelledby="op-h">
                      <div className="lab" id="op-h">
                        Operator note
                      </div>
                      {d.hook && (
                        <p>
                          <b>{d.hook}</b>
                        </p>
                      )}
                      {d.thesis && <p>{d.thesis}</p>}
                      <p className="muted small" style={{ marginBottom: 0 }}>
                        Human-written context, kept separate from the computed score above.
                      </p>
                    </section>
                  )}
                  {pinned && (
                    <section className="notebox" aria-labelledby="note-h">
                      <div className="card-title">
                        <h3 id="note-h" style={{ fontSize: "var(--fs-sm)" }}>
                          Your note
                        </h3>
                        {!noteOpen && (
                          <button className="btn-quiet" onClick={() => setNoteOpen(true)}>
                            {note ? "Edit" : "Add a note"}
                          </button>
                        )}
                      </div>
                      {noteOpen ? (
                        <>
                          <textarea value={note} maxLength={280} onChange={(e) => setNote(e.target.value)} placeholder="Why you pinned it, what would change your mind…" />
                          <div className="row" style={{ marginTop: "var(--s-2)" }}>
                            <button className="btn btn-primary btn-sm" disabled={noteBusy} onClick={saveNote}>
                              {noteBusy ? "Saving…" : "Save note"}
                            </button>
                            <button className="btn-quiet" onClick={() => setNoteOpen(false)}>
                              Cancel
                            </button>
                            <span className="xs faint">{note.length}/280 · private to you</span>
                          </div>
                        </>
                      ) : (
                        <p className="small" style={{ marginBottom: 0, color: note ? "var(--ink)" : "var(--ink-faint)" }}>
                          {note || "No note yet."}
                        </p>
                      )}
                    </section>
                  )}
                </div>
              </details>
            )}
          </section>
        </div>

        <aside className="sidebar sr-side" aria-label="Evidence">
          <h2>Evidence</h2>
          <details className="acc" open={full}>
            <summary>
              Data on file <span className="sum-note">{plural(snaps.length, "field")}</span>
            </summary>
            <div className="acc-body">
              {snaps.length === 0 ? (
                <div className="aside-note">
                  No market snapshot is on file for this name. The score above rests on the operator's research pass and whatever filings the pipeline has
                  read.
                </div>
              ) : (
                snaps.map(([k, val]) => {
                  const [, fmt] = SNAPSHOT_LABELS[k] || [k, (x) => x];
                  return (
                    <div className="kv" key={k}>
                      <span className="k">
                        <FieldLabel k={k} simple={simple} />
                      </span>
                      <span className="v">
                        {fmt(val.value)}
                        <AgeChip asOf={val.as_of} />
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </details>
          <details className="acc" open={full}>
            <summary>Find more like it</summary>
            <div className="acc-body">
              <div className="aside-note">
                <Link to={`/screen?industries=${d.industry.key}${strat.key !== "fast_mover" ? `&strategy=${strat.key}` : ""}`}>Screen {d.industry.label}</Link>
                {d.lane ? (
                  <>
                    {" "}
                    · <Link to={`/screen?lane=${encodeURIComponent(d.lane)}`}>{d.lane}-stage names</Link>
                  </>
                ) : null}
                {hardFilters.length > 0 && hardFilters.every((f) => f.pass) ? (
                  <>
                    {" "}
                    · <Link to="/screen?hf=pass">Everything that passed every filter</Link>
                  </>
                ) : null}{" "}
                · <Link to="/calendar">Calendar</Link> · <Link to={compareHref}>Compare</Link>
              </div>
            </div>
          </details>
          <details className="acc" open={full}>
            <summary>
              Run <span className="sum-note">what this report was computed from</span>
            </summary>
            <div className="acc-body">
              <div className="kv">
                <span className="k">Scored</span>
                <span className="v">{shortDate(d.run.as_of, tz)}</span>
              </div>
              {s && s.delta_1d != null && (
                <div className="kv">
                  <span className="k">
                    <Explain term="delta_run">Δ vs prior run</Explain>
                  </span>
                  <span className="v">{delta(s.delta_1d)}</span>
                </div>
              )}
              {history.length > 0 && (
                <div className="kv">
                  <span className="k">Runs on record</span>
                  <span className="v">{history.length}</span>
                </div>
              )}
              {d.lane && (
                <div className="kv">
                  <span className="k">
                    <Explain term="lane">Stage</Explain>
                  </span>
                  <span className="v">{d.lane}</span>
                </div>
              )}
              {d.group && (
                <div className="kv">
                  <span className="k">
                    <Explain term="group">Group</Explain>
                  </span>
                  <span className="v">{d.group}</span>
                </div>
              )}
              <div className="kv">
                <span className="k">
                  <Explain term="benchmark">Benchmark</Explain>
                </span>
                <span className="v">{d.industry.benchmark_etf}</span>
              </div>
            </div>
          </details>
          <details className="acc" open={full}>
            <summary>
              Calibration record{" "}
              <span className="sum-note">
                <Explain term={strat.calibrated ? "calibrated" : "provisional"}>{strat.calibrated ? "calibrated" : "provisional"}</Explain>
              </span>
            </summary>
            <div className="acc-body">
              {strat.calibrated ? (
                <div className="aside-note">
                  {strat.label} is calibrated on {strat.resolved_outcomes_count} resolved outcomes. Filter-passing events moved {EVIDENCE.hitRate}% of the time (
                  {EVIDENCE.hits} of {EVIDENCE.events}), against {EVIDENCE.earningsRate}% for earnings events generally and {EVIDENCE.randomRate}% on a random
                  day. The test measures movement, not direction or profit, over {EVIDENCE.window}. <Link to={`/strategies/${strat.key}`}>Evidence page</Link>
                </div>
              ) : (
                <div className="aside-note">
                  {strat.label} has {strat.resolved_outcomes_count ?? 0} resolved outcomes. Its weights can be calibrated once {EVIDENCE.calibrationThreshold}{" "}
                  resolve. Until then it produces candidates, not signals. <Link to={`/strategies/${strat.key}`}>Evidence page</Link>
                </div>
              )}
            </div>
          </details>
          <div className="sr-foot">
            <span>Not investment advice. Every figure here is a claim to re-verify against its primary source before you act on it.</span>
            <button className="btn-quiet" onClick={() => window.print()}>
              Print this report
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
