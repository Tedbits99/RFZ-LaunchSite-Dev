/*
# Create generate_order_reference RPC

Creates the missing RPC function that generates unique order reference codes.
This is required by the orders API route to create orders.

1. New Functions
  - `generate_order_reference()` — generates a unique order reference like 'RF-XXXXXX'
    using a combination of random characters, guaranteed unique via collision check

2. Security
  - Function is SECURITY INVOKER (runs as calling role)
  - Callable by anon and authenticated roles
*/

CREATE OR REPLACE FUNCTION generate_order_reference()
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result text;
  i int;
  collision boolean := true;
BEGIN
  WHILE collision LOOP
    result := 'RF-';
    FOR i IN 1..6 LOOP
      result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
    END LOOP;
    SELECT EXISTS(SELECT 1 FROM orders WHERE reference = result) INTO collision;
  END LOOP;
  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION generate_order_reference() TO anon, authenticated;
