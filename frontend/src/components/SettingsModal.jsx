import { useState } from "react";

const FIELD_LABELS = {
  my_capital: "자기자본 (만원)",
  my_income: "연소득 (만원)",
  ltv_ratio: "LTV 비율 (예: 0.70)",
  dti_limit: "DTI 한도 (예: 0.60)",
};

export function SettingsModal({ onClose }) {
  const [pin, setPin] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [settings, setSettings] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleAuth() {
    const res = await fetch("/api/settings/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
    });
    if (!res.ok) {
      setError("PIN이 틀렸습니다");
      return;
    }
    const data = await res.json();
    setSettings(data.settings || {});
    setAuthenticated(true);
    setError("");
  }

  async function handleSave(key, value) {
    setSaving(true);
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin, key, value }),
    });
    setSaving(false);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h3>설정</h3>
        {!authenticated ? (
          <div>
            <input
              type="password"
              placeholder="PIN 입력"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAuth()}
            />
            <button onClick={handleAuth}>확인</button>
            {error && <p className="error">{error}</p>}
          </div>
        ) : (
          <div>
            {Object.entries(FIELD_LABELS).map(([key, label]) => (
              <div key={key} className="setting-row">
                <label>{label}</label>
                <input
                  type="text"
                  defaultValue={settings[key] || ""}
                  onBlur={(e) => handleSave(key, e.target.value)}
                />
              </div>
            ))}
            {saving && <p>저장 중...</p>}
            <button onClick={onClose}>닫기</button>
          </div>
        )}
      </div>
    </div>
  );
}
