import {
  useEffect,
  useRef,
  forwardRef,
  useImperativeHandle,
  useState,
} from "react";

/* eslint-disable no-undef */
const KAKAO_MAP_JS_KEY = String(
  typeof __KAKAO_MAP_JS_KEY__ !== "undefined" ? __KAKAO_MAP_JS_KEY__ : "",
).trim();
const KAKAO_SDK_SCRIPT_ID = "kakao-map-sdk";
const KAKAO_SDK_LIBS = "services,clusterer,drawing";
const MONEY_SWAP_PLATFORMS = new Set(["dabang", "daangn"]);
const MONEY_SWAP_RENT_MIN = 500;
const MONEY_SWAP_DEPOSIT_MAX = 200;
function kakaoSdkUrl() {
  return `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(
    KAKAO_MAP_JS_KEY,
  )}&libraries=${KAKAO_SDK_LIBS}&autoload=false`;
}

let kakaoMapSdkPromise = null;
const RELAYOUT_DELAY_MS = 60;

function loadKakaoMapSdk() {
  if (window.kakao?.maps) return Promise.resolve();

  if (!KAKAO_MAP_JS_KEY) {
    return Promise.reject(new Error(
      "카카오 지도 JS 키가 설정되지 않았습니다. "
      + "KAKAO_MAP_JS_KEY / VITE_KAKAO_JS_KEY / VITE_KAKAO_REST_API_KEY / KAKAO_REST_API_KEY 중 하나를 확인하세요.",
    ));
  }

  if (kakaoMapSdkPromise) return kakaoMapSdkPromise;

  kakaoMapSdkPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById(KAKAO_SDK_SCRIPT_ID);
    if (existing) {
      const onLoad = () => {
        if (window.kakao?.maps) {
          resolve();
        } else {
          kakaoMapSdkPromise = null;
          reject(new Error("카카오 지도 SDK가 로드되었지만 지도 API 초기화가 실패했습니다."));
        }
      };
      existing.addEventListener("load", onLoad, { once: true });
      existing.addEventListener("error", () => {
        kakaoMapSdkPromise = null;
        reject(new Error("카카오 지도 SDK 네트워크 로드 실패"));
      }, { once: true });
      if (existing.readyState === "complete" || existing.readyState === "loaded") onLoad();
      return;
    }

    const script = document.createElement("script");
    script.id = KAKAO_SDK_SCRIPT_ID;
    script.async = true;
    script.src = kakaoSdkUrl();
    script.onload = () => {
      if (window.kakao?.maps) {
        resolve();
      } else {
        kakaoMapSdkPromise = null;
        reject(new Error("카카오 지도 SDK가 로드되었지만 지도 API 초기화가 실패했습니다."));
      }
    };
    script.onerror = () => {
      kakaoMapSdkPromise = null;
      reject(new Error("카카오 지도 SDK 네트워크 로드 실패"));
    };
    document.head.appendChild(script);
  });

  return kakaoMapSdkPromise;
}

const PLATFORM_COLORS = {
  naver: "#03C75A",
  zigbang: "#3B82F6",
  dabang: "#8B5CF6",
  kbland: "#EF4444",
  peterpanz: "#F97316",
  daangn: "#FBBF24",
};

function toMoney(v) {
  if (v == null) return "-";
  return v >= 10000 ? `${(v / 10000).toFixed(1)}억` : `${v}만`;
}

function shouldSwapMoneyForDisplay(platformCode, leaseType, rawText, rentAmount, depositAmount) {
  const normalizedPlatform = String(platformCode || "").toLowerCase();
  if (!MONEY_SWAP_PLATFORMS.has(normalizedPlatform)) return false;
  if (String(leaseType || "").trim() !== "월세") return false;

  const rent = Number(rentAmount);
  const deposit = Number(depositAmount);
  if (!Number.isFinite(rent) || !Number.isFinite(deposit)) return false;
  if (rent <= 0 || deposit <= 0) return false;
  if (rent <= deposit) return false;
  if (deposit > MONEY_SWAP_DEPOSIT_MAX) return false;

  const normalized = String(rawText || "").toLowerCase();
  const rentIndex = normalized.indexOf("월세");
  const depositIndex = normalized.indexOf("보증금");
  if (rentIndex >= 0 && depositIndex >= 0) {
    return depositIndex < rentIndex;
  }

  if (rent >= MONEY_SWAP_RENT_MIN) return true;

  const slash = normalized.indexOf("/");
  const bar = normalized.indexOf("|");
  const divider = slash >= 0 ? slash : bar;
  if (divider < 0) return false;

  const left = normalized.slice(0, divider).match(/([0-9]+(?:\.[0-9]+)?)/)?.[1];
  const right = normalized.slice(divider + 1).match(/([0-9]+(?:\.[0-9]+)?)/)?.[1];
  if (!left || !right) return false;
  return Number(left) >= MONEY_SWAP_RENT_MIN && Number(right) <= MONEY_SWAP_DEPOSIT_MAX;
}

function normalizeDisplayMoney(item) {
  const rentAmount = Number(item?.rent_amount);
  const depositAmount = Number(item?.deposit_amount);
  if (!Number.isFinite(rentAmount) || !Number.isFinite(depositAmount)) {
    return {
      rent: Number.isFinite(rentAmount) ? rentAmount : null,
      deposit: Number.isFinite(depositAmount) ? depositAmount : null,
    };
  }

  if (!shouldSwapMoneyForDisplay(
    item?.platform_code,
    item?.lease_type || item?.platform_code,
    item?.title || item?.address_text || item?.source_ref || "",
    rentAmount,
    depositAmount,
  )) {
    return { rent: rentAmount, deposit: depositAmount };
  }

  return { rent: depositAmount, deposit: rentAmount };
}

function escapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getMarkerInfoHtml(item) {
  const platformLabels = {
    naver: "네이버", zigbang: "직방", dabang: "다방",
    kbland: "KB", peterpanz: "피터팬", daangn: "당근"
  };
  const platformName = platformLabels[item?.platform_code] || item?.platform_code || "매물";
  const platformColor = PLATFORM_COLORS[item?.platform_code] || "#6B7280";

  const price = normalizeDisplayMoney(item);
  const rent = price.rent != null ? `${price.rent}만` : "-";
  const deposit = price.deposit != null ? toMoney(price.deposit) : "-";
  const area = item?.area_m2 != null ? `${item.area_m2}m²` : "";
  const rooms = item?.room_count != null ? `${item.room_count}룸` : "";
  const floor = item?.floor != null ? `${item.floor}층` : "";
  const buildingType = item?.building_use || "";

  const specs = [area, rooms, floor, buildingType].filter(Boolean).join(" · ");
  const addressShort = item?.address_text ?
    (item.address_text.length > 35 ? item.address_text.substring(0, 35) + "..." : item.address_text) :
    "";

  const listingId = escapeHtml(String(item?.listing_id || ""));
  return `
    <div class="map-iw">
      <div class="map-iw-platform" style="background-color: ${escapeHtml(platformColor)};">
        ${escapeHtml(platformName)}
      </div>
      <div class="map-iw-price">보증금 ${escapeHtml(deposit)} / 월세 ${escapeHtml(rent)}</div>
      <div class="map-iw-address">${escapeHtml(addressShort)}</div>
      ${specs ? `<div class="map-iw-detail">${escapeHtml(specs)}</div>` : ""}
      <div class="map-iw-footer" data-open-detail="${listingId}" style="cursor:pointer;">상세보기 ▸</div>
    </div>
  `;
}

const KakaoMap = forwardRef(function KakaoMap({
  center,
  zoom,
  markers,
  selectedId,
  favoriteIds,
  onBoundsChange,
  onMarkerClick,
  onOpenDetail,
}, ref) {
  const containerRef = useRef(null);
  const mapInstance = useRef(null);
  const clustererRef = useRef(null);
  const kakaoMarkersRef = useRef([]);
  const markerEntriesRef = useRef(new Map());
  const infoWindowRef = useRef(null);
  const infoAnchorRef = useRef(null);
  const debounceRef = useRef(null);
  const idleListenerRef = useRef(null);
  const pendingFocusRef = useRef(null);
  const windowResizeHandlerRef = useRef(null);
  const windowScrollHandlerRef = useRef(null);
  const docClickHandlerRef = useRef(null);
  const resizeObserverRef = useRef(null);
  const relayoutRafRef = useRef(0);
  const scrollIdleTimerRef = useRef(null);
  const [sdkError, setSdkError] = useState(null);

  const onBoundsChangeRef = useRef(onBoundsChange);
  onBoundsChangeRef.current = onBoundsChange;

  const onMarkerClickRef = useRef(onMarkerClick);
  onMarkerClickRef.current = onMarkerClick;

  const onOpenDetailRef = useRef(onOpenDetail);
  onOpenDetailRef.current = onOpenDetail;

  const favoriteIdsRef = useRef(favoriteIds);
  favoriteIdsRef.current = favoriteIds;

  const closeInfoWindow = () => {
    if (infoWindowRef.current) {
      try { infoWindowRef.current.close?.(); } catch { /* InfoWindow */ }
      try { infoWindowRef.current.setMap?.(null); } catch { /* CustomOverlay */ }
      infoWindowRef.current = null;
    }
    if (infoAnchorRef.current) {
      infoAnchorRef.current.setMap(null);
      infoAnchorRef.current = null;
    }
  };

  /** Open a CustomOverlay info popup (no auto-pan, unlike InfoWindow). */
  const openInfoOverlay = (position, item) => {
    closeInfoWindow();
    const infoEl = document.createElement("div");
    infoEl.className = "map-info-overlay";
    infoEl.innerHTML = getMarkerInfoHtml(item);

    const closeBtn = document.createElement("button");
    closeBtn.className = "map-info-overlay-close";
    closeBtn.innerHTML = "&times;";
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeInfoWindow();
    });
    const iwEl = infoEl.querySelector(".map-iw");
    if (iwEl) iwEl.prepend(closeBtn);

    const detailBtn = infoEl.querySelector("[data-open-detail]");
    if (detailBtn) {
      detailBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = detailBtn.dataset.openDetail;
        if (id) onOpenDetailRef.current?.(id);
      });
    }

    infoEl.addEventListener("click", (e) => e.stopPropagation());

    const overlay = new window.kakao.maps.CustomOverlay({
      position,
      content: infoEl,
      yAnchor: 1.4,
      zIndex: 10000,
    });
    overlay.setMap(mapInstance.current);
    infoWindowRef.current = overlay;
  };

  const requestMapRelayout = () => {
    if (!mapInstance.current) return;
    const map = mapInstance.current;
    const center = map.getCenter?.();
    if (scrollIdleTimerRef.current) {
      clearTimeout(scrollIdleTimerRef.current);
    }
    scrollIdleTimerRef.current = setTimeout(() => {
      if (!map) return;
      map.relayout();
      if (center && typeof map.setCenter === "function") {
        map.setCenter(center);
      }
      scrollIdleTimerRef.current = null;
    }, RELAYOUT_DELAY_MS);
  };

  const requestMapRelayoutRaf = () => {
    if (relayoutRafRef.current) return;
    relayoutRafRef.current = requestAnimationFrame(() => {
      relayoutRafRef.current = 0;
      const map = mapInstance.current;
      if (!map) return;
      const center = map.getCenter?.();
      map.relayout();
      if (center && typeof map.setCenter === "function") {
        map.setCenter(center);
      }
    });
  };

  const toLatLng = (value) => {
    const lat = Number(value?.lat);
    const lng = Number(value?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !window.kakao?.maps) return null;
    if (lat < 33 || lat > 39 || lng < 124 || lng > 132) return null;
    return new window.kakao.maps.LatLng(lat, lng);
  };

  const applyMapLevel = (zoom) => {
    if (!mapInstance.current || !Number.isFinite(zoom)) return;
    if (typeof mapInstance.current.setLevel !== "function") return;
    const level = Math.max(1, Math.min(14, Math.round(zoom)));
    mapInstance.current.setLevel(level, true);
  };

  const focusAtLatLng = (lat, lng, zoom) => {
    if (!mapInstance.current || !window.kakao?.maps) return false;
    const pos = toLatLng({ lat, lng });
    if (!pos) return false;
    mapInstance.current.setCenter(pos);
    if (Number.isFinite(zoom)) {
      applyMapLevel(zoom);
    }
    return true;
  };

  const focusListingInMap = (listingId, options = {}) => {
    if (!mapInstance.current || !window.kakao?.maps || !clustererRef.current) return false;
    const entry = markerEntriesRef.current.get(String(listingId));
    const fallbackPosition = toLatLng(options.fallbackListing || options.fallbackLatLng);
    const position = fallbackPosition || entry?.position;
    if (!position) return false;

    const infoItem = options.fallbackListing || entry?.item;
    if (!infoItem) return false;

    const explicitZoom = Number.isFinite(options.zoom) ? Math.round(options.zoom) : NaN;
    if (options.panTo !== false) {
      mapInstance.current.setCenter(position);
    }
    if (Number.isFinite(explicitZoom)) {
      applyMapLevel(explicitZoom);
    }

    if (options.openInfoWindow !== false) {
      openInfoOverlay(position, infoItem);
    }
    return true;
  };

  useImperativeHandle(ref, () => ({
    panTo(lat, lng) {
      if (mapInstance.current && window.kakao?.maps) {
        const pos = new window.kakao.maps.LatLng(lat, lng);
        mapInstance.current.panTo(pos);
      }
    },
    focusAt({ lat, lng, zoom }) {
      return focusAtLatLng(lat, lng, zoom);
    },
    focusListing(listingId, options = {}) {
      const config = {
        panTo: true,
        zoom: null,
        openInfoWindow: true,
        ...options,
      };

      if (!focusListingInMap(listingId, config)) {
        pendingFocusRef.current = { listingId, options: config };
        return;
      }
      pendingFocusRef.current = null;
    },
    clearSelection() {
      closeInfoWindow();
    },
    getMap() {
      return mapInstance.current;
    },
    zoomIn() {
      if (!mapInstance.current || !window.kakao?.maps) return;
      const currentLevel = mapInstance.current.getLevel?.();
      if (typeof currentLevel !== "number") return;
      const nextLevel = Math.max(1, Math.round(currentLevel) - 1);
      mapInstance.current.setLevel(nextLevel, true);
    },
    zoomOut() {
      if (!mapInstance.current || !window.kakao?.maps) return;
      const currentLevel = mapInstance.current.getLevel?.();
      if (typeof currentLevel !== "number") return;
      const nextLevel = Math.min(14, Math.round(currentLevel) + 1);
      mapInstance.current.setLevel(nextLevel, true);
    },
  }));

  // Initialize map
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await loadKakaoMapSdk();
        if (cancelled || !containerRef.current || !window.kakao?.maps) return;

        setSdkError(null);

        window.kakao.maps.load(() => {
          if (cancelled || !containerRef.current) return;

          const options = {
            center: new window.kakao.maps.LatLng(center.lat, center.lng),
            level: zoom,
            zoomControl: true,
            zoomControlOptions: {
              position: window.kakao.maps.ControlPosition.RIGHT,
            },
            draggable: true,
            scrollwheel: true,
            disableDoubleClickZoom: false,
          };
          const map = new window.kakao.maps.Map(containerRef.current, options);
          mapInstance.current = map;

          clustererRef.current = new window.kakao.maps.MarkerClusterer({
            map,
            averageCenter: true,
            minLevel: 5,
            disableClickZoom: false,
            styles: [{
              width: "52px", height: "52px",
              background: "rgba(36, 96, 242, 0.85)",
              borderRadius: "50%",
              color: "#fff",
              textAlign: "center",
              lineHeight: "52px",
              fontSize: "14px",
              fontWeight: "700",
            }],
          });

          const emitBounds = () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
            debounceRef.current = setTimeout(() => {
              const b = map.getBounds();
              const sw = b.getSouthWest();
              const ne = b.getNorthEast();
              onBoundsChangeRef.current?.({
                sw: { lat: sw.getLat(), lng: sw.getLng() },
                ne: { lat: ne.getLat(), lng: ne.getLng() },
              });
            }, 300);
          };

          window.kakao.maps.event.addListener(map, "idle", emitBounds);
          idleListenerRef.current = { map, handler: emitBounds };

          if (containerRef.current && typeof window.ResizeObserver !== "undefined") {
            const resizeObserver = new window.ResizeObserver(() => {
              map.relayout();
            });
            resizeObserver.observe(containerRef.current);
            resizeObserverRef.current = resizeObserver;
          }

          /* Delegate clicks on InfoWindow "상세보기" to open detail modal */
          const onDocClick = (e) => {
            const target = e.target.closest("[data-open-detail]");
            if (target) {
              const id = target.dataset.openDetail;
              if (id) onOpenDetailRef.current?.(id);
            }
          };
          document.addEventListener("click", onDocClick);
          docClickHandlerRef.current = onDocClick;

          const onWindowResize = () => map.relayout();
          windowResizeHandlerRef.current = onWindowResize;
          window.addEventListener("resize", onWindowResize);

          const onWindowScroll = () => requestMapRelayoutRaf();
          windowScrollHandlerRef.current = onWindowScroll;
          window.addEventListener("scroll", onWindowScroll, { passive: true });

          setTimeout(() => {
            requestMapRelayout();
            if (pendingFocusRef.current) {
              const { listingId, options: focusOptions } = pendingFocusRef.current;
              if (focusListingInMap(listingId, focusOptions)) {
                pendingFocusRef.current = null;
              }
            }
            emitBounds();
          }, 120);

          setTimeout(emitBounds, 500);
        });
      } catch (error) {
        if (!cancelled) {
          setSdkError(error?.message || "카카오 지도 SDK를 불러오는 중 오류가 발생했습니다.");
        }
      }
    })();

    return () => {
      cancelled = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (idleListenerRef.current) {
        const { map, handler } = idleListenerRef.current;
        window.kakao?.maps?.event?.removeListener(map, "idle", handler);
        idleListenerRef.current = null;
      }
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
      if (windowResizeHandlerRef.current) {
        window.removeEventListener("resize", windowResizeHandlerRef.current);
        windowResizeHandlerRef.current = null;
      }
      if (windowScrollHandlerRef.current) {
        window.removeEventListener("scroll", windowScrollHandlerRef.current);
        windowScrollHandlerRef.current = null;
      }
      if (docClickHandlerRef.current) {
        document.removeEventListener("click", docClickHandlerRef.current);
        docClickHandlerRef.current = null;
      }
      if (scrollIdleTimerRef.current) {
        clearTimeout(scrollIdleTimerRef.current);
        scrollIdleTimerRef.current = null;
      }
      if (relayoutRafRef.current) {
        cancelAnimationFrame(relayoutRafRef.current);
        relayoutRafRef.current = 0;
      }
      closeInfoWindow();
    };
  }, []);

  // Update markers
  useEffect(() => {
    if (!mapInstance.current || !window.kakao?.maps || !clustererRef.current) return;
    /* Do NOT close InfoWindow unconditionally — it kills the InfoWindow
       opened by focusListing before this effect runs.
       Instead, close only when the selected marker is gone (checked below). */
    kakaoMarkersRef.current.forEach((m) => m.setMap(null));
    kakaoMarkersRef.current = [];
    clustererRef.current.clear();
    markerEntriesRef.current.clear();

    const normalizedMarkers = markers
      .map((item) => {
        const markerLat = Number(item?.lat);
        const markerLng = Number(item?.lng);
        if (!Number.isFinite(markerLat) || !Number.isFinite(markerLng)) return null;
        return {
          item,
          markerLat,
          markerLng,
          coordinateKey: `${markerLat.toFixed(6)}:${markerLng.toFixed(6)}`,
        };
      })
      .filter(Boolean)
      .map(({ item, markerLat, markerLng, coordinateKey }) => ({
        item,
        markerLat,
        markerLng,
        coordinateKey,
      }));

    const coordinateBuckets = new Map();
    normalizedMarkers.forEach(({ coordinateKey }) => {
      const list = coordinateBuckets.get(coordinateKey);
      if (list) list.push(coordinateKey);
      else coordinateBuckets.set(coordinateKey, [coordinateKey]);
    });

    const coordinateState = new Map();
    const getSpreadOffset = (index, total) => {
      if (total <= 1) return { latOffset: 0, lngOffset: 0 };
      const radius = 0.00002 * (total - 1);
      const angle = (Math.PI * 2 * index) / total;
      return {
        latOffset: Math.sin(angle) * radius,
        lngOffset: Math.cos(angle) * (radius / 1.15),
      };
    };

    const newMarkers = normalizedMarkers.map(({ item, markerLat, markerLng, coordinateKey }) => {
      const clusterIndex = coordinateState.get(coordinateKey) || 0;
      coordinateState.set(coordinateKey, clusterIndex + 1);
      const sameCount = coordinateBuckets.get(coordinateKey)?.length || 1;
      const offset = getSpreadOffset(clusterIndex, sameCount);
      const pos = new window.kakao.maps.LatLng(markerLat + offset.latOffset, markerLng + offset.lngOffset);
        const color = PLATFORM_COLORS[item.platform_code] || "#6B7280";
        const isSelected = String(item.listing_id) === String(selectedId);
        const markerPrice = normalizeDisplayMoney(item);
        const markerLabel = (() => {
          if (markerPrice.rent != null) return `월세 ${markerPrice.rent}만`;
          if (markerPrice.deposit != null) return `보증금 ${toMoney(markerPrice.deposit)}`;
          return "?";
        })();

        const isFav = typeof favoriteIdsRef.current === "function" && favoriteIdsRef.current(item.listing_id);

        const content = document.createElement("div");
        content.className = `map-marker${isSelected ? " map-marker--selected" : ""}${isFav ? " map-marker--fav" : ""}`;
        content.dataset.listingId = String(item.listing_id);
        content.title = item.address_text || `매물 ${item.listing_id}`;

        if (isSelected) {
          content.style.cssText = `
            background: ${color};
            color: #fff;
            padding: 6px 12px;
            border-radius: 16px;
            font-size: 13px;
            font-weight: 800;
            white-space: nowrap;
            cursor: pointer;
            box-shadow: 0 0 0 4px rgba(255,255,255,0.9), 0 0 16px 4px ${color}80, 0 4px 12px rgba(0,0,0,0.3);
            border: 3px solid #fff;
            transform: scale(1.3);
            position: relative;
            z-index: 9999;
            animation: marker-pulse 1.5s ease-in-out infinite;
          `;
          if (isFav) {
            const heart = document.createElement("span");
            heart.textContent = "\u2764";
            heart.style.cssText = "margin-right:3px;font-size:11px;";
            content.appendChild(heart);
          }
          content.appendChild(document.createTextNode(markerLabel));
          const tail = document.createElement("div");
          tail.style.cssText = `
            position: absolute;
            bottom: -8px;
            left: 50%;
            transform: translateX(-50%);
            width: 0;
            height: 0;
            border-left: 7px solid transparent;
            border-right: 7px solid transparent;
            border-top: 8px solid #fff;
          `;
          content.appendChild(tail);
        } else {
          const favBorder = isFav ? `border: 2px solid #FF3B5C;` : `border: 2px solid transparent;`;
          const favShadow = isFav
            ? `box-shadow: 0 0 0 2px rgba(255,59,92,0.3), 0 2px 6px rgba(0,0,0,0.25);`
            : `box-shadow: 0 2px 6px rgba(0,0,0,0.25);`;
          content.style.cssText = `
            background: ${color};
            color: #fff;
            padding: 4px 8px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 700;
            white-space: nowrap;
            cursor: pointer;
            ${favShadow}
            ${favBorder}
            position: relative;
            z-index: ${isFav ? "10" : "1"};
            transition: transform 0.15s, box-shadow 0.15s;
          `;
          if (isFav) {
            const heart = document.createElement("span");
            heart.textContent = "\u2764";
            heart.style.cssText = "margin-right:3px;font-size:10px;";
            content.appendChild(heart);
          }
          content.appendChild(document.createTextNode(markerLabel));
          content.addEventListener("mouseenter", () => {
            content.style.transform = "scale(1.1)";
            content.style.boxShadow = "0 4px 12px rgba(0,0,0,0.35)";
            content.style.zIndex = "100";
          });
          content.addEventListener("mouseleave", () => {
            content.style.transform = "scale(1)";
            content.style.boxShadow = isFav
              ? "0 0 0 2px rgba(255,59,92,0.3), 0 2px 6px rgba(0,0,0,0.25)"
              : "0 2px 6px rgba(0,0,0,0.25)";
            content.style.zIndex = isFav ? "10" : "1";
          });
        }

        const marker = new window.kakao.maps.CustomOverlay({
          position: pos,
          content,
          yAnchor: 1.3,
        });

        /* Single click = select + InfoWindow tooltip only (no modal) */
        let clickTimer = null;
        content.addEventListener("click", () => {
          if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; return; }
          clickTimer = setTimeout(() => {
            clickTimer = null;
            /* CustomOverlay popup — no auto-pan, no map movement */
            openInfoOverlay(pos, item);
            /* Zoom in if zoomed out, like other real estate platforms */
            const curLevel = mapInstance.current?.getLevel?.();
            if (typeof curLevel === "number" && curLevel > 5) {
              applyMapLevel(5);
            }
            onMarkerClickRef.current?.(item);
          }, 250);
        });

        /* Double click = open detail modal */
        content.addEventListener("dblclick", (e) => {
          e.preventDefault();
          if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
          onOpenDetailRef.current?.(item.listing_id);
        });

        markerEntriesRef.current.set(String(item.listing_id), {
          item,
          position: pos,
        });

        return marker;
      });

    kakaoMarkersRef.current = newMarkers;
    clustererRef.current.clear();
    newMarkers.forEach((m) => m.setMap(mapInstance.current));

    if (selectedId == null || !markerEntriesRef.current.has(String(selectedId))) {
      closeInfoWindow();
    }
    if (pendingFocusRef.current) {
      const { listingId, options } = pendingFocusRef.current;
      if (focusListingInMap(listingId, options)) {
        pendingFocusRef.current = null;
      }
    }
  }, [markers, selectedId, favoriteIds]);

  if (sdkError) {
    return <div ref={containerRef} className="kakao-map kakao-map--error">{sdkError}</div>;
  }

  return <div ref={containerRef} className="kakao-map" />;
});

export default KakaoMap;
