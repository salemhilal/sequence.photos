import { describe, expect, it } from 'vitest';
import { DEV_SERVER_URL, INSTAGRAM, SERVER_URL, SITE_URL } from './config';
import { challengeOf, enrollmentExpiry, parseConnection, parseSignInReturn, planSignIn } from './instagram';

const connection = {
  token: 'IGAA-token',
  expiresAt: 1_800_000_000,
  refreshedAt: 1_790_000_000,
  userId: '17841400000000000',
  username: 'some.photographer_',
  enrollment: 'abc.def',
};

describe('parseConnection', () => {
  it('accepts a whole connection, and only its fields', () => {
    expect(parseConnection({ ...connection, extra: 'ignored' }, SERVER_URL)).toEqual({
      ...connection,
      server: SERVER_URL,
    });
  });

  it('refuses anything missing or malformed', () => {
    for (const [key, value] of [
      ['token', ''],
      ['expiresAt', '1800000000'],
      ['refreshedAt', 1.5],
      ['userId', 'abc'],
      ['username', 'has space'],
      ['enrollment', ''],
    ] as const) {
      expect(parseConnection({ ...connection, [key]: value }, SERVER_URL), key).toBeNull();
    }
    expect(parseConnection(null, SERVER_URL)).toBeNull();
    expect(parseConnection([connection], SERVER_URL)).toBeNull();
  });

  it('keeps the server it came from, and refuses servers the app can’t use', () => {
    expect(parseConnection({ ...connection, server: DEV_SERVER_URL }, SERVER_URL)?.server).toBe(DEV_SERVER_URL);
    expect(parseConnection(connection, 'https://example.com')).toBeNull();
    expect(parseConnection({ ...connection, needsReconnect: true }, SERVER_URL)?.needsReconnect).toBe(true);
  });
});

describe('parseSignInReturn', () => {
  it('reads a connection or an error, with the state', () => {
    expect(parseSignInReturn('#instagram=SEALED&state=web.n.c')).toEqual({
      kind: 'connected',
      sealed: 'SEALED',
      state: 'web.n.c',
    });
    expect(parseSignInReturn('#instagram_error=not_professional&state=web.n.c')).toEqual({
      kind: 'error',
      error: 'not_professional',
      state: 'web.n.c',
    });
  });

  it('treats an unknown error as a failed exchange, and ignores other fragments', () => {
    expect(parseSignInReturn('#instagram_error=weird&state=s')).toMatchObject({ error: 'exchange_failed' });
    expect(parseSignInReturn('#instagram=SEALED')).toBeNull();
    expect(parseSignInReturn('')).toBeNull();
    expect(parseSignInReturn('#something-else')).toBeNull();
  });
});

describe('planSignIn', () => {
  it('builds Instagram’s sign-in URL: two scopes, no Facebook option, a state with a challenge', async () => {
    const plan = await planSignIn(SITE_URL, SERVER_URL);
    if ('error' in plan) throw new Error(plan.error);
    const url = new URL(plan.url);
    expect(url.origin + url.pathname).toBe(INSTAGRAM.authorizeUrl);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: INSTAGRAM.appId,
      redirect_uri: `${SERVER_URL}/auth/callback`,
      response_type: 'code',
      scope: 'instagram_business_basic,instagram_business_content_publish',
      enable_fb_login: 'false',
    });
    const [client, nonce, challenge] = plan.pending.state.split('.');
    expect(client).toBe('web');
    expect(nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).toBe(await challengeOf(plan.pending.verifier));
    expect(url.searchParams.get('state')).toBe(plan.pending.state);
    expect(plan.pending.server).toBe(SERVER_URL);
  });

  it('makes a fresh nonce and verifier every time', async () => {
    const a = await planSignIn(SITE_URL, SERVER_URL);
    const b = await planSignIn(SITE_URL, SERVER_URL);
    if ('error' in a || 'error' in b) throw new Error('no plan');
    expect(a.pending.state).not.toBe(b.pending.state);
    expect(a.pending.verifier).not.toBe(b.pending.verifier);
  });

  it('signs in from this computer only through the development server', async () => {
    expect(await planSignIn('http://localhost:5175', SERVER_URL)).toHaveProperty('error');
    const plan = await planSignIn('http://localhost:5175', DEV_SERVER_URL);
    if ('error' in plan) throw new Error(plan.error);
    expect(plan.pending.state.startsWith('dev.')).toBe(true);
    expect(new URL(plan.url).searchParams.get('redirect_uri')).toBe(`${DEV_SERVER_URL}/auth/callback`);
  });

  it('refuses app addresses the server doesn’t send people back to', async () => {
    expect(await planSignIn('https://elsewhere.example', SERVER_URL)).toHaveProperty('error');
  });
});

describe('enrollmentExpiry', () => {
  it('reads the expiry from an enrollment’s signed payload', () => {
    const payload = btoa('v1\nENROLL\n17841400000000000\n1800000000')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(enrollmentExpiry(`${payload}.signature`)).toBe(1_800_000_000);
  });

  it('is 0 (renew now) when unreadable', () => {
    expect(enrollmentExpiry('abc.def')).toBe(0);
    expect(enrollmentExpiry('')).toBe(0);
  });
});
