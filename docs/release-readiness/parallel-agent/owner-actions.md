# Remaining owner actions

These actions require owner/provider access and were intentionally not performed:

1. Confirm production host, Cloudflare account/Worker/domain, Access policy,
   TLS, routes, bindings, and least-privilege token; record identities only.
2. Confirm production Supabase project and hosted migration ledger/schema,
   backup/restore evidence, Auth redirect allowlist, Edge Function versions,
   schedules, storage, Realtime, and names-only secret inventory.
3. Verify GitHub branch/ruleset protection and exact required status contexts;
   keep auto-merge off.
4. Verify the historical FazerCards key was revoked upstream; issue a fresh
   secret only through the approved secret store. Do not test against the real
   supplier.
5. Obtain independent review/signoff for PR #82 and this draft PR, then merge
   only through protected `main` and rerun the final-SHA preflight.
6. Create a restorable database backup and approved rollback decision record;
   never treat the repository as a database backup.
7. Run approved HTTPS Auth/customer/admin read-only smoke tests with payments,
   supplier fulfillment, RF Coins, schedulers, and real email still disabled.
8. Create a separate financial-activation approval for PayMongo/FazerCards/RF
   Coins, with sandbox evidence, limits, monitoring, and rollback rehearsal.
