"""Write the operator's research inputs for the workbench names, and nothing else.

The engine (app/engine.py) reads narrative heat, quality factors, haircuts,
pre-revenue and pre-flags from `instrument_research` beside the market data.
They come from the operator's workbench (db/_workbench_meta.json). Without
them a name scores on market data alone and a haircut for dilution or
going-concern risk disappears, so load them before turning the engine on.

Unlike db/seed_universe.py this touches no run, score or instrument: safe on
a production database whose seeded run subscribers are reading.

    python db/seed_research.py            # upsert, then print counts
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db import get_conn  # noqa: E402

META = Path(__file__).resolve().parent / "_workbench_meta.json"


def research_row(meta, r):
    """The research values for one SHORTLIST row of the workbench meta."""
    t = r["ticker"]
    ql = meta["QUAL"].get(t)
    hc = meta["HAIRCUTS"].get(t)
    gr_row = meta["GROWTH"].get(t)
    heat_v = r.get("heat")
    if heat_v is None:
        for pat, v in meta["HEAT_RULES"]:
            if re.search(pat, r.get("theme", ""), re.I):
                heat_v = v
                break
    return (heat_v,
            (sum(v[0] for v in ql.values()) / len(ql)) if ql else None,
            f"{len(ql)} of 5 known" if ql else "",
            hc[0] if hc else 0, hc[1] if hc else "",
            t in set(meta["PREREV"]), json.dumps(r.get("preFlags") or []),
            gr_row[0] if gr_row else None)


def upsert(cur, instrument_id, values):
    cur.execute("""
        INSERT INTO instrument_research (instrument_id, heat, qual, qual_note, haircut_points,
                                         haircut_note, prerev, pre_flags_json, growth_pct)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (instrument_id) DO UPDATE SET
          heat = EXCLUDED.heat, qual = EXCLUDED.qual, qual_note = EXCLUDED.qual_note,
          haircut_points = EXCLUDED.haircut_points, haircut_note = EXCLUDED.haircut_note,
          prerev = EXCLUDED.prerev, pre_flags_json = EXCLUDED.pre_flags_json,
          growth_pct = EXCLUDED.growth_pct, updated_at = now()
    """, (instrument_id, *values))


def main():
    meta = json.loads(META.read_text(encoding="utf-8"))
    conn = get_conn()
    conn.set_client_encoding("UTF8")
    written = missing = 0
    try:
        with conn.cursor() as cur:
            for r in meta["SHORTLIST"]:
                if not r.get("ticker"):
                    continue
                cur.execute("SELECT i.id FROM instruments i JOIN tickers t ON t.id = i.ticker_id "
                            "WHERE t.symbol = %s AND i.origin = 'workbench'", (r["ticker"],))
                ids = [row[0] for row in cur.fetchall()]
                if not ids:
                    missing += 1
                    continue
                values = research_row(meta, r)
                for iid in ids:
                    upsert(cur, iid, values)
                    written += 1
            cur.execute("SELECT COUNT(*), COUNT(*) FILTER (WHERE haircut_points > 0) FROM instrument_research")
            total, cuts = cur.fetchone()
        conn.commit()
    finally:
        conn.close()
    print(f"research rows written {written}; workbench tickers with no instrument {missing}; "
          f"table now {total} rows, {cuts} with a haircut")


if __name__ == "__main__":
    main()
