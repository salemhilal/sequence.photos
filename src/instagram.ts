import { useSyncExternalStore } from 'react';
import { INSTAGRAM, SERVER_URL } from './config';
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

/** As sequence-server's src/api.ts. */
export interface InstagramConnection {
  token: string;
  /** Unix seconds. */
  expiresAt: number;
  refreshedAt: number;
  userId: string;
  username: string;
  enrollment: string;
}

export type InstagramError = 'cancelled' | 'exchange_failed' | 'missing_permission' | 'not_professional';

const STORAGE_KEY = 'photobook-instagram';
const PENDING_KEY = 'photobook-instagram-pending';

// --- The stored connection ------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The connection, if `value` is one (from storage or the server). */
export function parseConnection(value: unknown): InstagramConnection | null {
  if (!isRecord(value)) return null;
  const { token, expiresAt, refreshedAt, userId, username, enrollment } = value;
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
    !enrollment
  ) {
    return null;
  }
  return { token, expiresAt, refreshedAt, userId, username, enrollment };
}

function load(): InstagramConnection | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? parseConnection(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

let current = load();
const listeners = new Set<() => void>();

function set(connection: InstagramConnection | null): void {
  current = connection;
  try {
    if (connection) localStorage.setItem(STORAGE_KEY, JSON.stringify(connection));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Not kept past this session.
  }
  for (const l of listeners) l();
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

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomToken(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function challengeOf(verifier: string): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

/** The sign-in this tab started: kept until it comes back. */
interface Pending {
  state: string;
  verifier: string;
  server: string;
}

export interface SignInPlan {
  url: string;
  pending: Pending;
}

/**
 * Instagram's sign-in URL for this app address and server, or why it can't sign in from
 * here: an app address the server doesn't send people back to.
 */
/** When the chosen server can't be used from here. */
export const SERVER_ERROR = 'Couldn’t connect to the Sequence server. Check the server in the Advanced tab.';

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
export type SignInReturn =
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
  // Why a return was ignored or failed, for debugging (nothing secret).
  if (!pending) {
    console.warn('Instagram sign-in: ignored a return, as this tab has no sign-in in progress.');
    return null;
  }
  if (pending.state !== back.state) {
    console.warn('Instagram sign-in: ignored a return that doesn’t match the sign-in this tab started.');
    return null;
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
  const connection = res.ok ? parseConnection(await res.json().catch(() => null)) : null;
  if (!connection) {
    console.warn(`Instagram sign-in: /auth/redeem answered ${res.status}${res.ok ? ' with an unexpected body' : ''}.`);
    return ERROR_MESSAGES.exchange_failed;
  }
  set(connection);
  return `Connected to Instagram as @${connection.username}.`;
}

// --- Keeping the connection fresh -------------------------------------------------------

const DAY = 24 * 60 * 60;
/** Refresh once the token is this old (it lasts ~60 days; Instagram refuses under a day). */
const REFRESH_AFTER = 30 * DAY;

/** A connection problem the user has to fix by connecting again. */
export class ReconnectError extends Error {}

/**
 * The connection, refreshed first if it's getting old: a new Instagram token (no secret
 * needed), then a new enrollment from the server for it. Throws ReconnectError when
 * it's gone or expired, or Error with a message for anything else.
 */
export async function freshConnection(now = Date.now() / 1000): Promise<InstagramConnection> {
  const connection = current;
  if (!connection || connection.expiresAt <= now) {
    throw new ReconnectError('Your Instagram connection expired. Connect again in Settings.');
  }
  if (now - connection.refreshedAt < REFRESH_AFTER) return connection;

  let token = connection.token;
  let expiresAt = connection.expiresAt;
  try {
    const url = new URL('https://graph.instagram.com/refresh_access_token');
    url.searchParams.set('grant_type', 'ig_refresh_token');
    url.searchParams.set('access_token', connection.token);
    const res = await fetch(url);
    const body: unknown = await res.json().catch(() => null);
    if (res.ok && isRecord(body) && typeof body.access_token === 'string' && typeof body.expires_in === 'number') {
      token = body.access_token;
      expiresAt = Math.floor(now + body.expires_in);
    } else if (res.status === 400 || res.status === 401) {
      throw new ReconnectError('Your Instagram connection expired. Connect again in Settings.');
    }
  } catch (error) {
    if (error instanceof ReconnectError) throw error;
    // Instagram unreachable: carry on with the current token, which is still valid.
    return connection;
  }

  // The enrollment follows the token. If renewing it fails, keep the new token anyway.
  let enrollment = connection.enrollment;
  try {
    const res = await fetch(`${serverUrl()}/auth/renew`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ enrollment }),
    });
    const body: unknown = await res.json().catch(() => null);
    if (res.ok && isRecord(body) && typeof body.enrollment === 'string') enrollment = body.enrollment;
  } catch {
    // Retried at the next refresh.
  }
  const next = { ...connection, token, expiresAt, refreshedAt: Math.floor(now), enrollment };
  set(next);
  return next;
}
