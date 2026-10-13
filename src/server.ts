import { DEV_SERVER_URL, INSTAGRAM, SERVER_URL } from './config';
import { createPref } from './prefs';

/**
 * Sequence's server (the sequence-server repo), which the app uses to post to Instagram.
 * The default is SERVER_URL (config.ts), or DEV_SERVER_URL when the app itself runs on
 * this computer (`npm run dev`), since only the development server sends sign-ins back
 * there. Settings → Advanced can choose either, or one on this computer (e.g. a local
 * `wrangler dev`). Only those: the web app's Content Security Policy allows no others.
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

/** The default server for an app running at `origin`. */
export function defaultServerUrl(origin: string = location.origin): string {
  return INSTAGRAM.clients[origin] === 'dev' ? DEV_SERVER_URL : SERVER_URL;
}

/** This browser's choice; '' means none (use the default). */
export const serverUrlPref = createPref('photobook-server-url', '', (raw) => normalizeServerUrl(raw) ?? undefined);

/** The server to use: this browser's choice, else the default. */
export function serverUrl(): string {
  return serverUrlPref.load() || defaultServerUrl();
}
