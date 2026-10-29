import { test } from '@playwright/test';

const pending = 'PENDING_IMPLEMENTATION: disposable catalog seed and acceptance server are not available on this baseline';

test.describe('CATALOG-001B storefront acceptance', () => {
  test.fixme(true, pending);
  test('draft, hidden, and archived games are not purchasable', async () => {});
  test('published packages are sorted and unavailable packages cannot enter checkout', async () => {});
  test('a game with no approved packages shows an unavailable state', async () => {});
  test('missing artwork uses a safe fallback', async () => {});
  test('required player fields validate on desktop and mobile', async () => {});
  test('desktop and mobile layouts have no unexpected horizontal overflow', async () => {});
  test('desktop and mobile flows have no unexpected JavaScript exceptions', async () => {});
});
