import { env } from 'cloudflare:workers';
import * as v from 'valibot';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomBase64Url, sha256Base64Url } from '../src/encoding';
import {
  ENROLL_RENEW_GRACE,
  getKeys,
  LIFETIME,
  makeEnrollment,
  readEnrollment,
  seal,
} from '../src/keys';
import {
  call,
  captureLogs,
  CODE,
  EXPIRES_IN,
  fakeInstagram,
  fragmentParams,
  graphError,
  json,
  LONG_TOKEN,
  SHORT_TOKEN,
  USER_ID,
} from './helpers';

afterEach(() => {
  vi.restoreAllMocks();
});

const Connection = v.strictObject({
  token: v.string(),
  expiresAt: v.number(),
  refreshedAt: v.number(),
  userId: v.string(),
  username: v.string(),
  enrollment: v.string(),
});

const RETURN_URL = 'http://localhost:5175/app/';
const nowSeconds = () => Math.floor(Date.now() / 1000);

interface SignIn {
  state: string;
  verifier: string;
}

async function newSignIn(client = 'dev'): Promise<SignIn> {
  const verifier = randomBase64Url(32);
  const state = `${client}.${randomBase64Url(32)}.${await sha256Base64Url(verifier)}`;
  return { state, verifier };
}

function callback(query: Record<string, string>): Promise<Response> {
  return call(`/auth/callback?${new URLSearchParams(query).toString()}`);
}

function redeem(body: unknown): Promise<Response> {
  return call('/auth/redeem', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function renew(enrollment: string, token: string | null = LONG_TOKEN): Promise<Response> {
  return call('/auth/renew', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({ enrollment }),
  });
}

/** Expects a redirect to the app with `#instagram_error=<code>&state=<state>`. */
function expectError(response: Response, code: string, state: string): void {
  expect(response.status).toBe(303);
  const location = response.headers.get('Location') ?? '';
  expect(location.startsWith(`${RETURN_URL}#`)).toBe(true);
  const fragment = fragmentParams(location);
  expect(fragment.get('instagram_error')).toBe(code);
  expect(fragment.get('state')).toBe(state);
  expect(fragment.has('instagram')).toBe(false);
}

function requestRecord(records: unknown[]): unknown {
  return records.find(
    (r) => typeof r === 'object' && r !== null && 'event' in r && r.event === 'request',
  );
}

describe('GET /auth/callback', () => {
  it('signs in: exchanges, seals, and redirects with the handoff', async () => {
    const { requests } = fakeInstagram();
    const logs = captureLogs();
    const { state, verifier } = await newSignIn();
    const before = nowSeconds();
    const response = await callback({ code: CODE, state });

    expect(response.status).toBe(303);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    const location = response.headers.get('Location') ?? '';
    expect(location.startsWith(`${RETURN_URL}#instagram=`)).toBe(true);
    expect(location).not.toContain(LONG_TOKEN);
    expect(location).not.toContain(SHORT_TOKEN);
    const fragment = fragmentParams(location);
    expect(fragment.get('state')).toBe(state);

    // The code exchange.
    const [exchange, longLived, me] = requests;
    const form = new URLSearchParams(exchange?.body);
    expect(Object.fromEntries(form)).toEqual({
      client_id: 'test-app-id',
      client_secret: env.IG_APP_SECRET,
      grant_type: 'authorization_code',
      redirect_uri: 'https://server.test/auth/callback',
      code: CODE,
    });
    // The long-lived exchange.
    const longLivedUrl = new URL(longLived?.url ?? '');
    expect(longLivedUrl.searchParams.get('grant_type')).toBe('ig_exchange_token');
    expect(longLivedUrl.searchParams.get('client_secret')).toBe(env.IG_APP_SECRET);
    expect(longLivedUrl.searchParams.get('access_token')).toBe(SHORT_TOKEN);
    // /me, with the long-lived token.
    const meUrl = new URL(me?.url ?? '');
    expect(meUrl.searchParams.get('fields')).toBe('user_id,username,account_type');
    expect(meUrl.searchParams.get('access_token')).toBe(LONG_TOKEN);

    // Redeem it.
    const redeemed = await redeem({ sealed: fragment.get('instagram'), verifier });
    expect(redeemed.status).toBe(200);
    expect(redeemed.headers.get('Cache-Control')).toBe('no-store');
    const connection = v.parse(Connection, await redeemed.json());
    expect(connection).toMatchObject({ token: LONG_TOKEN, userId: USER_ID, username: 'someone' });
    const after = nowSeconds();
    const { expiresAt, refreshedAt, enrollment } = connection;
    expect(refreshedAt).toBeGreaterThanOrEqual(before);
    expect(refreshedAt).toBeLessThanOrEqual(after);
    expect(expiresAt).toBe(refreshedAt + EXPIRES_IN);
    // The enrollment is for /me's user id, not the exchange's.
    const read = await readEnrollment(await getKeys(env.SERVER_SECRET), enrollment, after);
    expect(read).toMatchObject({ ok: true, userId: USER_ID });

    // Log lines: the route and a user hash; never the code, state, tokens, or secrets.
    const record = requestRecord(logs.records());
    expect(record).toMatchObject({
      route: 'GET /auth/callback',
      status: 303,
      outcome: 'ok',
      query: ['code', 'state'],
    });
    expect(v.parse(v.object({ user: v.string() }), record).user).toMatch(/^[0-9a-f]{8}$/);
    for (const line of logs.lines()) {
      for (const secret of [CODE, state, verifier, LONG_TOKEN, SHORT_TOKEN, env.IG_APP_SECRET]) {
        expect(line).not.toContain(secret);
      }
      expect(line).not.toContain(USER_ID);
    }
  });

  it('strips a trailing #_ from the code', async () => {
    const { requests } = fakeInstagram();
    const { state } = await newSignIn();
    const response = await callback({ code: `${CODE}#_`, state });
    expect(response.status).toBe(303);
    expect(new URLSearchParams(requests[0]?.body).get('code')).toBe(CODE);
  });

  it('accepts the flat exchange response and an array of permissions', async () => {
    fakeInstagram({
      exchange: () =>
        json({
          access_token: SHORT_TOKEN,
          user_id: 999,
          permissions: ['instagram_business_basic', 'instagram_business_content_publish'],
        }),
    });
    const { state } = await newSignIn();
    const location = (await callback({ code: CODE, state })).headers.get('Location');
    expect(fragmentParams(location).has('instagram')).toBe(true);
  });

  it('accepts Creator accounts', async () => {
    fakeInstagram({
      me: () => json({ user_id: USER_ID, username: 'someone', account_type: 'MEDIA_CREATOR' }),
    });
    const { state } = await newSignIn();
    const location = (await callback({ code: CODE, state })).headers.get('Location');
    expect(fragmentParams(location).has('instagram')).toBe(true);
  });

  describe('without a usable state: 400, no redirect', () => {
    for (const [name, state] of [
      ['missing', null],
      ['malformed', 'dev.short.short'],
      ['unknown client', `evil.${'n'.repeat(43)}.${'c'.repeat(43)}`],
      ['production-only client name in the wrong env', `prod.${'n'.repeat(43)}.${'c'.repeat(43)}`],
    ] as const) {
      it(name, async () => {
        const instagram = fakeInstagram();
        const response = await callback({
          code: CODE,
          ...(state === null ? {} : { state }),
        });
        expect(response.status).toBe(400);
        expect(response.headers.get('Location')).toBeNull();
        expect(response.headers.get('Content-Type')).toContain('text/plain');
        expect(await response.text()).toBe('Bad Request');
        expect(instagram.requests).toHaveLength(0);
      });
    }
  });

  it('redirects with cancelled when Instagram sends an error', async () => {
    const instagram = fakeInstagram();
    const { state } = await newSignIn();
    const response = await callback({
      error: 'access_denied',
      error_reason: 'user_denied',
      error_description: 'The user denied your request.',
      state,
    });
    expectError(response, 'cancelled', state);
    expect(instagram.requests).toHaveLength(0);
  });

  it('redirects with exchange_failed without a code', async () => {
    fakeInstagram();
    const { state } = await newSignIn();
    expectError(await callback({ state }), 'exchange_failed', state);
  });

  describe('code exchange failures → exchange_failed', () => {
    const cases: [string, () => Response | Promise<Response>, string][] = [
      [
        'a 400',
        () => json({ error_type: 'OAuthException', code: 400, error_message: 'x' }, 400),
        'exchange_failed',
      ],
      ['a 500', () => new Response('oops', { status: 500 }), 'instagram_unavailable'],
      [
        'a timeout',
        () => Promise.reject(new DOMException('timed out', 'TimeoutError')),
        'instagram_unavailable',
      ],
      ['a network error', () => Promise.reject(new TypeError('network')), 'instagram_unavailable'],
      ['empty data', () => json({ data: [] }), 'exchange_failed'],
      ['no token', () => json({ data: [{ user_id: '1', permissions: [] }] }), 'exchange_failed'],
      ['not JSON', () => new Response('<html>', { status: 200 }), 'exchange_failed'],
    ];
    for (const [name, exchange, outcome] of cases) {
      it(name, async () => {
        fakeInstagram({ exchange });
        const logs = captureLogs();
        const { state } = await newSignIn();
        expectError(await callback({ code: CODE, state }), 'exchange_failed', state);
        expect(requestRecord(logs.records())).toMatchObject({ outcome });
      });
    }
  });

  it('logs Instagram failures by code, type, and trace id, never the message', async () => {
    fakeInstagram({ longLived: () => graphError(400) });
    const logs = captureLogs();
    const { state } = await newSignIn();
    expectError(await callback({ code: CODE, state }), 'exchange_failed', state);
    expect(logs.records()).toContainEqual({
      event: 'instagram',
      endpoint: 'GET graph.instagram.com/access_token',
      status: 400,
      code: 190,
      subcode: 463,
      type: 'OAuthException',
      fbtraceId: 'AbC123_def-456',
    });
    for (const line of logs.lines()) {
      expect(line).not.toContain('Invalid OAuth');
      expect(line).not.toContain(LONG_TOKEN);
    }
  });

  describe('missing permission → missing_permission', () => {
    for (const [name, permissions] of [
      ['basic only (string)', 'instagram_business_basic'],
      ['basic only (array)', ['instagram_business_basic']],
      ['absent', undefined],
      ['a lookalike', 'instagram_business_content_publish_x'],
    ] as const) {
      it(name, async () => {
        fakeInstagram({
          exchange: () =>
            json({
              data: [
                {
                  access_token: SHORT_TOKEN,
                  user_id: '999',
                  ...(permissions === undefined ? {} : { permissions }),
                },
              ],
            }),
        });
        const { state } = await newSignIn();
        expectError(await callback({ code: CODE, state }), 'missing_permission', state);
      });
    }
  });

  it('long-lived exchange failures → exchange_failed', async () => {
    fakeInstagram({ longLived: () => json({ access_token: LONG_TOKEN }) });
    const { state } = await newSignIn();
    expectError(await callback({ code: CODE, state }), 'exchange_failed', state);
  });

  it('/me failures → exchange_failed', async () => {
    fakeInstagram({ me: () => graphError(500, 2) });
    const { state } = await newSignIn();
    expectError(await callback({ code: CODE, state }), 'exchange_failed', state);
  });

  it('/me without a valid username → exchange_failed', async () => {
    fakeInstagram({
      me: () => json({ user_id: USER_ID, username: '<script>', account_type: 'BUSINESS' }),
    });
    const { state } = await newSignIn();
    expectError(await callback({ code: CODE, state }), 'exchange_failed', state);
  });

  describe('accounts that cannot publish → not_professional', () => {
    for (const accountType of ['PERSONAL', undefined]) {
      it(String(accountType), async () => {
        fakeInstagram({
          me: () =>
            json({
              user_id: USER_ID,
              username: 'someone',
              ...(accountType === undefined ? {} : { account_type: accountType }),
            }),
        });
        const { state } = await newSignIn();
        expectError(await callback({ code: CODE, state }), 'not_professional', state);
      });
    }
  });
});

describe('POST /auth/redeem', () => {
  async function signedIn(): Promise<{ sealed: string; verifier: string }> {
    fakeInstagram();
    const { state, verifier } = await newSignIn();
    const location = (await callback({ code: CODE, state })).headers.get('Location');
    return { sealed: fragmentParams(location).get('instagram') ?? '', verifier };
  }

  it('rejects the wrong verifier', async () => {
    const { sealed } = await signedIn();
    const response = await redeem({ sealed, verifier: randomBase64Url(32) });
    expect(response.status).toBe(400);
    expect(await response.text()).toBe('Bad Request');
  });

  it('rejects a tampered handoff', async () => {
    const { sealed, verifier } = await signedIn();
    const tampered = sealed.slice(0, 30) + (sealed[30] === 'A' ? 'B' : 'A') + sealed.slice(31);
    expect((await redeem({ sealed: tampered, verifier })).status).toBe(400);
  });

  it('rejects an expired handoff', async () => {
    const verifier = randomBase64Url(32);
    const keys = await getKeys(env.SERVER_SECRET);
    const sealed = await seal(
      keys,
      {
        connection: {
          token: LONG_TOKEN,
          expiresAt: 0,
          refreshedAt: 0,
          userId: USER_ID,
          username: 'someone',
          enrollment: 'x',
        },
        challenge: await sha256Base64Url(verifier),
      },
      nowSeconds() - 301,
    );
    expect((await redeem({ sealed, verifier })).status).toBe(400);
  });

  it('rejects malformed and oversize bodies with a 400', async () => {
    const { sealed, verifier } = await signedIn();
    for (const body of [
      'not json',
      {},
      { sealed },
      { sealed, verifier, extra: 1 },
      { sealed, verifier: 'short' },
      { sealed: 1, verifier },
      { sealed: 'x'.repeat(5000), verifier },
    ]) {
      expect((await redeem(body)).status).toBe(400);
    }
  });
});

describe('POST /auth/renew', () => {
  async function enrollment(issuedAt: number, userId = USER_ID): Promise<string> {
    return makeEnrollment(await getKeys(env.SERVER_SECRET), userId, issuedAt);
  }

  it('renews for the same user', async () => {
    const { requests } = fakeInstagram({ me: () => json({ user_id: USER_ID }) });
    const now = nowSeconds();
    const response = await renew(await enrollment(now - 40 * 86400));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const renewed = v.parse(
      v.strictObject({ enrollment: v.string() }),
      await response.json(),
    ).enrollment;
    const read = await readEnrollment(await getKeys(env.SERVER_SECRET), renewed, now);
    expect(read).toMatchObject({ ok: true, userId: USER_ID });
    expect(read.ok && read.exp).toBeGreaterThanOrEqual(now + LIFETIME.ENROLL);
    // /me with just user_id, and the bearer token.
    const meUrl = new URL(requests[0]?.url ?? '');
    expect(meUrl.searchParams.get('fields')).toBe('user_id');
    expect(meUrl.searchParams.get('access_token')).toBe(LONG_TOKEN);
  });

  it('renews an enrollment expired by less than 30 days', async () => {
    fakeInstagram({ me: () => json({ user_id: USER_ID }) });
    const issued = nowSeconds() - LIFETIME.ENROLL - ENROLL_RENEW_GRACE + 3600;
    expect((await renew(await enrollment(issued))).status).toBe(200);
  });

  it('refuses one expired by more than that: reconnect', async () => {
    const instagram = fakeInstagram({ me: () => json({ user_id: USER_ID }) });
    const issued = nowSeconds() - LIFETIME.ENROLL - ENROLL_RENEW_GRACE - 3600;
    expect((await renew(await enrollment(issued))).status).toBe(401);
    expect(instagram.requests).toHaveLength(0);
  });

  it('refuses a token for another user', async () => {
    fakeInstagram({ me: () => json({ user_id: '17841499999999999' }) });
    const logs = captureLogs();
    expect((await renew(await enrollment(nowSeconds()))).status).toBe(401);
    expect(requestRecord(logs.records())).toMatchObject({ outcome: 'enrollment_mismatch' });
  });

  it('refuses a forged or malformed enrollment without calling Instagram', async () => {
    const instagram = fakeInstagram({ me: () => json({ user_id: USER_ID }) });
    const real = await enrollment(nowSeconds());
    const forged = `${real.slice(0, -2)}${real.endsWith('AA') ? 'BA' : 'AA'}`;
    expect((await renew(forged)).status).toBe(401);
    expect((await renew('nope')).status).toBe(401);
    expect(instagram.requests).toHaveLength(0);
  });

  it('requires a bearer token', async () => {
    fakeInstagram();
    expect((await renew(await enrollment(nowSeconds()), null)).status).toBe(401);
  });

  it('401s when Instagram rejects the token, 502s when Instagram is down', async () => {
    fakeInstagram({ me: () => graphError(400) });
    expect((await renew(await enrollment(nowSeconds()))).status).toBe(401);
    vi.restoreAllMocks();
    fakeInstagram({ me: () => new Response('', { status: 503 }) });
    expect((await renew(await enrollment(nowSeconds()))).status).toBe(502);
  });
});
