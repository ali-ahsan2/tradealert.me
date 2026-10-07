export const TOKEN_KEY = "ta_token";

// Storage access throws outright in Safari private browsing; every read and
// write goes through these so a blocked store degrades to "signed out"
// rather than taking the page down.
export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* session just won't persist */
  }
  window.dispatchEvent(new Event("ta:auth"));
}

export function logout() {
  setToken(null);
}

export class ApiError extends Error {
  constructor(status, detail, body) {
    super(toStringDetail(detail));
    this.status = status;
    this.detail = toStringDetail(detail);
    this.body = body;
  }
}

function toStringDetail(detail) {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d) => (d && d.msg) || String(d))
      .filter(Boolean)
      .join("; ");
  }
  if (detail && typeof detail === "object") return JSON.stringify(detail);
  return "request failed";
}

export async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  const hasBody = opts.json !== undefined;
  if (hasBody) headers["content-type"] = "application/json";
  const token = getToken();
  if (token) headers["authorization"] = `Bearer ${token}`;
  const { json: _json, ...rest } = opts;
  let res;
  try {
    res = await fetch(`/api${path}`, {
      ...rest,
      headers,
      ...(hasBody ? { body: JSON.stringify(_json) } : {}),
    });
  } catch {
    throw new ApiError(0, "You appear to be offline. Check your connection and retry.", null);
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    if (res.status === 401) {
      // stale token: drop it so the next request is anonymous
      setToken(null);
    }
    if (res.status === 429) {
      throw new ApiError(429, "Too many requests. Try again in a minute.", body);
    }
    throw new ApiError(res.status, body && body.detail ? body.detail : res.statusText, body);
  }
  return body;
}

export async function signup(email, password) {
  const { token } = await api("/signup", { method: "POST", json: { email, password } });
  setToken(token);
  return token;
}

export async function login(email, password) {
  const { token } = await api("/login", { method: "POST", json: { email, password } });
  setToken(token);
  return token;
}

export function toast(message) {
  window.dispatchEvent(new CustomEvent("toast", { detail: message }));
}

// Session-scoped cache for the two reference lists every screen needs. The
// board itself is never cached; it is the data the subscriber came for.
const TTL = 5 * 60 * 1000;

export async function cached(path) {
  const key = `ta_cache:${path}`;
  try {
    const hit = JSON.parse(sessionStorage.getItem(key) || "null");
    if (hit && Date.now() - hit.t < TTL) return hit.v;
  } catch {
    /* fall through to the network */
  }
  const v = await api(path);
  try {
    sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), v }));
  } catch {
    /* cache just won't persist */
  }
  return v;
}
