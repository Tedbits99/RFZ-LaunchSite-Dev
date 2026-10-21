# Unapplied migration archive

These files were never present in the verified hosted ledger, whose latest
version is `20260928062039`. They are intentionally outside
`supabase/migrations/`, so Supabase CLI and the GitHub deployment integration
cannot execute them accidentally.

The active executable directory is the reviewed 96-file canonical sequence.
Archived files include superseded duplicate migrations, known incompatible
RPC predecessors, the scheduler migration with an embedded outbound target,
and the RF Coins feature migrations explicitly marked pending/owner approval.

The files are preserved byte-for-byte for historical review. Reintroducing any
of them requires a new reviewed migration and a fresh isolated validation.
