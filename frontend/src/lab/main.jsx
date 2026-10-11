/*
 * The Lab: the admin-only strategy workbench served at /lab (its own Vite
 * entry, frontend/lab.html). One file holds the shell and five of the seven
 * screens; Reports lives in Reports.jsx and the plain-language layer (term
 * tooltips, panel heads, glossary, intro, plain maps) in plain.jsx.
 *
 * Map for a new programmer (line numbers are approximate; grep the name):
 *
 *   helpers        pct, relTime, shortDate, errText, useFetch, Load    ~L75-145
 *   gate           useGate, Gate (sign-in), Denied                      ~L148-245
 *   walkthrough    SCREEN_INTROS, WALKTHROUGH_STEPS, Walkthrough        ~L265-345
 *   Strategies     StrategiesScreen (one card per strategy)             ~L350-420
 *   Inputs         GradeBadge, FiltersTable, ComponentsTable,
 *                  BandsTable, InputsScreen                             ~L423-695
 *   Versions       VersionsScreen: one-sentence verdict, History,
 *                  Compare (DiffList, PerformanceStrip, matched run)    ~L697-935
 *   Backtest       KINDS, BacktestScreen: five steps, run(), GroupRows,
 *                  BaseRows, the result card and Provenance             ~L938-1335
 *   Findings       STATUSES, KINDFIELDS, FindingsScreen (form + ledger),
 *                  FindingDetail (status, linked queries)               ~L1336-1580
 *   Log            LogScreen (query audit table)                        ~L1583-1626
 *   shell          LabApp: top bar, strategy context bar, screen intro,
 *                  LabIntro, status strip, GlossaryDrawer; App (gate)   ~L1627-end
 *
 * Navigation is React state only (screen, strat); there are no URL routes.
 * Data comes from app/lab.py (/api/admin/lab/*) and app/lab_release.py
 * (the performance verdict); Reports reads app/reporting.py. Everything the
 * user sees today is computed on synthetic fixtures (db/seed_lab.py).
 *
 * DESIGN_V6 §9 governs the plain layer: nothing moves; every addition is
 * additive and collapsible; plain word first, technical word second.
 */
import React, { useContext, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./lab.css";
import { api, login, getToken, logout } from "../api.js";
import ReportsScreen from "./Reports.jsx";
import {
  LabUI,
  withFloors,
  floorsSentence,
  useLocalFlag,
  GRADE_PLAIN,
  STATUS_PLAIN,
  KIND_PLAIN,
  RELATION_PLAIN,
  QUERY_STATUS_PLAIN,
  EXCLUSION_PLAIN,
  VERSION_STATE_PLAIN,
  plainTech,
  WarnBadge,
  fmtRule,
  fmtBand,
  fmtValue,
  BAND_ORDER,
  RawValues,
  MATCHED_SPEC,
  matchedSpecSentence,
  matchedSpecShort,
  PANELS,
  Term,
  Help,
  PanelHead,
  GlossaryDrawer,
  LabIntro,
  StartHereList,
} from "./plain.jsx";

// Evidence grades read as a phrase that already contains the stored word
// ("weak evidence"), so they are not doubled as "plain (technical)".
const gradeWord = (g) => GRADE_PLAIN[g] || g || "—";

const ADMIN_CHECK = "/admin/_check";

function pct(x) {
  return x == null ? "—" : (x * 100).toFixed(1) + "%";
}

// Timestamps arrive as full ISO strings. Cards show the age; the exact value
// stays in the title attribute for anyone who needs it.
function relTime(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(t).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function shortDate(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function errText(detail) {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map(String).join("\n");
  if (detail && typeof detail === "object") {
    const claim = detail.claim;
    if (Array.isArray(claim)) return claim.join("\n");
    return JSON.stringify(detail, null, 2);
  }
  return "request failed";
}

function useFetch(deps, loader) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr("");
    loader()
      .then((d) => alive && setData(d))
      .catch((e) => alive && setErr(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, deps);
  return { data, err, loading };
}

function Load({ data, err, loading, children }) {
  if (err) return <div className="errorbox" role="alert">{err}</div>;
  if (data === null || data === undefined) {
    return <p className="muted">Loading…</p>;
  }
  // Keep the previous render visible while refetching, dimmed, so switching
  // strategy doesn't blank the screen and then repaint.
  return <div className={loading ? "is-stale" : undefined}>{children(data)}</div>;
}

function useGate() {
  const [state, setState] = useState(getToken() ? "checking" : "unauthed");
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!getToken()) {
      setState("unauthed");
      return;
    }
    setState("checking");
    api(ADMIN_CHECK)
      .then(() => setState("ok"))
      .catch((e) => {
        if (e.status === 401) {
          logout();
          setState("unauthed");
        } else {
          setState("denied");
        }
      });
  }, [nonce]);
  return { state, retry: () => setNonce((n) => n + 1) };
}

function Gate({ retry }) {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await login(email, pass);
      retry();
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="gate">
      <h1>Lab</h1>
      <p className="muted">Sign in to the strategy analysis tool.</p>
      {err && <div className="errorbox" role="alert">{err}</div>}
      <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
        <label className="labfield">
          Email
          <input
            type="email"
            value={email}
            aria-label="Email"
            autoComplete="username"
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="labfield">
          Password
          <input
            type="password"
            value={pass}
            aria-label="Password"
            autoComplete="current-password"
            onChange={(e) => setPass(e.target.value)}
          />
        </label>
        <button className="btn btn-primary" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

function Denied({ retry }) {
  return (
    <div className="gate">
      <h1>Lab</h1>
      <p className="muted">
        The Lab is restricted to administrator accounts. Nothing here is
        shown to visitors.
      </p>
      <button
        className="btn"
        onClick={() => {
          logout();
          retry();
        }}
      >
        Sign in as a different account
      </button>
    </div>
  );
}

// Help (the "?" popover) and Term (the dotted term tooltip) live in plain.jsx.

function Collapsible({ title, subtitle, defaultOpen, children }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="labcollapse">
      <button
        type="button"
        className="labcollapse-head"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="labcollapse-chevron">{open ? "▾" : "▸"}</span>
        <span className="labcollapse-title">{title}</span>
        {!open && subtitle && <span className="labcollapse-subtitle">{subtitle}</span>}
      </button>
      {open && <div className="labcollapse-body">{children}</div>}
    </div>
  );
}

const SCREEN_INTROS = {
  strategies: "Open one to inspect or test it.",
  inputs: "What the strategy does. Not whether it works.",
  versions: "What changed, when, and whether it helped.",
  backtest: "Test a strategy against recorded history. Every run is audited.",
  findings: "What the backtests have shown, and the runs that back it.",
  log: "Every run, in order.",
  reports: "Where the data comes from, and what it shows at every level.",
};

const WALKTHROUGH_STEPS = [
  {
    title: "What the Lab is for",
    body: "The Lab is where a strategy's rules get inspected, changed, and tested against real history before anything reaches subscribers. Nothing you do here is visible outside this tool.",
  },
  {
    title: "1. Strategies",
    body: "The list of every scoring strategy. Open one to see its current rules (Inputs), its history (Versions), or to test it (Backtest).",
  },
  {
    title: "2. Inputs",
    body: "Shows what a strategy currently does: its filters, its component weights, its band cutoffs, and the evidence grade behind each one. This is a description, not a verdict.",
  },
  {
    title: "3. Backtest",
    body: "The core tool. Pick a strategy version, define a universe of stocks and a time window, choose what counts as a \"hit,\" and run it. Every run is recorded, so results can always be traced back later.",
  },
  {
    title: "4. Versions and Findings",
    body: "Versions lets you compare two points in a strategy's history on the exact same events, so a change is judged fairly. Findings is where a conclusion worth keeping gets written down and linked to the runs that support it.",
  },
  {
    title: "5. Reports",
    body: "Where the data comes from: each feed and when it last ran, how much price history and how many events exist, which industries have usable data, and one stock's chart with its events marked. A strategy result is only as good as the bars and events under it.",
  },
  {
    title: "6. Log",
    body: "Every run anyone made, in order, with who ran it, its settings fingerprint and its status. Every number anyone cites must trace back to a row here.",
  },
  {
    title: "Start here",
    body: "A path through the Lab in eight short steps. Pick one to go straight there; the same list sits in the \"What this lab is\" panel on the Strategies screen.",
    startHere: true,
  },
];

function Walkthrough({ onClose, onGo }) {
  const [step, setStep] = useState(0);
  const last = step === WALKTHROUGH_STEPS.length - 1;
  const s = WALKTHROUGH_STEPS[step];
  return (
    <div className="labwalk-backdrop" role="dialog" aria-modal="true" aria-label="Lab walkthrough">
      <div className={`labwalk${s.startHere ? " labwalk-wide" : ""}`}>
        <p className="labwalk-step">{step + 1} / {WALKTHROUGH_STEPS.length}</p>
        <h2>{s.title}</h2>
        <p>{s.body}</p>
        {s.startHere && (
          <StartHereList
            onGo={(item) => {
              onClose();
              onGo(item);
            }}
          />
        )}
        <div className="labwalk-actions">
          <button className="btn" onClick={onClose}>Skip</button>
          <span style={{ flex: 1 }} />
          {step > 0 && <button className="btn" onClick={() => setStep((n) => n - 1)}>Back</button>}
          <button className="btn btn-primary" onClick={() => (last ? onClose() : setStep((n) => n + 1))}>
            {last ? "Start" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Chip({ label, on, onClick }) {
  return (
    <button type="button" aria-pressed={on} className={`chip${on ? " on" : ""}`} onClick={onClick}>
      {label}
    </button>
  );
}

function StrategiesScreen({ strategies, onPick }) {
  const list = strategies?.strategies || [];
  return (
    <div className="labstack">
    <PanelHead id="strategies" title="Strategies" />
    <div className="stratlist">
      {list.map((s) => (
        <article className="card stratcard" key={s.key}>
          <div className="stratcard-main">
            <span className="stratcard-mark" aria-hidden="true">{s.monogram || s.key.slice(0, 2).toUpperCase()}</span>
            <div className="stratcard-body">
              <div className="stratcard-title">
                <h3>{s.label}</h3>
                {s.calibrated ? (
                  <span className="badge ok" title={`Weights backed by ${s.resolved_outcomes_count} resolved outcomes`}>
                    measured (calibrated)
                  </span>
                ) : (
                  <span className="badge warn" title="Weights are provisional priors, not yet backed by resolved outcomes">
                    starting guesses (provisional)
                  </span>
                )}
                {s.version_state && (
                  <span className="muted stratcard-state">
                    version state: {plainTech(VERSION_STATE_PLAIN, s.version_state)}
                  </span>
                )}
              </div>
              {s.description && <p className="stratcard-desc">{s.description}</p>}
              <dl className="stratcard-facts">
                <div>
                  <dt>Version</dt>
                  <dd>v{s.version_number ?? "—"}</dd>
                </div>
                <div>
                  <dt><Term text="Past alerts whose result is now known." g="resolved outcome">Outcomes</Term></dt>
                  <dd>{s.resolved_outcomes_count ?? 0} resolved</dd>
                </div>
                <div>
                  <dt><Term text="When someone last ran a backtest on this strategy." g="backtest">Last tested</Term></dt>
                  <dd>
                    {s.last_query_at ? (
                      <span title={`${s.last_query_at} · ${s.last_query_by}`}>{relTime(s.last_query_at)}</span>
                    ) : (
                      <span className="muted">never</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt><Term text="The strategy's machine name, as the API and the Log refer to it." g="strategy (lens)">Key</Term></dt>
                  <dd className="mono">{s.key}</dd>
                </div>
              </dl>
            </div>
          </div>
          <div className="stratcard-actions">
            <button className="btn btn-primary" onClick={() => onPick(s.key, "backtest")}>
              Run a backtest
            </button>
            <button className="btn" onClick={() => onPick(s.key, "inputs")}>
              Inspect inputs
            </button>
            <button className="btn" onClick={() => onPick(s.key, "versions")}>
              History
            </button>
          </div>
        </article>
      ))}
    </div>
    </div>
  );
}

function GradeBadge({ grade }) {
  if (!grade || grade === "none") {
    return <span className="muted">never tested</span>;
  }
  return (
    <span className={`badge ${grade === "strong" ? "ok" : grade === "weak" ? "warn" : ""}`}>
      {gradeWord(grade)}
    </span>
  );
}

function FiltersTable({ filters }) {
  if (!filters || filters.length === 0) {
    return <p className="muted">No hard filters declared for this version.</p>;
  }
  return (
    <>
    <table className="labtable">
      <thead>
        <tr>
          <th><Term k="rule">Rule</Term></th>
          <th><Term k="source">Source</Term></th>
          <th><Term k="cov">Cov.</Term></th>
          <th><Term k="evidence">Evidence</Term></th>
        </tr>
      </thead>
      <tbody>
        {filters.map((f, i) => (
          <tr key={i}>
            <td>
              <span className="mono">{f.label}</span>
              <span className="muted">
                {" "}
                {fmtRule(f.op, f.value, f.unit) ?? (
                  <span className="mono">{f.op} {JSON.stringify(f.value)}{f.unit ? ` ${f.unit}` : ""}</span>
                )}
              </span>
            </td>
            <td>
              {f.source && f.source.name ? (
                <>
                  {f.source.name}
                  {f.source.vintage_lag_days != null && (
                    <>
                      {" · "}
                      <Term
                        text="How stale this feed is when the rule reads it. Ignoring it would be lookahead bias."
                        g="vintage lag"
                      >
                        {f.source.vintage_lag_days}d vintage lag
                      </Term>
                    </>
                  )}
                </>
              ) : (
                <span className="muted">
                  <Term
                    text="The feed was not recorded when the data was loaded, so its lag is unknown."
                    g="untagged at ingest"
                  >
                    untagged at ingest
                  </Term>
                </span>
              )}
            </td>
            <td className="mono">{pct((f.coverage_pct ?? 0) / 100)}</td>
            <td><GradeBadge grade={f.evidence_grade} /></td>
          </tr>
        ))}
      </tbody>
    </table>
    <RawValues
      data={filters.map((f) => ({ key: f.key, op: f.op, value: f.value, unit: f.unit }))}
      sentence="The stored rules, exactly as the engine reads them."
    />
    </>
  );
}

function ComponentsTable({ components }) {
  if (!components || components.length === 0) {
    return <p className="muted">No component weights recorded for this version.</p>;
  }
  return (
    <table className="labtable">
      <thead>
        <tr>
          <th><Term k="component">Component</Term></th>
          <th><Term k="declared">Declared</Term></th>
          <th><Term k="median_eff">Median eff.</Term></th>
          <th><Term k="cov">Cov.</Term></th>
          <th><Term k="evidence">Evidence</Term></th>
        </tr>
      </thead>
      <tbody>
        {components.map((c, i) => (
          <tr key={i}>
            <td>
              <span className="mono">{c.key}</span>
              <span className="muted"> · {c.label}</span>
            </td>
            <td className="mono">{c.weight == null ? "—" : c.weight}</td>
            <td className="mono">{c.weight_renormalized_median == null ? "—" : c.weight_renormalized_median}</td>
            <td className="mono">{pct((c.coverage_pct ?? 0) / 100)}</td>
            <td><GradeBadge grade={c.evidence_grade} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BandsTable({ bands }) {
  const entries = Object.entries(bands || {});
  if (entries.length === 0) return <p className="muted">No band cutoffs recorded.</p>;
  // Strong first, as subscribers read the words; unknown keys last.
  const rank = (k) => {
    const i = BAND_ORDER.indexOf(k);
    return i === -1 ? BAND_ORDER.length : i;
  };
  entries.sort((a, b) => rank(a[0]) - rank(b[0]));
  return (
    <>
    <table className="labtable">
      <thead>
        <tr><th><Term k="band">Band</Term></th><th><Term k="cutoff">Cutoff</Term></th></tr>
      </thead>
      <tbody>
        {entries.map(([k, v]) => (
          <tr key={k}>
            <td>{k}</td>
            <td>{fmtBand(v) ?? <span className="mono">{JSON.stringify(v)}</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
    <RawValues data={bands} sentence="The stored cutoffs, exactly as the engine reads them." />
    </>
  );
}

function InputsScreen({ strat }) {
  const { data, err, loading } = useFetch([strat], () =>
    api(`/admin/lab/strategies/${strat}/inputs`));
  const coverage = useFetch([strat], () =>
    api(`/admin/lab/strategies/${strat}/coverage`));
  return (
    <div className="labstack">
      <Load data={data} err={err} loading={loading}>
        {(data) => (
          <>
        <div className="card">
          <PanelHead
            id="version"
            title={
              <>
                Version {data.version ? data.version.version_number : "?"}
                {data.version && (
                  <span className="muted" style={{ fontWeight: 400 }}>
                    {" "}· in effect since{" "}
                    <span title={data.version.effective_from}>{shortDate(data.version.effective_from)}</span>
                  </span>
                )}
              </>
            }
          />
          {data.version && data.version.change_reason && (
            <p className="muted" style={{ marginTop: 0 }}>{data.version.change_reason}</p>
          )}
          {data.score_evidence_note && (
            <div className="banner" style={{ marginTop: 12 }}>{data.score_evidence_note}</div>
          )}
        </div>
        <div className="card">
          <PanelHead id="filters" title="Hard filters">
            <p>Fail any one and the stock is excluded, whatever it scores.</p>
          </PanelHead>
          <div className="table-scroll">
            <FiltersTable filters={data.hard_filters} />
          </div>
        </div>
        <div className="card">
          <PanelHead id="components" title="Component weights">
            <p>Declared is intended. Median effective is what it came to after missing data.</p>
          </PanelHead>
          <div className="table-scroll">
            <ComponentsTable components={data.components} />
          </div>
        </div>
        <div className="card">
          <PanelHead id="bands" title="Band cutoffs">
            <p>A label, never a gate.</p>
          </PanelHead>
          <BandsTable bands={data.band_cutoffs} />
        </div>
        <div className="card">
          <PanelHead id="related" title="Related findings">
            <p>Each backed by the runs linked to it.</p>
          </PanelHead>
          {data.findings.length === 0 ? (
            <p className="muted">No findings recorded for this strategy yet.</p>
          ) : (
            data.findings.map((f, i) => (
              <div className="rel" key={f.id || i} style={{ marginBottom: 8 }}>
                <span>
                  <span className="badge">{gradeWord(f.evidence_grade)}</span>{" "}
                  <span className="badge">{plainTech(STATUS_PLAIN, f.status)}</span>{" "}
                  <span className="mono">{plainTech(KIND_PLAIN, f.claim_kind)}</span>
                </span>
                <p style={{ margin: 0 }}>{f.claim}</p>
              </div>
            ))
          )}
        </div>
          </>
        )}
      </Load>
      <Load data={coverage.data} err={coverage.err} loading={coverage.loading}>
        {(data) => (
        <div className="card">
          <PanelHead id="coverage_inputs" title="Event coverage">
            <p>Recorded history available to test against.</p>
          </PanelHead>
          <div className="statrow">
            <div className="stat">
              <span className="stat-num">{coverage.data.instruments}</span>
              <span className="stat-lab">
                <Term text="How many different stocks have recorded history to test on." g="instrument / ticker / symbol">instruments</Term>
              </span>
            </div>
            <div className="stat">
              <span className="stat-num">{coverage.data.events}</span>
              <span className="stat-lab">
                <Term k="events">events</Term> · {coverage.data.events_complete} <Term k="complete">complete</Term>
              </span>
            </div>
            <div className="stat">
              <span className="stat-num">
                {coverage.data.events_kinds ? coverage.data.events_kinds.length : 1}
              </span>
              <span className="stat-lab">
                {coverage.data.events_kinds ? coverage.data.events_kinds.join(", ") : "earnings"}
              </span>
            </div>
          </div>
          <div className="table-scroll">
          <table className="labtable" style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th><Term k="industry">Industry</Term></th>
                <th><Term k="events">Events</Term></th>
                <th><Term text="How many different stocks in that industry have recorded events." g="instrument / ticker / symbol">Instruments</Term></th>
                <th><Term k="synthetic">Synthetic</Term></th>
              </tr>
            </thead>
            <tbody>
              {coverage.data.industries.map((r, i) => (
                <tr key={i}>
                  <td>{r.label}</td>
                  <td>{r.events}</td>
                  <td>{r.instruments}</td>
                  <td>{r.synthetic ? "yes" : "no"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
        )}
      </Load>
    </div>
  );
}

function VersionsScreen({ strat }) {
  const { data, err, loading } = useFetch([strat], () =>
    api(`/admin/lab/strategies/${strat}/versions`));
  const { floors } = useContext(LabUI);
  // Best effort: the server's one-sentence verdict on the live version
  // (lab_release.py performance payload). Silent when unavailable.
  const perf = useFetch([strat], () =>
    api(`/admin/lab/strategies/${strat}/performance`).catch(() => ({ metrics: null })));
  const verdict = perf.data && perf.data.metrics;
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [diff, setDiff] = useState(null);
  const [diffErr, setDiffErr] = useState("");
  useEffect(() => {
    if (data && data.versions.length) {
      setA(String(data.versions[1]?.version_number ?? data.versions[0].version_number));
      setB(String(data.versions[0].version_number));
    }
  }, [data]);
  const runDiff = async () => {
    setDiffErr("");
    setDiff(null);
    try {
      const d = await api(`/admin/lab/strategies/${strat}/versions/diff?a=${a}&b=${b}`);
      setDiff(d);
    } catch (e) {
      setDiffErr(e.message);
    }
  };
  const [matching, setMatching] = useState(false);
  const [matchErr, setMatchErr] = useState("");
  const runMatched = async () => {
    setMatching(true);
    setMatchErr("");
    try {
      // MATCHED_SPEC (plain.jsx) is also what the disclosure sentence
      // beside the button describes, so the two cannot drift apart.
      const base = {
        strategy_key: strat,
        ...MATCHED_SPEC,
        hypothesis: `Same-events comparison of v${a} and v${b} on the fixture earnings set.`,
      };
      for (const vn of [Number(a), Number(b)]) {
        await api("/admin/lab/backtest", { method: "POST", json: { ...base, version_number: vn } });
      }
      const d = await api(`/admin/lab/strategies/${strat}/versions/diff?a=${a}&b=${b}`);
      setDiff(d);
    } catch (e) {
      setMatchErr(e.message);
    } finally {
      setMatching(false);
    }
  };
  const PerformanceStrip = ({ p }) => (
    <div className="card">
      <PanelHead id="performance" title="Performance on the same events">
        <p>
          Both versions scored on {p.events_in_scope ?? "the same"} identical events with one shared
          spec. When the Lab runs the pair itself it uses: {matchedSpecShort()}.
        </p>
      </PanelHead>
      <table className="labtable">
        <thead>
          <tr>
            <th><Term k="version">Version</Term></th>
            <th><Term k="hit_rate">Hit rate</Term></th>
            <th><Term k="hits">Hits</Term></th>
            <th><Term k="n">n</Term></th>
            <th><Term k="ci95">95% CI</Term></th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>v{p.a.version_number}</td>
            <td className="rate">{pct(p.a.hit_rate)}</td>
            <td>{p.a.hits}</td>
            <td>{p.a.n}</td>
            <td className="mono">{p.a.ci95 ? `${pct(p.a.ci95[0])}–${pct(p.a.ci95[1])}` : "—"}</td>
          </tr>
          <tr>
            <td>v{p.b.version_number}</td>
            <td className="rate">{pct(p.b.hit_rate)}</td>
            <td>{p.b.hits}</td>
            <td>{p.b.n}</td>
            <td className="mono">{p.b.ci95 ? `${pct(p.b.ci95[0])}–${pct(p.b.ci95[1])}` : "—"}</td>
          </tr>
        </tbody>
      </table>
      <p className="muted">
        <Term k="difference">difference</Term> {p.difference == null ? "—" : pct(p.difference)}
        {p.difference_ci95 && p.difference_ci95[0] != null && (
          <> (<Term k="ci95">95% CI</Term> {pct(p.difference_ci95[0])} to {pct(p.difference_ci95[1])})</>
        )}
        {p.p_value != null && <> · <Term k="p">p</Term> {p.p_value}</>}
      </p>
      <p className={p.verdict.state === "better" ? "notice" : p.verdict.state === "worse" ? "errorbox" : "muted"} style={p.verdict.state === "better" || p.verdict.state === "worse" ? undefined : { margin: 0 }}>
        {p.verdict.text}
      </p>
      {p.warnings.length > 0 && (
        <div className="rel" style={{ marginTop: 8 }}>
          {p.warnings.map((w, i) => (
            <WarnBadge w={w} floors={floors} key={i} />
          ))}
        </div>
      )}
    </div>
  );
  const DiffList = ({ title, items, kind }) =>
    items.length === 0 ? null : (
      <div className="card">
        <PanelHead id={`diff-${kind}`} title={title} {...PANELS.diff} />
        <table className="labtable">
          <thead>
            <tr>
              <th><Term k="key">Key</Term></th>
              <th><Term k="before">Before</Term></th>
              <th><Term k="after">After</Term></th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i}>
                <td className="mono">{it.key}</td>
                <td>{fmtValue(it.before, kind) ?? <span className="mono">{JSON.stringify(it.before)}</span>}</td>
                <td>{fmtValue(it.after, kind) ?? <span className="mono">{JSON.stringify(it.after)}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <RawValues data={items} sentence="The stored before and after values, exactly as the engine reads them." />
      </div>
    );
  return (
    <div className="labstack">
      {verdict && verdict.answer_head && (
        <div className="card oneline">
          <PanelHead
            id="oneline"
            title="In one sentence"
            plain={`v${verdict.version_number} · ${plainTech(VERSION_STATE_PLAIN, verdict.state)} · the server's own verdict`}
          />
          <p className="oneline-answer">
            <strong>{verdict.answer_head}</strong> {verdict.answer}
          </p>
          {verdict.answer_note && <p className="muted oneline-note">{verdict.answer_note}</p>}
        </div>
      )}
      <Load data={data} err={err} loading={loading}>
        {(data) => (
          <>
        <div className="card">
          <PanelHead id="history" title="History">
            <p>Newest first.</p>
          </PanelHead>
          {data.versions.length === 0 ? (
            <p className="muted">No versions recorded.</p>
          ) : (
            <ol className="vtimeline">
              {data.versions.map((v, i) => (
                <li className={`vitem${i === 0 ? " current" : ""}`} key={v.id}>
                  <div className="vitem-head">
                    <span className="vitem-ver">v{v.version_number}</span>
                    {i === 0 && <span className="badge ok">in effect</span>}
                    <span className="vitem-when" title={v.effective_from}>
                      {shortDate(v.effective_from)}
                      {v.effective_to ? ` → ${shortDate(v.effective_to)}` : " → now"}
                    </span>
                  </div>
                  {v.change_reason && <p className="vitem-why">{v.change_reason}</p>}
                  <p className="vitem-by">{v.created_by}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
        <div className="card">
          <PanelHead id="compare" title="Compare two versions">
            <p>Both must run on the same events, or the difference means nothing.</p>
            <p className="floors-note">{floorsSentence(floors)}</p>
          </PanelHead>
          <div className="formrow">
            <label className="labfield">
              Earlier version
              <select aria-label="Earlier version" value={a} onChange={(e) => setA(e.target.value)}>
                {(data.versions || []).map((v) => (
                  <option key={v.id} value={v.version_number}>{v.version_number}</option>
                ))}
              </select>
            </label>
            <label className="labfield">
              Later version
              <select aria-label="Later version" value={b} onChange={(e) => setB(e.target.value)}>
                {(data.versions || []).map((v) => (
                  <option key={v.id} value={v.version_number}>{v.version_number}</option>
                ))}
              </select>
            </label>
            <button className="btn btn-primary" style={{ alignSelf: "end" }} onClick={runDiff}>
              Compare
            </button>
          </div>
          {diffErr && <div className="errorbox" style={{ marginTop: 8 }}>{diffErr}</div>}
          {diff && (
            <div className="diffwrap">
              <p className="diffwrap-lead">
                Changes from <strong>v{diff.earlier}</strong> to <strong>v{diff.later}</strong>
              </p>
              {diff.hard_filters.length === 0 &&
                diff.component_weights.length === 0 &&
                diff.band_cutoffs.length === 0 && (
                  <p className="muted">No differences in filters, weights or cutoffs between these two versions.</p>
                )}
              <DiffList title="Hard filters" items={diff.hard_filters} kind="filters" />
              <DiffList title="Component weights" items={diff.component_weights} kind="weights" />
              <DiffList title="Band cutoffs" items={diff.band_cutoffs} kind="bands" />
              {diff.performance && diff.performance.matched ? (
                <PerformanceStrip p={diff.performance} />
              ) : (
                <div className="card">
                  <PanelHead id="performance" title="Performance on the same events" />
                  <p className="muted">
                    No existing run covers both versions with an identical spec, so there is
                    nothing fair to compare yet. Running both now on one shared event set fixes that.
                  </p>
                  <p className="muted">{matchedSpecSentence()}</p>
                  <button className="btn btn-primary" onClick={runMatched} disabled={matching}>
                    {matching ? "Running…" : "Run both versions on the same events"}
                  </button>
                  {matchErr && <div className="errorbox" style={{ marginTop: 8 }}>{matchErr}</div>}
                </div>
              )}
            </div>
          )}
        </div>
          </>
        )}
      </Load>
    </div>
  );
}

const KINDS = ["earnings", "random_day", "fda", "contract_award", "filing", "macro"];
const KIND_LABELS = {
  earnings: "Earnings",
  random_day: "Random day",
  fda: "FDA decision",
  contract_award: "Contract award",
  filing: "SEC filing",
  macro: "Macro event",
};

function BacktestScreen({ strat, onCite }) {
  const industries = useFetch([], () => api("/industries"));
  const versions = useFetch([strat], () => api(`/admin/lab/strategies/${strat}/versions`));
  const [ver, setVer] = useState("");
  const [tickers, setTickers] = useState("");
  const [indKeys, setIndKeys] = useState([]);
  const [capLo, setCapLo] = useState("");
  const [capHi, setCapHi] = useState("");
  const [group, setGroup] = useState("");
  const [theme, setTheme] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [kinds, setKinds] = useState(["earnings"]);
  const [price, setPrice] = useState("20");
  const [vol, setVol] = useState("3.0");
  const [combine, setCombine] = useState("or");
  const [baselines, setBaselines] = useState(["all_events", "random_day"]);
  const [hypothesis, setHypothesis] = useState("");
  const [family, setFamily] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [runErr, setRunErr] = useState("");
  const resultRef = useRef(null);
  const { floors } = useContext(LabUI);

  useEffect(() => {
    if (result || runErr) {
      resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [result, runErr]);

  const toggle = (arr, setArr, v) =>
    setArr(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const universeIsSet = !!(tickers || (capLo && capHi) || group || theme || from || to || indKeys.length);
  const universeSummary = [
    tickers && "tickers set",
    capLo && capHi && "cap band set",
    group && "group set",
    theme && "theme regex set",
    (from || to) && "date range set",
    indKeys.length ? `${indKeys.length} industr${indKeys.length === 1 ? "y" : "ies"}` : null,
  ].filter(Boolean).join(" · ");
  const advancedIsSet = !!(hypothesis || family);
  const advancedSummary = [hypothesis && "hypothesis recorded", family && "family key set"].filter(Boolean).join(" · ");

  const run = async (e) => {
    e.preventDefault();
    setRunning(true);
    setRunErr("");
    setResult(null);
    try {
      const body = {
        strategy_key: strat,
        version_number: ver ? Number(ver) : null,
        universe: {
          tickers: tickers
            ? tickers.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
            : null,
          industry_keys: indKeys.length ? indKeys : null,
          market_cap_band: capLo !== "" && capHi !== "" ? [Number(capLo), Number(capHi)] : null,
          instrument_group: group || null,
          theme_regex: theme || null,
        },
        window: { from: from || null, to: to || null },
        event_kinds: kinds,
        hit_definition: {
          price_move_pct: Number(price),
          volume_spike_x: Number(vol),
          combine,
          window: "tight",
        },
        baselines: baselines,
        hypothesis,
        family_key: family || null,
      };
      const r = await api("/admin/lab/backtest", { method: "POST", json: body });
      setResult(r);
    } catch (ex) {
      setRunErr(ex.message);
    } finally {
      setRunning(false);
    }
  };

  const GroupRows = ({ rows }) => (
    <table className="labtable">
      <caption className="mono">
        groups <span className="caption-plain">· stocks split by whether they passed the rules</span>
      </caption>
      <thead>
        <tr>
          <th><Term k="group">Group</Term></th>
          <th><Term k="n">n</Term></th>
          <th><Term k="hits">Hits</Term></th>
          <th><Term k="hit_rate">Hit rate</Term></th>
          <th><Term k="ci95">95% CI</Term></th>
          <th><Term k="instruments">Instruments</Term></th>
          <th><Term k="warnings">Warnings</Term></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((g) => (
          <tr key={g.key}>
            <td>{g.label}</td>
            <td>{g.n}</td>
            <td>{g.hits}</td>
            <td className="rate">{pct(g.hit_rate)}</td>
            <td className="mono">{g.ci95 ? `${pct(g.ci95[0])}–${pct(g.ci95[1])}` : "—"}</td>
            <td>{g.distinct_instruments}</td>
            <td>
              {g.warnings.length
                ? g.warnings.map((w, i) => <WarnBadge w={w} floors={floors} key={i} />)
                : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const BaseRows = ({ rows }) => (
    <table className="labtable">
      <caption className="mono">
        baselines <span className="caption-plain">· what the pass group is compared with</span>
      </caption>
      <thead>
        <tr>
          <th><Term k="baseline">Baseline</Term></th>
          <th><Term k="n">n</Term></th>
          <th><Term k="hits">Hits</Term></th>
          <th><Term k="hit_rate">Hit rate</Term></th>
          <th><Term k="ci95">95% CI</Term></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((b, i) => (
          <tr key={i}>
            <td>{b.label}</td>
            <td>{b.n}</td>
            <td>{b.hits}</td>
            <td className="rate">{pct(b.hit_rate)}</td>
            <td className="mono">{b.ci95 ? `${pct(b.ci95[0])}–${pct(b.ci95[1])}` : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <>
      <form onSubmit={run} className="labstack">
        <section className="lab-step">
          <PanelHead id="step1" title={<><span className="stepnum">1</span> Which version to test</>}>
            <p>Runs the rules as they stood at that point in time.</p>
          </PanelHead>
          <label className="labfield" style={{ maxWidth: 280 }}>
            Version
            <select aria-label="Version" value={ver} onChange={(e) => setVer(e.target.value)}>
              <option value="">current (live definition)</option>
              {(versions.data?.versions || []).map((v) => (
                <option key={v.id} value={v.version_number}>v{v.version_number}</option>
              ))}
            </select>
          </label>
        </section>
        <section className="lab-step">
          <PanelHead id="step2" title={<><span className="stepnum">2</span> Which stocks to test on</>}>
            <p>Every stock the strategy can see, unless you narrow it.</p>
          </PanelHead>
          <Collapsible
            title="Narrow the universe"
            subtitle={universeIsSet ? universeSummary : "using the full universe"}
            defaultOpen={universeIsSet}
          >
          <div className="formrow">
            <label className="labfield">
              Tickers (comma-separated)
              <input value={tickers} onChange={(e) => setTickers(e.target.value)} placeholder="PDYN, LEU" />
            </label>
            <label className="labfield">
              Market cap band (USD millions)
              <span style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 6, minWidth: 0 }}>
                <input type="number" placeholder="e.g. 300" value={capLo} onChange={(e) => setCapLo(e.target.value)} />
                <input type="number" placeholder="e.g. 3000" value={capHi} onChange={(e) => setCapHi(e.target.value)} />
              </span>
            </label>
            <label className="labfield">
              Instrument group
              <input value={group} onChange={(e) => setGroup(e.target.value)} placeholder="Scan / A / Bench" />
            </label>
          </div>
          <div className="formrow">
            <label className="labfield">
              Date from
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="labfield">
              Date to
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
            <label className="labfield">
              Theme regex
              <input value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="uranium|nuclear" />
            </label>
          </div>
          <div>
            <span className="labfield-label">Industries <span className="muted">({indKeys.length} selected)</span></span>
            <div className="chiprow">
              {(industries.data?.industries || []).map((i) => (
                <Chip key={i.key} label={i.label} on={indKeys.includes(i.key)} onClick={() => toggle(indKeys, setIndKeys, i.key)} />
              ))}
            </div>
          </div>
          </Collapsible>
        </section>
        <section className="lab-step">
          <PanelHead id="step3" title={<><span className="stepnum">3</span> What counts as a hit</>}>
            <p>Pick the events, then set how big a move counts.</p>
          </PanelHead>
          <div>
            <span className="labfield-label">
              Events to test
              <span className="muted"> ({kinds.length} selected)</span>
            </span>
            <div className="chiprow">
              {KINDS.map((k) => (
                <Chip key={k} label={KIND_LABELS[k] || k} on={kinds.includes(k)} onClick={() => toggle(kinds, setKinds, k)} />
              ))}
            </div>
          </div>
          <div className="hitrule">
            <span className="hitrule-lead">Counts as a hit when the stock</span>
            <label className="labfield hitrule-field">
              moved at least (%)
              <input type="number" step="any" value={price} onChange={(e) => setPrice(e.target.value)} />
            </label>
            <label className="labfield hitrule-field hitrule-join">
              <span className="labfield-label" style={{ margin: 0 }}>&nbsp;</span>
              <select aria-label="Combine conditions" value={combine} onChange={(e) => setCombine(e.target.value)}>
                <option value="or">or</option>
                <option value="and">and</option>
              </select>
            </label>
            <label className="labfield hitrule-field">
              traded at least (× normal volume)
              <input type="number" step="any" value={vol} onChange={(e) => setVol(e.target.value)} />
            </label>
          </div>
          <p className="hitrule-plain">
            {combine === "or"
              ? `A stock counts as a hit if it moved ${price || "—"}% or more, or traded ${vol || "—"}× its normal volume.`
              : `A stock counts as a hit only if it moved ${price || "—"}% or more and traded ${vol || "—"}× its normal volume.`}
          </p>
        </section>
        <section className="lab-step">
          <PanelHead id="step4" title={<><span className="stepnum">4</span> What to compare against</>}>
            <p>A hit rate alone means little. 30% is only good if random days do worse.</p>
          </PanelHead>
          <div className="chiprow">
            <Chip label="All selected events" on={baselines.includes("all_events")} onClick={() => toggle(baselines, setBaselines, "all_events")} />
            <Chip label="Random trading days" on={baselines.includes("random_day")} onClick={() => toggle(baselines, setBaselines, "random_day")} />
          </div>
          <p className="floors-note">{floorsSentence(floors)}</p>
        </section>
        <section className="lab-step">
          <PanelHead
            id="step5"
            title={<><span className="stepnum">5</span> Record what you expected <span className="muted">(optional)</span></>}
          >
            <p>Fill this in only if the result might become a finding.</p>
          </PanelHead>
          <Collapsible
            title="Record a hypothesis"
            subtitle={advancedIsSet ? advancedSummary : "not recorded"}
            defaultOpen={advancedIsSet}
          >
          <div className="formrow">
            <label className="labfield">
              Hypothesis (recorded with the run)
              <input value={hypothesis} onChange={(e) => setHypothesis(e.target.value)} placeholder="e.g. filtered beats small-beat names in a three-day window" />
            </label>
            <label className="labfield">
              Family key
              <span className="labfield-inline-help">
                <Help
                  text="Group repeated tests of the same idea under one family key. Test the same hypothesis five times and one of those runs will look good by chance alone; the family key applies a statistical correction (Holm-Bonferroni) so a lucky run doesn't get mistaken for a real result."
                  g="family key (line of inquiry)"
                />
              </span>
              <input value={family} onChange={(e) => setFamily(e.target.value)} placeholder="e.g. si-growth-2026" />
            </label>
          </div>
          </Collapsible>
        </section>
        <div className="runbar">
          <button className="btn btn-primary" disabled={running} style={{ padding: "10px 20px" }}>
            {running ? "Running backtest…" : "Run backtest"}
          </button>
          <p className="run-hint">
            Every run is recorded as a query and stays auditable. Results that clear their baselines are what a finding may cite.
          </p>
        </div>
      </form>
      <div aria-live="polite" ref={resultRef} style={{ scrollMarginTop: 72 }}>
        {runErr && <div className="errorbox">{runErr}</div>}
        {result && (
          <>
            {result.provenance.synthetic_data_used && (
              <div className="banner" style={{ marginBottom: 12 }}>
                These results were computed on synthetic sandbox fixtures, so they are a
                rehearsal, not evidence. The Provenance section below names the source that
                produced them.
              </div>
            )}
            {result.cached && (
              <p className="notice">Served from an earlier identical query (#{result.cached_from_query_id}); still audited as a new run.</p>
            )}
            <div className="card">
              <PanelHead
                id="result"
                title={<>Result · <Term k="query_id">query #{result.query_id}</Term></>}
                actions={
                  <button type="button" className="btn" onClick={() => onCite(result.query_id)}>
                    Cite this run in a finding
                  </button>
                }
              />
              {result.warnings.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  {result.warnings.map((w, i) => (
                    <div key={i}>
                      <span className={`badge ${w.severity}`}>{w.code}</span>{" "}
                      <span className="muted">{w.text}</span>
                    </div>
                  ))}
                </div>
              )}
              <GroupRows rows={result.groups} />
              {result.baselines.length > 0 && <div style={{ marginTop: 10 }}><BaseRows rows={result.baselines} /></div>}
              {result.comparison && (
                <div className="rel" style={{ marginTop: 12 }}>
                  <h4>Pass group vs {result.comparison.vs}</h4>
                  <dl className="kv">
                    <dt><Term k="difference">difference</Term></dt><dd className="rate">{pct(result.comparison.difference)}</dd>
                    <dt><Term k="test">test</Term></dt><dd>{result.comparison.test}</dd>
                    <dt><Term k="p">p</Term></dt><dd className="mono">{result.comparison.p_value}</dd>
                    <dt><Term k="p_holm">p (Holm)</Term></dt><dd className="mono">{result.comparison.p_value_adjusted}</dd>
                    <dt><Term k="family">family</Term></dt><dd>{result.comparison.adjustment.family_key || "—"} · {result.comparison.adjustment.tests_in_family} tests</dd>
                  </dl>
                </div>
              )}
              <details style={{ marginTop: 12 }}>
                <summary className="muted">
                  Provenance (where the data came from) · {result.provenance.events_in_scope} events in scope
                </summary>
                <p className="muted" style={{ margin: "8px 0 0" }}>
                  What went into this run and what was left out.
                </p>
                <dl className="kv" style={{ marginTop: 8 }}>
                  <dt>events (after universe)</dt><dd>{result.provenance.events_total_after_universe}</dd>
                  <dt>excluded</dt><dd>{result.provenance.events_excluded}</dd>
                  <dt><Term text="Scores made before version tracking; the exact rules behind them cannot be confirmed." g="assumed version">assumed versions</Term></dt><dd>{result.provenance.version_confidence_assumed_count} scores</dd>
                  <dt><Term k="synthetic">synthetic</Term></dt><dd>{result.provenance.synthetic_data_used ? "yes" : "no"}</dd>
                  <dt><Term text="The feeds the inputs came from." g="data source (feed)">sources</Term></dt><dd><span className="mono">{result.provenance.sources.join("; ")}</span></dd>
                </dl>
                {result.provenance.exclusions.length > 0 && (
                  <table className="labtable">
                    <tbody>
                      {result.provenance.exclusions.map((x, i) => (
                        <tr key={i}>
                          <td>{plainTech(EXCLUSION_PLAIN, x.reason)}</td>
                          <td>{x.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </details>
              <p className="footer-note">{result.footer}</p>
            </div>
          </>
        )}
      </div>
    </>
  );
}

const STATUSES = ["hypothesis", "tested", "held_up", "failed", "superseded"];
const KINDFIELDS = ["filter", "weight", "band", "component", "other"];

function FindingsScreen({ citeQueryId }) {
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [nonce, setNonce] = useState(0);
  const { data, err, loading } = useFetch([filter, statusFilter, nonce], () => {
    const q = [];
    if (filter) q.push(`strategy=${encodeURIComponent(filter)}`);
    if (statusFilter) q.push(`status=${encodeURIComponent(statusFilter)}`);
    return api(`/admin/lab/findings${q.length ? "?" + q.join("&") : ""}`);
  });
  const [openId, setOpenId] = useState(null);
  const [form, setForm] = useState({
    title: "",
    claim: "",
    claim_kind: "filter",
    query_ids: citeQueryId ? String(citeQueryId) : "",
    notes: "",
  });
  const [formErr, setFormErr] = useState("");
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const list = data?.findings || [];

  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    setFormErr("");
    setSaved("");
    try {
      const d = await api("/admin/lab/findings", {
        method: "POST",
        json: {
          title: form.title,
          claim: form.claim,
          claim_kind: form.claim_kind,
          lab_query_ids: form.query_ids.split(",").map((s) => Number(s.trim())).filter(Boolean),
          notes: form.notes,
        },
      });
      setForm({ title: "", claim: "", claim_kind: "filter", query_ids: "", notes: "" });
      setSaved(`Saved as finding #${d.id}${d.evidence_grade ? ` · evidence grade ${d.evidence_grade}` : ""}.`);
      setNonce((n) => n + 1);
    } catch (ex) {
      setFormErr(ex.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="labgrid">
      <div className="card">
        <form onSubmit={create} style={{ display: "grid", gap: 12 }}>
          <PanelHead id="record" title="Record a finding" className="in-grid" />
          {formErr && <div className="errorbox">{formErr}</div>}
          <div aria-live="polite">
            {saved && <p className="notice" style={{ margin: 0 }}>{saved}</p>}
          </div>
          {citeQueryId && (
            <p className="labmeta" style={{ margin: 0 }}>
              Citing backtest query #{citeQueryId}, carried over from the run you just made.
            </p>
          )}
          <label className="labfield">
            Title
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </label>
          <label className="labfield">
            Claim
            <textarea
              rows="3"
              value={form.claim}
              onChange={(e) => setForm({ ...form, claim: e.target.value })}
              placeholder={"Must carry a number and a data size (n=, events, instruments)."}
            />
          </label>
          <div className="formrow">
            <label className="labfield">
              Kind
              <select value={form.claim_kind} onChange={(e) => setForm({ ...form, claim_kind: e.target.value })}>
                {KINDFIELDS.map((k) => (
                  <option key={k} value={k}>{plainTech(KIND_PLAIN, k)}</option>
                ))}
              </select>
            </label>
            <label className="labfield">
              Query IDs (comma-separated)
              <input value={form.query_ids} onChange={(e) => setForm({ ...form, query_ids: e.target.value })} />
            </label>
          </div>
          <label className="labfield">
            Notes
            <textarea rows="2" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </label>
          <button className="btn btn-primary" disabled={busy}>Save finding</button>
        </form>
      </div>
      <div className="labgrid" style={{ alignContent: "start" }}>
        <div className="card" style={{ display: "grid", gap: 10 }}>
          <PanelHead id="findings" title="Findings" className="in-grid" />
          <div className="formrow">
            <label className="labfield">
              Strategy filter
              <input value={filter} onChange={(e) => setFilter(e.target.value)} />
            </label>
            <label className="labfield">
              Status filter
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">any</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{plainTech(STATUS_PLAIN, s)}</option>
                ))}
              </select>
            </label>
          </div>
          <Load data={data} err={err} loading={loading}>
{(data) => (
          list.length === 0 ? (
              <p className="muted">{loading ? "Loading…" : "No findings recorded yet. Run a backtest, then cite it here."}</p>
            ) : (
              list.map((f) => (
                <div key={f.id}>
                  <button
                    className="card"
                    style={{ textAlign: "left", width: "100%", cursor: "pointer" }}
                    onClick={() => setOpenId(openId === f.id ? null : f.id)}
                    aria-expanded={openId === f.id}
                  >
                    <span className="badge">{gradeWord(f.evidence_grade)}</span>{" "}
                    <span className="badge">{plainTech(STATUS_PLAIN, f.status)}</span>{" "}
                    <span className="mono">{plainTech(KIND_PLAIN, f.claim_kind)}</span>{" "}
                    <span className="mono muted">#{f.id} · {f.strategy}</span>
                    <p style={{ margin: "8px 0 0" }}>{f.title}</p>
                  </button>
                  {openId === f.id && (
                    <FindingDetail fid={f.id} grade={f.evidence_grade} />
                  )}
                </div>
))))}
            </Load>
        </div>
      </div>
    </div>
  );
}

function FindingDetail({ fid, grade }) {
  const { data, err, loading } = useFetch([fid], () => api(`/admin/lab/findings/${fid}`));
  const [addQ, setAddQ] = useState("");
  const [addRel, setAddRel] = useState("supports");
  const [msg, setMsg] = useState("");
  const [status, setStatus] = useState("");
  useEffect(() => {
    if (data) setStatus(data.status);
  }, [data]);
  const patchStatus = async (s) => {
    setMsg("");
    try {
      const d = await api(`/admin/lab/findings/${fid}`, { method: "PATCH", json: { status: s } });
      setStatus(d.status);
      setMsg("Status updated. The evidence grade is computed from the linked runs and cannot be edited.");
    } catch (ex) {
      setMsg(ex.message);
    }
  };
  const add = async () => {
    setMsg("");
    try {
      const d = await api(`/admin/lab/findings/${fid}/queries`, {
        method: "POST",
        json: { lab_query_id: Number(addQ), relation: addRel },
      });
      setMsg(`Run linked. The evidence grade is now ${gradeWord(d.evidence_grade)}.`);
      setAddQ("");
    } catch (ex) {
      setMsg(ex.message);
    }
  };
  const del = async (lqid) => {
    setMsg("");
    try {
      const d = await api(`/admin/lab/findings/${fid}/queries/${lqid}`, { method: "DELETE" });
      setMsg(`Run unlinked. The evidence grade is now ${gradeWord(d.evidence_grade)}.`);
    } catch (ex) {
      setMsg(ex.message);
    }
  };
  return (
    <div className="card" style={{ marginTop: 6 }}>
      <Load data={data} err={err} loading={loading}>
        {(data) => (
          <>
        <PanelHead id="finding" title={`Finding #${fid}`} />
        <p style={{ marginTop: 0 }}>{data.claim}</p>
        <div className="formrow">
          <label className="labfield">
            Status
            <select value={status} onChange={(e) => patchStatus(e.target.value)}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{plainTech(STATUS_PLAIN, s)}</option>
              ))}
            </select>
          </label>
          <p className="muted" style={{ alignSelf: "end" }}>
            <Term k="evidence">evidence grade</Term>: <span className="badge">{gradeWord(grade)}</span>
          </p>
        </div>
        {data.notes && <p className="muted">{data.notes}</p>}
        <h4>Linked queries</h4>
        {data.queries.length === 0 ? (
          <p className="muted">None linked yet.</p>
        ) : (
          data.queries.map((q) => (
            <div className="rel-select" key={q.id} style={{ marginBottom: 6 }}>
              <span className="badge">{plainTech(RELATION_PLAIN, q.relation)}</span>
              <span className="mono">#{q.id}</span>
              <span className="muted">{q.query_type} · {q.created_at}</span>
              <button className="btn" style={{ marginLeft: "auto" }} onClick={() => del(q.id)}>Unlink</button>
            </div>
          ))
        )}
        <div className="rel-select labfield" style={{ marginTop: 10 }}>
          <input
            className="mono qid-input"
            placeholder="query id"
            value={addQ}
            onChange={(e) => setAddQ(e.target.value)}
            aria-label="Query id"
          />
          <select value={addRel} onChange={(e) => setAddRel(e.target.value)}>
            <option value="supports">{plainTech(RELATION_PLAIN, "supports")}</option>
            <option value="contradicts">{plainTech(RELATION_PLAIN, "contradicts")}</option>
            <option value="replicates">{plainTech(RELATION_PLAIN, "replicates")}</option>
          </select>
          <button className="btn btn-primary" onClick={add}>Link query</button>
        </div>
        {msg && <p className="notice">{msg}</p>}
          </>
        )}
      </Load>
    </div>
  );
}

function LogScreen() {
  const { data, err, loading } = useFetch([], () => api("/admin/lab/queries?limit=100"));
  return (
    <div className="card">
      <PanelHead id="log" title="Query audit log" />
      <Load data={data} err={err} loading={loading}>
        {(data) => (
        data.queries.length === 0 ? (
          <p className="muted">No queries recorded.</p>
        ) : (
          <table className="labtable">
            <thead>
              <tr>
                <th><Term k="query_id">#</Term></th>
                <th><Term k="strategy">Strategy</Term></th>
                <th><Term k="query_status">Status</Term></th>
                <th><Term k="by">By</Term></th>
                <th><Term k="family_key">Family</Term></th>
                <th><Term k="hypothesis">Hypothesis</Term></th>
                <th><Term k="hash">Hash</Term></th>
                <th><Term k="at">At</Term></th>
              </tr>
            </thead>
            <tbody>
              {data.queries.map((q) => (
                <tr key={q.id}>
                  <td className="mono">{q.id}</td>
                  <td>{q.strategy}</td>
                  <td><span className="badge">{plainTech(QUERY_STATUS_PLAIN, q.status)}</span></td>
                  <td className="mono">{q.by}</td>
                  <td className="mono">{q.family_key || "—"}</td>
                  <td>{q.hypothesis || "—"}</td>
                  <td className="mono">{q.spec_hash}</td>
                  <td className="mono">{q.created_at}</td>
                </tr>
              ))}
            </tbody>
</table>
          ))}
        </Load>
    </div>
  );
}

const WALKTHROUGH_SEEN_KEY = "lab_walkthrough_seen";
const INTRO_SEEN_KEY = "lab_intro_seen";
const STRATEGY_SCREENS = ["inputs", "versions", "backtest"];

function LabApp() {
  const { data: strategies, err } = useFetch([], () => api("/admin/lab/strategies"));
  const [screen, setScreen] = useState("strategies");
  const [strat, setStrat] = useState("");
  const [citeQueryId, setCiteQueryId] = useState(null);
  const [showWalk, setShowWalk] = useState(() => {
    try {
      return !localStorage.getItem(WALKTHROUGH_SEEN_KEY);
    } catch {
      return false;
    }
  });
  const closeWalk = () => {
    setShowWalk(false);
    try {
      localStorage.setItem(WALKTHROUGH_SEEN_KEY, "1");
    } catch {
      /* ignore */
    }
  };
  // "What this lab is" shows on Strategies until dismissed; "What is this?"
  // in the top bar brings it back.
  const [introSeen, setIntroSeen] = useLocalFlag(INTRO_SEEN_KEY, false);
  // The glossary drawer, opened from the top bar and from every Term's
  // "more" link; focus returns to whatever opened it.
  const [glossary, setGlossary] = useState({ open: false, term: null });
  const glossaryTrigger = useRef(null);
  const openGlossary = (term, trigger) => {
    glossaryTrigger.current = trigger || document.activeElement;
    setGlossary({ open: true, term: term || null });
  };
  const closeGlossary = () => {
    setGlossary({ open: false, term: null });
    const t = glossaryTrigger.current;
    glossaryTrigger.current = null;
    if (t && typeof t.focus === "function") setTimeout(() => t.focus(), 0);
  };
  // The floors come from the API so the copy cannot drift from lab.py;
  // the literals in plain.jsx are only the fallback.
  const floors = withFloors(strategies && strategies.floors);
  useEffect(() => {
    if (!strat && strategies) {
      const first = strategies.strategies[0];
      if (first) setStrat(first.key);
    }
  }, [strategies, strat]);
  const go = (key, s) => {
    setStrat(key);
    setCiteQueryId(null);
    setScreen(s);
  };
  const options = strategies ? strategies.strategies : [];
  const navTo = (id) => {
    setCiteQueryId(null);
    setScreen(id);
  };
  const goStartHere = (item) => {
    if (item.glossary) {
      openGlossary(null, null);
      return;
    }
    if (item.strat) go(strat, item.screen);
    else navTo(item.screen);
  };
  const tab = (label, id) => (
    <button className={screen === id ? "active" : ""} onClick={() => navTo(id)}>
      {label}
    </button>
  );
  const subtab = (label, id) => (
    <button
      className={screen === id ? "active" : ""}
      aria-current={screen === id ? "page" : undefined}
      onClick={() => navTo(id)}
    >
      {label}
    </button>
  );
  return (
    <LabUI.Provider value={{ openGlossary, floors }}>
      <div className="labbar">
        <span className="mark">LB</span>
        <span className="surface-name">Analysis engine</span>
        <span className="surface-note">Internal. Subscribers never see this.</span>
        <nav className="labnav">
          <button
            className={screen === "strategies" || STRATEGY_SCREENS.includes(screen) ? "active" : ""}
            onClick={() => navTo("strategies")}
          >
            Strategies
          </button>
          {tab("Reports", "reports")}
          {tab("Findings", "findings")}
          {tab("Log", "log")}
        </nav>
        <span style={{ flex: 1 }} />
        <span
          className="muted mono labbar-count"
          title="Dated events in the sandbox test set. Today all of them are synthetic fixtures."
        >
          {strategies ? `${strategies.events_total} events in the test set` : ""}
        </span>
        <button
          className="btn"
          onClick={() => {
            setIntroSeen(false);
            navTo("strategies");
          }}
        >
          What is this?
        </button>
        <button className="btn" onClick={(e) => openGlossary(null, e.currentTarget)}>Glossary</button>
        <button className="btn" onClick={() => setShowWalk(true)}>Guide</button>
        <button
          className="btn"
          onClick={() => {
            logout();
            window.location.reload();
          }}
        >
          Sign out
        </button>
      </div>
      {showWalk && <Walkthrough onClose={closeWalk} onGo={goStartHere} />}
      <div className="labwrap">
        {err && <div className="errorbox">{err}</div>}
        {STRATEGY_SCREENS.includes(screen) && (
          <div className="labcontext">
            <div className="labcontext-head">
              <button
                type="button"
                className="labcontext-back"
                onClick={() => setScreen("strategies")}
              >
                ← All strategies
              </button>
              <select
                className="labcontext-name"
                aria-label="Strategy"
                value={strat}
                onChange={(e) => setStrat(e.target.value)}
              >
                {options.map((o) => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </select>
            </div>
            <nav className="labsubnav">
              {subtab("Inputs", "inputs")}
              {subtab("Versions", "versions")}
              {subtab("Backtest", "backtest")}
            </nav>
          </div>
        )}
        <p className="labscreen-intro">{SCREEN_INTROS[screen]}</p>
        {screen === "strategies" && !introSeen && (
          <LabIntro onDismiss={() => setIntroSeen(true)} onGo={goStartHere} />
        )}
        {screen === "strategies" && (
          <StrategiesScreen strategies={strategies} onPick={go} />
        )}
        {STRATEGY_SCREENS.includes(screen) && !strat && (
          <p className="muted">Loading strategies…</p>
        )}
        {screen === "inputs" && strat && <InputsScreen strat={strat} />}
        {screen === "versions" && strat && <VersionsScreen strat={strat} />}
        {screen === "backtest" && strat && (
          <BacktestScreen
            strat={strat}
            onCite={(qid) => {
              setCiteQueryId(qid);
              setScreen("findings");
            }}
          />
        )}
        {screen === "findings" && (
          <FindingsScreen key={citeQueryId || "none"} citeQueryId={citeQueryId} />
        )}
        {screen === "reports" && <ReportsScreen />}
        {screen === "log" && <LogScreen />}
      </div>
      <div className="labstatus" role="status" aria-label="Engine status">
        <span className="live">ENGINE</span>
        <span>
          strategies <b>{options.length || "—"}</b>
        </span>
        <span>
          events in the test set <b>{strategies ? strategies.events_total : "—"}</b>{" "}
          <span className="labstatus-dim">(synthetic fixtures)</span>
        </span>
        <span>
          screen <b>{screen.toUpperCase()}</b>
          {strat && STRATEGY_SCREENS.includes(screen) ? <> · <b>{strat}</b></> : null}
        </span>
        <span className="spacer" />
        <span>synthetic rows never leave this surface</span>
        <button type="button" className="labstatus-btn" onClick={() => setShowWalk(true)}>
          <b>?</b> guide
        </button>
      </div>
      <GlossaryDrawer open={glossary.open} term={glossary.term} onClose={closeGlossary} />
    </LabUI.Provider>
  );
}

function App() {
  const { state, retry } = useGate();
  if (state === "checking") return <div className="gate"><p className="muted">Checking…</p></div>;
  if (state === "unauthed") return <Gate retry={retry} />;
  if (state === "denied") return <Denied retry={retry} />;
  return <LabApp />;
}

createRoot(document.getElementById("root")).render(<App />);