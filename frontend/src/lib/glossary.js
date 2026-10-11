// Plain-language definitions for every term the product uses on a subscriber
// screen. One source so the dossier, the board, the screener and the help
// page all explain a word the same way. Plain word first, technical word in
// brackets (DESIGN_V6 §7); nothing here softens the honesty rules in
// PRODUCT_DESIGN §2 or DESIGN_V5 §2: the definitions say what the engine
// does and does not know, and never quote a weight, a threshold or a cutoff.
//
// Each entry: { term, short, long?, see? }
//   term  — the heading: the plain phrase, then the engine's word in brackets
//   short — one sentence, what it means in the product
//   long  — two or three sentences for the help page and popovers

export const GLOSSARY = {
  score: {
    term: "Score",
    short: "A number from 0 to 100 saying how well a stock fits a strategy's setup this morning. Not a prediction, not a price target.",
    long: "Each strategy turns a handful of inputs (short interest, the cost to borrow, shares that trade, a dated event and so on) into one number. Higher means more of the setup is in place today. It says nothing about where the price goes next.",
    see: ["band", "coverage", "shrinkage"],
  },
  band: {
    term: "The rating word (band)",
    short: "The word next to a score: strong, elevated, neutral or weak. The word is the claim; the number is detail.",
    long: "Strong is the top of the strategy's range this morning, elevated is above its usual range, neutral is inside it, weak is below it. The words are never comparable across strategies.",
    see: ["score", "hard_filter"],
  },
  strong: { term: "Strong", short: "Near the top of the strategy's range this morning." },
  elevated: { term: "Elevated", short: "Above the strategy's usual range." },
  neutral: { term: "Neutral", short: "Inside the usual range. Nothing stands out." },
  weak: { term: "Weak", short: "Below the usual range." },
  excluded: {
    term: "Excluded",
    short: "A word reserved for a name the engine sets aside. A name that fails a must-pass rule is flagged FAIL and still rated, so you will rarely see it.",
  },
  coverage: {
    term: "How much data the score had (coverage)",
    short: "How many of a strategy's inputs actually had data this morning. Full, partial or thin.",
    long: "A score built from every input and a score built from three are different things wearing the same number. Coverage tells you which one you are looking at. Thin coverage adds a ~ to the number.",
    see: ["tilde", "shrinkage"],
  },
  tilde: {
    term: "The ~ mark",
    short: "A ~ before a score means thin data: fewer than half the inputs had data, so read it as approximate.",
  },
  shrinkage: {
    term: "Pulled toward neutral for missing data (shrinkage)",
    short: "When data is thin the score is moved part of the way toward neutral, so missing data cannot inflate a number.",
    long: "If only a few inputs had data, the raw score is moved toward the middle of the scale. The dossier always says when this happened: from what, to what, and how many inputs were missing.",
    see: ["coverage"],
  },
  hard_filter: {
    term: "Must-pass rule (hard filter)",
    short: "A yes/no check on a name, such as company size or short interest. A name that fails is flagged FAIL and still rated.",
    long: "Must-pass rules are the strategy's non-negotiables, and PASS or FAIL are the only two outcomes. A FAIL does not drop a name from the board; it is shown beside the score so you can discount it. The exact lines stay in the Lab.",
  },
  calibrated: {
    term: "Has a measured record (calibrated)",
    short: "Its setups were checked against what happened next, at least thirty times. Its names are called signals.",
    see: ["provisional", "signal"],
  },
  provisional: {
    term: "No measured record yet (provisional)",
    short: "Its setups have not yet been checked against what happened next often enough. Its names are candidates, not signals.",
    long: "A strategy with no measured record is scored the same way as one with a record, but we cannot yet say how often its setups played out. Until then the product calls what it produces a candidate.",
    see: ["calibrated", "candidate"],
  },
  signal: { term: "Signal", short: "What a strategy with a measured record produces: a name whose setup is in place, with a record behind the word." },
  candidate: { term: "Candidate", short: "What a strategy with no measured record produces: a name whose setup is in place, before the strategy has been checked against outcomes." },
  strategy: {
    term: "Strategy",
    short: "A named way of looking for a setup, such as Fast Mover. Each has a plain card: what it looks for, the move it tries to catch, what it ignores, its record.",
    see: ["fast_mover"],
  },
  fast_mover: {
    term: "Fast Mover",
    short: "The lead strategy and the only one with a measured record: small, tightly held names a crowd is betting against, with a date coming. In the backtest, 26 of the 32 events that passed its must-pass rules moved 20% or traded 3x volume.",
  },
  lane: {
    term: "A date set, or not yet (stage)",
    short: "No date set yet, or a date is set. With no date the engine assumes one further out, so the name is scored down, not dropped.",
    see: ["lane_early", "lane_event", "catalyst"],
  },
  lane_early: {
    term: "No date set yet (early)",
    short: "The setup is forming but no dated event is on the calendar yet; the event input is an assumption until a date is filed.",
  },
  lane_event: {
    term: "A date is set (event)",
    short: "A dated event such as earnings or a decision sits inside the strategy's look-ahead window.",
  },
  assumed: {
    term: "Assumed",
    short: "Estimated by the engine, not taken from a filing or a dated announcement. Shown so you know the input is a placeholder.",
  },
  judgment: {
    term: "An operator's reading (judgment input)",
    short: "A reading of the news or of company quality by a person, not a measured figure. It counts in the score and is marked so you can discount it.",
  },
  age: {
    term: "Age chip",
    short: "How long ago the figure beside it was recorded. Fresh is under 36 hours, ageing under four days, older than that is marked stale.",
  },
  group: {
    term: "Group",
    short: "A sub-theme inside an industry, used to sort the board so similar names sit together.",
  },
  delta_run: {
    term: "Change since the last scoring",
    short: "How much a score moved since the previous morning's scoring. A plus or minus number of points, or 'new' when the name was not rated before.",
  },
  run: {
    term: "This morning's scoring (run)",
    short: "One pass of the engine over every stock in your industries. It happens each morning, and every figure on screen is stamped with the morning it came from.",
  },
  catalyst: {
    term: "A dated event that can move the price (catalyst)",
    short: "Earnings, a regulator's decision, a contract decision, a lock-up expiry: something with a date attached.",
  },
  short_interest: {
    term: "Short interest",
    short: "The share of the float sold short: how much of a company's tradable stock traders have bet against, from the twice-monthly FINRA print.",
  },
  borrow_fee: {
    term: "The cost to borrow (borrow fee)",
    short: "The yearly rate short sellers pay to borrow shares. When the cost doubles, shares are getting hard to find.",
  },
  float: {
    term: "Shares that trade (float)",
    short: "The shares that actually change hands, after insiders and locked-up holders are taken out. Fewer shares trading means a smaller base for any burst of volume.",
  },
  days_to_cover: {
    term: "Days to cover",
    short: "How many days of normal volume it would take short sellers to buy back everything they owe. More days means a slower exit.",
  },
  volume_x: {
    term: "Volume vs normal",
    short: "Today's trading volume divided by the average of the last twenty days. 3x means three times a normal day.",
  },
  market_cap: {
    term: "Company size (market cap)",
    short: "The company's total value at today's price: shares outstanding times price.",
  },
  run3m: { term: "3-month move", short: "The price change over the last three months." },
  off_high: { term: "Below yearly high", short: "How far under its highest price of the past year the stock trades today." },
  haircut: {
    term: "Penalty (haircut)",
    short: "Points taken off a score for a red flag, such as a share-sale filing. Penalties are listed under the score whenever one applied.",
  },
  pin: {
    term: "Watch",
    short: "Add a name to your watchlist. Watched names appear in your weekly brief and stay visible even if they drop off the board.",
  },
  alert: {
    term: "Alert",
    short: "A message we send when something specific happens to a name you asked us to watch. Each alert names the fact that fired it.",
    see: ["trigger"],
  },
  trigger: {
    term: "Trigger",
    short: "The specific fact an alert waits for: the cost to borrow doubling, volume at three times normal, a dated event landing in range, and so on.",
  },
  digest: {
    term: "My week, by email (digest)",
    short: "The emailed summary of what changed in your industries and watchlist since the last one.",
  },
  benchmark: {
    term: "Benchmark",
    short: "The industry's sector fund, shown next to a stock so you can tell a name's move from the sector's.",
  },
  rebased: {
    term: "Rebased to 100",
    short: "Every line starts at 100 so you can compare movement. It shows relative change, not a balance.",
  },
  industry: {
    term: "Industry",
    short: "One of the sectors you follow. Your plan sets how many you can follow at once; the engine scores every stock inside them.",
  },
  universe: {
    term: "The names in your industries (universe)",
    short: "Every stock in the industries you follow plus your watched names. Find, Explore and search only ever look inside it.",
  },
  names_shown: {
    term: "Names shown",
    short: "Your plan sets how many names a list shows. Counts above that are totals, not more tickers.",
  },
  rate: {
    term: "Outcome rate",
    short: "Of the alerts that fired, the share that was followed by a 20% move or 3x volume within five trading days. Only shown once there are at least ten cases.",
  },
};

export function term(key) {
  return GLOSSARY[key] || null;
}

// Plain phrases for each alert trigger: what we will tell you, and why it
// matters. The second string finishes the sentence "We will tell you when…".
// [label, what it will tell you (present), what it told you (past)]
export const TRIGGER_PLAIN = {
  borrow_fee_2x: ["The cost to borrow doubles", "the cost to borrow shares doubles, a sign shares are getting hard to find", "the cost to borrow shares doubled, a sign shares are getting hard to find"],
  si_cross: ["Short interest crosses a line", "short interest crosses 10%, 15% or 20% of the float on a FINRA print", "short interest crossed 10%, 15% or 20% of the float on a FINRA print"],
  volume_3x: ["Unusual volume", "a day trades at three times its normal volume", "a day traded at three times its normal volume"],
  catalyst_dated: ["A dated event ahead", "a dated event such as earnings or a regulator's decision lands inside the next window", "a dated event such as earnings or a regulator's decision landed inside the next window"],
  s3_424b: ["A share-sale filing", "the company files to sell more shares (an S-3 or 424B)", "the company filed to sell more shares (an S-3 or 424B)"],
  band_change: ["The rating word changes", "the score moves to a different rating word between mornings", "the score moved to a different rating word between mornings"],
  insider_buying: ["Insiders buying", "insiders report open-market buys after a stretch of selling", "insiders reported open-market buys after a stretch of selling"],
  social_surge: ["Social chatter spikes", "the social feed prints 20 or more messages in a day", "the social feed printed 20 or more messages in a day"],
  contract_award: ["A contract award", "a government or corporate contract with a dollar figure is announced", "a government or corporate contract with a dollar figure was announced"],
};

// The three triggers a newcomer gets with one tap. Chosen because each is a
// hard fact with a clear date or print behind it.
export const DEFAULT_TRIGGERS = ["catalyst_dated", "borrow_fee_2x", "volume_3x"];

// The score's inputs in plain words, by component key. Replaces the engine's
// own labels ("size (scaled)", "momentum / coil") on every subscriber surface.
export const PLAIN_COMPONENT = {
  float: "few shares available to trade",
  si: "heavy short interest",
  dtc: "slow for short sellers to exit",
  fee: "costly to borrow",
  cap: "company size",
  growth: "revenue growth",
  cat: "a dated event ahead",
  mom: "recent price action",
  news: "the news (an operator's reading)",
  qual: "company quality (an operator's reading)",
};

export function plainComponent(key, fallback) {
  return PLAIN_COMPONENT[key] || fallback || key;
}

// Plain column and field labels for Simple mode. Keys match snapshot fields.
export const PLAIN_FIELD = {
  px: "Price",
  day_pct: "Today",
  cap_usd_m: "Company size",
  so_m: "Shares outstanding",
  float_m: "Shares that trade",
  si_pct_float: "Shorted",
  si_shares_m: "Shares short",
  dtc: "Days to cover",
  fee_pct: "Cost to borrow",
  borrow_avail: "Shares to borrow",
  growth_pct: "Revenue growth",
  run3m_pct: "3-month move",
  off_high_pct: "Below yearly high",
  hi52: "Yearly high",
  lo52: "Yearly low",
  volx20d: "Volume vs normal",
  avgvol20: "Normal volume",
  earnings: "Next earnings",
  earnings_conf: "Earnings date certainty",
};

// Which glossary entry explains a snapshot field.
export const FIELD_TERM = {
  cap_usd_m: "market_cap",
  float_m: "float",
  si_pct_float: "short_interest",
  fee_pct: "borrow_fee",
  dtc: "days_to_cover",
  volx20d: "volume_x",
  run3m_pct: "run3m",
  off_high_pct: "off_high",
  earnings: "catalyst",
};

// The status words for a strategy's plain.status.
export const STRATEGY_STATUS = {
  measured: { chip: "Measured record", title: "Its setups were checked against what happened next (calibrated)" },
  provisional: { chip: "No record yet", title: "Its setups have not been checked against what happened next (provisional)" },
  not_running: { chip: "Not running yet", title: "It puts no score on any name this morning" },
};
