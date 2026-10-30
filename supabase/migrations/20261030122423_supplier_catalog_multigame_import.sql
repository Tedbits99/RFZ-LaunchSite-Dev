-- Append-only, sanitized evidence for supplier catalog snapshot imports.
CREATE TABLE public.supplier_catalog_import_runs (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  game_id uuid NOT NULL REFERENCES public.games(id) ON DELETE RESTRICT,
  category_id text NOT NULL,
  source text NOT NULL CHECK (source IN ('live_provider', 'synthetic_fixture')),
  status text NOT NULL CHECK (status IN ('complete', 'partial', 'failed')),
  requested_count integer NOT NULL CHECK (requested_count >= 0),
  created_count integer NOT NULL CHECK (created_count >= 0),
  updated_count integer NOT NULL CHECK (updated_count >= 0),
  deactivated_count integer NOT NULL CHECK (deactivated_count >= 0),
  failed_offer_ids text[] NOT NULL DEFAULT '{}',
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

ALTER TABLE public.supplier_catalog_import_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.supplier_catalog_import_runs FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.supplier_catalog_import_runs TO service_role;

CREATE INDEX supplier_catalog_import_runs_created_idx
  ON public.supplier_catalog_import_runs (created_at DESC);
CREATE INDEX supplier_catalog_import_runs_identity_idx
  ON public.supplier_catalog_import_runs (supplier_id, category_id, game_id, created_at DESC);

-- One supplier offer can map to one package globally. A duplicate existing
-- identity makes this migration fail rather than silently choosing a game.
CREATE UNIQUE INDEX supplier_package_mappings_offer_identity_uidx
  ON public.supplier_package_mappings
    (supplier_id, (metadata ->> 'category_id'), supplier_product_id)
  WHERE supplier_product_id <> ''
    AND metadata ->> 'category_id' <> '';

CREATE UNIQUE INDEX packages_supplier_offer_identity_uidx
  ON public.packages (supplier_category_id, supplier_offer_id)
  WHERE supplier_category_id IS NOT NULL AND supplier_offer_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.admin_import_supplier_catalog(
  p_supplier_id uuid,
  p_game_id uuid,
  p_category_id text,
  p_offers jsonb,
  p_fields jsonb,
  p_region text,
  p_currency text,
  p_complete_snapshot boolean,
  p_actor_id uuid,
  p_source text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_offer jsonb;
  v_offer_id text;
  v_name text;
  v_cost numeric(10,4);
  v_sku text;
  v_package public.packages%ROWTYPE;
  v_existing_mapping public.supplier_package_mappings%ROWTYPE;
  v_has_mapping boolean;
  v_cost_changed boolean;
  v_package_created boolean;
  v_review_count integer := 0;
  v_created integer := 0;
  v_updated integer := 0;
  v_deactivated integer := 0;
  v_failed_ids text[] := '{}';
  v_success_ids text[] := '{}';
  v_requested integer;
  v_source_offer_count integer;
  v_status text;
  v_run_id uuid;
BEGIN
  IF p_source IS DISTINCT FROM 'live_provider' AND p_source IS DISTINCT FROM 'synthetic_fixture' THEN
    RAISE EXCEPTION 'invalid supplier catalog import payload' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_category_id, '') !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$'
     OR pg_catalog.jsonb_typeof(p_offers) IS DISTINCT FROM 'array'
     OR pg_catalog.jsonb_typeof(p_fields) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid supplier catalog import payload' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_currency, '') !~ '^[A-Z]{3}$'
     OR (p_region IS NOT NULL AND pg_catalog.length(p_region) > 80) THEN
    RAISE EXCEPTION 'invalid supplier region or currency metadata' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.jsonb_array_length(p_offers) NOT BETWEEN 1 AND 2000
     OR pg_catalog.jsonb_array_length(p_fields) > 32 THEN
    RAISE EXCEPTION 'invalid supplier catalog import payload' USING ERRCODE = '22023';
  END IF;

  SELECT pg_catalog.count(*), pg_catalog.count(DISTINCT value ->> 'offer_id')
    INTO v_requested, v_source_offer_count
  FROM pg_catalog.jsonb_array_elements(p_offers) AS offers(value);
  IF v_requested <> v_source_offer_count OR EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(p_offers) AS offers(value)
    WHERE pg_catalog.jsonb_typeof(value) IS DISTINCT FROM 'object'
       OR COALESCE(value ->> 'offer_id', '') !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$'
       OR COALESCE(value ->> 'name', '') = ''
       OR pg_catalog.length(value ->> 'name') > 180
       OR COALESCE(value ->> 'price_usd', '') !~ '^[0-9]+(\.[0-9]{1,8})?$'
       OR (value ->> 'price_usd')::numeric <= 0
       OR (value ->> 'price_usd')::numeric > 1000000
       OR pg_catalog.round((value ->> 'price_usd')::numeric, 4) <= 0
  ) THEN
    RAISE EXCEPTION 'invalid or duplicate supplier offer' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(p_fields) AS fields(value)
    WHERE pg_catalog.jsonb_typeof(value) IS DISTINCT FROM 'object'
       OR COALESCE(value ->> 'field_key', '') !~ '^[a-z][a-z0-9_]{0,63}$'
       OR COALESCE(value ->> 'label', '') = ''
       OR pg_catalog.length(value ->> 'label') > 120
       OR pg_catalog.length(COALESCE(value ->> 'placeholder', '')) > 180
       OR pg_catalog.length(COALESCE(value ->> 'help_text', '')) > 500
       OR (value ? 'is_required' AND pg_catalog.jsonb_typeof(value -> 'is_required') IS DISTINCT FROM 'boolean')
  ) OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_array_elements(p_fields))
       <> (SELECT pg_catalog.count(DISTINCT lower(value ->> 'field_key')) FROM pg_catalog.jsonb_array_elements(p_fields) AS fields(value)) THEN
    RAISE EXCEPTION 'invalid or duplicate supplier player field' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.suppliers s WHERE s.id = p_supplier_id AND s.code = 'fazercards';
  IF NOT FOUND THEN RAISE EXCEPTION 'supplier is not configured' USING ERRCODE = '23503'; END IF;
  PERFORM 1 FROM public.games g WHERE g.id = p_game_id AND g.catalog_status <> 'ARCHIVED';
  IF NOT FOUND THEN RAISE EXCEPTION 'target game is missing or archived' USING ERRCODE = '23503'; END IF;

  -- Serialize category imports; offer identity is also protected by a unique index.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_supplier_id::text || ':' || p_category_id, 0)
  );

  FOR v_offer IN SELECT value FROM pg_catalog.jsonb_array_elements(p_offers) AS offers(value)
  LOOP
    v_offer_id := v_offer ->> 'offer_id';
    v_name := v_offer ->> 'name';
    v_cost := pg_catalog.round((v_offer ->> 'price_usd')::numeric, 4);

    BEGIN
      v_has_mapping := false;
      v_package_created := false;
      v_cost_changed := false;
      SELECT p.* INTO v_package
      FROM public.supplier_package_mappings m
      JOIN public.packages p ON p.id = m.package_id
      WHERE m.supplier_id = p_supplier_id
        AND m.supplier_product_id = v_offer_id
        AND m.metadata ->> 'category_id' = p_category_id
      FOR UPDATE OF p, m;

      IF FOUND THEN
        v_has_mapping := true;
        IF v_package.game_id <> p_game_id
           OR v_package.supplier_offer_id IS DISTINCT FROM v_offer_id
           OR v_package.supplier_category_id IS DISTINCT FROM p_category_id THEN
          RAISE EXCEPTION 'cross-game or mismatched supplier mapping';
        END IF;
      ELSE
        SELECT p.* INTO v_package
        FROM public.packages p
        WHERE p.supplier_offer_id = v_offer_id
          AND p.supplier_category_id = p_category_id
        ORDER BY p.created_at, p.id
        LIMIT 1
        FOR UPDATE;

        IF FOUND THEN
          IF v_package.game_id <> p_game_id THEN RAISE EXCEPTION 'offer is assigned to a different game'; END IF;
          SELECT m.* INTO v_existing_mapping
          FROM public.supplier_package_mappings m
          WHERE m.package_id = v_package.id AND m.supplier_id = p_supplier_id
          FOR UPDATE;
          IF FOUND AND (v_existing_mapping.supplier_product_id <> v_offer_id
             OR v_existing_mapping.metadata ->> 'category_id' <> p_category_id) THEN
            RAISE EXCEPTION 'package already has a conflicting supplier mapping';
          END IF;
        ELSE
          v_sku := 'FC-' || p_category_id || '-' || v_offer_id;
          IF EXISTS (SELECT 1 FROM public.packages p WHERE p.sku = v_sku) THEN
            RAISE EXCEPTION 'supplier SKU conflicts with an existing manual package';
          END IF;
          INSERT INTO public.packages (
            game_id, name, amount, sku, price_cents, is_active, catalog_status,
            supplier_offer_id, supplier_category_id, supplier_cost_usd,
            supplier_last_seen_at, supplier_review_required
          ) VALUES (
            p_game_id, v_name, v_name, v_sku, 0, false, 'DRAFT',
            v_offer_id, p_category_id, v_cost, pg_catalog.now(), true
          ) RETURNING * INTO v_package;
          v_package_created := true;
        END IF;
      END IF;

      IF v_package.supplier_offer_id = v_offer_id THEN
        v_cost_changed := v_package.supplier_cost_usd IS DISTINCT FROM v_cost;
        UPDATE public.packages p SET
          supplier_offer_id = v_offer_id,
          supplier_category_id = p_category_id,
          supplier_cost_usd = v_cost,
          supplier_last_seen_at = pg_catalog.now(),
          supplier_review_required = p.supplier_review_required OR v_cost_changed,
          is_active = CASE WHEN v_cost_changed THEN false ELSE p.is_active END,
          catalog_status = CASE WHEN v_cost_changed THEN 'DRAFT' ELSE p.catalog_status END,
          published_at = CASE WHEN v_cost_changed THEN NULL ELSE p.published_at END
        WHERE p.id = v_package.id;
      END IF;

      INSERT INTO public.supplier_package_mappings (
        package_id, supplier_id, supplier_product_id, supplier_cost_cents,
        enabled, metadata, updated_at
      ) VALUES (
        v_package.id, p_supplier_id, v_offer_id, pg_catalog.round(v_cost * 100)::integer,
        false,
        pg_catalog.jsonb_build_object(
          'category_id', p_category_id,
          'offer_id', v_offer_id,
          'product_type', 'game_topup',
          'region', p_region,
          'currency', p_currency,
          'player_fields', p_fields
        ),
        pg_catalog.now()
      )
      ON CONFLICT (package_id, supplier_id) DO UPDATE SET
        supplier_product_id = EXCLUDED.supplier_product_id,
        supplier_cost_cents = EXCLUDED.supplier_cost_cents,
        metadata = EXCLUDED.metadata,
        updated_at = EXCLUDED.updated_at;
      IF v_package_created THEN
        v_created := v_created + 1;
        v_review_count := v_review_count + 1;
      ELSE
        v_updated := v_updated + 1;
        IF v_cost_changed OR v_package.supplier_review_required THEN
          v_review_count := v_review_count + 1;
        END IF;
      END IF;
      v_success_ids := pg_catalog.array_append(v_success_ids, v_offer_id);
    EXCEPTION WHEN OTHERS THEN
      v_failed_ids := pg_catalog.array_append(v_failed_ids, v_offer_id);
    END;
  END LOOP;

  -- Only extend forms after at least one offer was safely imported. Existing
  -- admin definitions are preserved; only absent field keys are added.
  IF pg_catalog.cardinality(v_success_ids) > 0 THEN
    INSERT INTO public.game_input_fields (
      game_id, label, field_key, placeholder, help_text, is_required, sort_order
    )
    SELECT p_game_id, fields.value ->> 'label', lower(fields.value ->> 'field_key'),
      COALESCE(fields.value ->> 'placeholder', ''),
      COALESCE(fields.value ->> 'help_text', ''),
      COALESCE((fields.value ->> 'is_required')::boolean, true),
      fields.ordinality::integer - 1
    FROM pg_catalog.jsonb_array_elements(p_fields) WITH ORDINALITY AS fields(value, ordinality)
    ON CONFLICT (game_id, field_key) DO NOTHING;
  END IF;

  -- A failed item or incomplete provider snapshot must never stale absent rows.
  IF p_complete_snapshot IS TRUE AND pg_catalog.cardinality(v_failed_ids) = 0 THEN
    UPDATE public.packages p SET
      is_active = false,
      catalog_status = 'DRAFT',
      published_at = NULL,
      supplier_review_required = true
    WHERE p.game_id = p_game_id
      AND p.supplier_category_id = p_category_id
      AND p.supplier_offer_id IS NOT NULL
      AND NOT (p.supplier_offer_id = ANY(v_success_ids));
    GET DIAGNOSTICS v_deactivated = ROW_COUNT;
    v_review_count := v_review_count + v_deactivated;
    UPDATE public.supplier_package_mappings m SET enabled = false, updated_at = pg_catalog.now()
    FROM public.packages p
    WHERE m.package_id = p.id
      AND m.supplier_id = p_supplier_id
      AND m.metadata ->> 'category_id' = p_category_id
      AND p.game_id = p_game_id
      AND p.supplier_offer_id IS NOT NULL
      AND NOT (p.supplier_offer_id = ANY(v_success_ids));
  END IF;

  v_status := CASE WHEN pg_catalog.cardinality(v_failed_ids) = 0 THEN 'complete'
                   WHEN pg_catalog.cardinality(v_success_ids) = 0 THEN 'failed'
                   ELSE 'partial' END;
  INSERT INTO public.supplier_catalog_import_runs (
    supplier_id, game_id, category_id, source, status, requested_count,
    created_count, updated_count, deactivated_count, failed_offer_ids, actor_id
  ) VALUES (
    p_supplier_id, p_game_id, p_category_id, p_source, v_status, v_requested,
    v_created, v_updated, v_deactivated, v_failed_ids, p_actor_id
  ) RETURNING id INTO v_run_id;

  RETURN pg_catalog.jsonb_build_object(
    'run_id', v_run_id,
    'status', v_status,
    'created', v_created,
    'updated', v_updated,
    'deactivated', v_deactivated,
    'failed', pg_catalog.cardinality(v_failed_ids),
    'requires_review', v_review_count,
    'failed_offer_ids', to_jsonb(v_failed_ids)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_import_supplier_catalog(uuid, uuid, text, jsonb, jsonb, text, text, boolean, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_import_supplier_catalog(uuid, uuid, text, jsonb, jsonb, text, text, boolean, uuid, text)
  TO service_role;
