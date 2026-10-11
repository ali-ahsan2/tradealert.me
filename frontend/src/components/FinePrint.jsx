import React from "react";
import { Link } from "../lib/router.jsx";
import { FINE_PRINT_LONG, FINE_PRINT_SHORT } from "../lib/legal.js";
import "./fineprint.css";

// The one fine-print component (DESIGN_V6 §6). `short` is a single line for
// footers and the space under a primary action; the default is the paragraph
// for legal pages, pricing and anywhere a decision is being invited.
// `links={false}` where a link would compete with the action beside it.
export default function FinePrint({ short = false, className = "", links = true }) {
  if (short) {
    return (
      <p className={`fineprint fineprint-short ${className}`.trim()}>
        {FINE_PRINT_SHORT}
        {links && (
          <>
            {" "}
            <Link to="/legal/disclaimer">Read the disclaimer</Link>.
          </>
        )}
      </p>
    );
  }
  return (
    <div className={`fineprint ${className}`.trim()}>
      <p>{FINE_PRINT_LONG}</p>
      {links && (
        <p>
          <Link to="/legal/terms">Terms</Link> · <Link to="/legal/privacy">Privacy</Link> ·{" "}
          <Link to="/legal/disclaimer">Disclaimer</Link>
        </p>
      )}
    </div>
  );
}
