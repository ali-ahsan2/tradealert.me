import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./lab.css";
import { api, login, getToken, logout } from "../api.js";
import ThemeSwitcher from "../components/ThemeSwitcher.jsx";

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

function Help({ text }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="labhelp">
      <button
        type="button"
        className="labhelp-btn"
        aria-label="What does this mean?"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        ?
      </button>
      {open && <span className="labhelp-pop" role="tooltip">{text}</span>}
    </span>
  );
}

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
  strategies: "Every strategy the site can score with. Start here, then open a card to inspect it or test it.",
  inputs: "What this strategy currently claims to do, filter by filter and weight by weight, and what evidence backs each claim.",
  versions: "The change history for a strategy. Compare two versions on the same events to see whether a change actually helped.",
  backtest: "Run one strategy version against a chosen set of past events and see how often it would have called a real move.",
  findings: "The written record of what backtests have actually shown. A finding is only as strong as the runs linked to it.",
  log: "Every backtest ever run, in order, so any result can be traced back to the exact query that produced it.",
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
];

function Walkthrough({ onClose }) {
  const [step, setStep] = useState(0);
  const last = step === WALKTHROUGH_STEPS.length - 1;
  const s = WALKTHROUGH_STEPS[step];
  return (
    <div className="labwalk-backdrop" role="dialog" aria-modal="true" aria-label="Lab walkthrough">
      <div className="labwalk">
        <p className="labwalk-step">{step + 1} / {WALKTHROUGH_STEPS.length}</p>
        <h2>{s.title}</h2>
        <p>{s.body}</p>
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
    <div className="labgrid">
      {list.map((s) => (
        <div className="card stratcard" key={s.key}>
          <h3>{s.label}</h3>
          <dl className="kv">
            <dt>key</dt>
            <dd className="mono">{s.key}</dd>
            <dt>version</dt>
            <dd>{s.version_number ?? "—"}</dd>
            <dt>calibrated</dt>
            <dd>{s.calibrated ? "yes" : "no"}</dd>
            <dt>last query</dt>
            <dd>
              {s.last_query_at ? (
                <>
                  <span title={s.last_query_at}>{relTime(s.last_query_at)}</span>
                  <span className="kv-sub">{s.last_query_by}</span>
                </>
              ) : (
                "never"
              )}
            </dd>
          </dl>
          <div className="stratcard-actions">
            <button className="btn btn-primary" onClick={() => onPick(s.key, "inputs")}>
              Inputs
            </button>
            <button className="btn" onClick={() => onPick(s.key, "versions")}>
              Versions
            </button>
            <button className="btn" onClick={() => onPick(s.key, "backtest")}>
              Backtest
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function GradeBadge({ grade }) {
  if (!grade || grade === "none") {
    return <span className="muted">never tested</span>;
  }
  return <span className={`badge ${grade === "strong" ? "ok" : grade === "weak" ? "warn" : ""}`}>{grade}</span>;
}

function FiltersTable({ filters }) {
  if (!filters || filters.length === 0) {
    return <p className="muted">No hard filters declared for this version.</p>;
  }
  return (
    <table className="labtable">
      <caption className="mono">hard filters</caption>
      <thead>
        <tr><th>Rule</th><th>Source</th><th>Cov.</th><th>Evidence</th></tr>
      </thead>
      <tbody>
        {filters.map((f, i) => (
          <tr key={i}>
            <td>
              <span className="mono">{f.label}</span>
              <span className="mono muted"> {f.op} {JSON.stringify(f.value)}{f.unit ? ` ${f.unit}` : ""}</span>
            </td>
            <td>
              {f.source && f.source.name ? (
                <>
                  {f.source.name}
                  {f.source.vintage_lag_days != null &&
                    ` · ${f.source.vintage_lag_days}d vintage lag`}
                </>
              ) : (
                <span className="muted">untagged at ingest</span>
              )}
            </td>
            <td className="mono">{pct((f.coverage_pct ?? 0) / 100)}</td>
            <td><GradeBadge grade={f.evidence_grade} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ComponentsTable({ components }) {
  if (!components || components.length === 0) {
    return <p className="muted">No component weights recorded for this version.</p>;
  }
  return (
    <table className="labtable">
      <caption className="mono">components · declared → median effective</caption>
      <thead>
        <tr><th>Component</th><th>Declared</th><th>Median eff.</th><th>Cov.</th><th>Evidence</th></tr>
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
  return (
    <table className="labtable">
      <caption className="mono">band cutoffs</caption>
      <thead>
        <tr><th>Band</th><th>Cutoff</th></tr>
      </thead>
      <tbody>
        {entries.map(([k, v]) => (
          <tr key={k}>
            <td>{k}</td>
            <td className="mono">{JSON.stringify(v)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function InputsScreen({ strat }) {
  const { data, err, loading } = useFetch([strat], () =>
    api(`/admin/lab/strategies/${strat}/inputs`));
  const coverage = useFetch([strat], () =>
    api(`/admin/lab/strategies/${strat}/coverage`));
  return (
    <div className="labstack">
      <p className="labmeta" style={{ margin: 0 }}>
        Read-mostly: what the strategy says it does, plus what the ledger has compared it against.
      </p>
      <Load data={data} err={err} loading={loading}>
        {(data) => (
          <>
        <div className="card">
          <h3>{data.strategy.label} — inputs</h3>
          <p className="muted">Version {data.version ? data.version.version_number : "?"} since {data.version ? data.version.effective_from : "—"}</p>
          {data.version && data.version.change_reason && (
            <p className="muted">{data.version.change_reason}</p>
          )}
          <div className="banner" style={{ marginTop: 12 }}>
            This screen describes what the strategy does. It says nothing about whether any of it works. Evidence grades come from the Findings ledger.
          </div>
          {data.score_evidence_note && (
            <div className="banner" style={{ marginTop: 12 }}>{data.score_evidence_note}</div>
          )}
          <div className="subgrid-2" style={{ marginTop: 12 }}>
            <div className="card-stack">
              <FiltersTable filters={data.hard_filters} />
            </div>
            <div className="card-stack">
              <ComponentsTable components={data.components} />
              <BandsTable bands={data.band_cutoffs} />
            </div>
          </div>
        </div>
        <div className="card">
          <h3>Related findings</h3>
          {data.findings.length === 0 ? (
            <p className="muted">No findings recorded for this strategy.</p>
          ) : (
            data.findings.map((f, i) => (
              <div className="rel" key={f.id || i} style={{ marginBottom: 8 }}>
                <span>
                  <span className="badge">{f.evidence_grade}</span>{" "}
                  <span className="badge">{f.status}</span>{" "}
                  <span className="mono">{f.claim_kind}</span>
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
          <h3>Event coverage</h3>
          <dl className="kv">
            <dt>instruments</dt><dd>{coverage.data.instruments}</dd>
            <dt>events</dt><dd>{coverage.data.events} ({coverage.data.events_complete} complete)</dd>
            <dt>kinds available</dt><dd>{coverage.data.events_kinds ? coverage.data.events_kinds.join(", ") : "earnings"}</dd>
          </dl>
          <div className="table-scroll">
          <table className="labtable" style={{ marginTop: 8 }}>
            <caption className="mono">by industry</caption>
            <thead>
              <tr><th>Industry</th><th>Events</th><th>Instruments</th><th>Synthetic</th></tr>
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
      const base = {
        strategy_key: strat,
        window: { from: null, to: null },
        event_kinds: ["earnings"],
        hit_definition: { price_move_pct: 20, volume_spike_x: 3, combine: "or", window: "tight" },
        baselines: ["all_events"],
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
      <h3>Performance on the same events</h3>
      <table className="labtable">
        <thead>
          <tr><th>Version</th><th>Hit rate</th><th>Hits</th><th>n</th><th>95% CI</th></tr>
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
        difference {p.difference == null ? "—" : pct(p.difference)}
        {p.difference_ci95 && p.difference_ci95[0] != null && (
          <> (95% {pct(p.difference_ci95[0])} to {pct(p.difference_ci95[1])})</>
        )}
        {p.p_value != null && <> · p {p.p_value}</>}
      </p>
      <p className={p.verdict.state === "better" ? "notice" : p.verdict.state === "worse" ? "errorbox" : "muted"} style={p.verdict.state === "better" || p.verdict.state === "worse" ? undefined : { margin: 0 }}>
        {p.verdict.text}
      </p>
      {p.warnings.length > 0 && (
        <div className="rel" style={{ marginTop: 8 }}>
          {p.warnings.map((w, i) => (
            <span className="badge warn" key={i} title={w.text}>{w.code}</span>
          ))}
        </div>
      )}
    </div>
  );
  const DiffList = ({ title, items }) =>
    items.length === 0 ? null : (
      <div className="card">
        <h3>{title}</h3>
        <table className="labtable">
          <thead>
            <tr><th>Key</th><th>Before</th><th>After</th></tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i}>
                <td className="mono">{it.key}</td>
                <td className="mono">{JSON.stringify(it.before)}</td>
                <td className="mono">{JSON.stringify(it.after)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  return (
    <div className="labstack">
      <p className="labmeta" style={{ margin: 0 }}>
        Version history is a ledger: each version is a recorded decision, not something you can quietly undo.
      </p>
      <Load data={data} err={err} loading={loading}>
        {(data) => (
          <>
        <div className="card">
          <h3>Versions</h3>
          {data.versions.length === 0 ? (
            <p className="muted">No versions recorded.</p>
          ) : (
            data.versions.map((v) => (
              <div className="rel" key={v.id} style={{ marginBottom: 8 }}>
                <dl className="kv">
                  <dt>version</dt><dd>{v.version_number}</dd>
                  <dt>effective</dt><dd>{v.effective_from}{v.effective_to ? ` → ${v.effective_to}` : " → now"}</dd>
                  <dt>by</dt><dd>{v.created_by}</dd>
                </dl>
                {v.change_reason && <p className="muted" style={{ margin: 0 }}>{v.change_reason}</p>}
              </div>
            ))
          )}
        </div>
        <div className="card">
          <h3>Diff versions</h3>
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
            <div className="subgrid-2" style={{ marginTop: 12 }}>
              <p className="muted">v{diff.earlier} → v{diff.later}</p>
              <DiffList title="Hard filters" items={diff.hard_filters} />
              <DiffList title="Component weights" items={diff.component_weights} />
              <DiffList title="Band cutoffs" items={diff.band_cutoffs} />
              {diff.performance && diff.performance.matched ? (
                <PerformanceStrip p={diff.performance} />
              ) : (
                <div className="card">
                  <h3>Performance on the same events</h3>
                  <p className="muted">
                    No cached backtest pair covers both versions with an identical
                    spec. Comparing two versions on different event sets is how a
                    meaningless improvement number gets made, so the tool will not
                    offer that comparison.
                  </p>
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
      <caption className="mono">groups</caption>
      <thead>
        <tr>
          <th>Group</th><th>n</th><th>Hits</th><th>Hit rate</th><th>95% CI</th>
          <th>Instruments</th><th>Warnings</th>
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
                ? g.warnings.map((w, i) => (
                    <span className={`badge ${w.severity}`} key={i} title={w.text}>{w.code}</span>
                  ))
                : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const BaseRows = ({ rows }) => (
    <table className="labtable">
      <caption className="mono">baselines</caption>
      <thead>
        <tr><th>Baseline</th><th>n</th><th>Hits</th><th>Hit rate</th><th>95% CI</th></tr>
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
      <p className="labmeta" style={{ margin: "0 0 var(--s-4)" }}>
        A backtest is one audited query: universe → event kinds → hit rule → baselines. The strategy and version decide which recorded inputs it runs on.
      </p>
      <form onSubmit={run} className="labstack">
        <section className="lab-step">
          <h3><span className="stepnum">1</span> Strategy and version</h3>
          <div className="formrow">
            <label className="labfield">
              Version
              <select aria-label="Version" value={ver} onChange={(e) => setVer(e.target.value)}>
                <option value="">current</option>
                {(versions.data?.versions || []).map((v) => (
                  <option key={v.id} value={v.version_number}>{v.version_number}</option>
                ))}
              </select>
            </label>
            <p className="labmeta" style={{ margin: 0 }}>
              Pick a version to run the filters, weights, and band cutoffs recorded for that point in time. Leave on current to run the live definition.
            </p>
          </div>
        </section>
        <section className="lab-step">
          <h3><span className="stepnum">2</span> Universe</h3>
          <p className="labmeta" style={{ margin: 0 }}>
            Leave everything below empty to run on every stock the strategy is allowed to see. Narrow it down only if you want to test a specific slice.
          </p>
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
              Market cap band (USD)
              <span style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 6, minWidth: 0 }}>
                <input type="number" placeholder="lo (USD)" value={capLo} onChange={(e) => setCapLo(e.target.value)} />
                <input type="number" placeholder="hi (USD)" value={capHi} onChange={(e) => setCapHi(e.target.value)} />
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
          <h3><span className="stepnum">3</span> Event kinds and hit rule</h3>
          <div className="formrow">
            <label className="labfield">
              Hit: price move ≥ %
              <input type="number" step="any" value={price} onChange={(e) => setPrice(e.target.value)} />
            </label>
            <label className="labfield">
              Hit: volume spike ≥ ×
              <input type="number" step="any" value={vol} onChange={(e) => setVol(e.target.value)} />
            </label>
            <label className="labfield">
              Combine
              <select value={combine} onChange={(e) => setCombine(e.target.value)}>
                <option value="or">OR</option>
                <option value="and">AND</option>
              </select>
            </label>
          </div>
          <div>
            <span className="labfield-label">Event kinds</span>
            <div className="chiprow">
              {KINDS.map((k) => (
                <Chip key={k} label={k} on={kinds.includes(k)} onClick={() => toggle(kinds, setKinds, k)} />
              ))}
            </div>
          </div>
        </section>
        <section className="lab-step">
          <h3>
            <span className="stepnum">4</span> Baselines
            <Help text="A baseline is what the strategy's hit rate gets measured against. If a strategy hits 30% of the time but random days also hit 28% of the time, the strategy isn't actually adding much." />
          </h3>
          <p className="labmeta" style={{ margin: 0 }}>
            Every hit rate is compared against these. A result only becomes citable by a finding when it clears its baselines.
          </p>
          <div className="chiprow">
            <Chip label="All selected events" on={baselines.includes("all_events")} onClick={() => toggle(baselines, setBaselines, "all_events")} />
            <Chip label="Random trading days" on={baselines.includes("random_day")} onClick={() => toggle(baselines, setBaselines, "random_day")} />
          </div>
        </section>
        <section className="lab-step">
          <h3><span className="stepnum">5</span> Hypothesis <span className="muted">(optional)</span></h3>
          <p className="labmeta" style={{ margin: 0 }}>
            Skip this for a quick look. Fill it in when a result might become a finding you cite later.
          </p>
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
                <Help text="Group repeated tests of the same idea under one family key. Test the same hypothesis five times and one of those runs will look good by chance alone; the family key applies a statistical correction (Holm-Bonferroni) so a lucky run doesn't get mistaken for a real result." />
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
                These results were computed on synthetic sandbox fixtures. Records in the
                provenance notes which source produced them.
              </div>
            )}
            {result.cached && (
              <p className="notice">Served from an earlier identical query (#{result.cached_from_query_id}); still audited as a new run.</p>
            )}
            <div className="card">
              <div className="result-head">
                <h3 style={{ margin: 0 }}>Result · query #{result.query_id}</h3>
                <button type="button" className="btn" onClick={() => onCite(result.query_id)}>
                  Cite this run in a finding
                </button>
              </div>
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
                    <dt>difference</dt><dd className="rate">{pct(result.comparison.difference)}</dd>
                    <dt>test</dt><dd>{result.comparison.test}</dd>
                    <dt>p</dt><dd className="mono">{result.comparison.p_value}</dd>
                    <dt>p (Holm)</dt><dd className="mono">{result.comparison.p_value_adjusted}</dd>
                    <dt>family</dt><dd>{result.comparison.adjustment.family_key || "—"} · {result.comparison.adjustment.tests_in_family} tests</dd>
                  </dl>
                </div>
              )}
              <details style={{ marginTop: 12 }}>
                <summary className="muted">Provenance · {result.provenance.events_in_scope} events in scope</summary>
                <dl className="kv" style={{ marginTop: 8 }}>
                  <dt>events (after universe)</dt><dd>{result.provenance.events_total_after_universe}</dd>
                  <dt>excluded</dt><dd>{result.provenance.events_excluded}</dd>
                  <dt>assumed versions</dt><dd>{result.provenance.version_confidence_assumed_count} scores</dd>
                  <dt>synthetic</dt><dd>{result.provenance.synthetic_data_used ? "yes" : "no"}</dd>
                  <dt>sources</dt><dd><span className="mono">{result.provenance.sources.join("; ")}</span></dd>
                </dl>
                {result.provenance.exclusions.length > 0 && (
                  <table className="labtable">
                    <tbody>
                      {result.provenance.exclusions.map((x, i) => (
                        <tr key={i}>
                          <td className="mono">{x.reason}</td>
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
          <h3>Record a finding</h3>
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
                  <option key={k} value={k}>{k}</option>
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
                  <option key={s} value={s}>{s}</option>
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
                    <span className="badge">{f.evidence_grade}</span>{" "}
                    <span className="badge">{f.status}</span>{" "}
                    <span className="mono">{f.claim_kind}</span>{" "}
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
      setMsg("status updated; evidence grade is computed, not editable");
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
      setMsg(`linked; evidence grade now ${d.evidence_grade}`);
      setAddQ("");
    } catch (ex) {
      setMsg(ex.message);
    }
  };
  const del = async (lqid) => {
    setMsg("");
    try {
      const d = await api(`/admin/lab/findings/${fid}/queries/${lqid}`, { method: "DELETE" });
      setMsg(`unlinked; evidence grade now ${d.evidence_grade}`);
    } catch (ex) {
      setMsg(ex.message);
    }
  };
  return (
    <div className="card" style={{ marginTop: 6 }}>
      <Load data={data} err={err} loading={loading}>
        {(data) => (
          <>
        <p style={{ marginTop: 0 }}>{data.claim}</p>
        <div className="formrow">
          <label className="labfield">
            Status
            <select value={status} onChange={(e) => patchStatus(e.target.value)}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          <p className="muted" style={{ alignSelf: "end" }}>evidence grade: <span className="badge">{grade}</span></p>
        </div>
        {data.notes && <p className="muted">{data.notes}</p>}
        <h4>Linked queries</h4>
        {data.queries.length === 0 ? (
          <p className="muted">None linked yet.</p>
        ) : (
          data.queries.map((q) => (
            <div className="rel-select" key={q.id} style={{ marginBottom: 6 }}>
              <span className="badge">{q.relation}</span>
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
            <option value="supports">supports</option>
            <option value="contradicts">contradicts</option>
            <option value="replicates">replicates</option>
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
      <h3>Query audit log</h3>
      <Load data={data} err={err} loading={loading}>
        {(data) => (
        data.queries.length === 0 ? (
          <p className="muted">No queries recorded.</p>
        ) : (
          <table className="labtable">
            <thead>
              <tr>
                <th>#</th><th>Strategy</th><th>Status</th><th>By</th>
                <th>Family</th><th>Hypothesis</th><th>Hash</th><th>At</th>
              </tr>
            </thead>
            <tbody>
              {data.queries.map((q) => (
                <tr key={q.id}>
                  <td className="mono">{q.id}</td>
                  <td>{q.strategy}</td>
                  <td><span className="badge">{q.status}</span></td>
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
    <>
      <div className="labbar">
        <span className="mark">LB</span>
        <span className="muted">Lab</span>
        <nav className="labnav">
          <button
            className={screen === "strategies" || STRATEGY_SCREENS.includes(screen) ? "active" : ""}
            onClick={() => navTo("strategies")}
          >
            Strategies
          </button>
          {tab("Findings", "findings")}
          {tab("Log", "log")}
        </nav>
        <span style={{ flex: 1 }} />
        <span className="muted mono">{strategies ? `${strategies.events_total} fixture events` : ""}</span>
        <button className="btn" onClick={() => setShowWalk(true)}>Guide</button>
        <ThemeSwitcher />
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
      {showWalk && <Walkthrough onClose={closeWalk} />}
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
        {screen === "log" && <LogScreen />}
      </div>
    </>
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