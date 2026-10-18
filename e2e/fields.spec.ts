import { expect, goTo, test } from './fixtures';

test.describe('number fields', () => {
  test('scrub when their label is dragged, and still take typing', async ({ page }) => {
    await goTo(page, 'Layout');
    const field = page.locator('label.num-field', { has: page.locator('.num-label', { hasText: /^W$/ }) });
    const input = field.locator('input');
    await expect(input).toHaveValue('10');
    const label = (await field.locator('.num-label').boundingBox())!;
    await page.mouse.move(label.x + label.width / 2, label.y + label.height / 2);
    await page.mouse.down();
    await page.mouse.move(label.x + 40, label.y + label.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => Number(await input.inputValue())).toBeGreaterThan(10);
    // A changed size waits for Apply.
    await expect(page.getByRole('button', { name: 'Apply' })).toBeEnabled();
    await page.getByRole('button', { name: 'Revert' }).click();
    await input.fill('12');
    await input.press('Enter');
    await expect(input).toHaveValue('12');
  });
});
