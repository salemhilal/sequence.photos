import { type Page } from '@playwright/test';
import { addTestImages, expect, MOD, test } from './fixtures';

async function startTour(page: Page) {
  await page.locator('.toolbar .menu > .btn').first().click();
  await page.getByRole('menuitem', { name: 'Take the tour' }).click();
  await expect(page.locator('.tour-card')).toBeVisible();
}

const card = (page: Page) => page.locator('.tour-card');
const next = (page: Page) => card(page).getByRole('button', { name: 'Next' });

test.describe('tour', () => {
  test('walks through the desk, spreads, editor, Layout, Preview, and Export', async ({ page }) => {
    await startTour(page);
    const titles = [];
    for (;;) {
      titles.push(await card(page).locator('h2').textContent());
      if (!(await next(page).isVisible())) break;
      await next(page).click();
    }
    expect(titles).toEqual([
      'Welcome to Sequence',
      'The desk',
      'Spreads',
      'Arrange a spread',
      'Layout',
      'Preview',
      'Export',
      'Keep a copy',
    ]);
  });

  test('shows each page it talks about', async ({ page }) => {
    await startTour(page);
    for (let i = 0; i < 5; i++) await next(page).click();
    await expect(card(page).locator('h2')).toHaveText('Preview');
    await expect(page.locator('.page-switcher button.on')).toHaveText('Preview');
    await next(page).click();
    await expect(page.locator('.page-switcher button.on')).toHaveText('Export');
    await expect(page.locator('.export-view')).toBeVisible();
    // ← → step through while the card has focus.
    await page.keyboard.press('ArrowLeft');
    await expect(card(page).locator('h2')).toHaveText('Preview');
  });

  test('lets you try the sample project, and brings yours back untouched', async ({ page }) => {
    await addTestImages(page, 2);
    await page.keyboard.press('Escape');
    await startTour(page);
    await next(page).click();
    const items = page.locator('.desk .item');
    await expect(items).toHaveCount(3);
    // Clicking through the dimming selects a sample photo, and the desk's keys work on it.
    await items.first().click();
    await expect(page.locator('.statusbar .status-text')).toContainText('1 photo selected');
    await page.keyboard.press('Delete');
    await expect(items).toHaveCount(2);
    // Nothing in the sample is marked as below its resolution.
    await expect(page.locator('.sidebar .warn, .sidebar .lucide-triangle-alert')).toHaveCount(0);

    await card(page).getByRole('button', { name: 'Skip tour' }).click();
    await expect(page.locator('.tour-card')).toHaveCount(0);
    await expect(items).toHaveCount(2);
    // Saved again once it's back (after the usual short delay).
    await page.waitForTimeout(1000);
    await page.reload();
    await expect(items).toHaveCount(2);
  });

  test('adding your own photos ends it, and they go in your project', async ({ page }) => {
    await startTour(page);
    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press(`${MOD}+I`);
    await (await chooser).setFiles('src/tour/lily.jpg');
    await expect(page.locator('.tour-card')).toHaveCount(0);
    await expect(page.locator('.desk .item')).toHaveCount(1);
  });
});
