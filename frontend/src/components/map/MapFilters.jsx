import { useState } from "react";
import { PLATFORM_OPTIONS, FLOOR_FILTER_OPTIONS } from "../../utils/format.js";

export default function MapFilters({ filters, onChange }) {
  const [local, setLocal] = useState({
    platform_code: filters.platform_code || "",
    min_rent: filters.min_rent || "",
    max_rent: filters.max_rent || "",
    min_deposit: filters.min_deposit || "",
    max_deposit: filters.max_deposit || "",
    min_area: filters.min_area || "",
    max_area: filters.max_area || "",
    min_floor: filters.min_floor || "",
  });

  const apply = () => {
    const clean = {};
    if (local.platform_code) clean.platform_code = local.platform_code;
    if (local.min_rent) clean.min_rent = local.min_rent;
    if (local.max_rent) clean.max_rent = local.max_rent;
    if (local.min_deposit) clean.min_deposit = local.min_deposit;
    if (local.max_deposit) clean.max_deposit = local.max_deposit;
    if (local.min_area) clean.min_area = local.min_area;
    if (local.max_area) clean.max_area = local.max_area;
    if (local.min_floor) clean.min_floor = local.min_floor;
    onChange(clean);
  };

  const reset = () => {
    setLocal({
      platform_code: "", min_rent: "", max_rent: "",
      min_deposit: "", max_deposit: "",
      min_area: "", max_area: "", min_floor: "",
    });
    onChange({});
  };

  const handleKey = (e) => { if (e.key === "Enter") apply(); };
  const set = (key, val) => setLocal(p => ({ ...p, [key]: val }));

  return (
    <div className="map-filters">
      <select
        value={local.platform_code}
        onChange={e => set("platform_code", e.target.value)}
      >
        {PLATFORM_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <div className="map-filter-pair">
        <input
          type="number" placeholder="최소 월세" value={local.min_rent}
          onChange={e => set("min_rent", e.target.value)}
          onKeyDown={handleKey}
        />
        <span className="filter-separator">~</span>
        <input
          type="number" placeholder="최대 월세" value={local.max_rent}
          onChange={e => set("max_rent", e.target.value)}
          onKeyDown={handleKey}
        />
      </div>
      <div className="map-filter-pair">
        <input
          type="number" placeholder="최소 보증금" value={local.min_deposit}
          onChange={e => set("min_deposit", e.target.value)}
          onKeyDown={handleKey}
        />
        <span className="filter-separator">~</span>
        <input
          type="number" placeholder="최대 보증금" value={local.max_deposit}
          onChange={e => set("max_deposit", e.target.value)}
          onKeyDown={handleKey}
        />
      </div>
      <div className="map-filter-pair">
        <input
          type="number" placeholder="최소 면적" value={local.min_area}
          onChange={e => set("min_area", e.target.value)}
          onKeyDown={handleKey}
        />
        <span className="filter-separator">~</span>
        <input
          type="number" placeholder="최대 면적" value={local.max_area}
          onChange={e => set("max_area", e.target.value)}
          onKeyDown={handleKey}
        />
      </div>
      <select
        value={local.min_floor}
        onChange={e => set("min_floor", e.target.value)}
      >
        {FLOOR_FILTER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <button className="map-filter-apply" type="button" onClick={apply}>검색</button>
      <button className="map-filter-reset" type="button" onClick={reset}>초기화</button>
    </div>
  );
}
