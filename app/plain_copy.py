"""Plain-words copy for strategies and industries (DESIGN_V6 §8).

Every strategy and industry gets the same card, written for a reader with
no market background and no appetite for the recipe. The shape is fixed:

    one_line   what it hunts, one sentence, fourteen words or fewer
    looks_for  three or four plain bullets, no numbers, no thresholds
    move       the shape and time frame of the move it tries to catch
    ignores    what it is not, so nobody reads it as a general ranking
    judgment   the disclosure that an operator's reading counts, where it does
    record     filled in by the API from measured data (see strategy_plain)
    status     measured | provisional | not_running

The copy is checked against the engine (db/seed_universe.py), not against
the brochure: names that fail a must-pass rule are flagged FAIL and still
rated, an undated name is scored down rather than dropped, a large company
is scored down rather than dropped, and a share-sale filing fires an alert
rather than disqualifying a name.

Nothing here reveals a weight, a threshold or a filter value: those stay in
the Lab. The only numbers are in the record sentences, which quote measured
counts (DESIGN_V5 §2 allows the record exactly as published). Nothing here
promises a return: a strategy scores a setup, never a direction. The copy
ships through /api/strategies and /api/industries as a `plain` object and is
rendered by the lens picker, the Strategies page, the dossier's Why card,
Help and onboarding.
"""
import logging

log = logging.getLogger("tradealert.plain")

NO_RECORD = "No measured record yet. Treat its names as candidates, not signals."
NOT_RUNNING = ("Not scoring yet. No names come from it today; this card says what it is "
               "built to look for.")
# the hit definition every record sentence rests on, in words
# (one way everywhere: the dossier, Strategies and lib/evidence.js say the same)
RECORD_DEFINITION = ("a 20% move, or three times normal volume, from two trading days "
                     "before the event to five after")
# a calibrated strategy whose numbers are not in reach: never "no record"
MEASURED_ELSEWHERE = "Measured on {resolved} past events; the numbers are on its page."
RECORD_MIN_OUTCOMES = 30

STRATEGIES = {
    "fast_mover": {
        "one_line": "Small, tightly held names a crowd is betting against, with a date coming.",
        "looks_for": [
            "Few shares available to trade, and costly to borrow",
            "Heavy short interest: many traders betting the price falls",
            "Revenue growing fast",
            "A dated event ahead: earnings, a decision, a filing",
        ],
        "judgment": "An operator's reading of the news and of company quality also counts.",
        "move": "A sharp move around the dated event over a few trading days; the test "
                "counts moves up. The strategy scores the setup, not the direction.",
        "ignores": "Large companies are scored down, not dropped. Names with no date are "
                   "scored down, not dropped. A fresh share-sale filing fires an alert.",
        "record_template": "{hits} of {n} backtest events that passed the test's filters "
                           "moved 20% or traded 3x their usual volume in the test window. "
                           "The test used six filters; four run today. That measures "
                           "movement, not profit.",
    },
    "market_shift": {
        "one_line": "Names pulling ahead of their own sector, with volume behind the move.",
        "looks_for": [
            "Price strength against the sector's benchmark fund",
            "A trend that has held for weeks, not days",
            "Volume rising with the price",
            "How sensitive the name is to interest rates",
        ],
        "move": "A trend that keeps going for weeks after the sector turns. Slower and "
                "steadier than an event-driven jump.",
        "ignores": "Single-day spikes, names that only move with the market, and anything "
                   "without a sector benchmark to compare against.",
    },
    "geopolitics": {
        "one_line": "Companies whose fortunes turn on government budgets, trade policy and "
                    "supply chains.",
        "looks_for": [
            "Revenue that depends on governments and defence budgets",
            "A place in a supply chain that policy protects or threatens",
            "Policy events on the calendar: budgets, tariffs, sanctions, awards",
            "Exposure to regions that are in play",
        ],
        "move": "A step around a policy event: an award, a budget line, a tariff. Often "
                "sudden, sometimes lasting.",
        "ignores": "Consumer names with no policy exposure, and headlines without a dated "
                   "event behind them.",
    },
    "industry_restructure": {
        "one_line": "Names where the owners are moving: activists, insiders buying, deals in "
                    "the air.",
        "looks_for": [
            "Activist investors filing their stake",
            "Insiders buying with their own money",
            "A balance sheet with net cash, which makes a deal easier",
            "Deal sizes typical for the industry",
        ],
        "move": "A step change when a deal or a campaign goes public. Weeks to months.",
        "ignores": "Insider selling as a signal, routine option exercises, and companies "
                   "too indebted to be bought.",
    },
    "monetary_shifts": {
        "one_line": "Names most exposed to rates and the dollar, timed to the central bank's "
                    "calendar.",
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
    },
}

# The industry card: what is in it and why it moves, one idea each, fourteen
# words or fewer. What tends to fire there is measured from alert_events by
# the API (the `month` object), never written here.
INDUSTRIES = {
    "semiconductors": {
        "what_is_in_it": "Chip makers, memory, optics and the equipment that feeds data centers.",
        "why_it_moves": "Data-center and phone orders swing fast and move whole supply chains.",
    },
    "defense_space": {
        "what_is_in_it": "Defense electronics, munitions, drones, satellites and space "
                         "infrastructure.",
        "why_it_moves": "Budgets, contract awards and launch dates set the calendar.",
    },
    "quantum_compute": {
        "what_is_in_it": "Quantum hardware and software, and other early computing companies.",
        "why_it_moves": "Early-stage companies are priced on milestones and funding rounds.",
    },
    "biotech_pharma": {
        "what_is_in_it": "Drug developers, gene editing, dated regulator decisions and medical "
                         "devices.",
        "why_it_moves": "Trial readouts and regulator decisions are yes-or-no events with dates.",
    },
    "energy_nuclear": {
        "what_is_in_it": "Uranium and fuel enrichment, nuclear components, rare earths and "
                         "critical minerals.",
        "why_it_moves": "Fuel contracts, government awards and commodity prices move the group "
                        "together.",
    },
    "battery_clean_energy": {
        "what_is_in_it": "Energy storage, battery chemistry, solar and the grid.",
        "why_it_moves": "Subsidy rules, commodity prices and factory timelines drive the group.",
    },
    "ai_software_data": {
        "what_is_in_it": "AI and analytics software, cloud infrastructure and data-center "
                         "compute.",
        "why_it_moves": "Spending on AI compute sets the tone; guidance carries the news.",
    },
    "fintech_payments": {
        "what_is_in_it": "Payments, digital banking and financial infrastructure in emerging "
                         "markets.",
        "why_it_moves": "Rates, credit quality and regulation set the tone.",
    },
    "consumer_ecom": {
        "what_is_in_it": "Online retail, homebuilders, specialty retail and consumer "
                         "discretionary names.",
        "why_it_moves": "Consumer demand, margins and rates set the tone.",
    },
    "media_adtech": {
        "what_is_in_it": "Social platforms, advertising technology, streaming and digital media.",
        "why_it_moves": "Ad budgets and platform rule changes set the tone.",
    },
}

_GENERIC = {
    "one_line": "A named way of looking for a setup in a stock.",
    "looks_for": [],
    "judgment": "",
    "move": "",
    "ignores": "",
}


def record_numbers(outcomes_hits, outcomes_n, record_hits, record_n):
    """The one resolution order for a strategy's measured record:
    calibration_outcomes once it holds enough rows, else the published
    record columns, else nothing. Returns {hits, n} or None. Never derived
    from backtest_events: real events carry no filter verdicts, so the raw
    rates there would silently replace the published figure."""
    if outcomes_n and outcomes_n >= RECORD_MIN_OUTCOMES and outcomes_hits is not None:
        return {"hits": int(outcomes_hits), "n": int(outcomes_n)}
    if record_n and record_hits is not None:
        return {"hits": int(record_hits), "n": int(record_n)}
    return None


def strategy_status(calibrated, scored=None):
    """measured | provisional | not_running. A strategy that put no score on
    the latest completed run is not running, whatever its paperwork says;
    scored=None means unknown and falls back to the calibration flag."""
    if scored is not None and int(scored) == 0:
        return "not_running"
    return "measured" if calibrated else "provisional"


def record_sentence(key, status, numbers, resolved=None):
    base = STRATEGIES.get(key) or {}
    if status == "not_running":
        return NOT_RUNNING
    if status == "measured":
        template = base.get("record_template")
        if numbers and template:
            return template.format(hits=numbers["hits"], n=numbers["n"])
        if numbers:
            return (f"{numbers['hits']} of {numbers['n']} measured events moved inside the "
                    "test window. That measures movement, not profit.")
        log.warning("strategy %s is calibrated but has no record numbers", key)
        return MEASURED_ELSEWHERE.format(resolved=int(resolved or 0))
    return NO_RECORD


def strategy_plain(key, calibrated=False, hits=None, n=None, scored=None, resolved=None,
                   record=None):
    """The plain card for a strategy with the record filled from measured
    data. `hits`/`n` are the resolved record numbers (see record_numbers);
    `scored` is how many names it scored on the latest completed run;
    `record` may carry a pre-resolved {hits, n}. Unknown keys get a generic
    card rather than nothing."""
    base = STRATEGIES.get(key) or _GENERIC
    numbers = record if record is not None else (
        {"hits": int(hits), "n": int(n)} if hits is not None and n else None)
    status = strategy_status(calibrated, scored)
    return {
        "one_line": base["one_line"],
        "looks_for": list(base.get("looks_for") or []),
        "judgment": base.get("judgment") or "",
        "move": base.get("move") or "",
        "ignores": base.get("ignores") or "",
        "record": record_sentence(key, status, numbers, resolved),
        "record_numbers": numbers if status == "measured" else None,
        "record_definition": RECORD_DEFINITION,
        "status": status,
    }


def strategy_brief(key, calibrated=False, hits=None, n=None, scored=None, resolved=None,
                   record=None):
    """{one_line, status, record}: the part of the card every payload that
    names a strategy carries (board, dossier lenses, screens)."""
    full = strategy_plain(key, calibrated, hits, n, scored, resolved, record)
    return {k: full[k] for k in ("one_line", "status", "record")}


def industry_plain(key):
    base = INDUSTRIES.get(key)
    if not base:
        return {"why_it_moves": "", "what_is_in_it": ""}
    return {"why_it_moves": base["why_it_moves"], "what_is_in_it": base["what_is_in_it"]}
