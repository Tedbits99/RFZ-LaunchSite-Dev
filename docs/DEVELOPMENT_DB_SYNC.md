# Development database synchronization

The manual workflow `.github/workflows/runfazone-development-db.yml` is the
only supported hosted synchronization path. It uses the protected
`runfazone-development-db` environment and never prints credential values.

It verifies project `ketdhcmwowzztcdlmris` through the Supabase Management API
before linking or applying anything. `audit` and `plan` are non-mutating.
`apply` requires the exact confirmation phrase
`APPLY_DEVELOPMENT_MIGRATIONS` and applies only the 97 SQL migrations from the
verified same-repository PR #14 head. It does not reset the project, mark
migrations as applied, execute PR scripts, or run production integrations.

The workflow must be present on trusted `main` before GitHub will offer manual
dispatch reliably. The environment should contain `SUPABASE_ACCESS_TOKEN`,
`SUPABASE_DB_PASSWORD`, and `SUPABASE_PROJECT_ID`; conflicting variable/secret
project IDs fail closed. Keep PayMongo, supplier, webhook, crypto, and email
credentials absent or sandbox-only in this development project.
