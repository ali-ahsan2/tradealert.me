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
          setErr(e.detail || "failed to load the board");
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
          {me.tier.label} plan: {me.tier.names_shown_limit} names across{" "}
          {me.tier.industries_limit >= 999
            ? "all industries"
            : `${me.tier.industries_limit} industr${
                me.tier.industries_limit === 1 ? "y" : "ies"
              }`}
          .
        </p>
      )}
      {err && <p className="empty">{err}</p>}
      {data && rows.length === 0 && (
        <div className="table-card empty">No names in this band on the latest run.</div>
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
                  <th>Lane</th>
                  <th style={{ textAlign: "right" }}>Score</th>
                  <th>Band</th>
                  <th style={{ textAlign: "right" }}>Coverage</th>
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
                    <td className="theme" title={r.hook || r.theme}>
                      {r.theme}
                    </td>
                    <td>
                      <span className="ind">
                        {r.industry.label} ({r.industry.benchmark_etf})
                      </span>
                    </td>
                    <td>
                      <span className="ind">{r.lane || "—"}</span>
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
              Showing {data.meta.shown} names, capped by this plan. Raise your
              plan to see the full board.
            </p>
          )}
        </>
      )}
    </div>
  );
}