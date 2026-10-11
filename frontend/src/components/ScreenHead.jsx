import React from "react";
import { wordCount } from "../lib/plain.js";
import "./screenhead.css";

// One line and one action at the top of every screen (DESIGN_V6 §7).
//
//   <ScreenHead title="My alerts" line="3 alerts sent to you this year." action={<button …>Alert me on a name</button>} secondary={…} />
//
// title     ≤ 4 words, first person where the thing is mine ("My alerts").
// line      one sentence of ≤ 14 words, built from the screen's own numbers.
//           It may be a string or a node; a string over the cap is warned
//           about in development so it cannot drift unnoticed.
// action    exactly one primary control: a request from me to the product
//           ("Alert me", "Show me…"). Omit it when the screen has none yet.
// secondary an optional quiet control or control group (a window switch,
//           "Mark all read"); never a second primary button.
// kicker    an optional small line above the title (a back link, a label).
export default function ScreenHead({ title, line, action = null, secondary = null, kicker = null, className = "", id }) {
  if (import.meta.env && import.meta.env.DEV) {
    if (typeof title === "string" && wordCount(title) > 4) console.warn(`ScreenHead title over four words: "${title}"`);
    if (typeof line === "string" && wordCount(line) > 14) console.warn(`ScreenHead line over fourteen words: "${line}"`);
  }
  return (
    <header className={`shead ${className}`.trim()} id={id}>
      <div className="shead-copy">
        {kicker && <div className="shead-kicker">{kicker}</div>}
        <h1 className="shead-title">{title}</h1>
        {line && <p className="shead-line">{line}</p>}
      </div>
      {(action || secondary) && (
        <div className="shead-acts">
          {action && <div className="shead-primary">{action}</div>}
          {secondary && <div className="shead-secondary">{secondary}</div>}
        </div>
      )}
    </header>
  );
}
