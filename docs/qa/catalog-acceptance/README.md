# CATALOG-001B independent acceptance

This is a companion test workstream for Agent A's CATALOG-001 implementation.
It is based on PR #82's application baseline and deliberately owns only new
files under `e2e/catalog-acceptance/`, `tests/catalog-contract/`, and
`docs/qa/catalog-acceptance/`.

The suite distinguishes:

- `PASS`: exercised against implemented code with sanitized local fixtures.
- `FAIL`: a reproducible defect in implemented code.
- `PENDING_IMPLEMENTATION`: the contract is written but the baseline does not
  yet provide the required catalog CRUD or disposable acceptance fixture.
- `BLOCKED`: required isolated infrastructure or dependency is unavailable.
- `NOT_RUN`: intentionally not executed.

Local tests use only `supplier.invalid`, synthetic identities, mocked fetches,
and source/schema assertions. They do not use FazerCards credentials, supplier
orders, payment APIs, hosted migrations, production data, or real email.

## Commands

```bash
npm test -- tests/catalog-contract/catalog-contract.test.ts
npx playwright test --config=e2e/catalog-acceptance/playwright.config.ts
```

The Playwright cases are intentionally marked `PENDING_IMPLEMENTATION` until
Agent A supplies a disposable Auth/database seed and the real catalog CRUD
workflow. They must be changed to authenticated, evidence-capturing tests only
after that fixture is independently verified as local/disposable.
