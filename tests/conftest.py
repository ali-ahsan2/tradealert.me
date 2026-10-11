"""Suite-wide harness. The API rate-limits sign-up and log-in per client
address, and the whole suite comes from one machine, so every test presents
its own address (X-Forwarded-For, which only nginx sets in production: the
app port binds to localhost). Tests that set the header themselves keep it."""
import zlib


import pytest


@pytest.fixture(autouse=True)
def _per_test_forwarded_for(request, monkeypatch):
    h = zlib.crc32(request.node.nodeid.encode())
    addr = f"10.9.{(h >> 8) & 255}.{h & 255}"
    import urllib.request as ur
    orig = ur.urlopen

    def urlopen(req, *a, **kw):
        if isinstance(req, ur.Request) and not req.has_header("X-forwarded-for"):
            req.add_header("X-Forwarded-For", addr)
        return orig(req, *a, **kw)

    monkeypatch.setattr(ur, "urlopen", urlopen)
    yield
