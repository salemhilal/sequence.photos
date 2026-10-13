import { DEV_SERVER_URL, SERVER_URL } from './config';
import { createPref } from './prefs';

/**
 * Sequence's server (the sequence-server repo), which the app uses to post to Instagram.
 * The default is SERVER_URL (config.ts); Settings → Advanced can point this browser at
 * the development server or at one on this computer (e.g. a local `wrangler dev`). Only
 * those: the web app's Content Security Policy allows no others.
 */

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

/**
 * A server address as the app stores it (its origin, no trailing slash), or null if it
 * isn't one the app can use: Sequence's servers, or plain http on this computer.
 */
export function normalizeServerUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
  const local = url.protocol === 'http:' && LOCAL_HOSTS.includes(url.hostname);
  if (!local && url.origin !== SERVER_URL && url.origin !== DEV_SERVER_URL) return null;
  return url.origin;
}

export { DEV_SERVER_URL, SERVER_URL };

/** This browser's override; '' means none (use the default). */
export const serverUrlPref = createPref('photobook-server-url', '', (raw) => normalizeServerUrl(raw) ?? undefined);

/** The server to use: this browser's override, else the default. */
export function serverUrl(): string {
  return serverUrlPref.load() || SERVER_URL;
}
