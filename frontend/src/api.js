export const TOKEN_KEY = "ta_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function logout() {
  setToken(null);
}

export class ApiError extends Error {
  constructor(status, detail) {
    super(toStringDetail(detail));
    this.status = status;
    this.detail = toStringDetail(detail);
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
  const res = await fetch(`/api${path}`, {
    ...rest,
    headers,
    ...(hasBody ? { body: JSON.stringify(_json) } : {}),
  });
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
    throw new ApiError(res.status, body && body.detail ? body.detail : res.statusText);
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

export function fmtMoney(m, decimals = 0) {
  if (m == null) return "—";
  if (Math.abs(m) >= 1000) return `$${(m / 1000).toFixed(1)}B`;
  return `$${m.toFixed(decimals)}M`;
}