import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('config', () => {
  it('builds the site’s addresses from its domain', async () => {
    vi.stubEnv('VITE_SITE_DOMAIN', 'example.photos');
    const { INSTAGRAM, PRIVACY_URL, SITE_URL } = await import('./config');
    expect(SITE_URL).toBe('https://example.photos');
    expect(PRIVACY_URL).toBe('https://example.photos/privacy/');
    expect(INSTAGRAM.clients[SITE_URL]).toBe('web');
    expect(INSTAGRAM.clients['http://localhost:5175']).toBe('dev');
  });

  it('refuses to start without a required value, naming it', async () => {
    for (const name of [
      'VITE_SITE_DOMAIN',
      'VITE_REPO_URL',
      'VITE_APP_STORE_URL',
      'VITE_SERVER_URL',
      'VITE_DEV_SERVER_URL',
      'VITE_INSTAGRAM_APP_ID',
    ]) {
      vi.resetModules();
      vi.stubEnv(name, '');
      await expect(import('./config'), name).rejects.toThrow(`${name} is missing from .env`);
      vi.unstubAllEnvs();
    }
  });
});
