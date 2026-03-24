import { useState, useEffect } from "react";

export function AffordabilityBadge({ salePrice }) {
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!salePrice) return;
    fetch(`/api/affordability?salePrice=${salePrice}`)
      .then((r) => r.json())
      .then(setResult)
      .catch(() => setResult(null));
  }, [salePrice]);

  if (!result) return null;

  if (result.feasible) {
    return (
      <span className="badge badge-feasible">
        ✅ 가능
      </span>
    );
  }

  const shortageText = result.shortage >= 10000
    ? `${(result.shortage / 10000).toFixed(1)}억`
    : `${result.shortage.toLocaleString()}만원`;

  return (
    <span className="badge badge-shortage">
      ⚠️ {shortageText} 부족
    </span>
  );
}
