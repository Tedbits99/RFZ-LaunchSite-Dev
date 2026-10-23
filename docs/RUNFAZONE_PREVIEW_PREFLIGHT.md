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
The account ID may be an environment variable or secret. Credential values are
never written to logs or artifacts. The preflight verifies Wrangler identity,
Cloudflare account access, the OpenNext artifact, and the fixed Worker name
`runfazone-preview`.

## Deployment gate

This infrastructure PR contains no deployment job. A later, separately reviewed
change may add one only after obtaining evidence for the development Supabase
schema, backup and recovery, RLS and authentication, Cloudflare Access
enforcement, and payment, supplier, webhook, and email isolation. No production
database, domain, DNS record, or Worker may be changed by this workflow.
