import { env, exports } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getKeys, toBase64Url, utf8 } from '../src/keys';
import { log, queryNames, Tag, toRecord, type RequestLine } from '../src/log';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('tags', () => {
  it('batch tags are the first 8 hex characters of SHA-256(id)', async () => {
    const id = 'AAAAAAAAAAAAAAAAAAAAAA';
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(id)));
    const hex = Array.from(digest.subarray(0, 4), (b) => b.toString(16).padStart(2, '0')).join('');
    expect((await Tag.batch(id)).hex).toBe(hex);
    expect((await Tag.batch(id)).hex).toMatch(/^[0-9a-f]{8}$/);
  });

  it('user tags are keyed: not a plain hash of the public user id', async () => {
    const keys = await getKeys(env.SERVER_SECRET);
    const userId = '17841400000000000';
    const tag = await Tag.user(keys.log, userId);
    expect(tag.hex).toMatch(/^[0-9a-f]{8}$/);
    expect(tag.hex).toBe((await Tag.user(keys.log, userId)).hex);
    expect(tag.hex).not.toBe((await Tag.batch(userId)).hex);
  });
});

describe('redaction', () => {
  const base: RequestLine = {
    event: 'request',
    method: 'PUT',
    route: 'PUT /uploads/:id/:i.jpg',
    status: 204,
    ms: 12.4,
    outcome: 'ok',
  };

  it('writes only allowlisted fields', () => {
    // Structural typing lets a wider object through; log() must still drop the extras.
    const wider = { ...base, token: 'SECRET-TOKEN', url: 'https://server.test/?sig=x' };
    const record = toRecord(wider);
    expect(record).toEqual({
      event: 'request',
      method: 'PUT',
      route: 'PUT /uploads/:id/:i.jpg',
      status: 204,
      ms: 12,
      outcome: 'ok',
    });
  });

  it('drops field values that fail their patterns', () => {
    expect(toRecord({ ...base, colo: 'https://x/?code=1' }).colo).toBeUndefined();
    expect(toRecord({ ...base, colo: 'SJC' }).colo).toBe('SJC');
    expect(toRecord({ ...base, i: -1 }).i).toBeUndefined();
    expect(toRecord({ ...base, bytes: 1.5 }).bytes).toBeUndefined();

    const instagram = toRecord({
      event: 'instagram',
      endpoint: 'GET graph.instagram.com/me',
      status: 400,
      code: 190,
      type: 'Invalid token: IGAAsecret',
      fbtraceId: 'A1b2_C3-d4',
    });
    expect(instagram).toEqual({
      event: 'instagram',
      endpoint: 'GET graph.instagram.com/me',
      status: 400,
      code: 190,
      fbtraceId: 'A1b2_C3-d4',
    });
  });

  it('logs exception names from an allowlist, never messages', () => {
    const custom = new Error('fetch https://graph.instagram.com/?access_token=SECRET failed');
    custom.name = 'SECRET-in-name';
    expect(toRecord({ event: 'exception', route: 'POST /uploads', name: custom.name })).toEqual({
      event: 'exception',
      route: 'POST /uploads',
      name: 'Error',
    });
    expect(toRecord({ event: 'exception', route: 'scheduled', name: 'TypeError' }).name).toBe(
      'TypeError',
    );
  });

  it('logs query parameter names, never values, and unknown names as "other"', () => {
    const url = new URL('https://server.test/x?exp=1&sig=SECRET&IGAAsecret=1&code=CODE');
    expect(queryNames(url)).toEqual(['exp', 'sig', 'other', 'code']);
  });

  it('writes one structured object through console.log', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    log(base);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toEqual(toRecord(base));
  });
});

describe('request log lines', () => {
  it('carry the route template and query names, never the path, values, or secrets', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const id = toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
    const secrets = ['SIGVALUE-1234', 'CODEVALUE-5678', env.SERVER_SECRET, env.IG_APP_SECRET];
    await exports.default.fetch(
      `https://server.test/uploads/${id}/0.jpg?exp=1&sig=${secrets[0] ?? ''}`,
      { method: 'PUT', headers: { Authorization: `Bearer ${secrets[1] ?? ''}` } },
    );

    const lines = spy.mock.calls.map((call) => JSON.stringify(call));
    expect(lines).toHaveLength(1);
    const record: unknown = spy.mock.calls[0]?.[0];
    expect(record).toMatchObject({
      event: 'request',
      method: 'PUT',
      route: 'PUT /uploads/:id/:i.jpg',
      query: ['exp', 'sig'],
    });
    for (const line of lines) {
      expect(line).not.toContain(id);
      expect(line).not.toMatch(/\?/);
      for (const secret of secrets) expect(line).not.toContain(secret);
    }
  });
});
