-- Fix listing image uniqueness to keep one row per listing + source URL.
-- Before: unique constraint only on source_url caused images of different listings to overwrite each other.

ALTER TABLE listing_images
  DROP CONSTRAINT IF EXISTS uq_listing_image_src;

ALTER TABLE listing_images
  DROP CONSTRAINT IF EXISTS uq_listing_image_source_url;

DROP INDEX IF EXISTS listing_images_source_url_key;
DROP INDEX IF EXISTS uq_listing_image_source_url;

ALTER TABLE listing_images
  ADD CONSTRAINT uq_listing_image_source_url UNIQUE (listing_id, source_url);

CREATE INDEX IF NOT EXISTS idx_listing_images_source_url ON listing_images(source_url);
