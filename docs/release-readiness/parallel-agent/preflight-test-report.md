# Preflight test report

Tests were local and read-only on the isolated branch. No provider CLI, hosted
write, payment, supplier request, deployment, or production migration ran.

| Case | Result |
|---|---|
| Real checkout: exact SHA/branch, manifest SHA, 101 migration files/checksums, config names, checks/protection evidence, disabled lock, rollback/evidence docs | PASS |
| Wrong expected SHA or manifest SHA | BLOCKED as expected |
| Missing required configuration evidence | BLOCKED as expected |
| Missing, duplicated, stale, or spoofed PASS evidence | BLOCKED as expected |
| Malformed release lock or missing synthetic marker | BLOCKED as expected |

The passing case used synthetic local evidence files that were removed after
the test. Hosted readiness is not claimed by this report. Focused executable
cases are in `scripts/release-preflight/test.sh`.
