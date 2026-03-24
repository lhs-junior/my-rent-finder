// frontend/src/components/PinLoginModal.jsx
import { useState } from "react";

export function PinLoginModal({ onSignIn, error }) {
  const [pin, setPin] = useState("");

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <h3>PIN으로 시작하기</h3>
        <p style={{ fontSize: "0.875rem", color: "#666", marginTop: 0 }}>
          PIN을 입력하면 찜 목록과 재정 설정이 저장됩니다.<br />
          처음이면 새 PIN을 만드세요 (4자리 이상).
        </p>
        <input
          type="password"
          placeholder="PIN 입력"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && pin && onSignIn(pin)}
          autoFocus
          style={{ width: "100%", padding: "0.5rem", marginBottom: "0.5rem", boxSizing: "border-box" }}
        />
        {error && <p className="error">{error}</p>}
        <button
          onClick={() => pin && onSignIn(pin)}
          style={{ width: "100%", padding: "0.5rem", cursor: "pointer" }}
        >
          시작하기
        </button>
      </div>
    </div>
  );
}
