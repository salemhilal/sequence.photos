import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getConfig } from '../src/env';
import { exchangeCode, exchangeLongLived, getMe, isProfessional } from '../src/instagram';
import { captureLogs, fakeInstagram, json, SHORT_TOKEN, USER_ID } from './helpers';

afterEach(() => {
  vi.restoreAllMocks();
});

const config = () => getConfig(env);

describe('response guards', () => {
  it('reads data[0] of the code exchange, with permissions as a comma string', async () => {
    fakeInstagram({
      exchange: () =>
        json({
          data: [{ access_token: SHORT_TOKEN, user_id: '1', permissions: 'a, b ,c' }],
        }),
    });
    expect(await exchangeCode(config(), 'secret', 'code')).toEqual({
      ok: true,
      value: { token: SHORT_TOKEN, permissions: ['a', 'b', 'c'] },
    });
  });

  it('rejects malformed exchange responses', async () => {
    for (const body of [
      { data: [{ access_token: '' }] },
      { data: [{ access_token: 1 }] },
      { data: [{ access_token: SHORT_TOKEN, permissions: [1] }] },
      { data: [{ access_token: SHORT_TOKEN, user_id: 'abc' }] },
      { data: [{ access_token: SHORT_TOKEN, user_id: 2 ** 60 }] },
      { data: 'x' },
      null,
      [],
    ]) {
      vi.restoreAllMocks();
      fakeInstagram({ exchange: () => json(body) });
      expect(await exchangeCode(config(), 'secret', 'code')).toEqual({
        ok: false,
        failure: 'rejected',
      });
    }
  });

  it('requires a positive integer expires_in on the long-lived token', async () => {
    for (const expires_in of [undefined, 0, -1, 1.5, '5184000']) {
      vi.restoreAllMocks();
      fakeInstagram({ longLived: () => json({ access_token: 'IGAAlong', expires_in }) });
      expect((await exchangeLongLived('secret', SHORT_TOKEN)).ok).toBe(false);
    }
  });

  it('reads /me, with a string or exact numeric user id', async () => {
    fakeInstagram({ me: () => json({ user_id: 17841400000, username: 'u' }) });
    expect(await getMe(config(), 'token', ['username'])).toEqual({
      ok: true,
      value: { userId: '17841400000', username: 'u' },
    });
    vi.restoreAllMocks();
    fakeInstagram({ me: () => json({ id: USER_ID }) });
    expect(await getMe(config(), 'token')).toEqual({ ok: false, failure: 'rejected' });
  });

  it('classifies 5xx, timeouts, and network errors as unavailable; 4xx as rejected', async () => {
    const logs = captureLogs();
    for (const [me, failure] of [
      [() => new Response('', { status: 502 }), 'unavailable'],
      [() => Promise.reject(new DOMException('t', 'TimeoutError')), 'unavailable'],
      [() => Promise.reject(new TypeError('net')), 'unavailable'],
      [() => json({ error: { code: 190 } }, 401), 'rejected'],
    ] as const) {
      const before = logs.records().length;
      fakeInstagram({ me });
      expect(await getMe(config(), 'token')).toEqual({ ok: false, failure });
      // One `instagram` line per failed call.
      expect(logs.records().slice(before)).toEqual([
        expect.objectContaining({ event: 'instagram', endpoint: 'GET graph.instagram.com/me' }),
      ]);
    }
  });

  it('times out every call', async () => {
    const signals: (AbortSignal | null | undefined)[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      signals.push(init?.signal);
      return Promise.resolve(json({}));
    });
    await exchangeCode(config(), 'secret', 'code');
    await exchangeLongLived('secret', 'token');
    await getMe(config(), 'token');
    expect(signals).toHaveLength(3);
    for (const signal of signals) expect(signal).toBeInstanceOf(AbortSignal);
  });
});

describe('isProfessional', () => {
  it('accepts Business and Creator accounts only', () => {
    expect(isProfessional('BUSINESS')).toBe(true);
    expect(isProfessional('MEDIA_CREATOR')).toBe(true);
    expect(isProfessional('Business')).toBe(true);
    expect(isProfessional('PERSONAL')).toBe(false);
    expect(isProfessional('')).toBe(false);
    expect(isProfessional(undefined)).toBe(false);
  });
});
