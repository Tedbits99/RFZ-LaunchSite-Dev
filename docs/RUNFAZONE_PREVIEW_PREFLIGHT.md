# Runfazone private preview preflight

This workflow is intentionally manual and is infrastructure-only. It does not
run on pushes or pull requests, and its default operation is `preflight`.

## Required dispatch

After this workflow is available on the default branch, dispatch **Runfazone
private preview** from `main` with:

- `head_sha`: the full, current `main` commit SHA
- `operation`: `preflight`

For the owner-authorized deployment, use the same trusted `main` dispatch with
`operation: deploy-private-preview` and `gate_b_audit_run_id: 40175163923`.
The workflow rechecks the current `main` commit and all required validation checks, the
successful hosted Gate B audit, the saved account-wide Cloudflare Access
policy, and the development Supabase identity before it can upload the named
Worker. It then resolves and tests both the normal workers.dev URL and the
immutable version URL. It does not configure routes, custom domains, DNS, or
production credentials.

The workflow verifies that the deployment ref is trusted `main`, belongs to
the same repository, and matches the supplied SHA. It also requires successful
`Next.js checks`, `Isolated Supabase RPC security tests`, and `Production release
safety` check runs on that exact SHA.

The `runfazone-preview` environment supplies the scoped Cloudflare credentials.
The account ID may be an environment variable or secret. Credential values are
never written to logs or artifacts. The preflight first calls Cloudflare's
`/user/tokens/verify` endpoint and requires an active token, then verifies the
intended account, Wrangler identity, OpenNext artifact, and fixed Worker name
`runfazone-preview`. Diagnostics expose only HTTP status and numeric API codes.

Failures are classified as `TOKEN_INVALID`,
`TOKEN_VALID_BUT_WRANGLER_FAILS`, `ACCOUNT_MISMATCH_OR_UNAVAILABLE`, or
`INSUFFICIENT_PERMISSIONS`; invalid credentials are not retried indefinitely.

## Deployment gate

Deployment is available only as the explicit `deploy-private-preview` operation
from trusted `main`. It remains protected by the `runfazone-preview`
environment. The deployment job accepts no PR-provided credentials, uses only
the immutable OpenNext artifact, requires the verified development project
`ketdhcmwowzztcdlmris`, and rejects privileged/provider secret assignments in
the artifact. No production database, domain, DNS record, or Worker may be
changed by this workflow.
