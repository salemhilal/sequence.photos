import { expect, MOD, openSettings, test } from './fixtures';

test.describe('settings', () => {
  test('groups its settings in three tabs', async ({ page }) => {
    await openSettings(page);
    await expect(page.locator('.settings .tabs button')).toHaveText(['General', 'Instagram & storage', 'Advanced']);
    const general = page.locator('.settings-body');
    for (const title of ['Theme', 'Desk color', 'Status bar', 'Shortcuts']) {
      await expect(general.getByRole('heading', { name: title })).toBeVisible();
    }
    await page.locator('.settings .tabs button', { hasText: 'Instagram & storage' }).click();
    await expect(general.getByRole('heading', { name: 'Instagram' })).toBeVisible();
    await expect(general.getByRole('heading', { name: 'Storage' })).toBeVisible();
  });

  test('opens over the page, keeping the toolbar and status bar in view', async ({ page }) => {
    await openSettings(page);
    await expect(page.locator('.main .modal.settings')).toBeVisible();
    await expect(page.locator('.statusbar')).toBeVisible();
    // A swatch's name is a hint, in the status bar.
    await page.getByRole('radio', { name: 'Light gray' }).hover({ force: true });
    await expect(page.locator('.statusbar .status-text')).toHaveText('Light gray');
  });

  test('hides the status bar, and remembers it', async ({ page }) => {
    await openSettings(page);
    await page.getByLabel('Show the status bar').uncheck();
    await expect(page.locator('.statusbar')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('.app')).toBeVisible();
    await expect(page.locator('.statusbar')).toHaveCount(0);
  });

  test('shows shortcut badges below their buttons while the modifier is held, unless turned off', async ({ page }) => {
    const badges = page.locator('.shortcut-hint');
    await page.keyboard.down(MOD);
    await expect(badges.first()).toBeVisible();
    const labels = await badges.allTextContents();
    for (const key of ['Z', '1', '2', '3', '4', 'B', ',']) {
      expect(labels.some((l) => l.endsWith(key))).toBe(true);
    }
    // Each badge sits below its button.
    const settings = await page.getByRole('button', { name: 'Settings' }).boundingBox();
    const comma = await badges.filter({ hasText: /,$/ }).boundingBox();
    expect(comma!.y).toBeGreaterThan(settings!.y + settings!.height - 1);
    await page.keyboard.up(MOD);
    await expect(badges).toHaveCount(0);

    await openSettings(page);
    await page.getByLabel(/Show shortcuts while/).uncheck();
    await page.keyboard.down(MOD);
    await page.waitForTimeout(500);
    await expect(badges).toHaveCount(0);
    await page.keyboard.up(MOD);
  });
});
