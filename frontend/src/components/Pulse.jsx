import React, { useEffect, useState } from "react";
import { Link } from "../lib/router.jsx";
import { fetchPulse } from "../lib/record.js";
import { useCountUp } from "../lib/motion.js";
import { shortDate } from "../lib/fmt.js";

// The live pulse (DESIGN_V5.md §1, §4.1, §5): what fired across the whole
// universe in the last 30 days, what moved after, how wide the watch is and
// how much lead the alerts gave, counted from GET /api/pulse. Every figure
// is a recorded count. Numbers count up once when the panel scrolls into
// view; a figure the API cannot give is left out, never shown as a dash.
// The endpoint carries no tickers and this component never invents one.

export function usePulse(days = 30) {
  const [state, setState] = useState({ pulse: null, error: null, loading: true });
  useEffect(() => {
    let alive = true;
    setState({ pulse: null, error: null, loading: true });
    fetchPulse(days)
      .then((p) => {
        if (!alive) return;
        const ok = p && p.alerts && p.universe;
        setState({ pulse: ok ? p : null, error: ok ? null : new Error("empty pulse"), loading: false });
      })
      .catch((e) => alive && setState({ pulse: null, error: e, loading: false }));
    return () => {
      alive = false;
    };
  }, [days]);
  return state;
}

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

// Up to four facts in the order the brief wants them: alerts fired, moves
// of 10%+ within five sessions, industries watched, median lead. Whatever
// the pulse cannot supply is filled from the universe; when the pulse is
// down altogether, this morning's run and the industry list stand in.
export function pulseStats(pulse, run, industries) {
  const out = [];
  const push = (key, value, label, sub) => {
    if (isNum(value) && out.length < 4) out.push({ key, value, label, sub: sub || null });
  };
  if (pulse) {
    const a = pulse.alerts || {};
    const u = pulse.universe || {};
    const days = pulse.days || 30;
    if (a.fired > 0) push("fired", a.fired, "alerts fired", `last ${days} days, every industry`);
    if (a.measured > 0) push("moved", a.moved_10, "moved 10%+ within five sessions", `${a.moved_10} of ${a.measured} measured alerts`);
    push("industries", u.industries, "industries watched", isNum(u.names) ? `${u.names} names scored` : null);
    if (isNum(pulse.lead_sessions_median)) {
      const m = pulse.lead_sessions_median;
      push("lead", m, `${m === 1 ? "session" : "sessions"} from alert to peak`, "median of the measured moves");
    }
    push("names", u.names, "names scored each morning", null);
    if (u.strategies > 0) push("strategies", u.strategies, "strategies", `${u.calibrated || 0} with a measured record`);
    return out;
  }
  if (run) {
    const scored = Object.values(run.bands || {}).reduce((s, n) => s + (Number(n) || 0), 0);
    if (scored > 0) push("names", scored, "names scored this morning", run.as_of ? `scored ${shortDate(run.as_of)}` : null);
    else push("names", run.universe_active, "names covered", null);
  }
  if (industries && industries.length) push("industries", industries.length, "industries watched", null);
  return out;
}

function Stat({ value, label, sub, active }) {
  const n = useCountUp(value, { active, duration: 1100 });
  return (
    <div className="pulse-stat">
      <div className="pulse-num">
        <span aria-hidden="true">{n}</span>
        <span className="sr-only">{value}</span>
      </div>
      <div className="pulse-label">{label}</div>
      {sub && <div className="pulse-sub">{sub}</div>}
    </div>
  );
}

// `stats` comes from pulseStats(); `active` starts the count-up (pass the
// reveal flag); `onJump(e, id)` scrolls to an in-page anchor.
export default function PulsePanel({ pulse, stats = [], loading = false, active = true, onJump }) {
  if (!loading && stats.length === 0) return null;
  const days = (pulse && pulse.days) || 30;
  return (
    <aside className="pulse" aria-label={pulse ? `The pulse: what fired and what moved in the last ${days} days` : "This morning's scoring"}>
      <div className="pulse-head">
        <span className="pulse-dot" aria-hidden="true" />
        <span className="pulse-title">{pulse ? `Live · last ${days} days` : "Live · this morning's scoring"}</span>
        {pulse && pulse.as_of && <span className="pulse-asof">as of {shortDate(pulse.as_of)}</span>}
      </div>
      {loading ? (
        <div className="pulse-grid" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <div className="pulse-stat pulse-sk" key={i}>
              <div className="pulse-sk-num" />
              <div className="pulse-sk-lab" />
            </div>
          ))}
        </div>
      ) : (
        <div className={`pulse-grid ${stats.length < 3 ? "two" : ""}`}>
          {stats.map((s) => (
            <Stat key={s.key} value={s.value} label={s.label} sub={s.sub} active={active} />
          ))}
        </div>
      )}
      <div className="pulse-foot">
        {pulse ? (
          <a href="#method" className="pulse-method" onClick={(e) => onJump && onJump(e, "method")}>
            Measured, not predicted
          </a>
        ) : (
          <Link to="/strategies/fast_mover" className="pulse-method">
            How the record is measured
          </Link>
        )}
        <span className="pulse-note">{pulse ? "Counts across every industry we watch. Names are shown to subscribers." : "Counts from this morning's scoring."}</span>
      </div>
    </aside>
  );
}
