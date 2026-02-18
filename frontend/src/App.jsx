import { useEffect, useState, useRef, Component } from "react";
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

function SettingsMenu({ activeView, setActiveView, apiBase, setApiBase, runId, setRunId, health }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="settings-menu" ref={menuRef}>
      <button
        type="button"
        className={`settings-btn ${open ? "settings-btn--open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-label="설정"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M10 13a3 3 0 100-6 3 3 0 000 6z" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M16.5 10.8v-1.6l-1.2-.4a5.5 5.5 0 00-.5-1.1l.5-1.1-1.1-1.1-1.1.5a5.5 5.5 0 00-1.1-.5L11.6 4h-1.6l-.4 1.2c-.4.1-.8.3-1.1.5l-1.1-.5-1.1 1.1.5 1.1c-.2.4-.4.7-.5 1.1L4 8.8v1.6l1.2.4c.1.4.3.8.5 1.1l-.5 1.1 1.1 1.1 1.1-.5c.4.2.7.4 1.1.5l.4 1.2h1.6l.4-1.2c.4-.1.8-.3 1.1-.5l1.1.5 1.1-1.1-.5-1.1c.2-.4.4-.7.5-1.1l1.2-.4z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && (
        <div className="settings-dropdown">
          <div className="settings-group">
            <label className="settings-label">API 서버</label>
            <input
              className="settings-input"
              value={apiBase}
              onChange={(e) => setApiBase(e.target.value)}
              placeholder="http://127.0.0.1:4100"
            />
          </div>
          <div className="settings-group">
            <label className="settings-label">Run ID</label>
            <input
              className="settings-input"
              value={runId}
              onChange={(e) => setRunId(e.target.value)}
              placeholder="비우면 최근"
            />
          </div>
          <div className="settings-divider" />
          <div className="settings-status">
            <span className={`settings-dot ${health.state === "정상" ? "settings-dot--ok" : "settings-dot--err"}`} />
            <span>API {health.state}</span>
          </div>
          {health.error && <div className="settings-error">{health.error}</div>}
          <div className="settings-divider" />
          <button
            type="button"
            className={`settings-item ${activeView === "ops" ? "settings-item--active" : ""}`}
            onClick={() => { setActiveView("ops"); setOpen(false); }}
          >
            수집 운영 대시보드
          </button>
          <button
            type="button"
            className={`settings-item ${activeView === "matches" ? "settings-item--active" : ""}`}
            onClick={() => { setActiveView("matches"); setOpen(false); }}
          >
            매칭 후보 / 중복 탐색
          </button>
        </div>
      )}
    </div>
  );
}

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
    if (activeView === "map") {
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
        <div
          className="topbar-brand"
          onClick={() => setActiveView("map")}
          onKeyDown={(e) => e.key === "Enter" && setActiveView("map")}
          role="button"
          tabIndex={0}
        >
          <svg className="topbar-logo" width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="M3 9.5L12 4l9 5.5v9a1.5 1.5 0 01-1.5 1.5h-15A1.5 1.5 0 013 18.5v-9z" fill="var(--primary)" opacity="0.15" />
            <path d="M3 9.5L12 4l9 5.5v9a1.5 1.5 0 01-1.5 1.5h-15A1.5 1.5 0 013 18.5v-9z" stroke="var(--primary)" strokeWidth="1.5" strokeLinejoin="round" />
            <path d="M9 20V14h6v6" stroke="var(--primary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="topbar-title">방찾기</span>
        </div>
        <nav className="topbar-nav">
          <button
            type="button"
            className={`nav-tab ${activeView === "map" ? "nav-tab--active" : ""}`}
            onClick={() => setActiveView("map")}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M1 3.5l4.5-2 5 2 4.5-2v11l-4.5 2-5-2-4.5 2v-11z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
              <path d="M5.5 1.5v11M10.5 3.5v11" stroke="currentColor" strokeWidth="1.2" />
            </svg>
            지도
          </button>
          <button
            type="button"
            className={`nav-tab ${activeView === "listings" ? "nav-tab--active" : ""}`}
            onClick={() => setActiveView("listings")}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="1.5" y="2" width="5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.2" />
              <rect x="9.5" y="2" width="5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.2" />
              <rect x="1.5" y="9.5" width="5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.2" />
              <rect x="9.5" y="9.5" width="5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.2" />
            </svg>
            매물
          </button>
          <button
            type="button"
            className={`nav-tab ${activeView === "favorites" ? "nav-tab--active" : ""}`}
            onClick={() => setActiveView("favorites")}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 13.7l-5.3-4.8C1.3 7.6 1 6 1.8 4.8A3.3 3.3 0 018 4.3a3.3 3.3 0 016.2.5c.8 1.2.5 2.8-.9 4.1L8 13.7z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
            </svg>
            찜{favoriteIds.size > 0 && <span className="nav-tab-badge">{favoriteIds.size}</span>}
          </button>
        </nav>
        <SettingsMenu
          activeView={activeView}
          setActiveView={setActiveView}
          apiBase={apiBase}
          setApiBase={setApiBase}
          runId={runId}
          setRunId={setRunId}
          health={health}
        />
      </header>

      <main className={`app-content${activeView === "map" ? " app-content--fullwidth" : ""}`}>
        {activeView === "ops" && <OperationsDashboard apiBase={apiBase} runId={runId} />}
        {activeView === "matches" && <MatchingBoard apiBase={apiBase} runId={runId} />}
        {activeView === "listings" && <ListingSearch apiBase={apiBase} runId={runId} isFavorite={isFavorite} toggleFavorite={toggleFavorite} />}
        {activeView === "map" && <MapErrorBoundary><MapView apiBase={apiBase} isFavorite={isFavorite} toggleFavorite={toggleFavorite} /></MapErrorBoundary>}
        {activeView === "favorites" && <FavoritesView apiBase={apiBase} favoriteIds={favoriteIds} toggleFavorite={toggleFavorite} />}
      </main>
    </div>
  );
}
