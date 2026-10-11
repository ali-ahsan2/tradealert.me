"""Plain-words copy for strategies and industries (DESIGN_V6 §8).

Every strategy and industry gets the same card, written for a reader with
no market background and no appetite for the recipe. The shape is fixed:

    one_line   what it hunts, one sentence
    looks_for  three or four plain bullets, no numbers, no thresholds
    move       the shape and time frame of the move it tries to catch
    ignores    what it is not, so nobody reads it as a general ranking
    record     filled in by the API from measured data; the template below
               is only the sentence for a strategy with no measured record

Nothing here reveals a weight, a threshold or a filter value: those stay in
the Lab. Nothing here promises a return: a strategy scores a setup, never a
direction. The copy ships through /api/strategies and /api/industries as a
`plain` object and is rendered by the lens picker, the Strategies page, the
dossier's Why card and onboarding.
"""

NO_RECORD = "No measured record yet. Treat its names as candidates, not signals."

STRATEGIES = {
    "fast_mover": {
        "one_line": "Small, tightly held names that a crowd is betting against, "
                    "with a date coming that could force the crowd to move.",
        "looks_for": [
            "A small company with few shares available to trade",
            "Heavy short interest: many traders betting the price falls",
            "A dated event ahead: earnings, a decision, a filing",
            "Signs the shorts are crowded, such as a stock that is costly to borrow",
        ],
        "move": "A sharp move around the dated event, in either direction, over a few "
                "trading days. The strategy scores the setup, not the direction.",
        "ignores": "Large companies, names with no date on the calendar, and anything with "
                   "a fresh share-sale filing, which fails a must-pass rule outright.",
        "record_template": "{hits} of {n} events that cleared its must-pass rules moved 20% "
                           "or traded 3x their usual volume inside the test window. "
                           "That measures movement, not profit.",
    },
    "market_shift": {
        "one_line": "Names pulling ahead of their own sector, with the volume and "
                    "breadth to back it.",
        "looks_for": [
            "Price strength against the sector's benchmark fund",
            "A trend that has held for weeks, not days",
            "Volume rising with the price",
            "How sensitive the name is to interest rates",
        ],
        "move": "A trend that keeps going for weeks after the sector turns. Slower and "
                "steadier than a squeeze.",
        "ignores": "Single-day spikes, names that only move with the market, and anything "
                   "without a sector benchmark to compare against.",
        "record_template": NO_RECORD,
    },
    "geopolitics": {
        "one_line": "Companies whose fortunes turn on government budgets, trade policy "
                    "and where their supply chain sits.",
        "looks_for": [
            "Revenue that depends on governments and defence budgets",
            "A place in a supply chain that policy protects or threatens",
            "Policy events on the calendar: budgets, tariffs, sanctions, awards",
            "Exposure to regions that are in play",
        ],
        "move": "A re-rating around a policy event: an award, a budget line, a tariff. "
                "Often sudden, sometimes lasting.",
        "ignores": "Consumer names with no policy exposure, and headlines without a dated "
                   "event behind them.",
        "record_template": NO_RECORD,
    },
    "industry_restructure": {
        "one_line": "Names where the owners are moving: activists filing stakes, insiders "
                    "buying, deals in the air.",
        "looks_for": [
            "Activist investors filing their stake",
            "Insiders buying with their own money",
            "A balance sheet with net cash, which makes a deal easier",
            "Deal sizes typical for the industry",
        ],
        "move": "A step change when a deal or a campaign goes public. Weeks to months.",
        "ignores": "Insider selling as a signal, routine option exercises, and companies "
                   "too indebted to be bought.",
        "record_template": NO_RECORD,
    },
    "monetary_shifts": {
        "one_line": "Names most exposed to interest rates and the dollar, timed to the "
                    "central bank's calendar.",
        "looks_for": [
            "How much the stock moves when rates or the dollar move",
            "How long the company's cash lasts at its current burn",
            "Whether it will need to raise money soon",
            "Rate decisions and inflation prints on the calendar",
        ],
        "move": "Sharp moves on rate decisions and inflation prints, strongest in names "
                "that need cash.",
        "ignores": "Cash-rich names with little rate sensitivity, and stretches with "
                   "nothing on the central bank calendar.",
        "record_template": NO_RECORD,
    },
}

INDUSTRIES = {
    "semiconductors": {
        "why_it_moves": "Orders from data centers and phones swing fast; one customer's "
                        "budget can move a supplier's whole year.",
        "what_fires": "Volume spikes on earnings and guidance; dated events around "
                      "product cycles.",
    },
    "defense_space": {
        "why_it_moves": "Budgets, contract awards and launch dates set the calendar, and "
                        "awards arrive as filings.",
        "what_fires": "Contract awards; short interest crossing a line on names that "
                      "depend on a launch.",
    },
    "quantum_compute": {
        "why_it_moves": "Early-stage companies priced on milestones and funding rounds; "
                        "news moves them violently.",
        "what_fires": "Social surges and volume spikes; share-sale filings.",
    },
    "biotech_pharma": {
        "why_it_moves": "Trial readouts and regulator decision dates are yes-or-no events "
                        "with dates attached.",
        "what_fires": "Dated events; the cost to borrow doubling in the run-up to a "
                      "readout.",
    },
    "energy_nuclear": {
        "why_it_moves": "Fuel contracts, government awards and commodity prices move the "
                        "whole group together.",
        "what_fires": "Dated events and contract awards; short interest crossing a line.",
    },
    "battery_clean_energy": {
        "why_it_moves": "Subsidy rules, commodity prices and factory timelines drive the "
                        "group; policy news lands on dated events.",
        "what_fires": "Policy-dated events; volume spikes.",
    },
    "ai_software_data": {
        "why_it_moves": "Spending on AI compute is the story; a change of guidance "
                        "re-rates a name in a day.",
        "what_fires": "Volume at multiples of normal on guidance; social surges.",
    },
    "fintech_payments": {
        "why_it_moves": "Rates, credit quality and regulation set the tone; earnings carry "
                        "most of the news.",
        "what_fires": "Earnings on the calendar; insider buying after a sell-off.",
    },
    "consumer_ecom": {
        "why_it_moves": "Consumer demand and margins; the housing names move with rates.",
        "what_fires": "Earnings on the calendar; short interest crossing a line in retail.",
    },
    "media_adtech": {
        "why_it_moves": "Ad budgets and platform changes; heavily shorted names squeeze on "
                        "a surprise.",
        "what_fires": "Short interest crossing a line; the cost to borrow doubling; social "
                      "surges.",
    },
}


def strategy_plain(key, calibrated=False, hits=None, n=None):
    """The plain card for a strategy, with the record sentence filled from
    measured data. Unknown keys get a generic card rather than nothing."""
    base = STRATEGIES.get(key)
    if not base:
        return {
            "one_line": "A named recipe for what to look for in a stock.",
            "looks_for": [],
            "move": "",
            "ignores": "",
            "record": NO_RECORD,
        }
    if calibrated and hits is not None and n:
        record = base["record_template"].format(hits=hits, n=n)
    else:
        record = NO_RECORD
    return {
        "one_line": base["one_line"],
        "looks_for": list(base["looks_for"]),
        "move": base["move"],
        "ignores": base["ignores"],
        "record": record,
    }


def industry_plain(key):
    base = INDUSTRIES.get(key)
    if not base:
        return {"why_it_moves": "", "what_fires": ""}
    return dict(base)
