"""Seed index, sector-ETF and macro benchmarks, then pull their history.

These give a stock something to be measured against. Sector ETFs are mapped
to the industries already in the database so a stock's move can be compared
with its own sector rather than only the broad market.

    python db/seed_benchmarks.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.db import get_conn  # noqa: E402

# (symbol, kind, label, industry_key_fragment_or_None, sort)
BENCHMARKS = [
    ("SPY",  "index",      "S&P 500", None, 10),
    ("QQQ",  "index",      "Nasdaq 100", None, 20),
    ("IWM",  "index",      "Russell 2000 (small cap)", None, 30),
    ("DIA",  "index",      "Dow Jones Industrial", None, 40),
    ("VTI",  "index",      "Total US Market", None, 50),

    ("XLK",  "sector_etf", "Technology", "tech", 100),
    ("XLV",  "sector_etf", "Health Care", "health", 110),
    ("XLE",  "sector_etf", "Energy", "energy", 120),
    ("XLF",  "sector_etf", "Financials", "financ", 130),
    ("XLI",  "sector_etf", "Industrials", "industr", 140),
    ("XLB",  "sector_etf", "Materials", "material", 150),
    ("XLU",  "sector_etf", "Utilities", "utilit", 160),
    ("XLP",  "sector_etf", "Consumer Staples", "staple", 170),
    ("XLY",  "sector_etf", "Consumer Discretionary", "discretion", 180),
    ("XLRE", "sector_etf", "Real Estate", "real", 190),
    ("XLC",  "sector_etf", "Communication Services", "commun", 200),

    ("ITA",  "etf",        "Aerospace & Defense", "defen", 300),
    ("URA",  "etf",        "Uranium", "uranium", 310),
    ("TAN",  "etf",        "Solar", "solar", 320),
    ("IBB",  "etf",        "Biotech", "bio", 330),
    ("SMH",  "etf",        "Semiconductors", "semi", 340),
    ("XOP",  "etf",        "Oil & Gas E&P", None, 350),
    ("JETS", "etf",        "Airlines", None, 360),
    ("ARKK", "etf",        "Disruptive Innovation", None, 370),

    ("^VIX", "macro",      "Volatility Index", None, 500),
    ("^TNX", "macro",      "US 10-Year Yield", None, 510),
    ("DX-Y.NYB", "macro",  "US Dollar Index", None, 520),
    ("GLD",  "macro",      "Gold", None, 530),
    ("USO",  "macro",      "Crude Oil", None, 540),
]


def seed():
    conn = get_conn()
    added = 0
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id, key, label FROM industries")
            industries = cur.fetchall()

            for symbol, kind, label, frag, order_ in BENCHMARKS:
                cur.execute(
                    "INSERT INTO tickers (symbol) VALUES (%s) "
                    "ON CONFLICT (symbol) DO NOTHING", (symbol,))
                cur.execute("SELECT id FROM tickers WHERE symbol=%s", (symbol,))
                ticker_id = cur.fetchone()[0]

                industry_id = None
                if frag:
                    for iid, key, ilabel in industries:
                        hay = f"{key} {ilabel}".lower()
                        if frag.lower() in hay:
                            industry_id = iid
                            break

                cur.execute(
                    "INSERT INTO reference_assets "
                    " (ticker_id, kind, label, industry_id, sort_order) "
                    "VALUES (%s,%s,%s,%s,%s) "
                    "ON CONFLICT (ticker_id) DO UPDATE SET "
                    " kind=EXCLUDED.kind, label=EXCLUDED.label, "
                    " industry_id=EXCLUDED.industry_id, sort_order=EXCLUDED.sort_order",
                    (ticker_id, kind, label, industry_id, order_))
                added += 1
        conn.commit()
    finally:
        conn.close()
    print(f"benchmarks seeded: {added}")
    return added


if __name__ == "__main__":
    seed()
