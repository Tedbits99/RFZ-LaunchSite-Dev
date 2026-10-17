/*
# Add placement and target_game_id columns to promotions

## Changes
1. New column: `placement` (text, nullable, default 'HOMEPAGE_HERO')
   - Controls where the promotion banner appears.
   - Values: 'HOMEPAGE_HERO', 'GAME_CARD', 'GAME_DETAIL_HERO'
2. New column: `target_game_id` (uuid, nullable, references games(id))
   - For GAME_CARD and GAME_DETAIL_HERO placements, specifies which game
     the banner applies to.
   - NULL for HOMEPAGE_HERO (applies globally).

## Security
- No RLS policy changes needed; existing policies already cover all columns.
- Existing promotions default to 'HOMEPAGE_HERO' so current behavior is preserved.
*/

ALTER TABLE promotions
  ADD COLUMN IF NOT EXISTS placement text NOT NULL DEFAULT 'HOMEPAGE_HERO';

ALTER TABLE promotions
  ADD COLUMN IF NOT EXISTS target_game_id uuid
  REFERENCES games(id) ON DELETE SET NULL;

-- Backfill existing rows so they keep appearing on the homepage hero
UPDATE promotions SET placement = 'HOMEPAGE_HERO' WHERE placement IS NULL OR placement = '';
