import React from "react";
import { Link } from "../lib/router.jsx";

// One name as a card (DESIGN_V6 §5): the symbol and where it sits, one
// sentence, one muted meta line in words, one action. The whole card opens
// the dossier; the action sits outside the link so a button never nests
// inside an anchor. Shared by the Board and Find in Simple mode.
//
//   <NameCard symbol="LEU" sub="Nuclear" to="/stock/LEU"
//             sentence="Up 6 since the last run, from neutral to strong."
//             meta="Strong · earnings in 12 days"
//             action={<NotifyButton symbol="LEU" compact />} />
export default function NameCard({ symbol, sub, sentence, meta, to, action, index, cursor = false, onOpen, className = "" }) {
  return (
    <li className={`bcard ${cursor ? "cursor" : ""} ${className}`} data-rownav={index}>
      <Link
        to={to}
        className="bcard-link"
        aria-label={`${symbol}: open the report`}
        onClick={(e) => {
          if (onOpen) {
            e.preventDefault();
            onOpen();
          }
        }}
      >
        <span className="bcard-head">
          <span className="sym">{symbol}</span>
          {sub && <span className="bcard-sub">{sub}</span>}
        </span>
        {sentence && <span className="bcard-sent">{sentence}</span>}
        {meta && <span className="bcard-meta">{meta}</span>}
      </Link>
      {action && (
        <span className="bcard-act" onClick={(e) => e.stopPropagation()}>
          {action}
        </span>
      )}
    </li>
  );
}

// "Show all 46" under a capped list, stating the count it hides.
export function ShowAll({ total, shown, open, onToggle, noun = "names" }) {
  if (total <= shown && !open) return null;
  return (
    <button type="button" className="btn btn-secondary showall" onClick={onToggle} aria-expanded={open}>
      {open ? `Show fewer ${noun}` : `Show all ${total}`}
    </button>
  );
}
