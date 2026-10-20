import { describe, expect, it } from 'vitest';
import tauriConf from '../src-tauri/tauri.conf.json?raw';
import { DEV_SERVER_URL, INSTAGRAM, SERVER_URL } from './config';

/**
 * The Mac app's Content Security Policy is fixed in src-tauri/tauri.conf.json (the
 * website's is built from .env; see vite.config.ts). It has to let the app reach
 * Instagram's API and Sequence's servers, or connecting and posting fail there.
 */
describe('the Mac app’s security policy', () => {
  it('allows Instagram’s API and both of Sequence’s servers', () => {
    const conf = JSON.parse(tauriConf) as { app: { security: { csp: Record<string, string> } } };
    const connect = conf.app.security.csp['connect-src']!.split(' ');
    for (const url of [INSTAGRAM.graphOrigin, SERVER_URL, DEV_SERVER_URL]) {
      expect(connect).toContain(new URL(url).origin);
    }
  });
});
