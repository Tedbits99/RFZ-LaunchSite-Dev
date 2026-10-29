# Release preflight

`run.sh` is a local/CI-only, read-only gate. It never invokes GitHub,
Cloudflare, Supabase, payment, supplier, DNS, or email APIs and never requires
production secret values. It fails closed on checkout, evidence, branch, SHA,
configuration, migration, check, protection, lock, rollback, or evidence-index
failures. Required-check and protection expectation files are paired with
`.required` files whose entries must appear as `PASS|NAME` evidence lines.

The script is intentionally safe to exercise with synthetic fixtures. A caller
must supply the evidence files; the repository does not claim that a local run
proves hosted readiness.
