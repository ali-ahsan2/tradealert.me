// Item caps (DESIGN_V6 §4, §7): how many items a list shows before "Show all
// N". The caps apply in Simple mode; Full mode keeps longer lists. The plan's
// own clamp (names_shown_limit) still happens server-side and is a different
// thing: these are attention caps, not entitlement.

export const HOME_ROWS = 3; // rows per Home section before "Show all"
export const LIST_CARDS = 10; // Board and Find cards before "Show all"
export const KNOWN_ROWS = 3; // dossier "What you'd have known" rows in Simple
export const KNOWN_ROWS_FULL = 6;
export const FIND_PRESETS = 3; // ready-made screens shown before "More ways to find"
export const WATCHLIST_FACTS = 5; // facts on a Full-mode watchlist card
