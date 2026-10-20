/*
# Global Announcement Table

1. New Tables
  - `global_announcement` — stores a single global storefront announcement
    - `id` (uuid, primary key)
    - `enabled` (boolean) — whether the announcement is active on the storefront
    - `display_mode` (text) — 'normal' (dismissible) or 'blocking' (full-screen overlay)
    - `type` (text) — Online, Promotion, Event, Maintenance, Closed, Not Accepting Orders, Upgrading, Temporarily Unavailable, Offline, Custom
    - `title` (text) — announcement heading
    - `message` (text) — announcement body
    - `button_text` (text) — CTA button label
    - `button_link` (text, nullable) — optional URL for the button
    - `return_date_time` (timestamptz, nullable) — optional date/time when the announcement auto-hides
    - `show_countdown` (boolean) — show countdown timer to return_date_time
    - `image_url` (text, nullable) — optional announcement image
    - `created_at` / `updated_at` (timestamptz)

2. Security
  - RLS enabled
  - anon + authenticated can SELECT (storefront reads it)
  - anon + authenticated can INSERT/UPDATE/DELETE (admin writes via service role, but policies allow both for flexibility)

3. Notes
  - Only one row is expected (the active global announcement). The admin UI upserts by id.
*/

CREATE TABLE IF NOT EXISTS global_announcement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enabled boolean NOT NULL DEFAULT false,
  display_mode text NOT NULL DEFAULT 'normal',
  type text NOT NULL DEFAULT 'Maintenance',
  title text NOT NULL DEFAULT '',
  message text NOT NULL DEFAULT '',
  button_text text NOT NULL DEFAULT 'OK',
  button_link text,
  return_date_time timestamptz,
  show_countdown boolean NOT NULL DEFAULT false,
  image_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE global_announcement ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_global_announcement" ON global_announcement;
CREATE POLICY "anon_select_global_announcement" ON global_announcement FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_global_announcement" ON global_announcement;
CREATE POLICY "anon_insert_global_announcement" ON global_announcement FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_global_announcement" ON global_announcement;
CREATE POLICY "anon_update_global_announcement" ON global_announcement FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_global_announcement" ON global_announcement;
CREATE POLICY "anon_delete_global_announcement" ON global_announcement FOR DELETE
  TO anon, authenticated USING (true);