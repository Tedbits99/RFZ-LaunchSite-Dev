/*
# Honor of Kings — UID input field

Adds a required 'UID' input field to the Honor of Kings game so customers
can provide their in-game UID at checkout. The game_input_fields table stores
per-game custom checkout fields. The game ID is resolved from the live
games table by slug ('honor-of-kings') rather than hardcoded, so this works
regardless of what UUID the game row was seeded with.
*/

DO $$
DECLARE
  v_game_id uuid;
BEGIN
  SELECT id INTO v_game_id FROM games WHERE slug = 'honor-of-kings';
  IF v_game_id IS NULL THEN
    RAISE EXCEPTION 'honor-of-kings game not found';
  END IF;

  INSERT INTO game_input_fields (game_id, label, field_key, placeholder, help_text, is_required, sort_order)
  VALUES (v_game_id, 'UID', 'uid', 'Enter your UID', 'Find your UID on your profile page.', true, 1);
EXCEPTION WHEN unique_violation THEN
  NULL; -- already exists
END $$;