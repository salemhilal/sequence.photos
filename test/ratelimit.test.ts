import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ROUTE_TABLE } from '../src/index';
import { getKeys, makeEnrollment } from '../src/keys';
import { Tag } from '../src/log';
import { handleRequest } from '../src/router';
import { captureLogs, fakeInstagram, json, LONG_TOKEN, USER_ID } from './helpers';

afterEach(() => {
  vi.restoreAllMocks();
});

/** A rate limiter that records keys and answers from `decide`. */
function fakeLimiter(decide: (key: string) => boolean | Promise<boolean>): {
  binding: RateLimit;
  keys: string[];
} {
  const keys: string[] = [];
  return {
    keys,
    binding: {
      async limit({ key }) {
        keys.push(key);
        return { success: await decide(key) };
      },
    },
  };
}

/** `env` without one binding, as in a local setup that lacks it. */
function withoutBinding(name: 'IP_RATE_LIMIT' | 'UPLOAD_RATE_LIMIT'): Env {
  return new Proxy(env, {
    get(target, property) {
      if (property === name) return undefined;
      const value: unknown = Reflect.get(target, property);
      return value;
    },
  });
}

function run(request: Request, testEnv: Env): Promise<Response> {
  return handleRequest(request, testEnv, ROUTE_TABLE);
}

function redeemFrom(ip: string | null): Request {
  return new Request('https://server.test/auth/redeem', {
    method: 'POST',
    headers: ip === null ? {} : { 'CF-Connecting-IP': ip },
    body: '{}',
  });
}

async function uploadsRequest(): Promise<Request> {
  const enrollment = await makeEnrollment(
    await getKeys(env.SERVER_SECRET),
    USER_ID,
    Math.floor(Date.now() / 1000),
  );
  return new Request('https://server.test/uploads', {
    method: 'POST',
    headers: { Authorization: `Bearer ${LONG_TOKEN}` },
    body: JSON.stringify({ enrollment, count: 1 }),
  });
}

describe('rate limits', () => {
  it('limits /auth/* by IP, keyed auth:<ip>, with a 429 over the limit', async () => {
    let calls = 0;
    const limiter = fakeLimiter(() => ++calls <= 2);
    const testEnv = { ...env, IP_RATE_LIMIT: limiter.binding };
    expect((await run(redeemFrom('203.0.113.7'), testEnv)).status).toBe(400);
    expect((await run(redeemFrom('203.0.113.7'), testEnv)).status).toBe(400);
    const logs = captureLogs();
    const limited = await run(redeemFrom('203.0.113.7'), testEnv);
    expect(limited.status).toBe(429);
    expect(await limited.text()).toBe('Too Many Requests');
    expect(logs.records()[0]).toMatchObject({
      route: 'POST /auth/redeem',
      outcome: 'rate_limited',
    });
    expect(limiter.keys).toEqual(['auth:203.0.113.7', 'auth:203.0.113.7', 'auth:203.0.113.7']);
  });

  it('limits /meta/* by IP under its own prefix', async () => {
    const limiter = fakeLimiter(() => false);
    const response = await run(
      new Request('https://server.test/meta/deletion', {
        headers: { 'CF-Connecting-IP': '2001:db8::1' },
      }),
      { ...env, IP_RATE_LIMIT: limiter.binding },
    );
    expect(response.status).toBe(429);
    expect(limiter.keys).toEqual(['meta:2001:db8::1']);
  });

  it('limits POST /uploads by the keyed user hash, never the raw user id', async () => {
    const instagram = fakeInstagram({ me: () => json({ user_id: USER_ID }) });
    const limiter = fakeLimiter(() => false);
    const response = await run(await uploadsRequest(), {
      ...env,
      UPLOAD_RATE_LIMIT: limiter.binding,
    });
    expect(response.status).toBe(429);
    const tag = await Tag.user((await getKeys(env.SERVER_SECRET)).log, USER_ID);
    expect(limiter.keys).toEqual([`user:${tag.hex}`]);
    // Limited before calling Instagram.
    expect(instagram.requests).toHaveLength(0);
  });

  it('fails open, logging the error name, when limit() throws', async () => {
    fakeInstagram({ me: () => json({ user_id: USER_ID }) });
    const broken: RateLimit = {
      limit: () => Promise.reject(new TypeError(`limiter down for ${USER_ID}`)),
    };
    const logs = captureLogs();
    const response = await run(await uploadsRequest(), { ...env, UPLOAD_RATE_LIMIT: broken });
    expect(response.status).toBe(200);
    expect(logs.records()).toContainEqual({
      event: 'exception',
      route: 'POST /uploads',
      name: 'TypeError',
    });
    for (const line of logs.lines()) expect(line).not.toContain(USER_ID);
  });

  it('allows requests when a binding is missing', async () => {
    fakeInstagram({ me: () => json({ user_id: USER_ID }) });
    expect((await run(await uploadsRequest(), withoutBinding('UPLOAD_RATE_LIMIT'))).status).toBe(
      200,
    );
    expect((await run(redeemFrom('203.0.113.8'), withoutBinding('IP_RATE_LIMIT'))).status).toBe(
      400,
    );
  });

  it('skips the IP limit without CF-Connecting-IP (local only)', async () => {
    const limiter = fakeLimiter(() => false);
    expect((await run(redeemFrom(null), { ...env, IP_RATE_LIMIT: limiter.binding })).status).toBe(
      400,
    );
    expect(limiter.keys).toEqual([]);
  });

  it('calls the real (local) binding', async () => {
    // The test config raises the limit, so this only shows the binding is wired and works.
    for (let i = 0; i < 12; i++) {
      expect((await run(redeemFrom('198.51.100.1'), env)).status).toBe(400);
    }
  });
});
