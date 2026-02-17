import { useEffect, useState, Component } from "react";
import { useApiHealth } from "./hooks/useApi.js";
import { useFavorites } from "./hooks/useFavorites.js";
import { normalizeView } from "./utils/format.js";
import OperationsDashboard from "./components/OperationsDashboard.jsx";
import MatchingBoard from "./components/MatchingBoard.jsx";
import ListingSearch from "./components/ListingSearch.jsx";
import FavoritesView from "./components/FavoritesView.jsx";
import MapView from "./components/map/MapView.jsx";

class MapErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: "2rem", textAlign: "center" }}>
          <h3>지도를 불러오는 중 오류가 발생했습니다.</h3>
          <p className="muted">{this.state.error?.message}</p>
          <button type="button" onClick={() => this.setState({ hasError: false, error: null })}>
            다시 시도
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const DEFAULT_API_BASE = (() => {
  if (typeof window === "undefined" || window.location.protocol === "file:") {
    return "http://127.0.0.1:4100";
  }
  const hostname = window.location.hostname || "127.0.0.1";
  // Production (Vercel etc): API is same-origin
  if (hostname !== "127.0.0.1" && hostname !== "localhost") {
    return "";
  }
  // Local dev: proxy to API server on port 4100
  const proto = window.location.protocol || "http:";
  const hostPort = window.location.port || "4100";
  const port = hostPort === "5173" || hostPort === "4173" ? "4100" : hostPort;
  return `${proto}//${hostname}:${port}`;
})();

export default function App() {
  const [apiBase, setApiBase] = useState(DEFAULT_API_BASE);
  const [runId, setRunId] = useState("");
  const [activeView, setActiveView] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return normalizeView(params.get("view"));
  });
  const health = useApiHealth(apiBase);
  const { favoriteIds, isFavorite, toggleFavorite } = useFavorites(apiBase);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (activeView === "ops") {
      params.delete("view");
    } else {
      params.set("view", activeView);
    }
    const nextPath = params.toString()
      ? `${window.location.pathname}?${params.toString()}`
      : window.location.pathname;
    window.history.replaceState({}, "", nextPath);
  }, [activeView]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <h1>Rent Finder</h1>
        <p className="muted">수집/매칭 데이터를 DB에서 바로 읽는 실운영 화면</p>
        <div className="toolbar">
          <input
            value={apiBase}
            onChange={(event) => setApiBase(event.target.value)}
            placeholder="http://127.0.0.1:4100"
          />
          <input
            value={runId}
            onChange={(event) => setRunId(event.target.value)}
            placeholder="run_id (비우면 최근)"
          />
          <span className={`chip ${health.state === "정상" ? "chip-success" : "chip-danger"}`}>
            API {health.state}
          </span>
          {health.error ? <span className="muted">{health.error}</span> : null}
        </div>
        <nav className="tabs">
          <button
            type="button"
            className={activeView === "ops" ? "tab-active" : ""}
            onClick={() => setActiveView("ops")}
          >
            수집 운영
          </button>
            <button
            type="button"
            className={activeView === "matches" ? "tab-active" : ""}
            onClick={() => setActiveView("matches")}
          >
            매칭 후보 / 중복 탐색
          </button>
          <button
            type="button"
            className={activeView === "listings" ? "tab-active" : ""}
            onClick={() => setActiveView("listings")}
          >
            매물 검색
          </button>
          <button
            type="button"
            className={activeView === "map" ? "tab-active" : ""}
            onClick={() => setActiveView("map")}
          >
            지도
          </button>
          <button
            type="button"
            className={`${activeView === "favorites" ? "tab-active" : ""} tab-fav`}
            onClick={() => setActiveView("favorites")}
          >
            즐겨찾기{favoriteIds.size > 0 ? ` (${favoriteIds.size})` : ""}
          </button>
        </nav>
      </header>

      {activeView === "ops" && <OperationsDashboard apiBase={apiBase} runId={runId} />}
      {activeView === "matches" && <MatchingBoard apiBase={apiBase} runId={runId} />}
      {activeView === "listings" && <ListingSearch apiBase={apiBase} runId={runId} isFavorite={isFavorite} toggleFavorite={toggleFavorite} />}
      {activeView === "map" && <MapErrorBoundary><MapView apiBase={apiBase} isFavorite={isFavorite} toggleFavorite={toggleFavorite} /></MapErrorBoundary>}
      {activeView === "favorites" && <FavoritesView apiBase={apiBase} favoriteIds={favoriteIds} toggleFavorite={toggleFavorite} />}
    </div>
  );
}
