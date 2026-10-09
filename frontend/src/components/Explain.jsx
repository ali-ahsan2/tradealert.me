import React, { useEffect, useId, useRef, useState } from "react";
import { Link } from "../lib/router.jsx";
import { GLOSSARY } from "../lib/glossary.js";

// An inline explainer. Wrap a term in <Explain term="coverage">coverage</Explain>
// and it gets a dotted underline and a tap-to-open card with the plain
// definition. Works on touch (no hover), closes on Escape, outside tap or
// scroll, and never blocks the thing it explains. Without children it
// renders a small "?" the way the old Help did, but readable on a phone.

export default function Explain({ term, text, title, children, className = "", side = "auto" }) {
  const g = term ? GLOSSARY[term] : null;
  const body = text || (g && (g.long || g.short));
  const heading = title || (g && g.term) || null;
  const [open, setOpen] = useState(false);
  const [align, setAlign] = useState("left");
  const box = useRef(null);
  const id = useId();

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (box.current && box.current.contains(e.target)) return;
      setOpen(false);
    };
    const key = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close, { passive: true });
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", () => setOpen(false), { once: true, passive: true });
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("touchstart", close);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  if (!body) return children || null;

  const toggle = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!open && box.current) {
      const r = box.current.getBoundingClientRect();
      const room = window.innerWidth - r.left;
      setAlign(side === "auto" ? (room < 320 ? "right" : "left") : side);
    }
    setOpen((v) => !v);
  };

  return (
    <span className={`xp ${className}`} ref={box} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className={children ? "xp-term" : "xp-q"}
        aria-expanded={open}
        aria-controls={id}
        aria-label={children ? undefined : `What is ${heading || "this"}?`}
        onClick={toggle}
      >
        {children || "?"}
      </button>
      {open && (
        <span className={`xp-pop xp-${align}`} id={id} role="note">
          {heading && <b className="xp-h">{heading}</b>}
          <span className="xp-b">{body}</span>
          {g && g.see && g.see.length > 0 && (
            <span className="xp-see">
              See also {g.see.map((k, i) => (GLOSSARY[k] ? <span key={k}>{i > 0 ? ", " : ""}<Term k={k} /></span> : null))}
            </span>
          )}
          {term && (
            <Link to={`/help#${term}`} className="xp-more" onClick={() => setOpen(false)}>
              More in the guide
            </Link>
          )}
        </span>
      )}
    </span>
  );
}

// The term's own name, explained. <Term k="shrinkage" /> → "Shrinkage" underlined.
export function Term({ k, children }) {
  const g = GLOSSARY[k];
  return (
    <Explain term={k}>{children || (g ? g.term.toLowerCase() : k)}</Explain>
  );
}
