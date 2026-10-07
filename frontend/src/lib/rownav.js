import { useEffect, useState } from "react";

// j/k move a highlight through a list of rows, Enter opens the highlighted
// one, p pins it. Never fires while typing in a field or inside a dialog.
function typing(e) {
  const t = e.target;
  return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
}

export function useRowNav(count, { onOpen, onPin } = {}) {
  const [cursor, setCursor] = useState(-1);
  useEffect(() => setCursor(-1), [count]);
  useEffect(() => {
    const onKey = (e) => {
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector(".modal-backdrop")) return;
      if (e.key === "j" || e.key === "ArrowDown") {
        if (count === 0) return;
        e.preventDefault();
        setCursor((c) => Math.min(count - 1, c + 1));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        if (count === 0) return;
        e.preventDefault();
        setCursor((c) => Math.max(0, c - 1));
      } else if (e.key === "Enter" && cursor >= 0 && onOpen) {
        e.preventDefault();
        onOpen(cursor);
      } else if (e.key === "p" && cursor >= 0 && onPin) {
        e.preventDefault();
        onPin(cursor);
      } else if (e.key === "Escape") {
        setCursor(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [count, cursor, onOpen, onPin]);
  useEffect(() => {
    if (cursor < 0) return;
    const el = document.querySelector(`[data-rownav="${cursor}"]`);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
  }, [cursor]);
  return cursor;
}
