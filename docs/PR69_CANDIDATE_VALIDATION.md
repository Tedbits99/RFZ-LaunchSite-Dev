# PR #69 candidate validation

The `Runfazone PR69 candidate validation` workflow is a manually dispatched,
main-branch workflow. It is not a pull-request trigger and never executes a
workflow file from the candidate commit.

It verifies that PR #69 is still open/draft, that the supplied SHA is its exact
head, and that the exact-head Frontend validation, Development validation,
isolated security, and production-safety checks succeeded. The candidate build
runs without Cloudflare, Supabase database, service-role, payment, supplier,
SMTP, or recovery-secret credentials.

`candidate-preflight` only builds and scans the immutable artifact. The
explicit `deploy-candidate` operation requires the exact confirmation phrase
`DEPLOY_PR69_CANDIDATE`, verifies the saved account-wide Cloudflare Access
policy, and uses `wrangler versions upload` with a preview alias. It does not
run `wrangler deploy` or activate a new Worker version, so the current `main`
preview remains unchanged. Anonymous access to the version URL must still be
denied before the operation can pass.

Owner-authenticated browser acceptance remains a separate required test; the
workflow never requests or logs owner passwords, OTPs, cookies, or tokens.
