import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Tests run inside workerd with the `dev` environment's bindings (a local, in-memory R2
// bucket). Secrets, and the vars tests depend on, come from `miniflare.bindings` below:
// fixed test values, so tests don't follow wrangler.jsonc's dev values.
export default defineConfig({
  // Spies (fetch, console.log) are put back before each test.
  test: { restoreMocks: true },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc', environment: 'dev' },
      miniflare: {
        bindings: {
          IG_APP_ID: 'test-app-id',
          IG_APP_SECRET: 'test-ig-app-secret-0123456789',
          SERVER_SECRET: 'test-server-secret-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          CALLBACK_URL: 'https://server.test/auth/callback',
          RETURN_URLS: JSON.stringify({
            web: 'https://sequence.photos/app/',
            dev: 'http://localhost:5175/app/',
          }),
          ALLOWED_ORIGINS: JSON.stringify(['https://sequence.photos', 'http://localhost:5175']),
          MAX_FRAMES: '10',
        },
        // High limits so ordinary tests never trip them; test/ratelimit.test.ts checks the
        // limiting itself with fake bindings.
        ratelimits: {
          UPLOAD_RATE_LIMIT: { namespace_id: '9001', simple: { limit: 10_000, period: 60 } },
          IP_RATE_LIMIT: { namespace_id: '9002', simple: { limit: 10_000, period: 60 } },
        },
      },
    }),
  ],
});
