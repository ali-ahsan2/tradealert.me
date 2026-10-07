import React, { useEffect, useState } from "react";
import { getToken } from "../src/api.js";

// Hash-based twin of src/lib/router.jsx for the hosted preview: the page
// lives at one fixed URL, so every in-app route rides in location.hash
// ("#/board?strategy=market_shift"). Same exports, same semantics.

function current() {
  const h = window.location.hash || "";
  // "#/settings#digest": the route is the part before any in-page anchor
  const p = (h.startsWith("#/") ? h.slice(1) : "/").split("#")[0];
  return p || "/";
}

export function usePath() {
  const [path, setPath] = useState(current());
  useEffect(() => {
    const onChange = () => setPath(current());
    window.addEventListener("popstate", onChange);
    window.addEventListener("hashchange", onChange);
    return () => {
      window.removeEventListener("popstate", onChange);
      window.removeEventListener("hashchange", onChange);
    };
  }, []);
  return path;
}

export function navigate(to, { replace = false } = {}) {
  const target = to.startsWith("#") ? to : `#${to.startsWith("/") ? to : `/${to}`}`;
  if (replace) window.history.replaceState({}, "", target);
  else window.history.pushState({}, "", target);
  window.dispatchEvent(new Event("popstate"));
  if (!to.includes("#", 1)) window.scrollTo({ top: 0 });
}

export function useQuery() {
  const path = usePath();
  return new URLSearchParams(path.split("?")[1] || "");
}

export function Link({ to, children, className, replace, ...rest }) {
  const href = to.startsWith("#") ? to : `#${to}`;
  return (
    <a
      href={href}
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to, { replace });
      }}
      {...rest}
    >
      {children}
    </a>
  );
}

export function RequireAuth({ children }) {
  const authed = Boolean(getToken());
  useEffect(() => {
    if (!authed) navigate(`/login?next=${encodeURIComponent(current())}`, { replace: true });
  }, [authed]);
  return authed ? children : null;
}
