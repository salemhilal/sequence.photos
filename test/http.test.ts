import { env, exports } from 'cloudflare:workers';
import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/env';
import {
  contentLength,
  HttpError,
  isBatchId,
  parseBearer,
  parseExp,
  parseFrameIndex,
  parseState,
  readBody,
  readJson,
} from '../src/http';

const NONCE = 'n'.repeat(43);
const CHALLENGE = 'c'.repeat(43);

async function rejection(promise: Promise<unknown>): Promise<HttpError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpError) return error;
    throw error;
  }
  throw new Error('expected an HttpError');
}

describe('input formats', () => {
  it('batch ids are exactly 22 base64url characters', () => {
    expect(isBatchId('AAAAAAAAAAAAAAAAAAAAAA')).toBe(true);
    expect(isBatchId('abcdefghij-_0123456789')).toBe(true);
    expect(isBatchId('AAAAAAAAAAAAAAAAAAAAA')).toBe(false);
    expect(isBatchId('AAAAAAAAAAAAAAAAAAAAAAA')).toBe(false);
    expect(isBatchId('AAAAAAAAAAAAAAAAAAAAA=')).toBe(false);
    expect(isBatchId('AAAAAAAAAA/AAAAAAAAAAA')).toBe(false);
    expect(isBatchId('..')).toBe(false);
    expect(isBatchId(undefined)).toBe(false);
  });

  it('frame indexes are decimal, without leading zeros, below MAX_FRAMES', () => {
    expect(parseFrameIndex('0', 10)).toBe(0);
    expect(parseFrameIndex('9', 10)).toBe(9);
    expect(parseFrameIndex('10', 10)).toBeNull();
    expect(parseFrameIndex('19', 20)).toBe(19);
    for (const bad of ['01', '00', '-1', '+1', '1e1', ' 1', '1 ', '0x1', '1.0', '', '100']) {
      expect(parseFrameIndex(bad, 20)).toBeNull();
    }
    expect(parseFrameIndex(undefined, 10)).toBeNull();
  });

  it('exp is positive decimal unix seconds', () => {
    expect(parseExp('1700000000')).toBe(1_700_000_000);
    for (const bad of [null, '', '0', '01', '-1', '1.5', '1e9', '1234567890123']) {
      expect(parseExp(bad)).toBeNull();
    }
  });

  it('state is <client>.<nonce>.<challenge>', () => {
    expect(parseState(`web.${NONCE}.${CHALLENGE}`)).toEqual({
      client: 'web',
      nonce: NONCE,
      challenge: CHALLENGE,
    });
    for (const bad of [
      null,
      '',
      `web.${NONCE}`,
      `web.${NONCE}.${CHALLENGE}.x`,
      `Web.${NONCE}.${CHALLENGE}`,
      `.${NONCE}.${CHALLENGE}`,
      `web.${NONCE.slice(1)}.${CHALLENGE}`,
      `web.${NONCE}.${CHALLENGE}x`,
      `web.${NONCE}.${'c'.repeat(42)}=`,
      `w/b.${NONCE}.${CHALLENGE}`,
    ]) {
      expect(parseState(bad)).toBeNull();
    }
  });

  it('bearer tokens', () => {
    expect(parseBearer('Bearer IGAAabc.def-ghi_jkl')).toBe('IGAAabc.def-ghi_jkl');
    for (const bad of [null, '', 'Bearer', 'Bearer ', 'bearer abc', 'Basic abc', 'Bearer a b']) {
      expect(parseBearer(bad)).toBeNull();
    }
    expect(parseBearer(`Bearer ${'a'.repeat(3000)}`)).toBeNull();
  });

  it('Content-Length', () => {
    const req = (length?: string) =>
      new Request('https://server.test/', {
        method: 'POST',
        headers: length === undefined ? {} : { 'Content-Length': length },
      });
    expect(contentLength(req('12'))).toBe(12);
    expect(contentLength(req())).toBeNull();
    expect(() => contentLength(req('-1'))).toThrow(HttpError);
    expect(() => contentLength(req('012'))).toThrow(HttpError);
  });
});

describe('bodies', () => {
  const post = (body: BodyInit) => new Request('https://server.test/', { method: 'POST', body });

  it('reads a body within the limit', async () => {
    expect(await readBody(post('hello'), 5)).toEqual(new TextEncoder().encode('hello'));
  });

  it('rejects a declared length over the limit before reading', async () => {
    expect((await rejection(readBody(post('hello!'), 5))).status).toBe(413);
  });

  it('stops reading a streamed body that runs over the limit', async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(4));
      },
    });
    const error = await rejection(readBody(post(stream), 10));
    expect(error.status).toBe(413);
    expect(error.outcome).toBe('too_large');
  });

  it('parses JSON against a schema, and nothing else', async () => {
    const schema = v.strictObject({ a: v.number() });
    expect(await readJson(post('{"a":1}'), 100, schema)).toEqual({ a: 1 });
    for (const body of ['{"a":"1"}', '{"a":1,"b":2}', 'not json', '', '[]']) {
      expect((await rejection(readJson(post(body), 100, schema))).status).toBe(400);
    }
    const invalidUtf8 = new Uint8Array([0x7b, 0xff, 0x7d]);
    expect((await rejection(readJson(post(invalidUtf8), 100, schema))).status).toBe(400);
  });
});

describe('config', () => {
  it('parses the dev environment', () => {
    const config = parseConfig(env);
    expect(config.maxFrames).toBe(10);
    expect(config.returnUrls.get('dev')).toBe('http://localhost:5175/app/');
    expect(config.allowedOrigins.has('http://localhost:5175')).toBe(true);
  });

  it('refuses invalid vars, naming the var but not its value', () => {
    expect(() => parseConfig({ ...env, RETURN_URLS: '{"web":"javascript:alert(1)"}' })).toThrow(
      'RETURN_URLS is invalid',
    );
    expect(() => parseConfig({ ...env, ALLOWED_ORIGINS: '["https://a.test/path"]' })).toThrow(
      'ALLOWED_ORIGINS is invalid',
    );
    expect(() => parseConfig({ ...env, MAX_FRAMES: '100' })).toThrow('MAX_FRAMES is invalid');
    expect(() => parseConfig({ ...env, RETURN_URLS: 'secret-ish{' })).toThrow(
      'RETURN_URLS is not valid JSON',
    );
  });
});

describe('router', () => {
  function fetchWorker(input: string, init?: RequestInit): Promise<Response> {
    return exports.default.fetch(`https://server.test${input}`, init);
  }

  it('404s unknown paths, with the default headers', async () => {
    const response = await fetchWorker('/nope');
    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('405s a known path with the wrong method', async () => {
    const response = await fetchWorker('/auth/redeem');
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST');
  });

  it('answers CORS preflights for allowed origins only', async () => {
    const allowed = await fetchWorker('/uploads/AAAAAAAAAAAAAAAAAAAAAA/0.jpg', {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5175', 'Access-Control-Request-Method': 'PUT' },
    });
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5175');
    expect(allowed.headers.get('Access-Control-Allow-Methods')).toBe('POST, PUT, DELETE');
    expect(allowed.headers.get('Access-Control-Allow-Headers')).toBe('Authorization, Content-Type');

    const denied = await fetchWorker('/uploads', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.test' },
    });
    expect(denied.status).toBe(403);
    expect(denied.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('has no CORS on routes outside the list', async () => {
    const response = await fetchWorker('/auth/callback', {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5175' },
    });
    expect(response.status).toBe(405);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('adds CORS headers to responses for allowed origins', async () => {
    const response = await fetchWorker('/auth/redeem', {
      method: 'POST',
      headers: { Origin: 'https://sequence.photos' },
    });
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://sequence.photos');
    expect(response.headers.get('Vary')).toBe('Origin');
  });
});
