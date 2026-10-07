import React, { useEffect, useState } from "react";
import { navigate } from "../lib/router.jsx";
import { getToken } from "../api.js";
import { Modal } from "./ui.jsx";

// Keyboard: "/" opens the palette, "?" opens this sheet, and "g" then a
// letter jumps between screens. Never fires while typing in a field.

const GO = { b: "/board", w: "/watchlist", a: "/alerts", s: "/settings", t: "/strategies", d: "/digests", p: "/pricing" };

const ROWS = [
  ["⌘K / Ctrl+K or /", "Find a name or jump to a screen"],
  ["g then b", "Board"],
  ["g then w", "Watchlist"],
  ["g then a", "Alerts"],
  ["g then t", "Strategies"],
  ["g then d", "Digests"],
  ["g then s", "Account"],
  ["?", "This sheet"],
  ["esc", "Close any dialog"],
];

function typing(e) {
  const t = e.target;
  return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
}

export default function Shortcuts() {
  const [help, setHelp] = useState(false);

  useEffect(() => {
    let pendingG = 0;
    const onKey = (e) => {
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "?") {
        e.preventDefault();
        setHelp((h) => !h);
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        window.dispatchEvent(new Event("palette:open"));
        return;
      }
      if (e.key === "g") {
        pendingG = Date.now();
        return;
      }
      if (pendingG && Date.now() - pendingG < 1200 && GO[e.key]) {
        pendingG = 0;
        if (!getToken() && e.key !== "p") return;
        navigate(GO[e.key]);
        return;
      }
      pendingG = 0;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!help) return null;
  return (
    <Modal title="Keyboard shortcuts" onClose={() => setHelp(false)}>
      <table className="shortcuts">
        <tbody>
          {ROWS.map(([k, what]) => (
            <tr key={k}>
              <td>
                <kbd className="kbd">{k}</kbd>
              </td>
              <td>{what}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
