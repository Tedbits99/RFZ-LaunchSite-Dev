-- UIUX-007: server-validated animation controls for promotional artwork.
-- This is additive and intentionally does not alter existing promotion rows.
ALTER TABLE public.promotions
  ADD COLUMN IF NOT EXISTS animation_preset text NOT NULL DEFAULT 'holographic-reveal',
  ADD COLUMN IF NOT EXISTS motion_speed text NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS autoplay_enabled boolean NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'promotions_animation_preset_check'
  ) THEN
    ALTER TABLE public.promotions
      ADD CONSTRAINT promotions_animation_preset_check
      CHECK (animation_preset IN ('holographic-reveal', 'cinematic-depth', 'futuristic-energy', 'minimal-motion', 'static'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'promotions_motion_speed_check'
  ) THEN
    ALTER TABLE public.promotions
      ADD CONSTRAINT promotions_motion_speed_check
      CHECK (motion_speed IN ('fast', 'standard', 'relaxed'));
  END IF;
END $$;
