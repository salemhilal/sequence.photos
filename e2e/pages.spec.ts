import { expect, goTo, MOD, statusText, test } from './fixtures';

test.describe('pages', () => {
  test('the switcher goes to each page, and only the desk has the sidebar toggle', async ({ page }) => {
    const toggle = page.getByRole('button', { name: /^(Hide|Show) spreads$/ });
    await expect(toggle).toBeVisible();
    for (const name of ['Layout', 'Preview', 'Export'] as const) {
      await goTo(page, name);
      await expect(toggle).toHaveCount(0);
    }
    await goTo(page, 'Desk');
    await expect(page.locator('.desk')).toBeVisible();
  });

  test('⌥⌘1–⌥⌘4 go to the pages', async ({ page }) => {
    const on = page.locator('.page-switcher button.on');
    await page.keyboard.press(`${MOD}+Alt+Digit2`);
    await expect(on).toHaveText('Layout');
    await page.keyboard.press(`${MOD}+Alt+Digit3`);
    await expect(on).toHaveText('Preview');
    await page.keyboard.press(`${MOD}+Alt+Digit4`);
    await expect(on).toHaveText('Export');
    await page.keyboard.press(`${MOD}+Alt+Digit1`);
    await expect(on).toHaveText('Desk');
  });

  test('Esc doesn’t leave a page', async ({ page }) => {
    for (const name of ['Layout', 'Preview', 'Export'] as const) {
      await goTo(page, name);
      await page.keyboard.press('Escape');
      await expect(page.locator('.page-switcher button.on')).toHaveText(name);
    }
  });

  test('each page says what it is in the status bar', async ({ page }) => {
    await expect(statusText(page)).toHaveText('0 on desk, 0 placed');
    await goTo(page, 'Layout');
    await expect(statusText(page)).toContainText('10 × 8 in');
    await goTo(page, 'Export');
    await expect(statusText(page)).toContainText('10 × 8 in spreads · 300 dpi');
    await goTo(page, 'Preview');
    await expect(statusText(page)).toHaveText('← → to turn pages · F for fullscreen');
  });

  test('leaving Layout with unapplied changes asks first', async ({ page }) => {
    await goTo(page, 'Layout');
    const width = page
      .locator('label.num-field', { has: page.locator('.num-label', { hasText: /^W$/ }) })
      .locator('input');
    await width.fill('11');
    await width.press('Enter');
    await expect(page.getByRole('button', { name: 'Apply' })).toBeEnabled();

    await page.locator('.page-switcher button', { hasText: 'Desk' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('Apply the page changes?');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('.page-switcher button.on')).toHaveText('Layout');

    await page.locator('.page-switcher button', { hasText: 'Desk' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Discard' }).click();
    await expect(page.locator('.page-switcher button.on')).toHaveText('Desk');
    await goTo(page, 'Layout');
    await expect(width).toHaveValue('10');
  });
});
