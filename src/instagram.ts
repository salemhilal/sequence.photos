import { useSyncExternalStore } from 'react';
import { INSTAGRAM, SERVER_URL } from './config';
import { decodeBase64Url, encodeBase64Url } from './base64url';
import { isRecord } from './guards';
import { normalizeServerUrl, serverUrl } from './server';

/**
 * Connecting an Instagram account (Instagram API with Instagram Login), through
 * Sequence's server. See sequence-server's README, "Sign-in":
 *
 * 1. `connectInstagram` opens Instagram's sign-in page with a `state` of
 *    `<client>.<nonce>.<challenge>`, after keeping the nonce and a secret `verifier` (whose
 *    hash is the challenge) for this tab.
 * 2. Instagram sends the user to the server, which exchanges the code and sends them back
 *    here with a sealed bundle in the URL's fragment (useless without the verifier).
 * 3. `finishSignIn`, at startup, strips the fragment, checks the state is the one this tab
 *    started, and trades the bundle and verifier for the connection (`/auth/redeem`).
 *
 * The connection (the Instagram token, the account, and Sequence's enrollment) is kept in
 * this browser only.
 */

/** As sequence-server's src/api.ts, plus what the app keeps with it. */
export interface InstagramConnection {
  token: string;
  /** Unix seconds. */
  expiresAt: number;
  refreshedAt: number;
  userId: string;
  username: string;
  enrollment: string;
  /**
   * The server that signed the enrollment: uploads and renewals go there, whatever
   * Settings → Advanced says now (each server's enrollments are its own).
   */
  server: string;
  /** Instagram or the server refused it: the user has to connect again. */
  needsReconnect?: true;
}

type InstagramError = 'cancelled' | 'exchange_failed' | 'missing_permission' | 'not_professional';

const STORAGE_KEY = 'photobook-instagram';
const PENDING_KEY = 'photobook-instagram-pending';

// --- The stored connection ------------------------------------------------------------

/**
 * The connection, if `value` is one: from storage, or from the server (which doesn't
 * name itself: `server` is the one it came from).
 */
export function parseConnection(value: unknown, server: string): InstagramConnection | null {
  if (!isRecord(value)) return null;
  const { token, expiresAt, refreshedAt, userId, username, enrollment } = value;
  const from = typeof value.server === 'string' ? normalizeServerUrl(value.server) : normalizeServerUrl(server);
  if (
    typeof token !== 'string' ||
    !token ||
    typeof expiresAt !== 'number' ||
    !Number.isSafeInteger(expiresAt) ||
    typeof refreshedAt !== 'number' ||
    !Number.isSafeInteger(refreshedAt) ||
    typeof userId !== 'string' ||
    !/^[0-9]{1,32}$/.test(userId) ||
    typeof username !== 'string' ||
    !/^[A-Za-z0-9._]{1,64}$/.test(username) ||
    typeof enrollment !== 'string' ||
    !enrollment ||
    !from
  ) {
    return null;
  }
  return {
    token,
    expiresAt,
    refreshedAt,
    userId,
    username,
    enrollment,
    server: from,
    ...(value.needsReconnect === true && { needsReconnect: true }),
  };
}

function load(): InstagramConnection | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    // Kept before connections named their server: the one in use then.
    return raw ? parseConnection(JSON.parse(raw), serverUrl()) : null;
  } catch {
    return null;
  }
}

let current = load();
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

function set(connection: InstagramConnection | null): void {
  current = connection;
  try {
    if (connection) localStorage.setItem(STORAGE_KEY, JSON.stringify(connection));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Not kept past this session.
  }
  notify();
}

// Another tab connected, disconnected, or refreshed: follow it, so this one never writes
// back a connection that's gone.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY && e.key !== null) return;
    current = load();
    notify();
  });
}

/** Instagram or the server refused the connection: Settings offers to reconnect. */
export function markNeedsReconnect(): void {
  if (current && !current.needsReconnect) set({ ...current, needsReconnect: true });
}

export function instagramConnection(): InstagramConnection | null {
  return current;
}

export function useInstagram(): InstagramConnection | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

/**
 * Forget the connection. (This doesn't revoke Sequence's access: that's in Instagram's
 * settings.)
 */
export function disconnectInstagram(): void {
  set(null);
}

// --- Signing in -------------------------------------------------------------------------

function randomToken(): string {
  return encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function challengeOf(verifier: string): Promise<string> {
  return encodeBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

/** The sign-in this tab started: kept until it comes back. */
interface Pending {
  state: string;
  verifier: string;
  server: string;
}

interface SignInPlan {
  url: string;
  pending: Pending;
}

/** When the chosen server can't be reached, or used from here. */
export const SERVER_ERROR = 'Couldn’t connect to the Sequence server. Check the server in Settings → Advanced.';

/**
 * Instagram's sign-in URL for this app address and server, or why it can't sign in from
 * here: an app address the server doesn't send people back to.
 */
export async function planSignIn(origin: string, server: string): Promise<SignInPlan | { error: string }> {
  const client = INSTAGRAM.clients[origin];
  if (!client) return { error: 'Instagram can’t be connected from this address.' };
  // Only the development server sends sign-ins back to this computer.
  if (client === 'dev' && server === SERVER_URL) return { error: SERVER_ERROR };
  const verifier = randomToken();
  const state = `${client}.${randomToken()}.${await challengeOf(verifier)}`;
  const params = new URLSearchParams({
    client_id: INSTAGRAM.appId,
    redirect_uri: `${server}/auth/callback`,
    response_type: 'code',
    scope: INSTAGRAM.scopes.join(','),
    enable_fb_login: 'false',
    state,
  });
  return { url: `${INSTAGRAM.authorizeUrl}?${params}`, pending: { state, verifier, server } };
}

/** Start connecting: go to Instagram's sign-in page. Returns an error message if it can't. */
export async function connectInstagram(): Promise<string | null> {
  const plan = await planSignIn(location.origin, serverUrl());
  if ('error' in plan) return plan.error;
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(plan.pending));
  } catch {
    return 'This browser isn’t keeping data for this site, so Instagram can’t be connected.';
  }
  location.assign(plan.url);
  return null;
}

/** What came back in the URL's fragment, if it's a sign-in's return. */
type SignInReturn =
  { kind: 'connected'; sealed: string; state: string } | { kind: 'error'; error: InstagramError; state: string };

const ERRORS: readonly InstagramError[] = ['cancelled', 'exchange_failed', 'missing_permission', 'not_professional'];

export function parseSignInReturn(hash: string): SignInReturn | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const state = params.get('state');
  if (!state) return null;
  const sealed = params.get('instagram');
  if (sealed) return { kind: 'connected', sealed, state };
  const error = params.get('instagram_error');
  if (error !== null) {
    const known = ERRORS.find((e) => e === error);
    return { kind: 'error', error: known ?? 'exchange_failed', state };
  }
  return null;
}

function takePending(): Pending | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    sessionStorage.removeItem(PENDING_KEY);
    const v: unknown = raw ? JSON.parse(raw) : null;
    if (!isRecord(v)) return null;
    const { state, verifier, server } = v;
    if (typeof state !== 'string' || typeof verifier !== 'string' || typeof server !== 'string') return null;
    if (normalizeServerUrl(server) !== server) return null;
    return { state, verifier, server };
  } catch {
    return null;
  }
}

const OTHER_TAB =
  'That Instagram sign-in was started in another tab or window, so it was ignored. Connect again from here.';

export const ERROR_MESSAGES: Record<InstagramError, string | null> = {
  // They chose not to; nothing to say.
  cancelled: null,
  exchange_failed: 'Couldn’t connect to Instagram. Try again in a moment.',
  missing_permission: 'Sequence needs permission to publish to your account. Connect again and allow it.',
  not_professional:
    'Posting from Sequence needs an Instagram Business or Creator account. You can switch in Instagram’s settings.',
};

/**
 * At startup: if the URL is a sign-in's return, strip it from the address bar right away,
 * then finish (or report) the sign-in this tab started. A return this tab didn't start
 * (no matching state) is ignored, so a link can't connect someone to another account.
 * Resolves to a message for the user, or null.
 */
export async function finishSignIn(): Promise<string | null> {
  const back = parseSignInReturn(location.hash);
  if (!back) return null;
  history.replaceState(history.state, '', location.pathname + location.search);
  const pending = takePending();
  // Ignored (see above), but say so. The warnings say why, for debugging (nothing secret).
  if (!pending || pending.state !== back.state) {
    console.warn('Instagram sign-in: ignored a return this tab didn’t start.');
    return OTHER_TAB;
  }
  if (back.kind === 'error') {
    console.warn(`Instagram sign-in: the server reported ${back.error}.`);
    return ERROR_MESSAGES[back.error];
  }

  let res: Response;
  try {
    res = await fetch(`${pending.server}/auth/redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sealed: back.sealed, verifier: pending.verifier }),
    });
  } catch (error) {
    // Unreachable, or not allowed (CORS, or the Content Security Policy).
    console.warn(`Instagram sign-in: couldn’t reach ${pending.server}/auth/redeem.`, error);
    return SERVER_ERROR;
  }
  const connection = res.ok ? parseConnection(await res.json().catch(() => null), pending.server) : null;
  if (!connection) {
    console.warn(`Instagram sign-in: /auth/redeem answered ${res.status}${res.ok ? ' with an unexpected body' : ''}.`);
    return ERROR_MESSAGES.exchange_failed;
  }
  set(connection);
  return `Connected to Instagram as @${connection.username}.`;
}

// --- Keeping the connection fresh -------------------------------------------------------

const DAY = 24 * 60 * 60;
/** Refresh the token once it's this old (it lasts ~60 days; Instagram refuses under a day). */
const REFRESH_AFTER = 30 * DAY;
/** Renew the enrollment this long before it expires (it lasts 60 days). */
const RENEW_BEFORE = 15 * DAY;

/** A connection problem the user has to fix by connecting again. */
export class ReconnectError extends Error {}

export const RECONNECT = 'Your Instagram connection needs renewing. Reconnect in Settings.';

/** When an enrollment expires (unix seconds), from its signed payload; 0 if unreadable. */
export function enrollmentExpiry(enrollment: string): number {
  try {
    const payload = enrollment.split('.')[0] ?? '';
    const text = decodeBase64Url(payload);
    const exp = Number(/^v1\nENROLL\n[0-9]+\n([0-9]+)$/.exec(text)?.[1]);
    return Number.isSafeInteger(exp) ? exp : 0;
  } catch {
    return 0;
  }
}

/** A new token from Instagram (no secret needed), or the same connection if that fails. */
async function refreshToken(c: InstagramConnection, now: number): Promise<InstagramConnection> {
  const url = new URL(`${INSTAGRAM.graphOrigin}/refresh_access_token`);
  url.searchParams.set('grant_type', 'ig_refresh_token');
  url.searchParams.set('access_token', c.token);
  let res: Response;
  let body: unknown;
  try {
    res = await fetch(url);
    body = await res.json().catch(() => null);
  } catch {
    return c; // Instagram unreachable: try again next time.
  }
  if (res.ok && isRecord(body) && typeof body.access_token === 'string' && typeof body.expires_in === 'number') {
    return {
      ...c,
      token: body.access_token,
      expiresAt: Math.floor(now + body.expires_in),
      refreshedAt: Math.floor(now),
    };
  }
  // Only an invalid token means reconnecting; anything else (limits, too new) is retried.
  if (isRecord(body) && isRecord(body.error) && body.error.code === 190) {
    markNeedsReconnect();
    throw new ReconnectError(RECONNECT);
  }
  return c;
}

/** A new enrollment from the server that issued it, or the same connection if that fails. */
async function renewEnrollment(c: InstagramConnection): Promise<InstagramConnection> {
  try {
    const res = await fetch(`${c.server}/auth/renew`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.token}` },
      body: JSON.stringify({ enrollment: c.enrollment }),
    });
    const body: unknown = await res.json().catch(() => null);
    if (res.ok && isRecord(body) && typeof body.enrollment === 'string') return { ...c, enrollment: body.enrollment };
  } catch {
    // Server unreachable: try again next time.
  }
  return c;
}

/**
 * The connection, kept fresh: the token is refreshed once it's a month old, and the
 * enrollment renewed when it's within two weeks of expiring, each only marked done when it
 * worked. Throws ReconnectError when the connection is gone, expired, or refused.
 */
export async function freshConnection(now = Date.now() / 1000): Promise<InstagramConnection> {
  const c = current;
  if (!c || c.needsReconnect || c.expiresAt <= now) throw new ReconnectError(RECONNECT);
  let next = c;
  if (now - c.refreshedAt >= REFRESH_AFTER) next = await refreshToken(next, now);
  if (enrollmentExpiry(next.enrollment) - now < RENEW_BEFORE) next = await renewEnrollment(next);
  // Unless this tab's connection was replaced meanwhile (e.g. disconnected elsewhere).
  if (next !== c && current === c) set(next);
  return next;
}
