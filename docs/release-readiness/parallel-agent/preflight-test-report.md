# Preflight test report

Tests were local and read-only on the isolated branch. No provider CLI, hosted
write, payment, supplier request, deployment, or production migration ran.

| Case | Result |
|---|---|
| Real checkout: exact SHA/branch, 101 migration files/checksums, config names, checks/protection evidence, disabled lock, rollback/evidence docs | PASS |
| Wrong expected SHA | BLOCKED as expected |
| Missing required configuration evidence | BLOCKED as expected |
| Missing required check evidence | BLOCKED as expected |
| Unsafe release lock | BLOCKED as expected |

The passing case used synthetic local evidence files that were removed after
the test. Hosted readiness is not claimed by this report.
