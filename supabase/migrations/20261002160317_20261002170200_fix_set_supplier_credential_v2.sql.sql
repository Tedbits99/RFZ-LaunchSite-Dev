-- Fix set_supplier_credential to use vault.create_secret/update_secret
CREATE OR REPLACE FUNCTION public.set_supplier_credential(p_supplier_code text, p_credential_name text, p_value text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $function$
DECLARE
  v_secret_name text;
  v_existing_id uuid;
BEGIN
  v_secret_name := 'SUPPLIER_' || upper(p_supplier_code) || '_' || upper(p_credential_name);
  
  SELECT id INTO v_existing_id FROM vault.secrets WHERE name = v_secret_name LIMIT 1;
  
  IF v_existing_id IS NOT NULL THEN
    PERFORM vault.update_secret(v_existing_id, p_value);
  ELSE
    PERFORM vault.create_secret(p_value, v_secret_name, 'Supplier credential: ' || p_supplier_code || '/' || p_credential_name);
  END IF;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.set_supplier_credential(text, text, text) TO anon, authenticated;
