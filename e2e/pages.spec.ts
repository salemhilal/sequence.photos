import { expect, goTo, MOD, openLayout, statusText, test } from './fixtures';

test.describe('pages', () => {
  test('the switcher goes to each page, and only the desk has the sidebar toggle', async ({ page }) => {
    const toggle = page.getByRole('button', { name: /^(Hide|Show) spreads$/ });
    await expect(toggle).toBeVisible();
    for (const name of ['Preview', 'Export'] as const) {
      await goTo(page, name);
      await expect(toggle).toHaveCount(0);
    }
    await goTo(page, 'Desk');
    await expect(page.locator('.desk')).toBeVisible();
  });

  test('⌥⌘1–⌥⌘3 go to the pages', async ({ page }) => {
    const on = page.locator('.page-switcher button.on');
    await expect(page.locator('.page-switcher button')).toHaveText(['Desk', 'Preview', 'Export']);
    await page.keyboard.press(`${MOD}+Alt+Digit2`);
    await expect(on).toHaveText('Preview');
    await page.keyboard.press(`${MOD}+Alt+Digit3`);
    await expect(on).toHaveText('Export');
    await page.keyboard.press(`${MOD}+Alt+Digit1`);
    await expect(on).toHaveText('Desk');
  });

  test('Esc doesn’t leave a page', async ({ page }) => {
    for (const name of ['Preview', 'Export'] as const) {
      await goTo(page, name);
      await page.keyboard.press('Escape');
      await expect(page.locator('.page-switcher button.on')).toHaveText(name);
    }
  });

  test('each page says what it is in the status bar', async ({ page }) => {
    await expect(statusText(page)).toHaveText('0 on desk, 0 placed');
    await openLayout(page);
    await expect(statusText(page)).toContainText('10 × 8 in');
    await page.keyboard.press('Escape');
    await goTo(page, 'Export');
    await expect(statusText(page)).toContainText('10 × 8 in spreads · 300 dpi');
    await goTo(page, 'Preview');
    await expect(statusText(page)).toHaveText('← → to turn pages · F for fullscreen');
    // Layout over the page says its own; closing it brings back the page's.
    await openLayout(page);
    await expect(statusText(page)).toContainText('10 × 8 in');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Layout' })).toHaveCount(0);
    await expect(statusText(page)).toHaveText('← → to turn pages · F for fullscreen');
  });

  test('⌥⌘P opens and closes Layout', async ({ page }) => {
    const dialog = page.getByRole('dialog', { name: 'Layout' });
    await page.keyboard.press(`${MOD}+Alt+KeyP`);
    await expect(dialog).toBeVisible();
    await page.keyboard.press(`${MOD}+Alt+KeyP`);
    await expect(dialog).toHaveCount(0);
  });

  test('Layout is a dialog from the toolbar, closed by Esc or ×, that asks before dropping changes', async ({
    page,
  }) => {
    await openLayout(page);
    const dialog = page.getByRole('dialog', { name: 'Layout' });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    await openLayout(page);
    const width = dialog
      .locator('label.num-field', { has: page.locator('.num-label', { hasText: /^W$/ }) })
      .locator('input');
    await width.fill('11');
    await width.press('Enter');
    await expect(dialog.getByRole('button', { name: 'Apply' })).toBeEnabled();

    // Closing, or going to another page, asks first.
    await dialog.getByRole('button', { name: 'Close' }).click();
    const ask = page.getByRole('alertdialog');
    await expect(ask).toContainText('Apply the page changes?');
    await ask.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeVisible();

    await page.locator('.page-switcher button', { hasText: 'Export' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Discard' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.page-switcher button.on')).toHaveText('Export');
    await openLayout(page);
    await expect(width).toHaveValue('10');
  });
});
