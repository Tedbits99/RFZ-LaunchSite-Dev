-- Add nullable image_url column to packages for per-package artwork.
-- Stores a Cloudinary (or any HTTPS) image URL shown on customer package cards.
-- RLS is already enforced: admin-only writes (is_admin()), public read for active packages.
ALTER TABLE packages ADD COLUMN IF NOT EXISTS image_url text;
