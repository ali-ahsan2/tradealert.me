import React from "react";
import { Link, usePath } from "../lib/router.jsx";
import { ModeControl } from "./Shell.jsx";

// Explore (DESIGN_V6 §10): one tab strip over the existing Board, Find,
// Changes and Calendar pages. The strip only switches which page mounts;
// each page keeps its own query string and state. The Detail switch sits at
// the right of the row, where the table lives.
export const EXPLORE_TABS = [
  ["/board", "Ranked"],
  ["/screen", "Find"],
  ["/changes", "What changed"],
  ["/calendar", "Coming up"],
];

export function isExplore(pathname) {
  return EXPLORE_TABS.some(([to]) => pathname === to || pathname.startsWith(`${to}/`));
}

export default function ExploreTabs() {
  const here = usePath().split("?")[0];
  return (
    <div className="xtabs-wrap">
      <div className="xtabs" role="navigation" aria-label="Explore">
        {EXPLORE_TABS.map(([to, label]) => {
          const active = here === to || here.startsWith(`${to}/`);
          return (
            <Link key={to} to={to} className="xtab" aria-current={active ? "page" : undefined}>
              {label}
            </Link>
          );
        })}
        <span className="spacer" />
        <span className="xtabs-mode">
          <span className="xs faint">Detail</span>
          <ModeControl />
        </span>
      </div>
    </div>
  );
}
