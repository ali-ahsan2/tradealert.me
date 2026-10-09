"""Capture the API responses the hosted preview serves, from a running
local server, as one JSON map keyed by "GET <path>".

    scripts/dev.sh --no-serve && python -m uvicorn app.main:app &    # a seeded server
    python scripts/capture_preview_fixtures.py frontend/preview/fixtures.json
    cd frontend && npx vite build --config vite.preview.config.js
    # then copy fixtures.json next to preview-dist/preview.html and serve that folder

Signs in as the dev fixture login (db/seed_dev.py) unless PREVIEW_EMAIL and
PREVIEW_PASSWORD are set. Captures only what the screens request: public
lists, the subscriber's own records, every board/changes/calendar/outcomes
variant, one wide screener pull the preview filters client-side, and the
dossier, fields and series of every name that appears on any of them."""
import json
import os
import sys
from urllib import error, request

BASE = os.environ.get("API_BASE", "http://127.0.0.1:8000/api")
EMAIL = os.environ.get("PREVIEW_EMAIL", "dev@example.com")
PASSWORD = os.environ.get("PREVIEW_PASSWORD", "devpass123")
OUT_PATH = sys.argv[1] if len(sys.argv) > 1 else "frontend/preview/fixtures.json"


def _call(method, path, body=None, token=None):
    headers = {"Accept": "application/json"}
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["content-type"] = "application/json"
    if token:
        headers["authorization"] = f"Bearer {token}"
    req = request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with request.urlopen(req, timeout=120) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else None)
    except error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"null")
        except ValueError:
            return e.code, None


def main():
    status, body = _call("POST", "/login", {"email": EMAIL, "password": PASSWORD})
    if status != 200:
        raise SystemExit(f"login failed ({status}); is the server up and the dev fixture loaded?")
    token = body["token"]
    out = {}

    def get(path):
        s, b = _call("GET", path, token=token)
        out[f"GET {path}"] = {"status": s, "body": b}
        return b

    for p in ("/strategies", "/industries", "/runs/latest", "/entitlements", "/me", "/me/picks",
              "/me/settings", "/me/industries", "/me/alerts/rules", "/me/alerts/unread", "/me/digests",
              "/me/digests/preview", "/me/watchlist/stats", "/me/watchlist/series?days=30",
              "/me/watchlist/series?days=90", "/me/watchlist/series?days=365", "/overview"):
        get(p)
    strategies = [s["key"] for s in out["GET /strategies"]["body"]["strategies"]]
    industries = [i["key"] for i in out["GET /industries"]["body"]["industries"]]
    for s in strategies:
        get(f"/strategies/{s}")
        get(f"/board?strategy={s}")
        for vs in ("prev", "7d", "30d", "90d"):
            get(f"/changes?strategy={s}&vs={vs}")
    for k in industries:
        get(f"/industries/{k}")
    for d in (14, 30, 60, 90):
        get(f"/calendar?days={d}")
    for d in (90, 365, 730):
        get(f"/alerts/outcomes?days={d}")
    for q in ("?days=365&limit=100", "?days=30&limit=100", "?days=90&limit=100", "?unread=1&days=365&limit=100"):
        get(f"/alert-events{q}")
    get("/screen?limit=200")

    syms = set()
    for s in strategies:
        syms.update(r["symbol"] for r in out[f"GET /board?strategy={s}"]["body"]["rows"])
    syms.update(r["symbol"] for r in out["GET /screen?limit=200"]["body"]["rows"])
    syms.update(p["symbol"] for p in out["GET /me/picks"]["body"]["picks"])
    for d in (14, 30, 60, 90):
        syms.update(r["symbol"] for r in out[f"GET /calendar?days={d}"]["body"]["upcoming"])
    ov = out["GET /overview"]["body"]
    for ind in ov["industries"]:
        syms.update(r["symbol"] for r in ind["top"])
    if ov.get("changes"):
        for k in ("band_up", "band_down", "new"):
            syms.update(r["symbol"] for r in ov["changes"][k])
    chg = out["GET /changes?strategy=fast_mover&vs=prev"]["body"]
    if chg.get("summary"):
        for k in ("band_up", "band_down", "new", "dropped", "up", "down", "cleared", "failed",
                  "coverage_up", "coverage_down"):
            syms.update(r["symbol"] for r in chg[k]["rows"])
    syms.update(e["symbol"] for e in out["GET /alert-events?days=365&limit=100"]["body"]["events"])
    for sym in sorted(syms):
        get(f"/stock/{sym}?strategy=fast_mover")
        get(f"/stock/{sym}/fields?strategy=fast_mover")
        series = get(f"/stock/{sym}/series?days=365")
        if isinstance(series, dict) and series.get("bars"):
            series["bars"] = series["bars"][-180:]
            if series.get("benchmark"):
                series["benchmark"]["bars"] = series["benchmark"]["bars"][-180:]
    picks = [p["symbol"] for p in out["GET /me/picks"]["body"]["picks"]][:3]
    for s in strategies:
        if s != "fast_mover":
            for sym in picks:
                get(f"/stock/{sym}?strategy={s}")
                get(f"/stock/{sym}/fields?strategy={s}")

    os.makedirs(os.path.dirname(OUT_PATH) or ".", exist_ok=True)
    with open(OUT_PATH, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"{len(out)} responses, {len(syms)} names -> {OUT_PATH} ({os.path.getsize(OUT_PATH) // 1024} KB)")


if __name__ == "__main__":
    main()
