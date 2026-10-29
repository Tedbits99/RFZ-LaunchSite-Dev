# CATALOG-001 disposable fixtures

These commands are local-only. They do not contact Supabase, suppliers, payment providers, or email services.

```sh
scripts/catalog-001/disposable-postgres.sh start
# Run the selected migration/contract harness against:
# postgresql://postgres:synthetic-only@127.0.0.1:55432/runfazone
scripts/catalog-001/disposable-postgres.sh stop
```

The implementation requires synthetic Auth identities for admin, staff, and customer roles. The current cloud workspace has Docker/PostgreSQL but no Supabase CLI or local Auth service, so those identities remain a CI/local-Supabase prerequisite. Do not point this fixture at a hosted URL or supply production credentials.

Required synthetic identities:

- `admin@example.invalid`: catalog lifecycle and package-management checks.
- `staff@example.invalid`: authorization-denial checks for admin routes.
- `customer@example.invalid`: storefront and checkout visibility checks.

Seed data must use deterministic UUIDs and offer IDs, with at least one draft game, one published game, one archived game, a positive-price package, a zero-price package, duplicate supplier offers, and a disappeared upstream offer. Teardown is `scripts/catalog-001/disposable-postgres.sh stop`; no hosted migration is part of setup or teardown.
