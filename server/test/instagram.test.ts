import { env } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';
import { getConfig } from '../src/env';
import { exchangeCode, exchangeLongLived, getMe, isProfessional } from '../src/instagram';
import { captureLogs, fakeInstagram, json, SHORT_TOKEN, USER_ID } from './helpers';

const config = () => getConfig(env);

describe('response guards', () => {
  it('reads data[0] of the code exchange, with permissions as a comma string', async () => {
    fakeInstagram({
      exchange: () =>
        json({
          data: [{ access_token: SHORT_TOKEN, permissions: 'a, b ,c' }],
        }),
    });
    expect(await exchangeCode(config(), 'secret', 'code')).toEqual({
      ok: true,
      value: { token: SHORT_TOKEN, permissions: ['a', 'b', 'c'] },
    });
  });

  it('keeps every digit of long numeric ids (Instagram sends them unquoted)', async () => {
    // 17 digits: more than a JavaScript number holds exactly.
    const raw = (body: string) =>
      new Response(body, { headers: { 'Content-Type': 'application/json' } });
    fakeInstagram({
      me: () =>
        raw(
          '{"user_id": 17841412345678901, "username": "someone", "account_type": "BUSINESS", "id": 9007199254740993}',
        ),
    });
    expect(await getMe(config(), 'token', ['username', 'account_type'])).toMatchObject({
      ok: true,
      value: { userId: '17841412345678901' },
    });
  });

  it('logs which fields a 2xx response failed on, by name only', async () => {
    const logs = captureLogs();
    fakeInstagram({
      exchange: () => json({ data: [{ access_token: SHORT_TOKEN, permissions: [1] }] }),
    });
    expect(await exchangeCode(config(), 'secret', 'code')).toEqual({
      ok: false,
      failure: 'rejected',
    });
    const line = logs.records().find((r) => typeof r === 'object' && r !== null && 'fields' in r);
    expect(line).toMatchObject({ event: 'instagram', status: 200 });
    expect(JSON.stringify(line)).not.toContain(SHORT_TOKEN);
  });

  it('caps responses at 64 KB while reading, and logs an oversize one as such', async () => {
    const big = { user_id: USER_ID, padding: 'x'.repeat(64 * 1024) };
    const streamed = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            controller.enqueue(new Uint8Array(16 * 1024).fill(0x20));
          },
        }),
      );
    const instagram = fakeInstagram();
    for (const me of [() => json(big), streamed]) {
      const logs = captureLogs();
      instagram.set({ me });
      expect(await getMe(config(), 'token')).toEqual({ ok: false, failure: 'rejected' });
      expect(logs.records()).toEqual([
        {
          event: 'instagram',
          endpoint: 'GET graph.instagram.com/me',
          status: 200,
          fields: '(too_large)',
        },
      ]);
    }
  });

  it('rejects malformed exchange responses', async () => {
    const instagram = fakeInstagram();
    for (const body of [
      { data: [{ access_token: '' }] },
      { data: [{ access_token: 1 }] },
      { data: [{ access_token: SHORT_TOKEN, permissions: [1] }] },
      { data: 'x' },
      null,
      [],
    ]) {
      instagram.set({ exchange: () => json(body) });
      expect(await exchangeCode(config(), 'secret', 'code')).toEqual({
        ok: false,
        failure: 'rejected',
      });
    }
  });

  it('requires a positive integer expires_in on the long-lived token', async () => {
    const instagram = fakeInstagram();
    for (const expires_in of [undefined, 0, -1, 1.5, '5184000']) {
      instagram.set({ longLived: () => json({ access_token: 'IGAAlong', expires_in }) });
      expect((await exchangeLongLived('secret', SHORT_TOKEN)).ok).toBe(false);
    }
  });

  it('reads /me, with a string or numeric user id', async () => {
    const instagram = fakeInstagram({
      me: () => json({ user_id: 17841400000, username: 'u' }),
    });
    expect(await getMe(config(), 'token', ['username'])).toEqual({
      ok: true,
      value: { userId: '17841400000', username: 'u' },
    });
    instagram.set({ me: () => json({ id: USER_ID }) });
    expect(await getMe(config(), 'token')).toEqual({ ok: false, failure: 'rejected' });
  });

  it('classifies 5xx, timeouts, and network errors as unavailable; 4xx as rejected', async () => {
    const instagram = fakeInstagram();
    const logs = captureLogs();
    for (const [me, failure] of [
      [() => new Response('', { status: 502 }), 'unavailable'],
      [() => Promise.reject(new DOMException('t', 'TimeoutError')), 'unavailable'],
      [() => Promise.reject(new TypeError('net')), 'unavailable'],
      [() => json({ error: { code: 190 } }, 401), 'rejected'],
    ] as const) {
      const before = logs.records().length;
      instagram.set({ me });
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
    expect(isProfessional('CREATOR')).toBe(true);
    expect(isProfessional('Business')).toBe(true);
    expect(isProfessional('PERSONAL')).toBe(false);
    expect(isProfessional('')).toBe(false);
    expect(isProfessional(undefined)).toBe(false);
  });
});
