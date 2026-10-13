// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEV_SERVER_URL, INSTAGRAM, SERVER_URL, SITE_URL } from './config';
import type { InstagramConnection } from './instagram';

const STORAGE_KEY = 'photobook-instagram';
const PENDING_KEY = 'photobook-instagram-pending';
const DAY = 24 * 60 * 60;
const NOW = 1_800_000_000;

/** An enrollment (as the server signs them) expiring at `exp`. */
function enrollment(exp: number): string {
  const payload = btoa(`v1\nENROLL\n17841400000000000\n${exp}`).replace(/=+$/, '');
  return `${payload}.signature`;
}

const connection: InstagramConnection = {
  token: 'OLD-TOKEN',
  expiresAt: NOW + 50 * DAY,
  refreshedAt: NOW - DAY,
  userId: '17841400000000000',
  username: 'some.photographer',
  enrollment: enrollment(NOW + 40 * DAY),
  server: SERVER_URL,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function setUrl(url: string): void {
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(url);
}

/** The module, freshly loaded with this connection stored (as at startup). */
async function load(stored: InstagramConnection | null = connection) {
  vi.resetModules();
  if (stored) localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  return import('./instagram');
}

function stored(): unknown {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw === null ? null : JSON.parse(raw);
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  setUrl(`${SITE_URL}/app/`);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the stored connection', () => {
  it('is read at startup', async () => {
    const { instagramConnection } = await load();
    expect(instagramConnection()).toEqual(connection);
  });

  it('follows another tab connecting or disconnecting', async () => {
    const { instagramConnection } = await load(null);
    expect(instagramConnection()).toBeNull();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(connection));
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }));
    expect(instagramConnection()).toEqual(connection);
    localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new StorageEvent('storage', { key: null }));
    expect(instagramConnection()).toBeNull();
  });

  it('ignores other keys changing', async () => {
    const { instagramConnection } = await load();
    localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new StorageEvent('storage', { key: 'photobook-theme' }));
    expect(instagramConnection()).toEqual(connection);
  });

  it('is marked for reconnecting, and kept so', async () => {
    const { instagramConnection, markNeedsReconnect } = await load();
    markNeedsReconnect();
    expect(instagramConnection()?.needsReconnect).toBe(true);
    expect(stored()).toMatchObject({ needsReconnect: true });
  });

  it('marking with no connection does nothing', async () => {
    const { instagramConnection, markNeedsReconnect } = await load(null);
    markNeedsReconnect();
    expect(instagramConnection()).toBeNull();
    expect(stored()).toBeNull();
  });

  it('is forgotten on disconnecting', async () => {
    const { disconnectInstagram, instagramConnection } = await load();
    disconnectInstagram();
    expect(instagramConnection()).toBeNull();
    expect(stored()).toBeNull();
  });
});

describe('freshConnection', () => {
  it('returns a fresh connection untouched, without asking anyone', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    const { freshConnection, instagramConnection } = await load();
    const before = instagramConnection();
    expect(await freshConnection(NOW)).toBe(before);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refreshes a token a month old, and keeps the new one', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(json({ access_token: 'NEW-TOKEN', expires_in: 60 * DAY }));
    const { freshConnection, instagramConnection } = await load({ ...connection, refreshedAt: NOW - 30 * DAY });
    const fresh = await freshConnection(NOW);
    expect(fresh).toMatchObject({ token: 'NEW-TOKEN', expiresAt: NOW + 60 * DAY, refreshedAt: NOW });
    const url = new URL(String(fetch.mock.calls[0]![0]));
    expect(url.origin + url.pathname).toBe('https://graph.instagram.com/refresh_access_token');
    expect(url.searchParams.get('grant_type')).toBe('ig_refresh_token');
    expect(url.searchParams.get('access_token')).toBe('OLD-TOKEN');
    expect(instagramConnection()).toEqual(fresh);
    expect(stored()).toMatchObject({ token: 'NEW-TOKEN', refreshedAt: NOW });
  });

  it('keeps the old token, and when it was refreshed, if refreshing fails', async () => {
    const old = { ...connection, refreshedAt: NOW - 31 * DAY };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ error: { code: 4 } }, 400));
    const { freshConnection } = await load(old);
    expect(await freshConnection(NOW)).toEqual(old);
    expect(stored()).toEqual(old);
  });

  it('keeps the old token if Instagram is unreachable', async () => {
    const old = { ...connection, refreshedAt: NOW - 31 * DAY };
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    const { freshConnection } = await load(old);
    expect(await freshConnection(NOW)).toEqual(old);
  });

  it('asks to reconnect when Instagram says the token is invalid (190)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ error: { code: 190 } }, 400));
    const { freshConnection, instagramConnection, ReconnectError } = await load({
      ...connection,
      refreshedAt: NOW - 31 * DAY,
    });
    await expect(freshConnection(NOW)).rejects.toBeInstanceOf(ReconnectError);
    expect(instagramConnection()?.needsReconnect).toBe(true);
  });

  it('renews an enrollment within two weeks of expiring, at the server that issued it', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ enrollment: 'RENEWED' }));
    const c = { ...connection, server: DEV_SERVER_URL, enrollment: enrollment(NOW + 14 * DAY) };
    const { freshConnection, instagramConnection } = await load(c);
    expect(await freshConnection(NOW)).toEqual({ ...c, enrollment: 'RENEWED' });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(`${DEV_SERVER_URL}/auth/renew`);
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer OLD-TOKEN');
    expect(JSON.parse(String(init?.body))).toEqual({ enrollment: c.enrollment });
    expect(instagramConnection()?.enrollment).toBe('RENEWED');
  });

  it('leaves an enrollment with more than two weeks to go', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    const { freshConnection } = await load({ ...connection, enrollment: enrollment(NOW + 16 * DAY) });
    await freshConnection(NOW);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps the old enrollment if renewing fails', async () => {
    const c = { ...connection, enrollment: enrollment(NOW + DAY) };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ error: 'nope' }, 500));
    const { freshConnection } = await load(c);
    expect(await freshConnection(NOW)).toEqual(c);
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await freshConnection(NOW)).toEqual(c);
  });

  it('asks to reconnect with no connection, an expired one, or one already refused', async () => {
    for (const c of [null, { ...connection, expiresAt: NOW }, { ...connection, needsReconnect: true as const }]) {
      const { freshConnection, ReconnectError } = await load(c);
      await expect(freshConnection(NOW), JSON.stringify(c)).rejects.toBeInstanceOf(ReconnectError);
      localStorage.clear();
    }
  });
});

describe('connectInstagram', () => {
  it('keeps this tab’s sign-in and goes to Instagram', async () => {
    const assign = vi.spyOn(location, 'assign').mockImplementation(() => {});
    const { connectInstagram } = await load(null);
    expect(await connectInstagram()).toBeNull();
    const pending = JSON.parse(sessionStorage.getItem(PENDING_KEY)!) as Record<string, string>;
    expect(pending.server).toBe(SERVER_URL);
    expect(pending.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const url = new URL(String(assign.mock.calls[0]![0]));
    expect(url.origin + url.pathname).toBe(INSTAGRAM.authorizeUrl);
    expect(url.searchParams.get('state')).toBe(pending.state);
  });

  it('says why it can’t from an address the server doesn’t send people back to', async () => {
    setUrl('https://elsewhere.example/');
    const assign = vi.spyOn(location, 'assign').mockImplementation(() => {});
    const { connectInstagram } = await load(null);
    expect(await connectInstagram()).toMatch(/can’t be connected from this address/);
    expect(assign).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
  });
});

describe('finishSignIn', () => {
  const pending = { state: 'web.nonce.challenge', verifier: 'VERIFIER', server: DEV_SERVER_URL };
  const returned = (fragment: string) => setUrl(`${SITE_URL}/app/?x=1#${fragment}`);

  beforeEach(() => {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  });

  it('does nothing without a sign-in’s return', async () => {
    const replace = vi.spyOn(history, 'replaceState');
    const { finishSignIn } = await load(null);
    expect(await finishSignIn()).toBeNull();
    expect(replace).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(PENDING_KEY)).not.toBeNull();
  });

  it('ignores a return this tab didn’t start, and strips it from the address', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    const replace = vi.spyOn(history, 'replaceState');
    returned(`instagram=SEALED&state=web.other.state`);
    const { finishSignIn, instagramConnection } = await load(null);
    expect(await finishSignIn()).toMatch(/started in another tab or window/);
    expect(replace).toHaveBeenCalledWith(history.state, '', '/app/?x=1');
    expect(location.hash).toBe('');
    expect(fetch).not.toHaveBeenCalled();
    expect(instagramConnection()).toBeNull();
    expect(stored()).toBeNull();
    // The pending sign-in is used up either way.
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it('ignores a return when no sign-in is pending', async () => {
    sessionStorage.clear();
    const fetch = vi.spyOn(globalThis, 'fetch');
    returned(`instagram=SEALED&state=${pending.state}`);
    const { finishSignIn } = await load(null);
    expect(await finishSignIn()).toMatch(/started in another tab or window/);
    expect(fetch).not.toHaveBeenCalled();
    expect(stored()).toBeNull();
  });

  it('reports an error the server sent back', async () => {
    returned(`instagram_error=not_professional&state=${pending.state}`);
    const { finishSignIn } = await load(null);
    expect(await finishSignIn()).toMatch(/Business or Creator account/);
    expect(location.hash).toBe('');
  });

  it('says nothing when the user cancelled', async () => {
    returned(`instagram_error=cancelled&state=${pending.state}`);
    const { finishSignIn } = await load(null);
    expect(await finishSignIn()).toBeNull();
  });

  it('redeems the bundle at the server the sign-in started with, and keeps the connection', async () => {
    const { server: _, ...fromServer } = connection;
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(fromServer));
    returned(`instagram=SEALED&state=${pending.state}`);
    const { finishSignIn, instagramConnection } = await load(null);
    expect(await finishSignIn()).toBe('Connected to Instagram as @some.photographer.');
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(`${DEV_SERVER_URL}/auth/redeem`);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ sealed: 'SEALED', verifier: 'VERIFIER' });
    expect(instagramConnection()).toEqual({ ...fromServer, server: DEV_SERVER_URL });
    expect(stored()).toEqual({ ...fromServer, server: DEV_SERVER_URL });
    expect(location.hash).toBe('');
  });

  it('says the server couldn’t be reached', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    returned(`instagram=SEALED&state=${pending.state}`);
    const { finishSignIn, SERVER_ERROR } = await load(null);
    expect(await finishSignIn()).toBe(SERVER_ERROR);
    expect(stored()).toBeNull();
  });

  it('says the exchange failed when the server refuses, or answers oddly', async () => {
    for (const res of [json({ error: 'expired' }, 400), json({ token: 'only' })]) {
      sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(res);
      returned(`instagram=SEALED&state=${pending.state}`);
      const { finishSignIn, ERROR_MESSAGES } = await load(null);
      expect(await finishSignIn()).toBe(ERROR_MESSAGES.exchange_failed);
      expect(stored()).toBeNull();
    }
  });
});
