import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { isoToZonedDateTimeInput } from '../../lib/voucherCampaign';
import { loginAdmin, writeEvidence } from '../catalog-001/fixture-support';

test.beforeEach(async ({ page }) => {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === 'data:' || ['localhost', '127.0.0.1'].includes(url.hostname)) return route.continue();
    return route.abort('blockedbyclient');
  });
});

test('admin creates, activates, pauses, archives and reloads a persisted campaign', async ({ page }, testInfo) => {
  await loginAdmin(page);
  await page.goto('/admin/vouchers');
  await page.getByRole('button', { name: 'New campaign' }).click();

  const name = `Synthetic UI ${testInfo.project.name} ${randomUUID().slice(0, 6)}`;
  const code = `VCH-${randomUUID().slice(0, 8).toUpperCase()}`;
  const dialog = page.getByRole('dialog', { name: 'New campaign draft' });
  const timezone = await dialog.getByLabel('Campaign timezone').inputValue();
  await dialog.getByLabel('Campaign name').fill(name);
  await dialog.getByLabel('Description').fill('Created by isolated desktop/mobile campaign acceptance.');
  await dialog.getByLabel('Unique code').fill(code);
  await dialog.getByLabel(`Starts at (${timezone})`).fill(
    isoToZonedDateTimeInput(new Date(Date.now() - 60_000).toISOString(), timezone),
  );
  await dialog.getByRole('button', { name: 'Save draft' }).click();

  const campaign = page.getByRole('article', { name: `${name} campaign` });
  await expect(campaign).toContainText('DRAFT');
  await expect(campaign).toContainText(code);
  await expect(page.getByRole('status')).toContainText('Campaign saved as a draft.');
  await campaign.getByRole('button', { name: 'Activate' }).click();
  await expect(campaign).toContainText('ACTIVE');
  await campaign.getByRole('button', { name: 'Pause' }).click();
  await expect(campaign).toContainText('PAUSED');

  page.on('dialog', (dialogEvent) => dialogEvent.accept());
  await campaign.getByRole('button', { name: 'Archive' }).click();
  await expect(campaign).toContainText('ARCHIVED');
  await expect(campaign).not.toContainText(/@/);

  await page.reload();
  const persisted = page.getByRole('article', { name: `${name} campaign` });
  await expect(persisted).toContainText('ARCHIVED');
  await expect(persisted).toContainText(code);
  await page.getByLabel('Search campaigns').fill(name);
  await expect(persisted).toBeVisible();
  await persisted.getByRole('button', { name: 'Report' }).click();
  await expect(page.getByRole('dialog', { name: `Campaign report · ${name}` })).toBeVisible();

  await writeEvidence(page, testInfo, {
    action: 'campaign_crud_lifecycle',
    statuses: ['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED'],
    persisted_after_reload: true,
    customer_email_exposed: false,
  });
});
