import { useState, useCallback, useRef, useEffect } from "react";

export function useMapListings(apiBase) {
  const [markers, setMarkers] = useState([]);
  const [totalInBounds, setTotalInBounds] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  const fetchMarkers = useCallback(async (bounds, filters = {}) => {
    if (!bounds) return;

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        sw_lat: bounds.sw.lat,
        sw_lng: bounds.sw.lng,
        ne_lat: bounds.ne.lat,
        ne_lng: bounds.ne.lng,
      });
      if (filters.platform_code) params.set("platform_code", filters.platform_code);
      if (filters.min_rent) params.set("min_rent", filters.min_rent);
      if (filters.max_rent) params.set("max_rent", filters.max_rent);
      if (filters.min_deposit) params.set("min_deposit", filters.min_deposit);
      if (filters.max_deposit) params.set("max_deposit", filters.max_deposit);
      if (filters.min_area) params.set("min_area", filters.min_area);
      if (filters.max_area) params.set("max_area", filters.max_area);
      if (filters.min_floor) params.set("min_floor", filters.min_floor);

      const res = await fetch(`${apiBase}/api/listings/geo?${params}`, {
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const data = await res.json();
      setMarkers(data.markers || []);
      setTotalInBounds(data.total_in_bounds || 0);
    } catch (err) {
      if (err.name !== "AbortError") {
        setError(err.message);
        setMarkers([]);
        setTotalInBounds(0);
      }
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  return { markers, totalInBounds, loading, error, fetchMarkers };
}
