import { useState, useEffect } from "react";

const FIELD_LABELS = {
  my_capital: "자기자본 (만원)",
  my_income: "연소득 (만원)",
  ltv_ratio: "LTV 비율 (예: 0.70)",
  dti_limit: "DTI 한도 (예: 0.60)",
};

export function SettingsModal({ onClose }) {
  // state: "checking" | "setup" | "login" | "authenticated"
  const [phase, setPhase] = useState("checking");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [settings, setSettings] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/settings/has-pin")
      .then((r) => r.json())
      .then((d) => setPhase(d.configured ? "login" : "setup"))
      .catch(() => setPhase("login")); // fallback: assume configured
  }, []);

  async function handleSetup() {
    setError("");
    if (!/^\d{4,6}$/.test(pin)) {
      setError("PIN은 4~6자리 숫자여야 합니다");
      return;
    }
    if (pin !== confirmPin) {
      setError("PIN이 일치하지 않습니다");
      return;
    }
    const res = await fetch("/api/settings/init-pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
    });
    if (res.status === 409) {
      // PIN was just set by another request — switch to login
      setPhase("login");
      return;
    }
    if (!res.ok) {
      setError("PIN 설정에 실패했습니다");
      return;
    }
    // Auto-authenticate after setup
    await authenticate(pin);
  }

  async function authenticate(pinVal) {
    const res = await fetch("/api/settings/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: pinVal }),
    });
    if (!res.ok) {
      setError("PIN이 틀렸습니다");
      return;
    }
    const data = await res.json();
    setSettings(data.settings || {});
    setPhase("authenticated");
    setError("");
  }

  async function handleLogin() {
    await authenticate(pin);
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

        {phase === "checking" && <p>확인 중...</p>}

        {phase === "setup" && (
          <div>
            <p className="settings-hint">처음 사용 시 PIN을 설정하세요 (4~6자리 숫자)</p>
            <input
              type="password"
              placeholder="새 PIN 입력"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              maxLength={6}
              inputMode="numeric"
            />
            <input
              type="password"
              placeholder="PIN 확인"
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value)}
              maxLength={6}
              inputMode="numeric"
              onKeyDown={(e) => e.key === "Enter" && handleSetup()}
            />
            <button onClick={handleSetup}>PIN 설정</button>
            {error && <p className="error">{error}</p>}
          </div>
        )}

        {phase === "login" && (
          <div>
            <input
              type="password"
              placeholder="PIN 입력"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
              maxLength={6}
              inputMode="numeric"
            />
            <button onClick={handleLogin}>확인</button>
            {error && <p className="error">{error}</p>}
          </div>
        )}

        {phase === "authenticated" && (
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
