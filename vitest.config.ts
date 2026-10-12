import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Tests run inside workerd with the `dev` environment's bindings (a local, in-memory R2
// bucket). Secrets come from `miniflare.bindings` below: fixed test values, not real ones.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc', environment: 'dev' },
      miniflare: {
        bindings: {
          IG_APP_ID: 'test-app-id',
          IG_APP_SECRET: 'test-ig-app-secret-0123456789',
          SERVER_SECRET: 'test-server-secret-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          CALLBACK_URL: 'https://server.test/auth/callback',
        },
      },
    }),
  ],
});
