// The one body of evidence the product has, stated once. Source:
// test_results.md (Fast Mover backtest, run 2026-09-11). These figures are
// never restated more favourably than that document supports.
export const EVIDENCE = {
  hitRate: 81.2,
  hits: 26,
  events: 32,
  tickers: 8,
  earningsRate: 58.6,
  earningsHits: 112,
  earningsEvents: 191,
  randomRate: 36.6,
  randomHits: 85,
  randomEvents: 232,
  window: "2 trading days before the signal to 5 after it",
  hitDefinition: "a move of 20% or more, or volume at 3x its 20-day average",
  calibrationThreshold: 30,
};

export const GROUPS = [
  { key: "random", label: "Random trading days", sub: "no earnings within 6 days", hits: 85, n: 232, pct: 36.6 },
  { key: "earnings", label: "All earnings events", sub: "27 tickers, about two years", hits: 112, n: 191, pct: 58.6 },
  { key: "filtered", label: "Events that cleared the screen", sub: "8 tickers, 32 events", hits: 26, n: 32, pct: 81.2 },
];

export const TICKER_RECORD = [
  ["INOD", 8, 6],
  ["AEHR", 7, 7],
  ["BKSY", 5, 3],
  ["SEZL", 4, 4],
  ["TSSI", 3, 3],
  ["PDYN", 3, 1],
  ["DUOT", 1, 1],
  ["OUST", 1, 1],
];

// Calibrated strategies produce a "signal"; provisional ones a "candidate".
// One helper so the vocabulary flips everywhere on a calibration event.
export function nounFor(strategy) {
  return strategy && strategy.calibrated ? "signal" : "candidate";
}

// Trigger catalogue mirrors db/seed.sql so the arm form can describe each
// trigger without a round trip.
export const TRIGGERS = [
  ["borrow_fee_2x", "Borrow fee 2x+", "Borrow fee doubles or more versus its recent baseline."],
  ["si_cross", "Short interest crosses 10/15/20%", "A FINRA print moves the name across a 10%, 15%, or 20% threshold."],
  ["volume_3x", "Volume at 3x+", "Daily volume prints above 3x the 20-day average."],
  ["catalyst_dated", "Catalyst dated", "A dated catalyst (earnings, FDA action, contract) lands inside the look-ahead."],
  ["s3_424b", "S-3 or 424B filing", "A dilution-risk filing lands on EDGAR."],
  ["band_change", "Band change", "A score crosses a band boundary between runs."],
  ["insider_buying", "Insider buying", "A Form 4 cluster shows open-market buys after a period of sales."],
  ["social_surge", "Social surge", "20+ messages in 24 hours on the social feed."],
  ["contract_award", "Contract award", "A government or corporate contract award with a dollar figure."],
];

export const DILUTION_TRIGGERS = new Set(["s3_424b"]);

export const SNAPSHOT_LABELS = {
  px: ["Last price", (v) => (typeof v === "number" ? `$${v.toFixed(2)}` : v)],
  cap_usd_m: ["Market cap", (v) => (typeof v === "number" ? fmtCap(v) : v)],
  so_m: ["Shares outstanding", (v) => (typeof v === "number" ? `${v}M` : v)],
  run3m_pct: ["3-month move", (v) => (typeof v === "number" ? `${v > 0 ? "+" : ""}${v}%` : v)],
  off_high_pct: ["Off 52-week high", (v) => (typeof v === "number" ? `${v}%` : v)],
  volx20d: ["Volume vs 20-day", (v) => (typeof v === "number" ? `${v}x` : v)],
  day_pct: ["Day move", (v) => (typeof v === "number" ? `${v > 0 ? "+" : ""}${v}%` : v)],
  earnings: ["Next earnings", (v) => v],
  earnings_conf: ["Earnings date", (v) => String(v)],
  si_pct_float: ["Short interest", (v) => (typeof v === "number" ? `${v}% of float` : v)],
  si_shares_m: ["Shares short", (v) => (typeof v === "number" ? `${v}M` : v)],
  dtc: ["Days to cover", (v) => (typeof v === "number" ? `${v}d` : v)],
  float_m: ["Float", (v) => (typeof v === "number" ? `${v}M shares` : v)],
  fee_pct: ["Borrow fee", (v) => (typeof v === "number" ? `${v}%` : v)],
  borrow_avail: ["Shares to borrow", (v) => (typeof v === "number" ? v.toLocaleString() : v)],
  growth_pct: ["Revenue growth", (v) => (typeof v === "number" ? `${v > 0 ? "+" : ""}${v}% y/y` : v)],
  avgvol20: ["20-day avg volume", (v) => (typeof v === "number" ? v.toLocaleString() : v)],
  hi52: ["52-week high", (v) => (typeof v === "number" ? `$${v.toFixed(2)}` : v)],
  lo52: ["52-week low", (v) => (typeof v === "number" ? `$${v.toFixed(2)}` : v)],
};

// Order the dossier lists snapshot fields in: price and size first, then
// the short-side inputs, then momentum, then dates.
export const SNAPSHOT_ORDER = [
  "px", "day_pct", "cap_usd_m", "so_m", "float_m", "si_pct_float", "si_shares_m", "dtc",
  "fee_pct", "borrow_avail", "growth_pct", "run3m_pct", "off_high_pct", "hi52", "lo52",
  "volx20d", "avgvol20", "earnings", "earnings_conf",
];

// Short column labels for the screener and watchlist.
export const FIELD_SHORT = {
  cap_usd_m: "Cap", si_pct_float: "SI %", float_m: "Float", fee_pct: "Fee", volx20d: "Vol×20d",
  run3m_pct: "3m", off_high_pct: "Off high", dtc: "DTC", px: "Price", day_pct: "Day",
  growth_pct: "Growth",
};

function fmtCap(m) {
  return Math.abs(m) >= 1000 ? `$${(m / 1000).toFixed(1)}B` : `$${Math.round(m)}M`;
}

export const HARD_FILTER_FORMAT = {
  cap: (v) => (typeof v === "number" ? fmtCap(v) : String(v)),
  float: (v) => (typeof v === "number" ? `${v}M shares` : String(v)),
  si: (v) => (typeof v === "number" ? `${v}% of float` : String(v)),
  growth: (v) => (typeof v === "number" ? `${v > 0 ? "+" : ""}${v}% y/y` : String(v)),
};
