import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test as base, expect, webkit, type Page } from '@playwright/test';

/**
 * Each test starts on a fresh app (empty storage), with the tour already seen so it doesn't
 * cover the desk. WebKit gets a profile on disk: Playwright's usual WebKit session is
 * ephemeral, and there (as in Safari's Private Browsing) IndexedDB won't store photos.
 */
export const test = base.extend({
  page: async ({ page, browserName, viewport, baseURL }, provide) => {
    let dir: string | null = null;
    let open = page;
    if (browserName === 'webkit') {
      dir = mkdtempSync(join(tmpdir(), 'sequence-webkit-'));
      const context = await webkit.launchPersistentContext(dir, { viewport, baseURL });
      open = context.pages()[0] ?? (await context.newPage());
    }
    await open.addInitScript(() => localStorage.setItem('photobook-tour', 'seen'));
    await open.goto('./');
    await expect(open.locator('.app')).toBeVisible();
    await provide(open);
    if (dir) {
      await open.context().close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
});

export { expect };

/** ⌘ on a Mac, Ctrl elsewhere: the app's shortcut modifier. */
export const MOD = 'ControlOrMeta';

/** The status bar's left text. */
export const statusText = (page: Page) => page.locator('.statusbar .status-text');

/** Go to a page with the toolbar's switcher, then move the pointer off it (its hint would show). */
export async function goTo(page: Page, name: 'Desk' | 'Layout' | 'Preview' | 'Export') {
  await page.locator('.page-switcher button', { hasText: name }).click();
  await expect(page.locator('.page-switcher button.on')).toHaveText(name);
  await page.mouse.move(4, 300);
}

/** Open Settings on a tab. */
export async function openSettings(page: Page, tab = 'General') {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.locator('.settings .tabs button', { hasText: tab }).click();
}

/** Add `count` test images (Settings → Advanced), waiting until they're on the desk. */
export async function addTestImages(page: Page, count: number) {
  await openSettings(page, 'Advanced');
  await page.locator('.test-images-count').fill(String(count));
  await page.getByRole('button', { name: 'Add test images' }).click();
  await expect(page.locator('.desk .item')).toHaveCount(count, { timeout: 30_000 });
}

/** Open the spread editor on a sidebar row (0 is the first). */
export async function openEditor(page: Page, row: number) {
  await page.locator('.spread-row').nth(row).dblclick();
  await expect(page.locator('.modal.editor')).toBeVisible();
}
