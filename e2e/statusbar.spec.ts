import { addTestImages, expect, goTo, statusText, test } from './fixtures';

test.describe('status bar', () => {
  test('counts photos, says what’s selected, and shows hints at once', async ({ page }) => {
    await addTestImages(page, 3);
    await page.mouse.move(4, 300);
    await expect(statusText(page)).toHaveText('3 on desk, 0 placed');

    await page.locator('.desk .item').first().click();
    await page.mouse.move(4, 300);
    await expect(statusText(page)).toHaveText('1 photo selected');
    await page.keyboard.press('Escape');

    await page.locator('.spread-row').nth(1).click();
    await page.mouse.move(4, 300);
    await expect(statusText(page)).toHaveText('1 spread selected');

    // A hint replaces the text while hovered, and nothing floats beside the pointer.
    await page.getByRole('button', { name: 'Settings' }).hover();
    await expect(statusText(page)).toHaveText(/^Settings \((⌘|Ctrl\+),\)$/);
    await expect(page.locator('.tooltip, [role="tooltip"]')).toHaveCount(0);
    await page.mouse.move(4, 300);
    await expect(statusText(page)).toHaveText('1 spread selected');
  });

  test('shows progress while test images are made and added', async ({ page }) => {
    await addTestImages(page, 2);
    await expect(page.locator('.status-progress')).toHaveCount(0);
    await expect(statusText(page)).toContainText('2 on desk');
  });

  test('zooms the desk, and hides zoom off the desk', async ({ page }) => {
    const zoom = page.locator('.status-zoom .menu .btn');
    await expect(zoom).toHaveText('100%');
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await expect(zoom).toHaveText('125%');
    await zoom.click();
    await page.getByRole('menuitem', { name: '50%' }).click();
    await expect(zoom).toHaveText('50%');
    await goTo(page, 'Layout');
    await expect(page.locator('.status-zoom')).toHaveCount(0);
  });
});

test.describe('private windows', () => {
  test('say photos can’t be added where the browser won’t store them', async ({ browser, browserName }) => {
    // Playwright's usual WebKit session is ephemeral: IndexedDB won't store photos there,
    // as in Safari's Private Browsing.
    test.skip(browserName !== 'webkit', 'Only WebKit refuses to store photos in an ephemeral session.');
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.addInitScript(() => localStorage.setItem('photobook-tour', 'seen'));
    await page.goto('./');
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.locator('.settings .tabs button', { hasText: 'Advanced' }).click();
    await page.locator('.test-images-count').fill('1');
    await page.getByRole('button', { name: 'Add test images' }).click();
    await expect(page.locator('.notice')).toContainText('won’t store photos here');
    await context.close();
  });
});
