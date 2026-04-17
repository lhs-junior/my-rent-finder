import { useEffect, useRef, useState } from "react";

// 매물 상세를 listing_id로 직접 fetch하는 공용 훅.
// 각 view가 중복으로 들고 있던 detail/loading 상태 + fetch/abort 로직을 한 곳에 모은다.

export function useListingDetail(detailId, apiBase) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const controllerRef = useRef(null);

  useEffect(() => {
    if (!detailId) {
      setDetail(null);
      setError(null);
      setLoading(false);
      return undefined;
    }
    if (controllerRef.current) controllerRef.current.abort();
    const ctrl = new AbortController();
    controllerRef.current = ctrl;

    setLoading(true);
    setError(null);
    setDetail(null);

    const base = (typeof apiBase === "string" ? apiBase.trim() : "").replace(/\/$/, "");
    fetch(`${base}/api/listings/${encodeURIComponent(detailId)}`, { signal: ctrl.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (ctrl.signal.aborted) return;
        setDetail(data?.listing || null);
      })
      .catch((err) => {
        if (ctrl.signal.aborted) return;
        setError(err);
        setDetail(null);
      })
      .finally(() => {
        if (ctrl.signal.aborted) return;
        setLoading(false);
      });

    return () => ctrl.abort();
  }, [detailId, apiBase]);

  return { detail, loading, error };
}
