// A fetch that answers /api requests from fixtures captured off a running
// server, so the real app runs unchanged inside a hosted page. Reads come
// from the capture; writes (pin, note, arm, mark read, settings) update the
// in-memory copy so the screens respond, and nothing leaves the page.

const FIX_URL = "./fixtures.json";
const TOKEN = "preview-session";
let FIX = {};
const BANDS = { strong: 4, elevated: 3, neutral: 2, weak: 1, excluded: 0 };

function key(path) {
  return `GET ${path}`;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function notFound() {
  return json({ detail: "not found" }, 404);
}

function hit(path) {
  const k = key(path);
  return FIX[k] ? FIX[k].body : undefined;
}

function params(path) {
  return new URLSearchParams(path.split("?")[1] || "");
}

function base(path) {
  return path.split("?")[0];
}

// --- screener: filter the one wide capture client-side ------------------
function coverageState(p, t) {
  if (p == null || !t || p >= t) return "full";
  if (p >= Math.ceil(t / 2)) return "partial";
  return "thin";
}

function screen(path) {
  const q = params(path);
  const wide = hit("/screen?limit=200");
  if (!wide) return notFound();
  const strategy = q.get("strategy") || "fast_mover";
  if (strategy !== "fast_mover") {
    const strat = (hit("/strategies") || { strategies: [] }).strategies.find((s) => s.key === strategy);
    if (!strat) return notFound();
    return json({ ...wide, strategy: strat, rows: [], facets: { band: {}, industry: {}, hf: { pass: 0, fail: 0, none: 0 }, coverage: { full: 0, partial: 0, thin: 0 }, lane: {}, group: {} }, meta: { ...wide.meta, matched: 0, shown: 0, truncated: false, sort: q.get("sort") || "score", dir: q.get("dir") || "desc" } });
  }
  const picks = new Set((hit("/me/picks") || { picks: [] }).picks.map((p) => p.symbol));
  let rows = wide.rows.map((r) => ({ ...r, pinned: picks.has(r.symbol) }));
  const num = (k) => (q.get(k) == null || q.get(k) === "" ? null : Number(q.get(k)));
  const bands = (q.get("bands") || "").split(",").filter((b) => b in BANDS);
  if (bands.length) rows = rows.filter((r) => bands.includes(r.band));
  if (num("min_score") != null) rows = rows.filter((r) => r.value >= num("min_score"));
  if (num("max_score") != null) rows = rows.filter((r) => r.value <= num("max_score"));
  if (q.get("coverage")) rows = rows.filter((r) => coverageState(r.components_present, r.components_total) === q.get("coverage"));
  if (q.get("hf") === "pass") rows = rows.filter((r) => r.hf_pass === true);
  if (q.get("hf") === "fail") rows = rows.filter((r) => r.hf_pass === false);
  const inds = (q.get("industries") || "").split(",").filter(Boolean);
  if (inds.length) rows = rows.filter((r) => inds.includes(r.industry.key));
  if (q.get("lane")) rows = rows.filter((r) => (r.lane || "") === q.get("lane"));
  if (q.get("group")) rows = rows.filter((r) => (r.group || "") === q.get("group"));
  if (q.get("q")) {
    const needle = q.get("q").toLowerCase();
    rows = rows.filter((r) => [r.symbol, r.theme, r.industry.label].some((s) => (s || "").toLowerCase().includes(needle)));
  }
  if (q.get("new") === "1") rows = rows.filter((r) => r.delta_1d == null);
  if (num("min_delta") != null) rows = rows.filter((r) => r.delta_1d != null && r.delta_1d >= num("min_delta"));
  if (num("max_delta") != null) rows = rows.filter((r) => r.delta_1d != null && r.delta_1d <= num("max_delta"));
  const sn = (r, k) => r.snapshot[k];
  const ge = (k, f) => num(k) != null && (rows = rows.filter((r) => sn(r, f) != null && sn(r, f) >= num(k)));
  const le = (k, f) => num(k) != null && (rows = rows.filter((r) => sn(r, f) != null && sn(r, f) <= num(k)));
  ge("cap_min", "cap_usd_m"); le("cap_max", "cap_usd_m"); ge("si_min", "si_pct_float"); le("si_max", "si_pct_float");
  le("float_max", "float_m"); ge("fee_min", "fee_pct"); ge("volx_min", "volx20d"); ge("run3m_min", "run3m_pct"); le("run3m_max", "run3m_pct");
  if (num("offhigh_max") != null) rows = rows.filter((r) => sn(r, "off_high_pct") != null && Math.abs(sn(r, "off_high_pct")) <= num("offhigh_max"));
  if (num("earnings_within") != null) rows = rows.filter((r) => r.earnings && r.earnings.days >= 0 && r.earnings.days <= num("earnings_within"));
  if (q.get("pinned") === "1") rows = rows.filter((r) => r.pinned);
  const facets = { band: {}, industry: {}, hf: { pass: 0, fail: 0, none: 0 }, coverage: { full: 0, partial: 0, thin: 0 }, lane: {}, group: {} };
  rows.forEach((r) => {
    facets.band[r.band] = (facets.band[r.band] || 0) + 1;
    facets.industry[r.industry.key] = facets.industry[r.industry.key] || { label: r.industry.label, n: 0 };
    facets.industry[r.industry.key].n += 1;
    facets.hf[r.hf_pass === true ? "pass" : r.hf_pass === false ? "fail" : "none"] += 1;
    facets.coverage[coverageState(r.components_present, r.components_total)] += 1;
    if (r.lane) facets.lane[r.lane] = (facets.lane[r.lane] || 0) + 1;
    if (r.group) facets.group[r.group] = (facets.group[r.group] || 0) + 1;
  });
  const sorts = {
    score: [(r) => r.value, "desc"], delta: [(r) => r.delta_1d, "desc"],
    coverage: [(r) => r.components_present / Math.max(1, r.components_total), "desc"],
    symbol: [(r) => r.symbol, "asc"], industry: [(r) => r.industry.label, "asc"],
    cap: [(r) => sn(r, "cap_usd_m"), "asc"], si: [(r) => sn(r, "si_pct_float"), "desc"], float: [(r) => sn(r, "float_m"), "asc"],
    fee: [(r) => sn(r, "fee_pct"), "desc"], volx: [(r) => sn(r, "volx20d"), "desc"], run3m: [(r) => sn(r, "run3m_pct"), "desc"],
    offhigh: [(r) => sn(r, "off_high_pct"), "desc"], earnings: [(r) => (r.earnings ? r.earnings.days : null), "asc"],
    chg30: [(r) => r.price.chg_30d, "desc"],
  };
  const [getter, def] = sorts[q.get("sort")] || sorts.score;
  const dir = ["asc", "desc"].includes(q.get("dir")) ? q.get("dir") : def;
  rows.sort((a, b) => {
    const x = getter(a), y = getter(b);
    if (x == null && y == null) return b.value - a.value;
    if (x == null) return 1;
    if (y == null) return -1;
    const c = typeof x === "string" ? x.localeCompare(y) : x - y;
    return (dir === "asc" ? c : -c) || b.value - a.value || a.symbol.localeCompare(b.symbol);
  });
  const K = wide.meta.names_shown_limit;
  const limit = Math.min(Number(q.get("limit") || 100), K);
  const shown = rows.slice(0, limit).map((r, i) => ({ ...r, rank: i + 1 }));
  return json({ ...wide, rows: shown, facets, meta: { ...wide.meta, matched: rows.length, shown: shown.length, truncated: rows.length > shown.length, sort: q.get("sort") || "score", dir } });
}

function search(path) {
  const q = (params(path).get("q") || "").trim().toLowerCase();
  if (!q) return json({ results: [] });
  const wide = hit("/screen?limit=200") || { rows: [] };
  const seen = new Set();
  const rows = wide.rows
    .filter((r) => r.symbol.toLowerCase().startsWith(q) || (r.theme || "").toLowerCase().includes(q) || r.industry.label.toLowerCase().includes(q))
    .filter((r) => !seen.has(r.symbol) && seen.add(r.symbol))
    .sort((a, b) => (b.symbol.toLowerCase() === q) - (a.symbol.toLowerCase() === q) || b.value - a.value)
    .slice(0, 12)
    .map((r) => ({ symbol: r.symbol, theme: r.theme, industry_key: r.industry.key, value: r.value, band: r.band }));
  return json({ results: rows });
}

// --- reads with fallbacks ------------------------------------------------
function read(path) {
  const b = base(path);
  const q = params(path);
  let body = hit(path);
  if (body !== undefined) return json(body);
  if (b === "/screen") return screen(path);
  if (b === "/search") return search(path);
  if (b === "/board") return json(hit(`/board?strategy=${q.get("strategy") || "fast_mover"}`) ?? notFound());
  if (b === "/changes") {
    body = hit(`/changes?strategy=${q.get("strategy") || "fast_mover"}&vs=${q.get("vs") || "prev"}`);
    return body !== undefined ? json(body) : notFound();
  }
  if (b === "/calendar") return json(hit(`/calendar?days=${q.get("days") || 60}`) ?? hit("/calendar?days=60"));
  if (b === "/alerts/outcomes") return json(hit(`/alerts/outcomes?days=${q.get("days") || 365}`) ?? hit("/alerts/outcomes?days=365"));
  if (b === "/alert-events") {
    const all = hit("/alert-events?days=365&limit=100") || { events: [] };
    const days = Number(q.get("days") || 365);
    const since = Date.now() - days * 864e5;
    let ev = all.events.filter((e) => new Date(e.fired_at).getTime() >= since);
    if (q.get("trigger")) ev = ev.filter((e) => e.trigger_key === q.get("trigger"));
    if (q.get("symbol")) ev = ev.filter((e) => e.symbol === q.get("symbol"));
    if (q.get("unread") === "1") ev = ev.filter((e) => e.read === false);
    return json({ events: ev.slice(0, Number(q.get("limit") || 100)) });
  }
  const stock = b.match(/^\/stock\/([^/]+)(\/fields|\/series)?$/);
  if (stock) {
    const sym = stock[1].toUpperCase();
    const strat = q.get("strategy") || "fast_mover";
    if (stock[2] === "/series") body = hit(`/stock/${sym}/series?days=365`);
    else if (stock[2] === "/fields") body = hit(`/stock/${sym}/fields?strategy=${strat}`) ?? (strat !== "fast_mover" ? hit(`/stock/${sym}/fields?strategy=fast_mover`) : undefined);
    else body = hit(`/stock/${sym}?strategy=${strat}`);
    if (body === undefined && stock[2] == null && strat !== "fast_mover") {
      // a lens that was not captured for this name: the dossier with that
      // lens's own score absent, which is also what the server returns
      // when a strategy has no run for the name
      const fm = hit(`/stock/${sym}?strategy=fast_mover`);
      const s = (hit("/strategies") || { strategies: [] }).strategies.find((x) => x.key === strat);
      if (fm && s) body = { ...fm, strategy: s, score: undefined, changes: null, history: [], peers: [] };
    }
    return body !== undefined ? json(body) : notFound();
  }
  if (b === "/billing/health") return json({ configured: false, dev: false });
  if (b === "/me/alerts/unread") return json({ count: 0 });
  return notFound();
}

// --- writes: keep the demo responsive without a server ------------------
function write(method, path, payload) {
  const b = base(path);
  const picks = hit("/me/picks");
  const wide = hit("/screen?limit=200");
  const rules = hit("/me/alerts/rules");
  if (method === "POST" && b === "/me/picks") {
    const sym = (payload.symbol || "").toUpperCase();
    const row = wide && wide.rows.find((r) => r.symbol === sym);
    if (!row) return notFound();
    if (!picks.picks.some((p) => p.symbol === sym)) {
      picks.picks.push({ id: Date.now(), symbol: sym, theme: row.theme, lane: row.lane, industry: row.industry, score_at_pin: row.value, pinned_at: new Date().toISOString(), value: row.value, band: row.band, delta_1d: row.delta_1d, note: "", components_present: row.components_present, components_total: row.components_total });
      const d = hit(`/stock/${sym}?strategy=fast_mover`);
      if (d) d.pinned = true;
    }
    return json({ pinned: true, symbol: sym });
  }
  const pick = b.match(/^\/me\/picks\/([^/]+)$/);
  if (pick && method === "DELETE") {
    picks.picks = picks.picks.filter((p) => p.symbol !== pick[1].toUpperCase());
    const d = hit(`/stock/${pick[1].toUpperCase()}?strategy=fast_mover`);
    if (d) d.pinned = false;
    return json({ pinned: false });
  }
  if (pick && method === "PATCH") {
    const p = picks.picks.find((x) => x.symbol === pick[1].toUpperCase());
    if (!p) return notFound();
    p.note = payload.note || "";
    return json({ symbol: p.symbol, note: p.note });
  }
  if (b === "/me/picks/order" && method === "PUT") {
    const by = Object.fromEntries(picks.picks.map((p) => [p.symbol, p]));
    picks.picks = payload.symbols.map((s) => by[s]).filter(Boolean);
    return json({ order: payload.symbols });
  }
  if (b === "/me/picks/swap") return json({ dropped: picks.picks[0] ? picks.picks[0].symbol : null });
  if (b === "/me/alerts/read" && method === "POST") {
    const all = hit("/alert-events?days=365&limit=100");
    if (all) all.events.forEach((e) => { if (payload.all || e.id === payload.event_id) e.read = true; });
    return json({ read: true });
  }
  if (b === "/me/alerts/rules" && method === "POST") {
    const sym = (payload.symbol || "").toUpperCase();
    const row = wide && wide.rows.find((r) => r.symbol === sym);
    if (!row) return notFound();
    const label = { borrow_fee_2x: "Borrow fee 2x+", si_cross: "Short interest crosses 10/15/20%", volume_3x: "Volume at 3x+", catalyst_dated: "Catalyst dated", s3_424b: "S-3 or 424B filing", band_change: "Band change", insider_buying: "Insider buying", social_surge: "Social surge", contract_award: "Contract award" }[payload.trigger_key] || payload.trigger_key;
    const rule = { id: Date.now(), symbol: sym, trigger_key: payload.trigger_key, trigger: label, channels: payload.channels || ["email"], armed_at: new Date().toISOString() };
    rules.rules.unshift(rule);
    return json({ rule });
  }
  const rule = b.match(/^\/me\/alerts\/rules\/(\d+)$/);
  if (rule && method === "DELETE") {
    rules.rules = rules.rules.filter((r) => String(r.id) !== rule[1]);
    return json({ deleted: true });
  }
  if (rule && method === "PATCH") {
    const r = rules.rules.find((x) => String(x.id) === rule[1]);
    if (!r) return notFound();
    r.channels = payload.channels;
    return json({ rule: r });
  }
  if (b === "/me/settings" && method === "PATCH") {
    const s = hit("/me/settings");
    Object.assign(s, payload);
    return json(s);
  }
  if (b === "/me/industries" || b.startsWith("/me/industries/")) {
    return json({ detail: "industry changes are disabled in the preview; the dataset is fixed" }, 409);
  }
  if (b === "/login" || b === "/signup") return json({ token: TOKEN, user: hit("/me") });
  if (b === "/me/password") return json({ changed: true });
  if (b === "/me" && method === "DELETE") return json({ detail: "account deletion is disabled in the preview" }, 409);
  return json({ detail: "not available in the preview" }, 409);
}

export async function installMock() {
  const res = await fetch(FIX_URL);
  FIX = await res.json();
  try {
    localStorage.setItem("ta_token", TOKEN);
  } catch {
    /* the token only gates routes; the mock answers regardless */
  }
  // the board and settings write paths straight into history; keep them in the hash
  for (const m of ["pushState", "replaceState"]) {
    const orig = window.history[m].bind(window.history);
    window.history[m] = (state, title, url) => {
      if (typeof url === "string" && url.startsWith("/")) url = `#${url}`;
      return orig(state, title, url);
    };
  }
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    if (!url.startsWith("/api")) return realFetch(input, init);
    const path = url.slice(4);
    const method = (init.method || "GET").toUpperCase();
    await new Promise((r) => setTimeout(r, 40));
    if (method === "GET") return read(path);
    let payload = {};
    try {
      payload = init.body ? JSON.parse(init.body) : {};
    } catch {
      payload = {};
    }
    return write(method, path, payload);
  };
}
