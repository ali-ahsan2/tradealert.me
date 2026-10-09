import React, { useEffect, useMemo, useRef, useState } from "react";
import { api, getToken } from "../api.js";
import { navigate } from "../lib/router.jsx";
import { score as fmtScore } from "../lib/fmt.js";

// ⌘K / Ctrl+K: one box that finds a name in the subscriber's universe or
// jumps to a screen. Opened by the shortcut, the nav button, or a
// "palette:open" event from anywhere.

const SCREENS = [
  { label: "Home · your brief", to: "/overview", hint: "g o" },
  { label: "Board", to: "/board", hint: "g b" },
  { label: "Find names", to: "/screen", hint: "g x" },
  { label: "Find · names that cleared every hard filter", to: "/screen?hf=pass" },
  { label: "Find · earnings within 14 days", to: "/screen?earnings_within=14&sort=earnings" },
  { label: "What changed since the last run", to: "/changes", hint: "g c" },
  { label: "Coming up · dated events", to: "/calendar", hint: "g l" },
  { label: "Watchlist", to: "/watchlist", hint: "g w" },
  { label: "Alerts", to: "/alerts", hint: "g a" },
  { label: "Alerts · the ones you have on", to: "/alerts?tab=armed" },
  { label: "How it works and glossary", to: "/help" },
  { label: "Strategies and evidence", to: "/strategies", hint: "g t" },
  { label: "Digests", to: "/digests", hint: "g d" },
  { label: "Compare names", to: "/compare" },
  { label: "Account", to: "/settings", hint: "g s" },
  { label: "Plans", to: "/pricing" },
];

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [active, setActive] = useState(0);
  const input = useRef(null);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("palette:open", onOpen);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("palette:open", onOpen);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQ("");
      setResults([]);
      setActive(0);
      setTimeout(() => input.current && input.current.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !q.trim() || !getToken()) {
      setResults([]);
      return undefined;
    }
    const t = setTimeout(() => {
      api(`/search?q=${encodeURIComponent(q.trim())}`)
        .then((d) => setResults(d.results || []))
        .catch(() => setResults([]));
    }, 150);
    return () => clearTimeout(t);
  }, [q, open]);

  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const screens = SCREENS.filter((s) => !needle || s.label.toLowerCase().includes(needle)).map((s) => ({
      kind: "screen",
      label: s.label,
      hint: s.hint,
      run: () => navigate(s.to),
    }));
    const names = results.map((r) => ({
      kind: "name",
      label: r.symbol,
      sub: r.theme,
      score: r.value,
      present: r.components_present,
      total: r.components_total,
      run: () => navigate(`/stock/${r.symbol}`),
    }));
    return [...names, ...screens];
  }, [q, results]);

  useEffect(() => setActive(0), [items.length]);

  if (!open) return null;

  const pick = (it) => {
    setOpen(false);
    it.run();
  };

  const onKey = (e) => {
    if (e.key === "Escape") setOpen(false);
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(items.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter" && items[active]) {
      pick(items[active]);
    }
  };

  return (
    <div className="modal-backdrop palette-backdrop" onMouseDown={() => setOpen(false)}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={input}
          className="palette-input"
          placeholder={getToken() ? "Find a name or jump to a screen…" : "Jump to a screen…"}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          aria-label="Search"
        />
        <ul className="palette-list" role="listbox">
          {items.length === 0 && <li className="palette-empty">No matches in your universe.</li>}
          {items.map((it, i) => (
            <li
              key={`${it.kind}-${it.label}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? "active" : ""}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(it)}
            >
              <span className={`pk ${it.kind}`}>{it.kind === "name" ? "name" : "go"}</span>
              <span className={it.kind === "name" ? "sym" : ""}>{it.label}</span>
              {it.sub && <span className="muted small palette-sub">{it.sub}</span>}
              <span className="spacer" />
              {it.kind === "name" && <span className="mono muted">{fmtScore(it.score, it.present, it.total)}</span>}
              {it.hint && <kbd className="kbd">{it.hint}</kbd>}
            </li>
          ))}
        </ul>
        <div className="palette-foot xs faint">
          <kbd className="kbd">↑↓</kbd> move · <kbd className="kbd">↵</kbd> open · <kbd className="kbd">esc</kbd> close ·{" "}
          <kbd className="kbd">?</kbd> all shortcuts
        </div>
      </div>
    </div>
  );
}
