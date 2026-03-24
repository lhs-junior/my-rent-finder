# 지도 UI 3-Panel 개편 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 지도 탭을 네이버 부동산식 3-panel 레이아웃으로 개편 — 좌측(필터+목록) / 중앙(지도) / 우측(상세 슬라이드), 모바일은 직방식 하단 시트

**Architecture:** MapView가 3개 패널을 조율하는 단일 상태 소유자. MapSidePanel을 MapLeftPanel(목록)과 MapRightPanel(상세)로 분리. 모바일에서는 MapBottomSheet가 좌측 패널을 대체.

**Tech Stack:** React 18, vanilla CSS (CSS variables), 카카오맵 SDK

**Spec:** `docs/superpowers/specs/2026-03-24-map-ui-redesign.md`

---

## 파일 맵

| 액션 | 파일 | 역할 |
|------|------|------|
| Create | `frontend/src/components/map/MapLeftPanel.jsx` | 필터 + 목록 (데스크탑 좌측 패널) |
| Create | `frontend/src/components/map/MapRightPanel.jsx` | 상세 뷰 (데스크탑 우측 슬라이드 패널) |
| Create | `frontend/src/components/map/MapBottomSheet.jsx` | 모바일 하단 시트 |
| Modify | `frontend/src/components/map/MapView.jsx` | 3-panel 레이아웃으로 재구성 |
| Modify | `frontend/src/components/map/MapFilters.jsx` | `has_image` 필터 추가, 즉시 적용 방식으로 변경 |
| Delete | `frontend/src/components/map/MapSidePanel.jsx` | MapLeftPanel + MapRightPanel으로 대체 |
| Modify | `frontend/src/styles.css` | 3-panel CSS, 슬라이드 애니메이션, 하단 시트 CSS 교체 |

---

## Task 1: MapLeftPanel 생성

**Files:**
- Create: `frontend/src/components/map/MapLeftPanel.jsx`

- [ ] **Step 1: 파일 생성**

```jsx
// frontend/src/components/map/MapLeftPanel.jsx
import { useRef, useEffect } from "react";
import { PLATFORM_OPTIONS, FLOOR_FILTER_OPTIONS } from "../../utils/format.js";
import MapListingCard from "./MapListingCard.jsx";

export default function MapLeftPanel({
  filters,
  onFilterChange,
  markers,
  totalInBounds,
  loading,
  selectedId,
  onCardClick,
  isFavorite,
  toggleFavorite,
}) {
  const listRef = useRef(null);

  // 선택된 카드로 자동 스크롤
  useEffect(() => {
    if (!selectedId || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-listing-id="${selectedId}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedId]);

  const set = (key, val) => onFilterChange({ ...filters, [key]: val });

  return (
    <div className="map-left-panel">
      {/* 필터 */}
      <div className="map-left-filters">
        <select
          aria-label="플랫폼"
          value={filters.platform_code || ""}
          onChange={e => set("platform_code", e.target.value)}
        >
          {PLATFORM_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <div className="map-filter-row">
          <input
            type="number" placeholder="최소 월세" aria-label="최소 월세"
            value={filters.min_rent || ""}
            onChange={e => set("min_rent", e.target.value)}
          />
          <span>~</span>
          <input
            type="number" placeholder="최대 월세" aria-label="최대 월세"
            value={filters.max_rent || ""}
            onChange={e => set("max_rent", e.target.value)}
          />
          <span className="map-filter-unit">만원</span>
        </div>
        <div className="map-filter-row">
          <input
            type="number" placeholder="최소 면적" aria-label="최소 면적"
            value={filters.min_area || ""}
            onChange={e => set("min_area", e.target.value)}
          />
          <span>~</span>
          <input
            type="number" placeholder="최대 면적" aria-label="최대 면적"
            value={filters.max_area || ""}
            onChange={e => set("max_area", e.target.value)}
          />
          <span className="map-filter-unit">㎡</span>
        </div>
        <div className="map-left-filter-row2">
          <select
            aria-label="층 필터"
            value={filters.min_floor || ""}
            onChange={e => set("min_floor", e.target.value)}
          >
            {FLOOR_FILTER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <div className="map-image-filter">
            {[{ v: "", l: "전체" }, { v: "true", l: "사진" }, { v: "false", l: "사진X" }].map(opt => (
              <button
                key={opt.v}
                type="button"
                className={`map-img-btn${(filters.has_image || "") === opt.v ? " map-img-btn--active" : ""}`}
                onClick={() => set("has_image", opt.v)}
              >
                {opt.l}
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          className="map-filter-reset"
          onClick={() => onFilterChange({})}
        >
          초기화
        </button>
      </div>

      {/* 목록 */}
      <div className="map-left-count">
        {loading ? "조회 중..." : `지도 내 ${totalInBounds ?? markers.length}건`}
      </div>
      <div className="map-left-list" ref={listRef}>
        {markers.length === 0 && !loading && (
          <p className="map-left-empty">해당 지역에 매물이 없습니다</p>
        )}
        {markers.map(m => (
          <div
            key={m.listing_id}
            data-listing-id={String(m.listing_id)}
            className={`map-left-card${String(selectedId) === String(m.listing_id) ? " map-left-card--selected" : ""}`}
            onClick={() => onCardClick(m)}
          >
            <div className="map-left-card-price">
              {m.rent_amount != null ? `월 ${m.rent_amount}만` : "가격미정"}
            </div>
            <div className="map-left-card-deposit">
              보증 {m.deposit_amount != null ? `${m.deposit_amount}만` : "-"}
            </div>
            <div className="map-left-card-addr">{m.address_text || "-"}</div>
            <div className="map-left-card-tags">
              {m.area_exclusive_m2 && <span>{m.area_exclusive_m2}㎡</span>}
              {m.floor != null && <span>{m.floor}층</span>}
              {m.room_count && <span>{m.room_count}룸</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 빌드 확인**

```bash
cd /Users/hyunsoo/personal-projects/my-rent-finder && npm run front:build 2>&1 | tail -3
```
Expected: `✓ built in`

- [ ] **Step 3: 커밋**

```bash
git add frontend/src/components/map/MapLeftPanel.jsx
git commit -m "feat: MapLeftPanel — 필터+목록 좌측 패널"
```

---

## Task 2: MapRightPanel 생성

**Files:**
- Create: `frontend/src/components/map/MapRightPanel.jsx`

- [ ] **Step 1: 파일 생성**

현재 `MapSidePanel.jsx`의 detail fetch 로직을 그대로 이식하되, 패널 슬라이드 구조로 감싼다.

```jsx
// frontend/src/components/map/MapRightPanel.jsx
import { useState, useEffect, useRef } from "react";
import { toPlatformLabel, normalizeImageUrl, toArea } from "../../utils/format.js";
import { resolveExternalListingUrl } from "../../utils/listing-url.js";
import FavoriteButton from "../FavoriteButton.jsx";

export default function MapRightPanel({
  detailId,
  apiBase,
  onClose,
  isFavorite,
  toggleFavorite,
}) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const controllerRef = useRef(null);

  useEffect(() => {
    if (!detailId) { setDetail(null); return; }
    if (controllerRef.current) controllerRef.current.abort();
    const ctrl = new AbortController();
    controllerRef.current = ctrl;
    setLoading(true);
    const base = (apiBase || "").replace(/\/$/, "");
    fetch(`${base}/api/listings/${encodeURIComponent(detailId)}`, { signal: ctrl.signal })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (!ctrl.signal.aborted) setDetail(data?.listing || null); })
      .catch(() => {})
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });
    return () => ctrl.abort();
  }, [detailId, apiBase]);

  const open = Boolean(detailId);
  const externalUrl = detail ? resolveExternalListingUrl(detail) : null;
  const firstImg = detail?.images?.[0]?.source_url;

  return (
    <div className={`map-right-panel${open ? " map-right-panel--open" : ""}`}>
      <div className="map-right-header">
        <span className="map-right-title">매물 상세</span>
        <button type="button" className="map-right-close" onClick={onClose} aria-label="닫기">✕</button>
      </div>
      <div className="map-right-body">
        {loading && <div className="map-right-loading">불러오는 중...</div>}
        {!loading && !detail && open && <div className="map-right-loading">정보 없음</div>}
        {detail && (
          <>
            {firstImg && (
              <div className="map-right-img">
                <img src={normalizeImageUrl(firstImg)} alt="" loading="lazy" />
              </div>
            )}
            <div className="map-right-content">
              <div className="map-right-platform">
                {toPlatformLabel(detail.platform_code || detail.platform || "")}
              </div>
              <div className="map-right-price">{detail.rent_amount != null ? `월 ${detail.rent_amount}만원` : "가격 미정"}</div>
              <div className="map-right-deposit">보증금 {detail.deposit_amount != null ? `${detail.deposit_amount}만원` : "-"}</div>
              <div className="map-right-addr">{detail.address_text || "-"}</div>
              <div className="map-right-tags">
                {detail.area_exclusive_m2 && <span>{toArea(detail.area_exclusive_m2)}</span>}
                {detail.floor != null && <span>{detail.floor}층{detail.total_floor ? `/${detail.total_floor}층` : ""}</span>}
                {detail.room_count && <span>{detail.room_count}룸</span>}
                {detail.building_use && <span>{detail.building_use}</span>}
              </div>
              {detail.title && <div className="map-right-desc">{detail.title}</div>}
              <div className="map-right-actions">
                {externalUrl && (
                  <a href={externalUrl} target="_blank" rel="noopener noreferrer" className="map-right-btn map-right-btn--primary">
                    원본 보기 →
                  </a>
                )}
                {toggleFavorite && (
                  <FavoriteButton
                    active={typeof isFavorite === "function" ? isFavorite(detail.listing_id) : false}
                    onClick={() => toggleFavorite(detail.listing_id)}
                  />
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 빌드 확인**

```bash
npm run front:build 2>&1 | tail -3
```

- [ ] **Step 3: 커밋**

```bash
git add frontend/src/components/map/MapRightPanel.jsx
git commit -m "feat: MapRightPanel — 우측 슬라이드 상세 패널"
```

---

## Task 3: MapBottomSheet 생성 (모바일)

**Files:**
- Create: `frontend/src/components/map/MapBottomSheet.jsx`

- [ ] **Step 1: 파일 생성**

```jsx
// frontend/src/components/map/MapBottomSheet.jsx
import { useRef, useState, useEffect } from "react";
import MapListingCard from "./MapListingCard.jsx";

const STAGES = { peek: 64, half: 0.45, full: 0.92 }; // peek=px, half/full=vh 비율

export default function MapBottomSheet({
  markers,
  totalInBounds,
  loading,
  selectedId,
  onCardClick,
  isFavorite,
  toggleFavorite,
}) {
  const [stage, setStage] = useState("peek"); // peek | half | full
  const sheetRef = useRef(null);
  const startY = useRef(null);

  const getHeight = () => {
    if (stage === "peek") return STAGES.peek;
    if (stage === "half") return window.innerHeight * STAGES.half;
    return window.innerHeight * STAGES.full;
  };

  const onTouchStart = (e) => { startY.current = e.touches[0].clientY; };
  const onTouchEnd = (e) => {
    const dy = startY.current - e.changedTouches[0].clientY;
    if (dy > 40) setStage(s => s === "peek" ? "half" : "full");
    else if (dy < -40) setStage(s => s === "full" ? "half" : "peek");
  };

  // 핀 선택 시 peek로
  useEffect(() => { if (selectedId) setStage("peek"); }, [selectedId]);

  return (
    <div
      ref={sheetRef}
      className="map-bottom-sheet"
      style={{ height: getHeight() }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div className="map-bottom-handle" onClick={() => setStage(s => s === "peek" ? "half" : s === "half" ? "full" : "peek")}>
        <div className="map-bottom-handle-bar" />
        <span className="map-bottom-count">{loading ? "..." : `${totalInBounds ?? markers.length}건`}</span>
      </div>
      <div className="map-bottom-list">
        {markers.map(m => (
          <div
            key={m.listing_id}
            className={`map-left-card${String(selectedId) === String(m.listing_id) ? " map-left-card--selected" : ""}`}
            onClick={() => { onCardClick(m); setStage("peek"); }}
          >
            <div className="map-left-card-price">{m.rent_amount != null ? `월 ${m.rent_amount}만` : "가격미정"}</div>
            <div className="map-left-card-deposit">보증 {m.deposit_amount != null ? `${m.deposit_amount}만` : "-"}</div>
            <div className="map-left-card-addr">{m.address_text || "-"}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 빌드 확인**

```bash
npm run front:build 2>&1 | tail -3
```

- [ ] **Step 3: 커밋**

```bash
git add frontend/src/components/map/MapBottomSheet.jsx
git commit -m "feat: MapBottomSheet — 모바일 하단 시트"
```

---

## Task 4: MapView 재구성

**Files:**
- Modify: `frontend/src/components/map/MapView.jsx`

- [ ] **Step 1: MapView 전체 교체**

현재 MapView의 핸들러 로직은 그대로 유지하고, render 부분만 3-panel로 교체한다.

```jsx
// frontend/src/components/map/MapView.jsx — render 부분만 교체
// (import에 MapLeftPanel, MapRightPanel, MapBottomSheet 추가, MapSidePanel 제거)

import { useState, useCallback, useRef, useEffect } from "react";
import KakaoMap from "./KakaoMap.jsx";
import MapLeftPanel from "./MapLeftPanel.jsx";
import MapRightPanel from "./MapRightPanel.jsx";
import MapBottomSheet from "./MapBottomSheet.jsx";
import MapControls from "./MapControls.jsx";
import { useMapListings } from "../../hooks/useMapListings.js";

const INITIAL_CENTER = { lat: 37.5665, lng: 126.978 };
const INITIAL_ZOOM = 13;
const MAP_CARD_FOCUS_ZOOM = 4;

function toFiniteCoordinate(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export default function MapView({ apiBase, isFavorite, toggleFavorite }) {
  const { markers, totalInBounds, loading, error, fetchMarkers } = useMapListings(apiBase);
  const [filters, setFilters] = useState({});
  const [selectedId, setSelectedId] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [heatmapOn, setHeatmapOn] = useState(false);
  const mapRef = useRef(null);
  const boundsRef = useRef(null);

  const handleBoundsChange = useCallback((bounds) => {
    boundsRef.current = bounds;
    fetchMarkers(bounds, filters);
  }, [fetchMarkers, filters]);

  const handleFilterChange = useCallback((newFilters) => {
    setFilters(newFilters);
    if (boundsRef.current) fetchMarkers(boundsRef.current, newFilters);
  }, [fetchMarkers]);

  const handleMarkerClick = useCallback((marker) => {
    const id = marker?.listing_id ?? marker;
    const normalizedId = id != null ? String(id) : null;
    if (!normalizedId) return;
    mapRef.current?.clearSelection?.();
    setSelectedId(normalizedId);
    setDetailId(normalizedId);
  }, []);

  const handleCardClick = useCallback((listingOrId) => {
    const item = typeof listingOrId === "object" && listingOrId != null
      ? listingOrId
      : markers.find(m => String(m.listing_id) === String(listingOrId)) || null;
    const id = item?.listing_id != null ? String(item.listing_id) : listingOrId != null ? String(listingOrId) : null;
    if (!id || !item) return;
    setSelectedId(id);
    setDetailId(id);
    mapRef.current?.clearSelection?.();
    const lat = toFiniteCoordinate(item.lat);
    const lng = toFiniteCoordinate(item.lng);
    if (lat != null && lng != null) {
      mapRef.current?.focusAt?.({ lat, lng, zoom: MAP_CARD_FOCUS_ZOOM });
    }
  }, [markers]);

  const handleCloseDetail = useCallback(() => {
    setDetailId(null);
    setSelectedId(null);
    mapRef.current?.clearSelection?.();
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    if (!markers.some(m => String(m.listing_id) === selectedId)) {
      setSelectedId(null);
      mapRef.current?.clearSelection?.();
    }
  }, [markers, selectedId]);

  return (
    <div className="map-view-3panel">
      {/* 데스크탑 3-panel */}
      <div className="map-3panel-left">
        <MapLeftPanel
          filters={filters}
          onFilterChange={handleFilterChange}
          markers={markers}
          totalInBounds={totalInBounds}
          loading={loading}
          selectedId={selectedId}
          onCardClick={handleCardClick}
          isFavorite={isFavorite}
          toggleFavorite={toggleFavorite}
        />
      </div>

      <div className="map-3panel-center">
        <KakaoMap
          ref={mapRef}
          center={INITIAL_CENTER}
          zoom={INITIAL_ZOOM}
          markers={markers}
          selectedId={selectedId}
          favoriteIds={isFavorite}
          heatmapOn={heatmapOn}
          onBoundsChange={handleBoundsChange}
          onMarkerClick={handleMarkerClick}
          onOpenDetail={handleMarkerClick}
        />
        <MapControls
          heatmapOn={heatmapOn}
          onToggleHeatmap={() => setHeatmapOn(v => !v)}
          onZoomIn={() => mapRef.current?.zoomIn?.()}
          onZoomOut={() => mapRef.current?.zoomOut?.()}
        />
        {loading && <div className="map-loading-bar" />}
      </div>

      <div className={`map-3panel-right${detailId ? " map-3panel-right--open" : ""}`}>
        <MapRightPanel
          detailId={detailId}
          apiBase={apiBase}
          onClose={handleCloseDetail}
          isFavorite={isFavorite}
          toggleFavorite={toggleFavorite}
        />
      </div>

      {/* 모바일 하단 시트 */}
      <MapBottomSheet
        markers={markers}
        totalInBounds={totalInBounds}
        loading={loading}
        selectedId={selectedId}
        onCardClick={handleCardClick}
        isFavorite={isFavorite}
        toggleFavorite={toggleFavorite}
      />
    </div>
  );
}
```

- [ ] **Step 2: 빌드 확인**

```bash
npm run front:build 2>&1 | tail -5
```
Expected: `✓ built in` (에러 없음)

- [ ] **Step 3: 커밋**

```bash
git add frontend/src/components/map/MapView.jsx
git commit -m "feat: MapView 3-panel 레이아웃으로 재구성"
```

---

## Task 5: CSS 교체

**Files:**
- Modify: `frontend/src/styles.css` (`.map-view` ~ `.map-side-*` 블록 교체)

- [ ] **Step 1: 기존 map CSS 섹션 찾기**

```bash
grep -n "^\.map-view\|^\.map-layout\|^\.map-side\|^\.map-filters\|^\.map-container" \
  frontend/src/styles.css | head -20
```

- [ ] **Step 2: 기존 `.map-view` 부터 `.map-side-*` 까지 블록을 아래 CSS로 교체**

```css
/* ── 3-panel Map View ── */
.map-view-3panel {
  display: flex;
  height: calc(100vh - 52px); /* topbar 높이 제외 */
  overflow: hidden;
  position: relative;
}

/* 좌측 패널 */
.map-3panel-left {
  width: 280px;
  flex-shrink: 0;
  border-right: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--panel);
}

/* 중앙 지도 */
.map-3panel-center {
  flex: 1;
  min-width: 0;
  position: relative;
}

/* 우측 패널 */
.map-3panel-right {
  width: 0;
  flex-shrink: 0;
  overflow: hidden;
  border-left: 1px solid var(--line);
  transition: width 0.22s ease;
  background: var(--panel);
}
.map-3panel-right--open {
  width: 380px;
}

/* 좌측 패널 내부 */
.map-left-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.map-left-filters {
  padding: 12px;
  border-bottom: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  gap: 7px;
  flex-shrink: 0;
  background: var(--panel-raised);
}

.map-left-filters select,
.map-left-filters input {
  width: 100%;
  padding: 5px 8px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  font: inherit;
  font-size: 0.82rem;
  background: white;
  color: var(--text);
}

.map-filter-row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.map-filter-row input { flex: 1; }
.map-filter-unit { font-size: 0.75rem; color: var(--text-muted); white-space: nowrap; }

.map-left-filter-row2 {
  display: flex;
  gap: 6px;
  align-items: center;
}
.map-left-filter-row2 select { flex: 1; }

.map-image-filter {
  display: flex;
  gap: 3px;
}
.map-img-btn {
  padding: 4px 8px;
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  background: white;
  font: inherit;
  font-size: 0.72rem;
  cursor: pointer;
  white-space: nowrap;
  color: var(--text-soft);
}
.map-img-btn--active {
  background: var(--primary);
  color: white;
  border-color: var(--primary);
}

.map-filter-reset {
  padding: 5px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: transparent;
  font: inherit;
  font-size: 0.78rem;
  color: var(--text-muted);
  cursor: pointer;
}
.map-filter-reset:hover { background: var(--primary-light); }

.map-left-count {
  padding: 8px 12px 4px;
  font-size: 0.75rem;
  color: var(--text-muted);
  flex-shrink: 0;
}

.map-left-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 8px 16px;
}

.map-left-empty {
  padding: 24px 12px;
  text-align: center;
  color: var(--text-muted);
  font-size: 0.82rem;
}

.map-left-card {
  padding: 10px 12px;
  border-radius: var(--radius);
  cursor: pointer;
  margin-bottom: 4px;
  border: 1px solid transparent;
  transition: background 0.1s, border-color 0.1s;
}
.map-left-card:hover { background: var(--primary-light); }
.map-left-card--selected {
  background: #eff6ff;
  border-color: var(--accent);
}

.map-left-card-price {
  font-size: 0.9rem;
  font-weight: 700;
  color: var(--text);
}
.map-left-card-deposit {
  font-size: 0.75rem;
  color: var(--text-soft);
  margin-top: 1px;
}
.map-left-card-addr {
  font-size: 0.75rem;
  color: var(--text-muted);
  margin-top: 3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.map-left-card-tags {
  display: flex;
  gap: 4px;
  margin-top: 5px;
  flex-wrap: wrap;
}
.map-left-card-tags span {
  font-size: 0.68rem;
  padding: 1px 6px;
  background: var(--primary-light);
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  color: var(--text-soft);
}

/* 우측 패널 내부 */
.map-right-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  width: 380px;
}

.map-right-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--line);
  flex-shrink: 0;
}
.map-right-title { font-weight: 700; font-size: 0.9rem; }
.map-right-close {
  background: none;
  border: none;
  font-size: 1rem;
  cursor: pointer;
  color: var(--text-muted);
  padding: 4px;
  border-radius: var(--radius);
}
.map-right-close:hover { background: var(--primary-light); color: var(--text); }

.map-right-body { flex: 1; overflow-y: auto; }
.map-right-loading { padding: 24px; text-align: center; color: var(--text-muted); font-size: 0.85rem; }

.map-right-img {
  width: 100%;
  aspect-ratio: 16/9;
  overflow: hidden;
  background: var(--primary-light);
}
.map-right-img img { width: 100%; height: 100%; object-fit: cover; }

.map-right-content { padding: 16px; }
.map-right-platform {
  font-size: 0.72rem;
  font-weight: 600;
  background: var(--primary);
  color: white;
  display: inline-block;
  padding: 2px 8px;
  border-radius: var(--radius-pill);
  margin-bottom: 8px;
}
.map-right-price { font-size: 1.3rem; font-weight: 800; letter-spacing: -0.02em; }
.map-right-deposit { font-size: 0.8rem; color: var(--text-muted); margin-top: 2px; }
.map-right-addr { font-size: 0.82rem; color: var(--text-soft); margin-top: 8px; }
.map-right-tags {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
  margin-top: 10px;
}
.map-right-tags span {
  font-size: 0.72rem;
  padding: 2px 8px;
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  color: var(--text-soft);
}
.map-right-desc {
  margin-top: 10px;
  font-size: 0.82rem;
  color: var(--text-soft);
  line-height: 1.5;
}
.map-right-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 16px;
}
.map-right-btn {
  padding: 8px 16px;
  border-radius: var(--radius);
  font: inherit;
  font-size: 0.85rem;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
  border: none;
}
.map-right-btn--primary {
  background: var(--primary);
  color: white;
}
.map-right-btn--primary:hover { background: var(--primary-hover); }

/* 모바일 하단 시트 */
.map-bottom-sheet {
  display: none;
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: var(--panel);
  border-radius: 14px 14px 0 0;
  box-shadow: 0 -4px 20px rgba(0,0,0,.12);
  transition: height 0.25s ease;
  z-index: 10;
  flex-direction: column;
}
.map-bottom-handle {
  padding: 8px 16px;
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  flex-shrink: 0;
}
.map-bottom-handle-bar {
  width: 36px;
  height: 4px;
  background: var(--line);
  border-radius: 2px;
  flex-shrink: 0;
}
.map-bottom-count { font-size: 0.82rem; color: var(--text-muted); }
.map-bottom-list { flex: 1; overflow-y: auto; padding: 0 12px 16px; }

/* 반응형 */
@media (max-width: 767px) {
  .map-3panel-left { display: none; }
  .map-3panel-right { display: none; }
  .map-bottom-sheet { display: flex; }
}

@media (max-width: 1100px) {
  .map-3panel-right--open { width: 320px; }
  .map-right-panel { width: 320px; }
}
```

- [ ] **Step 3: 빌드 + 서버 재시작해서 시각 확인**

```bash
npm run front:build 2>&1 | tail -3
pkill -f "api_server.mjs"; sleep 1
node scripts/api_server.mjs --host=127.0.0.1 --port=4100 --front-dir=frontend/dist &
```

브라우저에서 `http://127.0.0.1:4100` → 지도 탭 → 3-panel 확인:
- [ ] 좌측 280px 패널에 필터+목록 표시
- [ ] 지도 중앙에 표시
- [ ] 핀 클릭 시 우측 패널 슬라이드인

- [ ] **Step 4: 커밋**

```bash
git add frontend/src/styles.css
git commit -m "feat: 3-panel map CSS — 좌측/중앙/우측 패널 레이아웃"
```

---

## Task 6: MapSidePanel 제거 및 MapFilters 정리

**Files:**
- Delete: `frontend/src/components/map/MapSidePanel.jsx`
- Modify: `frontend/src/components/map/MapFilters.jsx` (참조 없어지면 그대로 유지, 나중에 삭제)

- [ ] **Step 1: MapSidePanel 삭제**

```bash
rm frontend/src/components/map/MapSidePanel.jsx
```

- [ ] **Step 2: MapFilters.jsx 참조 확인 (MapView에서 제거됐는지)**

```bash
grep -r "MapSidePanel\|MapFilters" frontend/src/
```
Expected: 결과 없음 (MapView에서 import 안 함)

- [ ] **Step 3: 빌드 최종 확인**

```bash
npm run front:build 2>&1 | tail -5
```
Expected: `✓ built in` (에러 없음, 경고 없음)

- [ ] **Step 4: .gitignore에 `.superpowers/` 추가**

```bash
grep -q ".superpowers" .gitignore || echo ".superpowers/" >> .gitignore
```

- [ ] **Step 5: 최종 커밋**

```bash
git add -A
git commit -m "feat: 지도 UI 3-panel 개편 완료 — MapSidePanel 제거, 좌/중/우 패널 분리"
```

---

## Task 7: PR 생성 및 머지

- [ ] **Step 1: Push**

```bash
git push origin HEAD
```

- [ ] **Step 2: PR 생성**

```bash
gh pr create \
  --title "feat: 지도 UI 3-panel 개편 (네이버 부동산 스타일)" \
  --body "## Summary
- 좌측 필터+목록 패널 / 중앙 지도 / 우측 상세 슬라이드 패널
- 모바일: 하단 시트 드래그 (직방 스타일)
- MapSidePanel 제거, MapLeftPanel + MapRightPanel + MapBottomSheet로 분리
- KakaoMap InfoWindow 팝업 → 우측 패널로 대체" \
  --base main
```

- [ ] **Step 3: 머지 후 배포 확인**

```bash
gh pr merge --squash --auto --delete-branch
npm run front:build && pkill -f "api_server.mjs"; sleep 1 && node scripts/api_server.mjs --host=127.0.0.1 --port=4100 --front-dir=frontend/dist &
```

---

## 검증 체크리스트

- [ ] 데스크탑: 좌측 목록 카드 클릭 → 지도 pan + 우측 패널 오픈
- [ ] 데스크탑: 지도 핀 클릭 → 좌측 목록 해당 카드 강조 + 우측 패널 오픈
- [ ] 데스크탑: 우측 패널 ✕ → 패널 닫힘 + 핀 선택 해제
- [ ] 데스크탑: 필터 변경 → 지도 마커 + 좌측 목록 동시 갱신
- [ ] 모바일: 지도 풀스크린 + 하단 시트 peek/half/full 드래그
- [ ] 즐겨찾기 버튼 정상 동작
- [ ] 원본 보기 링크 정상 동작
