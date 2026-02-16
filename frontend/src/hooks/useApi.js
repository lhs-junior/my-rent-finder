import { useState, useEffect } from "react";

export async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const payload = await response.json();
      if (payload?.error || payload?.message) {
        detail = `${payload.error || "error"}: ${payload.message || "요청 처리 실패"}`;
      }
    } catch {
      // Keep fallback detail
    }
    throw new Error(detail);
  }
  return response.json();
}

export function useApiHealth(apiBase) {
  const [health, setHealth] = useState({ state: "체크 중", error: null });

  useEffect(() => {
    let active = true;
    async function check() {
      try {
        await fetchJson(`${apiBase}/api/health`);
        if (active) setHealth({ state: "정상", error: null });
      } catch (error) {
        if (active) setHealth({ state: "실패", error: String(error?.message || error) });
      }
    }

    setHealth({ state: "체크 중", error: null });
    check();
    return () => {
      active = false;
    };
  }, [apiBase]);

  return health;
}
