# Migration count reconciliation

No migration file was modified or applied. Counts were obtained by parsing the
canonical manifest on PR #91's base (`main`, SHA
`0fde4cf946c85150fc0a607657e4a9e18f8c4afe`) and the current PR #82 head
(`e131e4ef0eef86785c7eeade4717ccbd049588a6`).

| Manifest | Included | Excluded | Deferred outside this manifest | Total manifest rows |
|---|---:|---:|---:|---:|
| PR #91 / main | 101 | 19 | 4 PR #82-only candidates | 120 |
| PR #82 | 105 | 19 | 0 | 124 |

The four-entry difference is explained by PR #82's manifest-only additions:

- `20261028115900_grant_service_role_supplier_transactions_select.sql`
- `20261028120000_rf_coins_schema.sql`
- `20261028120100_rf_coins_functions.sql`
- `20261028120200_rf_coin_admin_center_read.sql`

These are RF Coins/service-role changes on Agent A's candidate line, not an
indication that PR #91 lost four migrations. PR #91's source tree contains 101
SQL files and its preflight requires an exact set and checksum match. They are
deferred from PR #91's production-preflight release set until Agent A's PR is
independently reviewed. RF Coins activation remains separately deferred; no
hosted migration is authorized by this reconciliation.
