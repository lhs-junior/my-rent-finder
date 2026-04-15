-- 016: 관리비 컬럼 추가 (네이버 상세 API articleDetail.monthlyManagementCost)
ALTER TABLE normalized_listings
ADD COLUMN IF NOT EXISTS monthly_management_cost INTEGER;

COMMENT ON COLUMN normalized_listings.monthly_management_cost IS '월 관리비 (원 단위, 네이버: monthlyManagementCost)';
