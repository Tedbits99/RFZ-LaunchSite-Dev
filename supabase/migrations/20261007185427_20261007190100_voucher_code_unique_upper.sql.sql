/*
# Case-insensitive unique voucher codes

1. Plain-English explanation
   Voucher codes must be unique regardless of letter casing, and must be
   stored normalized: trimmed and uppercase. This migration adds a
   database-level unique index on the uppercase form of the code, so two
   vouchers can never exist as "save10" and "SAVE10".

2. Modified tables
   - `vouchers`: new unique index `vouchers_code_upper_key` on upper(code).
     Existing rows are normalized first (trim + uppercase) so the index
     can be created safely; the primary-key id is unchanged and no data is
     lost (codes only change casing/whitespace).

3. Security changes
   - None.

4. Important notes
   - The existing per-code unique index stays in place for compatibility.
   - The Admin API already uppercases and trims codes before insert, so
     this index is a second line of defense.
*/

UPDATE public.vouchers SET code = upper(btrim(code));

CREATE UNIQUE INDEX IF NOT EXISTS vouchers_code_upper_key
  ON public.vouchers (upper(btrim(code)));
