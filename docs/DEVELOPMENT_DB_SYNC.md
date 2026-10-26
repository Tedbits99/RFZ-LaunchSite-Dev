# Development database synchronization

The manual workflow `.github/workflows/runfazone-development-db.yml` is the
only supported hosted synchronization path. It uses the protected
`runfazone-development-db` environment and never prints credential values.

It verifies project `ketdhcmwowzztcdlmris` through the Supabase Management API
before linking or applying anything. After linking, all database commands use
the linked project explicitly: `migration list --linked`, `db dump --linked`,
and `db push --linked`. `audit` is schema/history-only; `plan` runs
`db push --dry-run` against the reviewed migration set and makes no hosted
change. The workflow installs and verifies `ripgrep` before scanning migration
SQL, and fails closed if the scanner is unavailable. It also performs a
secret-free PostgreSQL `SELECT 1` authentication diagnostic against the
region-derived Supabase pooler before reading migration history; SQLSTATE
`28P01` is reported as an owner credential action rather than retried or
silently accepted.
Before `apply`, the workflow verifies the latest terminal success of the three
required exact-head PR checks and rejects destructive DDL or outbound/scheduled
side effects in the migration source. `apply` also requires the exact phrase
`APPLY_DEVELOPMENT_MIGRATIONS` and applies only the 98 SQL migrations from the
verified current `main` commit. It does not reset the project, mark
migrations as applied, execute PR scripts, or run production integrations.

The workflow must be present on trusted `main` before GitHub will offer manual
dispatch reliably. The environment should contain `SUPABASE_ACCESS_TOKEN`,
`SUPABASE_DB_PASSWORD`, and `SUPABASE_PROJECT_ID`; conflicting variable/secret
project IDs fail closed. Keep PayMongo, supplier, webhook, crypto, and email
credentials absent or sandbox-only in this development project.

`auth-confirmation-audit` is a read-only operation for a protected candidate.
It reads the Supabase Auth configuration through the Management API and reports
only sanitized metadata: the configured site origin, whether the exact
candidate callback is allowlisted, and whether the Confirm signup template uses
`TokenHash` with `type=email`. It never prints the redirect list, template,
tokens, email addresses, or provider credentials, and it cannot change Auth
configuration. A candidate callback must be added to the project's redirect
allowlist before hosted confirmation testing; use a narrowly scoped PR69
wildcard only if it matches the documented Supabase redirect syntax.

`auth-confirmation-configure` is the explicitly confirmed development-only
operation for this PR69 repair. It preserves the existing redirect rules and
updates only the narrowly scoped PR69 callback rules plus the Confirm signup
template. It requires `CONFIGURE_PR69_EMAIL_CONFIRMATION`, reads the settings
back after the PATCH, and emits only hashes of the two changed values. It does
not change the production site URL, customer records, database migrations, or
any provider credentials.

`auth-confirmation-allowlist` is the narrower operation used when the project
email provider cannot accept template changes. It preserves the current
`site_url` while updating only the exact candidate callback and the PR69-only
wildcard, requires `CONFIGURE_PR69_AUTH_REDIRECT`, and reads the persisted
allowlist back. It does not claim fresh-browser confirmation support; that
still requires the TokenHash template and a supported custom SMTP provider.
