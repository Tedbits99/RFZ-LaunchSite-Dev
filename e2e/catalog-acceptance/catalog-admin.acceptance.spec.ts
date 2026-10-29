import { test } from '@playwright/test';

/*
 * These are executable-on-approval contracts, not fabricated passes. They
 * require a real disposable Supabase/Auth fixture supplied by Agent A or CI:
 * CATALOG_ACCEPTANCE_BASE_URL, CATALOG_ADMIN_STORAGE_STATE, and a matching
 * synthetic database seed. Until the CRUD implementation and fixture exist,
 * each case is explicitly PENDING_IMPLEMENTATION.
 */
const pending = 'PENDING_IMPLEMENTATION: catalog CRUD fixture and admin workflow are not available on this baseline';

test.describe('CATALOG-001B admin catalog acceptance', () => {
  test.fixme(true, pending);
  test('admin creates a draft game', async () => {});
  test('duplicate game slugs are rejected', async () => {});
  test('admin edits name, description, region, and artwork', async () => {});
  test('admin configures required player fields', async () => {});
  test('admin publishes an eligible game', async () => {});
  test('admin hides a game and storefront exposure disappears', async () => {});
  test('archived games retain historical references and restore to draft', async () => {});
  test('staff cannot perform unauthorized privileged operations', async () => {});
  test('anonymous and customer identities cannot mutate catalog records', async () => {});
});
