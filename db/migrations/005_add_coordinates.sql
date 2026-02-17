-- Migration 005: Add lat/lng coordinates for map view
ALTER TABLE normalized_listings
  ADD COLUMN IF NOT EXISTS lat REAL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS lng REAL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS geocode_status TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_listings_coordinates
  ON normalized_listings (lat, lng)
  WHERE lat IS NOT NULL AND lng IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_listings_geocode_status
  ON normalized_listings (geocode_status);
