import { defineConfig, devices } from '@playwright/test';

/**
 * The web app's interaction tests (npm run test:e2e): pages, the status bar, Settings, the
 * spread editor, and the like, driven in Chromium and in WebKit (the Mac app's engine).
 * They run against the dev server on a port of their own, so a running `npm run dev` isn't
 * disturbed. The Mac app's own end-to-end test is `npm run test:app`.
 */
const PORT = 5181;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}/app/`,
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/app/`,
    reuseExistingServer: !process.env.CI,
  },
});
