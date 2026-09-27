"""Lab seed: strategy versions, score version backfill, fixture
backtest_events, and the three seed findings from test_results.md.

Run inside the app container after migrations:

    docker compose exec -T app python db/seed_lab.py

Idempotent. Version 1 is created once per strategy and never duplicated;
scores are backfilled only when strategy_version_id is still NULL; fixture
events are regenerated each run (they are explicitly synthetic and the Lab
renders the synthetic-data banner over them); seed findings are skipped if
their title already exists.

NOTE: the fixture events are synthetic. Their purpose is to make every Lab
screen and guardrail demonstrable in the sandbox. backtest_events carries
synthetic_data_used = TRUE so no result built on them can be attached to a
finding (STRATEGY_ANALYSIS_TOOL.md section 6.7). A real ingest path swaps
the fixtures in without changing anything downstream.
"""
import json
import sys
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.db import get_conn  # noqa: E402

# Snapshot of the ported engine's weights and hard filters the day version 1
# was recorded (db/seed_universe.py FZW/HARD_FILTERS). Deliberately vendored:
# a version record is a historical fact and must not track later engine edits.
FZW = {"float": 13, "si": 14, "dtc": 5, "fee": 4, "cap": 7, "growth": 12,
       "cat": 11, "mom": 9, "news": 9, "qual": 16}


def _admin_id(cur):
    cur.execute("SELECT id FROM users WHERE is_admin ORDER BY id LIMIT 1")
    row = cur.fetchone()
    if row:
        return row[0]
    cur.execute("SELECT id FROM users ORDER BY id LIMIT 1")
    return cur.fetchone()[0]


def _seed_version_one(cur, admin_id):
    """One version on record per strategy, created when the strategy was
    defined (spec 5.3's provisional empty state)."""
    cur.execute(
        "SELECT id, key, band_cutoffs_json FROM strategies ORDER BY id")
    for strat_id, key, cutoffs in cur.fetchall():
        if key == "fast_mover":
            weights = {k: float(w) for k, w in FZW.items()}
            hard_filters = [
                {"key": "cap", "label": "Market cap", "op": "between",
                 "value": [300000000, 3000000000], "unit": "USD"},
                {"key": "float", "label": "Float", "op": "<",
                 "value": 50000000, "unit": "shares"},
                {"key": "si", "label": "Short interest", "op": ">",
                 "value": 10, "unit": "% of float"},
                {"key": "growth", "label": "Revenue growth", "op": ">",
                 "value": 40, "unit": "% y/y"},
            ]
            change_reason = ("Created when the strategy was defined; the ported "
                             "workbench FZW weights and hard filters.")
        else:
            weights = {}
            hard_filters = []
            change_reason = "Created when the strategy was defined. Provisional: weights not backed by resolved outcomes."
        cur.execute(
            "INSERT INTO strategy_versions "
            "(strategy_id, version_number, band_cutoffs_json, component_weights_json, "
            " hard_filters_json, effective_from, effective_to, created_by_admin_id, change_reason) "
            "VALUES (%s, 1, %s, %s, %s, now(), NULL, %s, %s) "
            "ON CONFLICT (strategy_id, version_number) DO NOTHING",
            (strat_id, json.dumps(cutoffs), json.dumps(weights),
             json.dumps(hard_filters), admin_id, change_reason),
        )


def _backfill_lifecycle(cur, admin_id):
    """Bring the seeded versions into the section-10 lifecycle. fast_mover v1
    is live and points the live_version_id pointer; the provisional strategies
    keep their single version in tested state. Idempotent: state/live pointers
    are only ever set when a live pointer is absent, so a box that already ran
    the workflow is left alone."""
    cur.execute(
        "SELECT s.id, s.key, sv.id FROM strategies s "
        "JOIN LATERAL (SELECT id FROM strategy_versions sv "
        "               WHERE sv.strategy_id = s.id ORDER BY sv.version_number ASC "
        "               LIMIT 1) sv ON TRUE "
        "WHERE s.live_version_id IS NULL ORDER BY s.id")
    rows = cur.fetchall()
    for strat_id, key, v1_id in rows:
        if key == "fast_mover":
            cur.execute(
                "UPDATE strategy_versions SET state = 'live' WHERE id = %s", (v1_id,))
            cur.execute("UPDATE strategies SET live_version_id = %s WHERE id = %s",
                        (v1_id, strat_id))
        else:
            cur.execute(
                "UPDATE strategy_versions SET state = 'tested' WHERE id = %s", (v1_id,))


def _backfill_version_confidence(cur):
    cur.execute(
        "SELECT sv.id FROM strategy_versions sv "
        "JOIN strategies s ON s.id = sv.strategy_id "
        "WHERE s.key = 'fast_mover' AND sv.version_number = 1 LIMIT 1")
    row = cur.fetchone()
    if not row:
        return
    fm_v1 = row[0]
    # All existing scores predate version tracking: assign the earliest known
    # version and mark the assumption explicitly (BUILD_SPEC 8.1, spec 3).
    cur.execute(
        "UPDATE scores SET strategy_version_id = %s, version_confidence = 'assumed' "
        "WHERE strategy_version_id IS NULL",
        (fm_v1,),
    )


def _fixture_events(cur):
    cur.execute("DELETE FROM backtest_events WHERE synthetic_data_used = TRUE")
    cur.execute(
        "SELECT id FROM runs WHERE status = 'completed' ORDER BY as_of DESC LIMIT 1")
    run = cur.fetchone()
    if not run:
        return 0
    run_id = run[0]
    cur.execute(
        "SELECT s.instrument_id, r.as_of::date, s.value, s.band, "
        "s.components_present, s.components_total, s.hard_filter_json, s.component_json "
        "FROM scores s JOIN runs r ON r.id = s.run_id "
        "WHERE s.strategy_id = (SELECT id FROM strategies WHERE key = 'fast_mover') "
        "ORDER BY s.instrument_id, s.value DESC",
        (),
    )
    rows = cur.fetchall()
    n_events = 0
    for (instrument_id, date_, value, band, _subjects, _total,
         hf_json, comp_json) in rows:
        hf = hf_json or []
        digest = sha256(f"{instrument_id}:{date_}".encode()).hexdigest()
        roll = int(digest[:6], 16) / 0xFFFFFF
        if roll < 0.15:
            continue  # not every name has an event
        growth_value = next((h.get("value") for h in hf if h.get("key") == "growth"),
                            None)
        # The original score row only records filters whose snapshot key
        # matched, which is growth alone. Rebuild all four declared filters
        # from the same deterministic roll as the outcome so the Lab can
        # evaluate pass/fail against version rules (LAB_IMPLEMENTATION_PLAN,
        # fixture enrichment). Values are synthetic like everything here.
        raw = [
            ("cap", "Market cap", "between", [300000000, 3000000000], "USD",
             150_000_000 + roll * 4_500_000_000),
            ("float", "Float", "<", 50000000, "shares",
             10_000_000 + roll * 90_000_000),
            ("si", "Short interest", ">", 10, "% of float", round(roll * 30, 2)),
            ("growth", "Revenue growth", ">", 40, "% y/y",
             growth_value if growth_value is not None else round(30 + roll * 60, 2)),
        ]
        hf_enriched = []
        for key, label, op, threshold, unit, v in raw:
            if op == "between":
                ok = v >= threshold[0] and v <= threshold[1]
            elif op == ">":
                ok = v > threshold
            elif op == "<":
                ok = v < threshold
            else:
                ok = True
            hf_enriched.append({"key": key, "label": label, "value": v,
                                "pass": ok, "op": op, "unit": unit,
                                "threshold": threshold})
        hf = hf_enriched
        all_pass = all(h["pass"] for h in hf)
        max_move = round(min(4 + roll * 46 + (18 if all_pass else 0), 74), 2)
        vol_spike = round(1.5 + roll * 4.5 + (1.2 if all_pass else 0), 2)
        days_to_move = 1 + int(roll * 6) if (max_move >= 20.0 or vol_spike >= 3.0) else None
        inputs = {
            "hard_filters": hf,
            "components": comp_json or [],
            "score": float(value),
            "band": band,
        }
        provenance = {
            "source": "sandbox fixture (db/seed_lab.py)",
            "as_of": date_.isoformat(),
            "notes": "Synthetic. Not eligible to support a finding.",
        }
        cur.execute(
            "INSERT INTO backtest_events (instrument_id, event_date, event_kind, "
            " inputs_json, provenance_json, fwd_max_move_pct, fwd_close_move_pct, "
            " fwd_vol_spike_x, days_to_move, hit, resolved_at, data_complete, synthetic_data_used) "
            "VALUES (%s, %s, 'earnings', %s, %s, %s, %s, %s, %s, %s, now(), TRUE, TRUE)",
            (instrument_id, date_, json.dumps(inputs),
             json.dumps(provenance), max_move,
             round(max_move * (0.4 + roll * 0.5), 2), vol_spike, days_to_move,
             max_move >= 20.0 or vol_spike >= 3.0),
        )
        n_events += 1
    # random_day baseline events for instruments that have a real event,
    # days more than 6 away from any event date (test_results construction).
    cur.execute(
        "SELECT DISTINCT instrument_id FROM backtest_events "
        "WHERE event_kind = 'earnings' AND synthetic_data_used")
    instrs = [r[0] for r in cur.fetchall()]
    for instrument_id in instrs:
        cur.execute(
            "SELECT event_date FROM backtest_events "
            "WHERE instrument_id = %s AND event_kind = 'earnings'", (instrument_id,))
        dates = [r[0] for r in cur.fetchall()]
        step = sha256(f"rd:{instrument_id}".encode()).hexdigest()
        for i in range(3):
            off = int(step[:6], 16) % 40 + i * 9
            d = (datetime(2025, 9, 1, tzinfo=timezone.utc)
                 + timedelta(days=off + i * 47)).date()
            if any(abs((d - x).days) <= 6 for x in dates):
                continue
            digest = sha256(f"{instrument_id}:rd:{i}".encode()).hexdigest()
            roll = int(digest[:6], 16) / 0xFFFFFF
            max_move = round(2 + roll * 18, 2)
            vol_spike = round(1.1 + roll * 2.2, 2)
            cur.execute(
                "INSERT INTO backtest_events (instrument_id, event_date, event_kind, "
                " inputs_json, provenance_json, fwd_max_move_pct, fwd_close_move_pct, "
                " fwd_vol_spike_x, hit, resolved_at, data_complete, synthetic_data_used) "
                "VALUES (%s, %s, 'random_day', %s, %s, %s, %s, %s, %s, now(), TRUE, TRUE)",
                (instrument_id, d, "{}", '{"source": "sandbox fixture", "synthetic": true}',
                 max_move, round(max_move * 0.5, 2), vol_spike,
                 max_move >= 20.0 or vol_spike >= 3.0),
            )
            n_events += 1
    # a few intentionally incomplete rows so the lab's exclusions render
    cur.execute(
        "UPDATE backtest_events SET data_complete = FALSE "
        "WHERE synthetic_data_used AND id IN "
        "(SELECT id FROM backtest_events ORDER BY id LIMIT 3)")
    print(f"fixture events: {n_events}")
    return n_events


def _seed_findings(cur, admin_id):
    cur.execute(
        "SELECT sv.id FROM strategy_versions sv "
        "JOIN strategies s ON s.id = sv.strategy_id "
        "WHERE s.key = 'fast_mover' AND sv.version_number = 1")
    fm_v1 = cur.fetchone()[0]
    cur.execute("SELECT id FROM strategies WHERE key = 'fast_mover'")
    fm_id = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM lab_findings WHERE title = %s",
                ("Fast Mover hard filters mark higher-probability setups",))
    if cur.fetchone()[0]:
        return

    q = {"query_type": "backtest", "strategy_version_id": fm_v1, "admin": admin_id}
    queries = {
        "filter_pass": {
            "spec_json": {"seed_id": "fm_filter_pass", "strategy": "fast_mover",
                          "universe": {}, "kind": "earnings"},
            "result_json": {
                "groups": [{"label": "All hard filters passed", "n": 32,
                            "hits": 26, "hit_rate": 0.8125}],
                "baselines": [{"label": "All earnings events", "n": 191,
                               "hit_rate": 0.5864},
                              {"label": "Random trading days", "n": 232,
                               "hit_rate": 0.3664}]},
        },
        "score_vs_returns": {
            "spec_json": {"seed_id": "fm_score_returns", "strategy": "fast_mover"},
            "result_json": {"claim": "composite score showed r2 near zero vs forward returns"},
        },
        "beat_size": {
            "spec_json": {"seed_id": "fm_beat_size", "strategy": "fast_mover"},
            "result_json": {"groups": [{"label": "Large beat (>=20%)", "n": 80,
                                        "hits": 60, "hit_rate": 0.75},
                                       {"label": "Small beat", "n": 35,
                                        "hits": 16, "hit_rate": 0.457},
                                       {"label": "Miss", "n": 70,
                                        "hits": 33, "hit_rate": 0.471}]},
        },
    }
    qids = {}
    for name, body in queries.items():
        spec = body["spec_json"]
        spec_hash = sha256(json.dumps(spec, sort_keys=True).encode()).hexdigest()[:16]
        cur.execute(
            "INSERT INTO lab_queries (admin_user_id, strategy_id, strategy_version_id, "
            " query_type, spec_json, spec_hash, hypothesis, family_key, status, "
            " completed_at, result_json) "
            "VALUES (%s, %s, %s, 'backtest', %s, %s, %s, 'spec_seed', 'completed', now(), %s) "
            "RETURNING id",
            (admin_id, fm_id, fm_v1, json.dumps(spec), spec_hash,
             body["spec_json"].get("hypothesis", ""),
             json.dumps(body["result_json"])),
        )
        qids[name] = cur.fetchone()[0]

    seeds = [
        {"title": "Fast Mover hard filters mark higher-probability setups",
         "claim": ("Events where all six Fast Mover filters passed showed an 81.2% hit "
                   "rate (26/32) versus 58.6% for earnings events generally and 36.6% for "
                   "random days, across 8 distinct instruments, Sept 2024 to Sept 2026."),
         "status": "held_up", "grade": "moderate", "kind": "filter",
         "queries": [("filter_pass", "supports")],
         "notes": "Seed: imported from test_results.md at Lab build time. Grade is moderate, not strong: n=32 and one continuous two-year window with no replication on a disjoint period."},
        {"title": "The Fast Mover 25-point score does not predict return size",
         "claim": ("An invented 0-100 composite of the same inputs showed r\u00b2 near "
                   "zero against forward returns at all tested horizons."),
         "status": "failed", "grade": "strong", "kind": "component",
         "queries": [("score_vs_returns", "contradicts")],
         "notes": ("This test was run against a claim the platform does not make. Recorded "
                   "so the same test is not repeated as if it were news; the platform's claim "
                   "is about filters, not score magnitude.")},
        {"title": "A large earnings beat separates from a miss; a small beat does not",
         "claim": ("Large beats (20%+) hit 75.0% (n=80) versus 45.7% for small beats (n=35) "
                   "and 47.1% for misses (n=70)."),
         "status": "tested", "grade": "weak", "kind": "other",
         "queries": [("beat_size", "supports")],
         "notes": "Correlation only. Does not establish the short-covering mechanism the strategy describes."},
    ]
    for s in seeds:
        cur.execute(
            "INSERT INTO lab_findings (strategy_id, title, claim, status, evidence_grade, "
            " claim_kind, created_by_admin_id, notes) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
            (fm_id, s["title"], s["claim"], s["status"], s["grade"], s["kind"],
             admin_id, s["notes"]),
        )
        fid = cur.fetchone()[0]
        for (qname, relation) in s["queries"]:
            cur.execute(
                "INSERT INTO lab_finding_queries (finding_id, lab_query_id, relation) "
                "VALUES (%s, %s, %s)", (fid, qids[qname], relation))


def main():
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            admin_id = _admin_id(cur)
            _seed_version_one(cur, admin_id)
            _backfill_version_confidence(cur)
            _fixture_events(cur)
            _seed_findings(cur, admin_id)
        conn.commit()
        print("lab seed complete")
    finally:
        conn.close()


if __name__ == "__main__":
    main()