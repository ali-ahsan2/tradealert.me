import React from "react";

// One stroke set, 20x20, 1.6px. The active state fills the glyph's body
// where it has one (home, star, bell) so a bottom tab reads at a glance.
const PATHS = {
  home: "M3 9.5 10 3l7 6.5V17a1 1 0 0 1-1 1h-4v-5H8v5H4a1 1 0 0 1-1-1z",
  board: "M3 4h14v12H3zM3 9h14M8 9v7",
  screen: "M3 5h14M5.5 10h9M8 15h4",
  changes: "M4 14l4-4 3 3 5-6M12 7h4v4",
  calendar: "M4 5h12v12H4zM4 9h12M7 3v4M13 3v4",
  watchlist: "M10 2.5l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.8 7.8l5-.7z",
  alerts: "M5 13V9a5 5 0 0 1 10 0v4l1.5 2h-13zM8.5 17a1.5 1.5 0 0 0 3 0",
  search: "M9 3a6 6 0 1 1 0 12A6 6 0 0 1 9 3zm4.5 10.5L17 17",
  settings: "M10 7a3 3 0 1 1 0 6 3 3 0 0 1 0-6zm-6.5 3h2m9 0h2M10 3.5v2m0 9v2M5.4 5.4l1.4 1.4m6.4 6.4 1.4 1.4m0-9.2-1.4 1.4m-6.4 6.4-1.4 1.4",
  arrow: "M4 10h12M11 5l5 5-5 5",
  plus: "M10 4v12M4 10h12",
  check: "M4 10.5l4 4 8-9",
  spark: "M3 14l4-5 3 3 3-6 4 4",
};

export default function Icon({ name, size = 20, filled = false, className = "" }) {
  const d = PATHS[name] || PATHS.spark;
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" className={`icon ${className}`}>
      <path d={d} fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
