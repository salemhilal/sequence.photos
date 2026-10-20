import { expect, goTo, test } from './fixtures';

test.describe('preview', () => {
  test('is a page, with fullscreen as an option that Esc leaves', async ({ page }) => {
    await goTo(page, 'Preview');
    const preview = page.locator('.preview');
    await expect(page.locator('.toolbar')).toBeVisible();
    await expect(page.locator('.preview-count')).toHaveText('1 / 4');
    // No folio, only the count.
    await expect(page.locator('.preview-head .folio')).toHaveCount(0);

    await page.keyboard.press('f');
    await expect(preview).toHaveClass(/presenting/);
    await expect(page.locator('.preview-head')).toContainText('Esc to leave fullscreen');
    await page.keyboard.press('Escape');
    await expect(preview).not.toHaveClass(/presenting/);
    await expect(page.locator('.page-switcher button.on')).toHaveText('Preview');

    await page.getByRole('button', { name: 'Fullscreen' }).click();
    await expect(preview).toHaveClass(/presenting/);
    await page.getByRole('button', { name: 'Exit fullscreen' }).click();
    await expect(preview).not.toHaveClass(/presenting/);
  });

  test('turns pages with the arrows and the buttons', async ({ page }) => {
    await goTo(page, 'Preview');
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.preview-count')).toHaveText('2 / 4');
    await page.getByRole('button', { name: 'Next spread' }).click();
    await expect(page.locator('.preview-count')).toHaveText('3 / 4');
    await page.keyboard.press('Home');
    await expect(page.locator('.preview-count')).toHaveText('1 / 4');
  });
});
