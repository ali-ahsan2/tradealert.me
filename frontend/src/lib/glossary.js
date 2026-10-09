// Plain-language definitions for every term the product uses on a subscriber
// screen. One source so the dossier, the board, the screener and the help
// page all explain a word the same way. Nothing here softens the honesty
// rules in PRODUCT_DESIGN §2: the definitions say what the engine does and
// does not know.
//
// Each entry: { term, short, long?, see? }
//   short — one sentence, what it means in the product
//   long  — two or three sentences for the help page and popovers

export const GLOSSARY = {
  score: {
    term: "Score",
    short: "A 0 to 100 number saying how well a stock fits a strategy's setup on this run. It is not a prediction or a price target.",
    long: "Each strategy turns a handful of inputs (short interest, borrow fee, float, catalyst timing and so on) into one number from 0 to 100. Higher means the setup the strategy looks for is more fully in place today. It says nothing about where the price goes next.",
    see: ["band", "coverage", "shrinkage"],
  },
  band: {
    term: "Band",
    short: "The word next to a score (strong, elevated, neutral, weak, excluded). The word is the claim; the number is detail.",
    long: "Bands group scores into plain words so you do not have to remember thresholds. Strong is the top of the strategy's range on this run, elevated is above its typical range, neutral is inside it, weak is below it, and excluded means a hard filter failed.",
    see: ["score", "hard_filter"],
  },
  strong: { term: "Strong", short: "Near the top of the strategy's range on this run." },
  elevated: { term: "Elevated", short: "Above the strategy's typical range." },
  neutral: { term: "Neutral", short: "Inside the typical range. Nothing stands out." },
  weak: { term: "Weak", short: "Below the typical range." },
  excluded: { term: "Excluded", short: "Failed a hard filter or carries a disqualifying haircut, so it is left out whatever its inputs say." },
  coverage: {
    term: "Coverage",
    short: "How many of a strategy's inputs actually had data on this run. Full, partial or thin.",
    long: "A score built from all ten inputs and a score built from three are different things wearing the same number. Coverage tells you which one you are looking at. Thin coverage adds a ~ to the number.",
    see: ["tilde", "shrinkage"],
  },
  tilde: {
    term: "The ~ mark",
    short: "A ~ before a score means thin coverage: fewer than half the inputs had data, so read it as approximate.",
  },
  shrinkage: {
    term: "Shrinkage",
    short: "When coverage is thin the engine pulls the score toward a neutral 40, so missing data cannot inflate a number.",
    long: "If only a few inputs had data, the raw score is moved part of the way toward 40. The dossier always states this when it happened: from what, to what, and how many inputs were missing.",
    see: ["coverage"],
  },
  hard_filter: {
    term: "Hard filter",
    short: "A pass or fail rule a stock must clear before it is scored at all, such as a market-cap ceiling or a minimum short interest.",
    long: "Hard filters are the strategy's non-negotiables. A name that fails one is marked excluded no matter how its other inputs look. PASS and FAIL are the only two outcomes, and they are the only place the product uses red and green outside price moves.",
  },
  calibrated: {
    term: "Calibrated",
    short: "A strategy whose weights are backed by at least 30 resolved outcomes. Its output is called a signal.",
    see: ["provisional", "signal"],
  },
  provisional: {
    term: "Provisional",
    short: "A strategy whose weights are not yet backed by enough resolved outcomes. Its output is called a candidate, not a signal.",
    long: "Provisional strategies run the same way as calibrated ones, but we do not yet have enough resolved cases to say how often their setups played out. Until then the product calls what they produce a candidate.",
    see: ["calibrated", "candidate"],
  },
  signal: { term: "Signal", short: "What a calibrated strategy produces: a name whose setup is in place, with a measured track record behind the word." },
  candidate: { term: "Candidate", short: "What a provisional strategy produces: a name whose setup is in place, before the strategy has a measured record." },
  strategy: {
    term: "Strategy",
    short: "A named recipe for what to look for, such as Fast Mover. Each one scores every stock in your industries on every run.",
    see: ["fast_mover"],
  },
  fast_mover: {
    term: "Fast Mover",
    short: "The lead strategy: small, tightly held names with heavy short interest and a dated catalyst, the setup that has moved 20% or traded 3x volume most often in the record.",
  },
  lane: {
    term: "Lane",
    short: "A strategy's grouping of names by how far along the setup is. The lanes are listed in the strategy's own words on its page.",
  },
  group: {
    term: "Group",
    short: "A sub-theme inside an industry, used to sort the board so similar names sit together.",
  },
  delta_run: {
    term: "Δ run",
    short: "How much a score moved since the previous run. A plus or minus number of points, or 'new' when the name was not scored before.",
  },
  run: {
    term: "Run",
    short: "One pass of the engine over every stock in your industries. Runs happen each trading morning, and every figure on screen is stamped with the run it came from.",
  },
  catalyst: {
    term: "Catalyst",
    short: "A dated event that can move a stock: earnings, an FDA decision, a contract decision, a lock-up expiry.",
  },
  short_interest: {
    term: "Short interest",
    short: "The share of a company's tradable shares that traders have sold short, from the twice-monthly FINRA print. High short interest can mean a crowded bet against the name.",
  },
  borrow_fee: {
    term: "Borrow fee",
    short: "The yearly rate short sellers pay to borrow shares. A rising fee means shares are getting hard to find.",
  },
  float: {
    term: "Float",
    short: "The number of shares that actually trade, after insiders and locked-up holders are taken out. A small float moves on less volume.",
  },
  days_to_cover: {
    term: "Days to cover",
    short: "How many days of average volume it would take short sellers to buy back everything they owe. More days means a slower exit.",
  },
  volume_x: {
    term: "Volume vs 20-day",
    short: "Today's trading volume divided by the 20-day average. 3x means three times a normal day.",
  },
  market_cap: {
    term: "Market cap",
    short: "The company's total value at today's price: shares outstanding times price.",
  },
  run3m: { term: "3-month move", short: "The price change over the last three months." },
  off_high: { term: "Off 52-week high", short: "How far below its highest price of the past year the stock trades today." },
  haircut: {
    term: "Haircut",
    short: "Points taken off a score for a red flag, such as a dilution filing. Haircuts are listed under the score whenever one applied.",
  },
  pin: {
    term: "Pin",
    short: "Add a name to your watchlist. Pinned names appear in your digest and stay visible even if they drop off the board.",
  },
  alert: {
    term: "Alert",
    short: "A message we send when something specific happens to a name you asked us to watch. Each alert names the fact that fired it.",
    see: ["trigger"],
  },
  trigger: {
    term: "Trigger",
    short: "The specific fact an alert waits for: a borrow fee doubling, volume at 3x, a catalyst date landing in range, and so on.",
  },
  digest: {
    term: "Digest",
    short: "The emailed summary of what changed in your industries and watchlist since the last one.",
  },
  benchmark: {
    term: "Benchmark",
    short: "The industry's sector ETF, shown next to a stock so you can tell a name's move from the sector's.",
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
    term: "Your universe",
    short: "Every stock in the industries you follow plus your pinned names. Screens, boards and search only ever look inside it.",
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
export const TRIGGER_PLAIN = {
  borrow_fee_2x: ["Borrow fee doubles", "the cost to borrow shares doubles, a sign shares are getting hard to find"],
  si_cross: ["Short interest crosses a line", "short interest crosses 10%, 15% or 20% of the float on a FINRA print"],
  volume_3x: ["Unusual volume", "a day trades at three times its normal volume"],
  catalyst_dated: ["Catalyst coming up", "a dated event such as earnings or an FDA decision lands inside the next window"],
  s3_424b: ["Dilution filing", "the company files to sell more shares (an S-3 or 424B)"],
  band_change: ["Score changes band", "the score moves into a different band between runs"],
  insider_buying: ["Insiders buying", "insiders report open-market buys after a stretch of selling"],
  social_surge: ["Social chatter spikes", "the social feed prints 20 or more messages in a day"],
  contract_award: ["Contract award", "a government or corporate contract with a dollar figure is announced"],
};

// The three triggers a newcomer gets with one tap. Chosen because each is a
// hard fact with a clear date or print behind it.
export const DEFAULT_TRIGGERS = ["catalyst_dated", "borrow_fee_2x", "volume_3x"];

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
