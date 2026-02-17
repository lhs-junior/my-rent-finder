import { useState, useCallback, useEffect, useRef } from "react";

function normalizeApiBase(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

export function useFavorites(apiBase) {
  const [favoriteIds, setFavoriteIds] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Load favorite IDs on mount
  useEffect(() => {
    const normalizedApiBase = normalizeApiBase(apiBase);
    setLoading(true);
    fetch(`${normalizedApiBase}/api/favorites/ids`)
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`${r.status}`)))
      .then((data) => {
        if (mountedRef.current) {
          setFavoriteIds(new Set(data.ids || []));
        }
      })
      .catch(() => {})
      .finally(() => {
        if (mountedRef.current) setLoading(false);
      });
  }, [apiBase]);

  const isFavorite = useCallback(
    (listingId) => favoriteIds.has(Number(listingId)),
    [favoriteIds],
  );

  const toggleFavorite = useCallback(
    async (listingId) => {
      const normalizedApiBase = normalizeApiBase(apiBase);
      const id = Number(listingId);
      if (!id) return;

      const wasActive = favoriteIds.has(id);

      // Optimistic update
      setFavoriteIds((prev) => {
        const next = new Set(prev);
        if (wasActive) next.delete(id);
        else next.add(id);
        return next;
      });

      try {
        if (wasActive) {
          const r = await fetch(`${normalizedApiBase}/api/favorites/${id}`, { method: "DELETE" });
          if (!r.ok) throw new Error(`${r.status}`);
        } else {
          const r = await fetch(`${normalizedApiBase}/api/favorites`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ listing_id: id }),
          });
          if (!r.ok) throw new Error(`${r.status}`);
        }
      } catch {
        // Revert on failure
        if (mountedRef.current) {
          setFavoriteIds((prev) => {
            const next = new Set(prev);
            if (wasActive) next.add(id);
            else next.delete(id);
            return next;
          });
        }
      }
    },
    [apiBase, favoriteIds],
  );

  return { favoriteIds, isFavorite, toggleFavorite, loading };
}
