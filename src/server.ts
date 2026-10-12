import { createPref } from './prefs';

/**
 * Sequence's server (the sequence-server repo), which the app uses to post to Instagram.
 * The default is the deployed one (VITE_SERVER_URL in .env); Settings → Advanced can
 * point this browser at another, e.g. a local `wrangler dev`.
 */

/**
 * A server address as the app stores it (its origin, no trailing slash), or null if it
 * isn't one: https anywhere, or plain http only on this computer (for local development).
 */
export function normalizeServerUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null;
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== '/') return null;
  return url.origin;
}

/** The deployed server, or null until there is one. */
export const DEFAULT_SERVER_URL: string | null = normalizeServerUrl(import.meta.env.VITE_SERVER_URL ?? '');

/** This browser's override; '' means none (use the default). */
export const serverUrlPref = createPref('photobook-server-url', '', (raw) => normalizeServerUrl(raw) ?? undefined);

/** The server to use: this browser's override, else the default (null if neither). */
export function serverUrl(): string | null {
  return serverUrlPref.load() || DEFAULT_SERVER_URL;
}
