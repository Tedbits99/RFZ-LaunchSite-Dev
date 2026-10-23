# Runfazone private preview preflight

This workflow is intentionally manual and is infrastructure-only. It does not
run on pushes or pull requests, and its default operation is `preflight`.

## Required dispatch

After this workflow is available on the default branch, dispatch **Runfazone
private preview** from `codex/uiux-007-continuation` with:

- `head_sha`: the full, current PR #14 head SHA
- `operation`: `preflight`

The workflow verifies that PR #14 is open and draft, targets `main`, belongs to
the same repository, and matches the supplied SHA. It also requires successful
`Next.js checks`, `Isolated Supabase RPC security tests`, and `Production release
safety` check runs on that exact SHA.

The `runfazone-preview` environment supplies the scoped Cloudflare credentials.
The account ID may be an environment variable or secret. If both are configured,
they must match; the workflow fails closed on a conflict. The environment
variable is selected when it is the only configured source, otherwise the
secret is selected. Credential values are never written to logs or artifacts.
The preflight first calls Cloudflare's
`/user/tokens/verify` endpoint and requires an active token. It then probes both
the account-details endpoint and the account-scoped Workers Scripts endpoint.
Successful Workers Scripts access is the least-privilege proof that the account
ID is correct for the token and that Worker metadata can be addressed; account
details may be denied when the token intentionally lacks broader account-read
access. Wrangler `whoami` is diagnostic when it cannot enumerate accounts with
an otherwise valid account-scoped token. The preflight also verifies the
OpenNext artifact and fixed Worker name `runfazone-preview`. Diagnostics expose
only HTTP status and numeric API codes.

For the preflight environment, configure a Cloudflare API token scoped to the
intended account with `Workers Scripts: Read` or `Workers Scripts: Edit`.
Cloudflare's Edit permission includes the read capability needed by the
account-scoped listing endpoint. A later reviewed deployment workflow would
require the dashboard's Edit permission (or its API equivalent) for that same
account. No DNS, Workers Routes, account
administration, or unrelated permissions are needed for this no-domain,
preflight-only workflow. Keep `CLOUDFLARE_ACCOUNT_ID` as a protected environment
variable or secret and do not put its value in the repository.

Failures are classified as `TOKEN_INVALID`,
`TOKEN_VALID_BUT_WRANGLER_FAILS`, `ACCOUNT_MISMATCH_OR_UNAVAILABLE`, or
`INSUFFICIENT_PERMISSIONS`; invalid credentials are not retried indefinitely.

## Deployment gate

This infrastructure PR contains no deployment job. A later, separately reviewed
change may add one only after obtaining evidence for the development Supabase
schema, backup and recovery, RLS and authentication, Cloudflare Access
enforcement, and payment, supplier, webhook, and email isolation. No production
database, domain, DNS record, or Worker may be changed by this workflow.
