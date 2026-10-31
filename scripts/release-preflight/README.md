# Release preflight

`run.sh` is a local/CI-only, read-only gate. It never invokes GitHub,
Cloudflare, Supabase, payment, supplier, DNS, or email APIs and never requires
production secret values. It fails closed on checkout, evidence, branch, SHA,
manifest hash, configuration, migration, check, protection, lock, rollback, or
evidence-origin failures. `rg` is explicitly required and version-checked.
Required-check and protection expectation files are paired with `.required`
files. Every non-comment evidence line must be exactly `PASS|NAME`, with no
duplicates, stale contexts, malformed lines, or missing required contexts.

The release lock accepts only the five exact state lines. The evidence index
must declare `ORIGIN=synthetic` plus `SYNTHETIC_FIXTURE=PASS` for local tests,
or `ORIGIN=hosted-independent` plus an independent verification marker and
hosted evidence identifier for separately verified hosted evidence.

The script is intentionally safe to exercise with synthetic fixtures. A caller
must supply the evidence files and the expected migration-manifest SHA-256; the
repository does not claim that a local run proves hosted readiness.
