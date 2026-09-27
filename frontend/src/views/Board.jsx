import React, { useEffect, useState } from "react";
import { api, getToken } from "../api.js";
import { navigate } from "../main.jsx";
import SearchBar from "../components/SearchBar.jsx";
import ScoreBadge from "../components/ScoreBadge.jsx";
import Pin from "../components/Pin.jsx";

const BANDS = ["", "strong", "elevated", "neutral", "weak"];

export default function Board() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [band, setBand] = useState("");
  const [me, setMe] = useState(null);
  const [strip, setStrip] = useState(
    () => window.localStorage.getItem("ta_board_intro_hidden") !== "1"
  );

  const hideStrip = () => {
    window.localStorage.setItem("ta_board_intro_hidden", "1");
    setStrip(false);
  };

  useEffect(() => {
    if (getToken()) {
      api("/me").then(setMe).catch(() => setMe(null));
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const q = band ? `?band=${band}` : "";
        const d = await api(`/board${q}`);
        if (alive) setData(d);
      } catch (e) {
        if (alive) {
          setErr(e.status === 401 ? "signin" : e.detail || "failed to load the board");
          setData(null);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [band]);

  const rows = data ? data.rows : [];

  return (
    <div className="wrap">
      <div className="pagehead">
        <h1>Fast Mover board</h1>
        <div className="meta">
          {data ? (
            <>
              run {data.run_id} · as of{" "}
              <span className="agechip">
                {new Date(data.as_of).toUTCString().slice(0, 16)} UTC
              </span>
            </>
          ) : (
            "…"
          )}
        </div>
      </div>
      <div className="filters">
        <SearchBar />
        <label>
          Band{" "}
          <select value={band} onChange={(e) => setBand(e.target.value)}>
            <option value="">all</option>
            {["strong", "elevated", "neutral", "weak"].map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
      </div>
      {me && (
        <p className="truncated-note" style={{ marginTop: 0, marginBottom: "var(--s-4)" }}>
          {me.tier.label} plan: {me.tier.names_shown_limit} tickers across{" "}
          {me.tier.industries_limit >= 999
            ? "all industries"
            : `${me.tier.industries_limit} industr${
                me.tier.industries_limit === 1 ? "y" : "ies"
              }`}
          .
        </p>
      )}
      {strip && (
        <div className="boardstrip">
          <span>
            Scores update daily. Click any row for the full evaluation report;
            the coverage column shows how much data backed each score.
          </span>
          <button className="btn-quiet" onClick={hideStrip}>Dismiss</button>
        </div>
      )}
      <details className="howto">
        <summary>How to read this board</summary>
        <div className="howbody">
          <ul>
            <li>
              <b>Band</b> — the score's bracket. Strong is the actionable
              bracket; the bands below it rank lower on the same scale.
            </li>
            <li>
              <b>Coverage</b> — how many scoring inputs had data. Thin coverage
              shrinks the score toward neutral; the number carries a{" "}
              <span className="mono">~</span> and the badge shows its solid band
              color regardless.
            </li>
            <li>
              <b>Provisional strategies</b> — marked with a label chip; their
              weights still wait on resolved outcomes.
            </li>
          </ul>
        </div>
      </details>
      {err === "signin" ? (
        <div className="table-card empty">
          <p>Sign in to see the board.</p>
          <p className="st" style={{ marginTop: "var(--s-2)" }}>
            Boards are sized and gated by plan.{" "}
            <a
              href="/login"
              onClick={(e) => {
                e.preventDefault();
                navigate("/login");
              }}
            >
              Log in
            </a>{" "}
            or{" "}
            <a
              href="/signup"
              onClick={(e) => {
                e.preventDefault();
                navigate("/signup");
              }}
            >
              sign up
            </a>{" "}
            to pick your industries.
          </p>
        </div>
      ) : err ? (
        <p className="empty">{err}</p>
      ) : null}
      {!data && !err && (
        <div className="table-card empty">
          <p>Loading the latest run…</p>
          <p className="st" style={{ marginTop: "var(--s-2)" }}>
            Boards regenerate on the operator&rsquo;s schedule; scores are
            whatever the last run computed.
          </p>
        </div>
      )}
      {data && rows.length === 0 && (
        <div className="table-card empty">No tickers in this band on the latest run.</div>
      )}
      {data && rows.length > 0 && (
        <>
          <div className="table-card">
            <table className="board">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Ticker</th>
                  <th>Theme</th>
                  <th>Industry</th>
                  <th style={{ textAlign: "right" }}>
                    Score<span className="thinfo" title="Score: 0-100 composite of present inputs. Thin coverage shrinks it toward neutral and marks the number with ~." aria-label="Score. A 0 to 100 composite; thin coverage shrinks it toward neutral.">?</span>
                  </th>
                  <th>Band<span className="thinfo" title="Band: strong, elevated, neutral, or weak, by the calibrated bands." aria-label="Band. Strong, elevated, neutral, or weak.">?</span></th>
                  <th style={{ textAlign: "right" }}>
                    Coverage<span className="thinfo" title="Coverage 2 of 3: some inputs missing, score shrunk toward neutral." aria-label="Coverage 2 of 3: some inputs missing, score shrunk toward neutral.">?</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.symbol}>
                    <td className="rank">{r.rank}</td>
                    <td>
                      <a
                        className="sym ntf"
                        href={`/stock/${r.symbol}`}
                        onClick={(e) => {
                          e.preventDefault();
                          navigate(`/stock/${r.symbol}`);
                        }}
                      >
                        {r.symbol}
                      </a>
                      <Pin symbol={r.symbol} />
                    </td>
                    <td className="theme" title={r.theme}>
                      {r.theme}
                    </td>
                    <td>
                      <span className="ind">
                        {r.industry.label} ({r.industry.benchmark_etf})
                      </span>
                    </td>
                    <td className="numcell">{r.value.toFixed(1)}</td>
                    <td>
                      <ScoreBadge
                        band={r.band}
                        value={r.value}
                        present={r.components_present}
                        total={r.components_total}
                      />
                    </td>
                    <td className="numcell">
                      {r.components_present}/{r.components_total}
                      {r.delta_1d != null ? (
                        <span
                          style={{
                            display: "block",
                            color: r.delta_1d >= 0 ? "var(--pos)" : "var(--neg)",
                          }}
                        >
                          {r.delta_1d >= 0 ? "+" : ""}
                          {r.delta_1d.toFixed(1)}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.meta.truncated && (
            <p className="truncated-note">
              Showing {data.meta.shown} tickers, capped by this plan. Raise your
              plan to see the full board.
            </p>
          )}
        </>
      )}
    </div>
  );
}