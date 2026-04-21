-- 성북구 서쪽 (lng < 127.019) 제외 — 성북동·정릉동·삼선동·동소문동·동선동 일부
-- 보문역(보문동 lng 127.020~), 안암역(안암동 lng 127.029~) 이상은 유지
UPDATE normalized_listings SET deleted_at = NOW()
WHERE deleted_at IS NULL
  AND address_text LIKE '서울특별시 성북구%'
  AND lng IS NOT NULL AND lng < 127.019;
