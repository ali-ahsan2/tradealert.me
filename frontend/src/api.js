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
    super(typeof detail === "string" ? detail : "request failed");
    this.status = status;
    this.detail = detail;
  }
}

export async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.json !== undefined) headers["content-type"] = "application/json";
  const token = getToken();
  if (token) headers["authorization"] = `Bearer ${token}`;
  const res = await fetch(`/api${path}`, { ...opts, headers });
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