// frontend/src/hooks/useProfile.js
import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "mrf_pin";

export function useProfile(apiBase = "") {
  const [pin, setPin] = useState(() => localStorage.getItem(STORAGE_KEY) || "");
  const [settings, setSettings] = useState({});
  const [favoriteIds, setFavoriteIds] = useState(new Set());
  const [authenticated, setAuthenticated] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (pinValue) => {
    if (!pinValue) return;
    try {
      const res = await fetch(`${apiBase}/api/profile/read`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: pinValue }),
      });
      if (!res.ok) { setError("PIN이 틀렸습니다"); setAuthenticated(false); return; }
      const data = await res.json();
      setSettings(data.settings || {});
      setFavoriteIds(new Set(data.favoriteIds || []));
      setAuthenticated(true);
      setError("");
      localStorage.setItem(STORAGE_KEY, pinValue);
    } catch {
      setError("서버 오류");
    }
  }, [apiBase]);

  // Auto-load if PIN saved in localStorage
  useEffect(() => {
    if (pin) load(pin);
  }, []); // only on mount

  const signIn = useCallback((pinValue) => {
    setPin(pinValue);
    return load(pinValue);
  }, [load]);

  const saveSetting = useCallback(async (key, value) => {
    if (!pin) return;
    await fetch(`${apiBase}/api/profile/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin, key, value }),
    });
    setSettings((s) => ({ ...s, [key]: value }));
  }, [pin, apiBase]);

  const toggleFavorite = useCallback(async (listingId) => {
    if (!pin) return;
    const res = await fetch(`${apiBase}/api/profile/favorites/toggle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin, listing_id: listingId }),
    });
    const data = await res.json();
    setFavoriteIds((ids) => {
      const next = new Set(ids);
      if (data.action === "added") next.add(listingId);
      else next.delete(listingId);
      return next;
    });
  }, [pin, apiBase]);

  const isFavorite = useCallback((listingId) => favoriteIds.has(listingId), [favoriteIds]);

  return { pin, authenticated, settings, favoriteIds, error, signIn, saveSetting, toggleFavorite, isFavorite };
}
