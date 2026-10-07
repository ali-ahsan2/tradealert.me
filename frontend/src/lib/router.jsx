import React, { useEffect, useState } from "react";
import { getToken } from "../api.js";

// A ten-line router: every screen is a real URL, the browser's back button
// works, and there is nothing to configure. Routes are matched in main.jsx.

export function usePath() {
  const [path, setPath] = useState(window.location.pathname + window.location.search);
  useEffect(() => {
    const onChange = () => setPath(window.location.pathname + window.location.search);
    window.addEventListener("popstate", onChange);
    return () => window.removeEventListener("popstate", onChange);
  }, []);
  return path;
}

export function navigate(to, { replace = false } = {}) {
  if (replace) window.history.replaceState({}, "", to);
  else window.history.pushState({}, "", to);
  window.dispatchEvent(new Event("popstate"));
  if (!to.includes("#")) window.scrollTo({ top: 0 });
}

export function useQuery() {
  const path = usePath();
  return new URLSearchParams(path.split("?")[1] || "");
}

export function Link({ to, children, className, replace, ...rest }) {
  return (
    <a
      href={to}
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

// Authenticated screens send a signed-out visitor to login and bring them
// back to the same URL afterwards.
export function RequireAuth({ children }) {
  const authed = Boolean(getToken());
  useEffect(() => {
    if (!authed) {
      const next = window.location.pathname + window.location.search;
      navigate(`/login?next=${encodeURIComponent(next)}`, { replace: true });
    }
  }, [authed]);
  return authed ? children : null;
}
