import assert from 'node:assert/strict';
import console from 'node:console';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const integrationRoot = path.resolve(process.argv[2] || '');
assert(integrationRoot && integrationRoot !== projectRoot && !integrationRoot.startsWith(`${projectRoot}${path.sep}`), 'companion activation requires an isolated worktree outside the implementation checkout');
const allowedRoots = [process.env.RUNNER_TEMP, os.tmpdir()].filter(Boolean).map((root) => path.resolve(root));
assert(allowedRoots.some((root) => integrationRoot.startsWith(`${root}${path.sep}`)), 'integration worktree must be under a disposable temporary root');
assert(fs.existsSync(path.join(integrationRoot, '.git')), 'target is not a Git worktree');

function read(relative) {
  return fs.readFileSync(path.join(integrationRoot, relative), 'utf8');
}

function write(relative, content) {
  fs.writeFileSync(path.join(integrationRoot, relative), content, 'utf8');
}

function replaceOnce(source, oldValue, newValue, label) {
  assert(source.includes(oldValue), `expected exactly one companion source assertion for ${label}`);
  assert(source.indexOf(oldValue) === source.lastIndexOf(oldValue), `duplicate companion source assertion for ${label}`);
  return source.replace(oldValue, newValue);
}

const contractPath = 'tests/catalog-contract/catalog-contract.test.ts';
let contracts = read(contractPath);
const packageGuard = String.raw`expect(read('app/api/admin/package-pricing/route.ts')).toMatch(/requireAdmin\(req\)/);`;
const syncGuard = String.raw`expect(read('app/api/admin/sync-offers/route.ts')).toMatch(/requireAdmin\(req\)/);`;
contracts = replaceOnce(contracts, packageGuard, String.raw`expect(read('app/api/admin/package-pricing/route.ts')).toMatch(/requireCatalogAdmin\(req\)/);`, 'package-pricing catalog guard');
contracts = replaceOnce(contracts, syncGuard, String.raw`expect(read('app/api/admin/sync-offers/route.ts')).toMatch(/requireCatalogAdmin\(req\)/);`, 'supplier sync catalog guard');

const todoMarker = "describe('CATALOG-001B pending contracts', () => {";
const todoStart = contracts.indexOf(todoMarker);
assert(todoStart >= 0, 'PR #92 pending contract block is missing');
const todoClose = contracts.indexOf('\n});', todoStart);
assert(todoClose >= 0 && contracts.slice(todoClose + 4).trim() === '', 'unexpected content after the PR #92 pending contract block');
const todoBlock = contracts.slice(todoStart, todoClose + 4);
assert((todoBlock.match(/\bit\.todo\(/g) || []).length === 9, 'expected exactly nine pending PR #92 catalog contracts');
contracts = contracts.slice(0, todoStart).trimEnd() + '\n';
const fixtureImport = "import { catalogPriceFixture, syntheticCategoryPage, syntheticSupplierConfig } from './catalog-fixtures';";
contracts = replaceOnce(contracts, fixtureImport, `${fixtureImport}\n\n// The nine formerly pending contracts are exercised against the real disposable Auth/Postgres implementation suite.\nimport '../catalog-001/catalog-integration.test';`, 'real disposable integration suite');
assert(!/\bit\.todo\(/.test(contracts), 'pending Vitest TODOs remain after activation');
write(contractPath, contracts);

for (const [relative, spec, expectedCount] of [
  ['e2e/catalog-acceptance/catalog-admin.acceptance.spec.ts', '../catalog-001/catalog-admin.acceptance.spec', 9],
  ['e2e/catalog-acceptance/storefront-acceptance.spec.ts', '../catalog-001/storefront.acceptance.spec', 7],
]) {
  const placeholder = read(relative);
  assert((placeholder.match(/test\.fixme\(/g) || []).length === 1, `expected one explicit pending browser marker in ${relative}`);
  assert((placeholder.match(/test\('/g) || []).length === expectedCount, `unexpected browser acceptance case count in ${relative}`);
  write(relative, `/* Active companion entrypoint: run the real, database-backed CATALOG-001 acceptance contracts. */\nimport '${spec}';\n`);
}

console.log('CATALOG_COMPANION_ACTIVATION_PASS vitest_todos=9 active_database_suite=13 playwright_cases=16x2');
