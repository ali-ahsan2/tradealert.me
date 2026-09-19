import React, { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { navigate } from "../main.jsx";

export default function SearchBar({ width }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const box = useRef(null);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (!q.trim()) {
        setResults([]);
        return;
      }
      try {
        const d = await api(`/search?q=${encodeURIComponent(q)}`);
        setResults(d.results || []);
        setOpen(true);
      } catch {
        setResults([]);
      }
    }, 180);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const onClick = (e) => {
      if (box.current && !box.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const go = (sym) => {
    setOpen(false);
    setQ("");
    navigate(`/stock/${sym}`);
  };

  return (
    <div className="searchbar" style={{ position: "relative" }} ref={box}>
      <input
        aria-label="Search the universe"
        placeholder="Search symbol or theme…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && results[0]) go(results[0].symbol);
        }}
      />
      {open && results.length > 0 && (
        <div className="dropdown">
          {results.map((r) => (
            <button key={r.symbol} onClick={() => go(r.symbol)}>
              <span className="tick">{r.symbol}</span>
              <span className="theme">{r.theme}</span>
              <span className="mono" style={{ color: "var(--ink-muted)" }}>
                {r.value != null ? Math.round(r.value) : "—"}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}