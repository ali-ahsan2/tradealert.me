import React, { useEffect, useState } from "react";
import { api, getToken } from "../api.js";
import { navigate } from "../main.jsx";
import ScoreBadge from "../components/ScoreBadge.jsx";

export default function Watchlist() {
  const [picks, setPicks] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    if (!getToken()) {
      setErr("Sign in to keep a watchlist.");
      setPicks([]);
      return;
    }
    setErr(null);
    api("/me/picks").then((d) => setPicks(d.picks)).catch((e) => { setErr(e.detail); setPicks([]); });
  };
  useEffect(load, []);

  const move = async (i, dir) => {
    setBusy(true);
    try {
      const syms = picks.map((p) => p.symbol);
      const j = i + dir;
      [syms[i], syms[j]] = [syms[j], syms[i]];
      const { order } = await api("/me/picks/order", { method: "PUT", json: { symbols: syms } });
      const bySym = Object.fromEntries(picks.map((p) => [p.symbol, p]));
      setPicks(order.map((s) => bySym[s]));
    } catch (e) {
      setErr(e.detail);
    } finally {
      setBusy(false);
    }
  };

  const unpin = async (sym) => {
    await api(`/me/picks/${encodeURIComponent(sym)}`, { method: "DELETE" }).catch(() => {});
    load();
  };

  if (err) return <div className="wrap"><div className="table-card empty"><p>{err}</p></div></div>;
  if (!picks) return <div className="wrap"><div className="table-card empty">Loading…</div></div>;

  return (
    <div className="wrap">
      <div className="pagehead">
        <h1>Watchlist</h1>
        <div className="meta">{picks.length} pinned</div>
      </div>
      {picks.length === 0 ? (
        <div className="table-card empty">
          <p>Nothing pinned yet. Pin tickers from the board or any stock page.</p>
          <p style={{ marginTop: "var(--s-3)" }}>
            <a className="btn btn-primary" href="/board"
               onClick={(e) => { e.preventDefault(); navigate("/board"); }}>
              Open the board
            </a>
          </p>
        </div>
      ) : (
        <div className="table-card">
          <table className="board">
            <thead>
              <tr>
                <th>#</th>
                <th>Move</th>
                <th>Ticker</th>
                <th>Theme</th>
                <th>Score at pin</th>
                <th>Current</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {picks.map((p, i) => (
                <tr key={p.symbol}>
                  <td className="rank">{i + 1}</td>
                  <td>
                    <button className="pin" disabled={busy || i === 0}
                            onClick={() => move(i, -1)}>↑</button>
                    <button className="pin" disabled={busy || i === picks.length - 1}
                            onClick={() => move(i, 1)}>↓</button>
                  </td>
                  <td>
                    <a className="sym ntf" href={`/stock/${p.symbol}`}
                       onClick={(e) => { e.preventDefault(); navigate(`/stock/${p.symbol}`); }}>
                      {p.symbol}
                    </a>
                  </td>
                  <td className="theme">{p.theme}</td>
                  <td className="numcell">{p.score_at_pin != null ? p.score_at_pin.toFixed(1) : "—"}</td>
                  <td>{p.band ? <ScoreBadge band={p.band} value={p.value} /> : "—"}</td>
                  <td>
                    <button className="btn btn-secondary" style={{ padding: "4px 10px", fontSize: "var(--fs-sm)" }}
                            onClick={() => unpin(p.symbol)}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}