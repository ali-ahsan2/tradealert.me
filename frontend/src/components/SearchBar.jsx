import React, { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { navigate } from "../lib/router.jsx";
import { score as fmtScore } from "../lib/fmt.js";

// Searches only the visible universe. Zero results is a legitimate answer
// and must look identical whether a name is hidden or does not exist.
export default function SearchBar({ onPick, placeholder = "Search symbol or theme", autoFocus = false }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [searched, setSearched] = useState(false);
  const box = useRef(null);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (!q.trim()) {
        setResults([]);
        setSearched(false);
        return;
      }
      try {
        const d = await api(`/search?q=${encodeURIComponent(q)}`);
        setResults(d.results || []);
        setSearched(true);
        setOpen(true);
        setActive(-1);
      } catch {
        setResults([]);
        setSearched(true);
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

  const go = (r) => {
    setOpen(false);
    setQ("");
    if (onPick) onPick(r);
    else navigate(`/stock/${r.symbol}`);
  };

  const onKey = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(results.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      const r = results[active] || results[0];
      if (r) go(r);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="searchbar" ref={box}>
      <svg className="search-glyph" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <input
        aria-label="Search the universe"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        placeholder={placeholder}
        value={q}
        autoFocus={autoFocus}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        onKeyDown={onKey}
      />
      {open && searched && (
        <div className="dropdown" role="listbox">
          {results.length === 0 ? (
            <div className="dropdown-empty">No names match in your universe.</div>
          ) : (
            results.map((r, i) => (
              <button
                key={r.symbol}
                role="option"
                aria-selected={i === active}
                className={i === active ? "active" : ""}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(r)}
              >
                <span className="tick">{r.symbol}</span>
                <span className="theme">{r.theme}</span>
                <span className="mono muted">{fmtScore(r.value)}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
