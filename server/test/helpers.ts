// Shared test helpers: an Instagram fake behind a fetch spy, log capture, requests to
// the Worker, and the values tests sign or send.

import { env, exports } from 'cloudflare:workers';
import * as v from 'valibot';
import { vi } from 'vitest';
import { toBase64Url, utf8 } from '../src/encoding';
import { getKeys, makeEnrollment } from '../src/keys';

export const USER_ID = '17841400000000000';
export const SHORT_TOKEN = 'IGAAshortlivedtokenvalue';
export const LONG_TOKEN = 'IGAAlonglivedtokenvalue';
export const CODE = 'AQcodevalue_123';
export const EXPIRES_IN = 5_183_944;

export type FakeHandler = (request: Request) => Response | Promise<Response>;

export function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** A Graph-style error, with a message that must never reach the logs. */
export function graphError(status: number, code = 190): Response {
  return json(
    {
      error: {
        message: `Invalid OAuth access token - Cannot parse access token ${LONG_TOKEN}`,
        type: 'OAuthException',
        code,
        error_subcode: 463,
        fbtrace_id: 'AbC123_def-456',
      },
    },
    status,
  );
}

/** A request the Worker made to the fake. */
export interface Recorded {
  method: string;
  url: string;
  body: string;
}

export interface FakeInstagram {
  exchange: FakeHandler;
  longLived: FakeHandler;
  me: FakeHandler;
}

/**
 * Instagram's happy path; override any endpoint now, or later with `set`. `restore` puts
 * the real fetch back (vitest.config.ts's `restoreMocks` also does, before each test).
 */
export function fakeInstagram(overrides: Partial<FakeInstagram> = {}): {
  handlers: FakeInstagram;
  requests: Recorded[];
  set: (overrides: Partial<FakeInstagram>) => void;
  restore: () => void;
} {
  const handlers: FakeInstagram = {
    exchange: () =>
      json({
        data: [
          {
            access_token: SHORT_TOKEN,
            user_id: '999',
            permissions: 'instagram_business_basic,instagram_business_content_publish',
          },
        ],
      }),
    longLived: () =>
      json({ access_token: LONG_TOKEN, token_type: 'bearer', expires_in: EXPIRES_IN }),
    me: () => json({ user_id: USER_ID, username: 'someone', account_type: 'BUSINESS' }),
    ...overrides,
  };
  const requests: Recorded[] = [];
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    // Read the body here, in the Worker's request context (bodies can't cross contexts).
    requests.push({
      method: request.method,
      url: request.url,
      body: new TextDecoder().decode(await request.clone().arrayBuffer()),
    });
    const url = new URL(request.url);
    const route = `${request.method} ${url.origin}${url.pathname}`;
    switch (route) {
      case 'POST https://api.instagram.com/oauth/access_token':
        return handlers.exchange(request);
      case 'GET https://graph.instagram.com/access_token':
        return handlers.longLived(request);
      case `GET https://graph.instagram.com/${env.GRAPH_VERSION}/me`:
        return handlers.me(request);
      default:
        throw new Error(`unexpected fetch: ${route}`);
    }
  });
  return {
    handlers,
    requests,
    set: (more) => Object.assign(handlers, more),
    restore: () => {
      spy.mockRestore();
    },
  };
}

/** Captures log lines (as JSON text) written from now on in the test. */
export function captureLogs(): { lines: () => string[]; records: () => unknown[] } {
  const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  // From here on, even if console.log was already captured earlier in the test.
  const start = spy.mock.calls.length;
  const calls = () => spy.mock.calls.slice(start);
  return {
    lines: () => calls().map((call) => JSON.stringify(call)),
    records: () => calls().map((call): unknown => call[0]),
  };
}

export function call(path: string, init?: RequestInit): Promise<Response> {
  return exports.default.fetch(`https://server.test${path}`, { redirect: 'manual', ...init });
}

export function fragmentParams(location: string | null): URLSearchParams {
  const hash = location?.split('#')[1];
  if (hash === undefined) throw new Error('no fragment');
  return new URLSearchParams(hash);
}

/** The request's log line among `records`. */
export function requestRecord(records: unknown[]): unknown {
  return records.find(
    (r) => typeof r === 'object' && r !== null && 'event' in r && r.event === 'request',
  );
}

/** A JSON POST (a string body is sent as is), with `Authorization: Bearer <token>`. */
export function postJson(
  path: string,
  body: unknown,
  token: string | null = LONG_TOKEN,
): Promise<Response> {
  return call(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

export const nowSeconds = (): number => Math.floor(Date.now() / 1000);

/** An enrollment credential, made with the test SERVER_SECRET. */
export async function newEnrollment(issuedAt = nowSeconds(), userId = USER_ID): Promise<string> {
  return makeEnrollment(await getKeys(env.SERVER_SECRET), userId, issuedAt);
}

/** `POST /uploads`'s response. */
export const Batch = v.strictObject({
  id: v.string(),
  frames: v.array(v.strictObject({ put: v.string(), url: v.string() })),
  delete: v.string(),
});
export type Batch = v.InferOutput<typeof Batch>;

/** Strips the origin, for `call`. */
export function path(url: string): string {
  const parsed = new URL(url);
  return parsed.pathname + parsed.search;
}

/** Signs like Meta: base64url(HMAC-SHA256(secret, encodedPayload)) + "." + encodedPayload. */
export async function signMetaRequest(
  payload: unknown,
  secret = env.IG_APP_SECRET,
): Promise<{ value: string; sig: string; payload: string }> {
  const encoded = toBase64Url(utf8(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey(
    'raw',
    utf8(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = toBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8(encoded))));
  return { value: `${sig}.${encoded}`, sig, payload: encoded };
}
