-- Fix the set_supplier_credential function to use correct column name
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
    -- Update via the view which handles encryption
    UPDATE vault.decrypted_secrets SET decrypted_secret = p_value WHERE id = v_existing_id;
  ELSE
    INSERT INTO vault.decrypted_secrets (name, description, decrypted_secret)
    VALUES (v_secret_name, 'Supplier credential: ' || p_supplier_code || '/' || p_credential_name, p_value);
  END IF;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.set_supplier_credential(text, text, text) TO anon, authenticated;
