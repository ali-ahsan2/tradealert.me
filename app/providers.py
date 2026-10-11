"""Daily bars from a licensed feed first, Yahoo's unofficial endpoint second.

Yahoo's chart endpoint is free, undocumented and rate-limited at will; a
product that promises to watch every morning cannot rest on it. With
TIINGO_TOKEN set, bars come from Tiingo's end-of-day API (licensed,
adjusted, documented) and Yahoo is the fallback for a symbol Tiingo lacks.
Without the token, Yahoo alone, as before. Each stored bar records which
source produced it.

Add another provider by writing fetch_<name>(symbol, start) returning the
same row shape and listing it in PROVIDERS.
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta

TIINGO_URL = "https://api.tiingo.com/tiingo/daily/{sym}/prices?startDate={start}&format=json&token={token}"
RANGE_DAYS = {"5d": 7, "1mo": 31, "3mo": 92, "6mo": 183, "1y": 366, "2y": 731, "5y": 1827, "max": 7300}


class ProviderError(Exception):
    pass


def tiingo_enabled():
    return bool(os.environ.get("TIINGO_TOKEN"))


def fetch_tiingo(symbol, rng="2y"):
    token = os.environ.get("TIINGO_TOKEN")
    if not token:
        raise ProviderError("TIINGO_TOKEN unset")
    start = (date.today() - timedelta(days=RANGE_DAYS.get(rng, 731))).isoformat()
    url = TIINGO_URL.format(sym=urllib.parse.quote(symbol.lower()), start=start, token=token)
    req = urllib.request.Request(url, headers={"User-Agent": "tradealert.me/1.0", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            payload = json.load(resp)
    except urllib.error.HTTPError as e:
        raise ProviderError(f"{symbol}: tiingo HTTP {e.code}") from e
    except (urllib.error.URLError, TimeoutError) as e:
        raise ProviderError(f"{symbol}: tiingo {e}") from e
    if not isinstance(payload, list) or not payload:
        raise ProviderError(f"{symbol}: tiingo empty")
    rows = []
    for b in payload:
        try:
            d = datetime.fromisoformat(b["date"].replace("Z", "+00:00")).date()
            o, h, lo, c = b["adjOpen"], b["adjHigh"], b["adjLow"], b["adjClose"]
            raw = b.get("close", c)
            v = int(b.get("adjVolume") or b.get("volume") or 0)
        except (KeyError, TypeError, ValueError):
            continue
        if not o or not c or o <= 0 or c <= 0:
            continue
        rows.append((d, round(o, 4), round(h, 4), round(lo, 4), round(c, 4), round(raw, 4), v))
    if not rows:
        raise ProviderError(f"{symbol}: tiingo no usable bars")
    return rows


def fetch_daily_bars(symbol, rng="2y"):
    """(rows, source). Licensed feed when configured, Yahoo otherwise or on
    a provider miss; the caller stores `source` on every bar."""
    from app.market_data import fetch_bars as fetch_yahoo
    if tiingo_enabled():
        try:
            return fetch_tiingo(symbol, rng), "tiingo"
        except ProviderError:
            pass
    return fetch_yahoo(symbol, rng), "yahoo"


def active_provider():
    return "tiingo (licensed), yahoo fallback" if tiingo_enabled() else "yahoo (unofficial, no licence)"
