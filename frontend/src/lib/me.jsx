import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, getToken } from "../api.js";

// One /api/me request per page load, shared by the nav, the board, and
// every gated control. Re-fetched when the token changes (login, logout,
// a 401 that cleared it).
const MeContext = createContext({ me: null, loading: true, refresh: () => {} });

export function MeProvider({ children }) {
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(Boolean(getToken()));

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setMe(null);
      setLoading(false);
      return null;
    }
    setLoading(true);
    try {
      const d = await api("/me");
      setMe(d);
      return d;
    } catch {
      setMe(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener("ta:auth", refresh);
    return () => window.removeEventListener("ta:auth", refresh);
  }, [refresh]);

  return <MeContext.Provider value={{ me, loading, refresh }}>{children}</MeContext.Provider>;
}

export function useMe() {
  return useContext(MeContext);
}

export function hasChannel(me, channel) {
  return Boolean(me && me.tier && me.tier.channels && me.tier.channels.includes(channel));
}
