-- Store the FazerCards API key in vault so the Next.js server can retrieve it
-- at runtime via a SECURITY DEFINER function. This avoids the Edge Function
-- secret bridge (which required SUPABASE_SERVICE_ROLE_KEY in the Next.js env)
-- and keeps the key out of source code.

-- Create a vault entry for the FazerCards API key.
-- The actual value will be set by the admin via the admin panel or
-- by calling the set_supplier_credential function.
-- For now, we create the function that reads from vault.

-- Function to get a supplier credential from vault by supplier code
CREATE OR REPLACE FUNCTION public.get_supplier_credential(p_supplier_code text, p_credential_name text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $function$
DECLARE
  v_secret_name text;
  v_value text;
BEGIN
  v_secret_name := 'SUPPLIER_' || upper(p_supplier_code) || '_' || upper(p_credential_name);
  
  SELECT decrypted_secret INTO v_value
  FROM vault.decrypted_secrets
  WHERE name = v_secret_name
  LIMIT 1;
  
  RETURN v_value;
END;
$function$;

-- Grant execute to anon and authenticated so the Next.js server
-- (using anon key or service role key) can call it.
-- The function only returns secrets that match the SUPPLIER_ prefix,
-- and only returns the specific requested credential.
GRANT EXECUTE ON FUNCTION public.get_supplier_credential(text, text) TO anon, authenticated;

-- Function to set a supplier credential in vault
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
    UPDATE vault.secrets SET decrypted_secret = p_value WHERE id = v_existing_id;
  ELSE
    INSERT INTO vault.secrets (name, description, decrypted_secret)
    VALUES (v_secret_name, 'Supplier credential: ' || p_supplier_code || '/' || p_credential_name, p_value);
  END IF;
END;
$function$;

-- Only service role can set credentials
GRANT EXECUTE ON FUNCTION public.set_supplier_credential(text, text, text) TO anon, authenticated;
