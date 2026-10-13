import { env } from 'cloudflare:workers';
import * as v from 'valibot';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toBase64Url, utf8 } from '../src/encoding';
import { ISSUED_AT_MAX_AGE, verifySignedRequest } from '../src/meta';
import { call, captureLogs } from './helpers';

afterEach(() => {
  vi.restoreAllMocks();
});

const now = () => Math.floor(Date.now() / 1000);

/** Signs like Meta: base64url(HMAC-SHA256(secret, encodedPayload)) + "." + encodedPayload. */
async function signedRequest(
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

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** A 43-character encoding of 32 bytes has 2 unused bits at the end; set one. */
function nonCanonical(sig: string): string {
  const last = ALPHABET.indexOf(sig.slice(-1));
  return sig.slice(0, -1) + (ALPHABET[last | 1] ?? '');
}

const payload = () => ({
  algorithm: 'HMAC-SHA256',
  issued_at: now(),
  expires: 0,
  user_id: '17841400000000000',
});

function postForm(path: string, body: string): Promise<Response> {
  return call(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
}

describe('verifySignedRequest', () => {
  it('accepts a request signed with the app secret', async () => {
    const { value } = await signedRequest(payload());
    expect(await verifySignedRequest(value, env.IG_APP_SECRET, now())).toEqual({ ok: true });
  });

  it('rejects another secret, tampering, and a swapped payload', async () => {
    const t = now();
    const other = await signedRequest(payload(), 'some-other-secret');
    expect(await verifySignedRequest(other.value, env.IG_APP_SECRET, t)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
    const real = await signedRequest(payload());
    const forged = await signedRequest({ ...payload(), user_id: '1' });
    expect(
      await verifySignedRequest(`${real.sig}.${forged.payload}`, env.IG_APP_SECRET, t),
    ).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects non-canonical base64url and malformed shapes', async () => {
    const t = now();
    const { sig, payload: encoded } = await signedRequest(payload());
    for (const value of [
      '',
      sig,
      `${sig}.${encoded}.x`,
      `${sig}=.${encoded}`,
      `${sig}.${encoded}=`,
      // Standard-alphabet characters.
      `${sig.slice(0, -1)}+.${encoded}`,
      `${sig.slice(0, -1)}/.${encoded}`,
      // The same 32 bytes, spelled with the unused low bits of the last character set.
      `${nonCanonical(sig)}.${encoded}`,
      `${sig.slice(0, -1)}.${encoded}`,
      `${sig}.`,
    ]) {
      expect((await verifySignedRequest(value, env.IG_APP_SECRET, t)).ok).toBe(false);
    }
  });

  it('rejects the wrong algorithm and bad payloads, even when signed', async () => {
    const t = now();
    for (const bad of [
      { ...payload(), algorithm: 'HMAC-SHA1' },
      { ...payload(), algorithm: 'hmac-sha256' },
      { issued_at: t },
      { ...payload(), issued_at: String(t) },
      { ...payload(), expires: -1 },
      'not an object',
    ]) {
      const { value } = await signedRequest(bad);
      expect(await verifySignedRequest(value, env.IG_APP_SECRET, t)).toEqual({
        ok: false,
        reason: 'malformed',
      });
    }
  });

  it('rejects a stale or future issued_at', async () => {
    const t = now();
    const stale = await signedRequest({ ...payload(), issued_at: t - ISSUED_AT_MAX_AGE - 1 });
    expect(await verifySignedRequest(stale.value, env.IG_APP_SECRET, t)).toEqual({
      ok: false,
      reason: 'expired',
    });
    const future = await signedRequest({ ...payload(), issued_at: t + 3600 });
    expect((await verifySignedRequest(future.value, env.IG_APP_SECRET, t)).ok).toBe(false);
    const recent = await signedRequest({ ...payload(), issued_at: t - ISSUED_AT_MAX_AGE + 60 });
    expect((await verifySignedRequest(recent.value, env.IG_APP_SECRET, t)).ok).toBe(true);
  });
});

describe('POST /meta/deauthorize', () => {
  it('200s a valid signed_request', async () => {
    const { value } = await signedRequest(payload());
    const response = await postForm(
      '/meta/deauthorize',
      new URLSearchParams({ signed_request: value }).toString(),
    );
    expect(response.status).toBe(200);
  });

  it('400s a bad or missing signed_request', async () => {
    const { value } = await signedRequest(payload(), 'wrong');
    for (const body of [
      new URLSearchParams({ signed_request: value }).toString(),
      new URLSearchParams({ other: 'x' }).toString(),
      '',
    ]) {
      expect((await postForm('/meta/deauthorize', body)).status).toBe(400);
    }
  });

  it('413s a body over 8 KB', async () => {
    const { value } = await signedRequest(payload());
    const body = new URLSearchParams({ signed_request: value, pad: 'x'.repeat(8192) }).toString();
    expect((await postForm('/meta/deauthorize', body)).status).toBe(413);
  });
});

describe('POST /meta/data-deletion', () => {
  it('returns a status URL and a matching confirmation code', async () => {
    const { value } = await signedRequest(payload());
    const response = await postForm(
      '/meta/data-deletion',
      new URLSearchParams({ signed_request: value }).toString(),
    );
    expect(response.status).toBe(200);
    const body = v.parse(
      v.strictObject({ url: v.string(), confirmation_code: v.string() }),
      await response.json(),
    );
    expect(body.confirmation_code).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(body.url).toBe(`https://server.test/meta/deletion?code=${body.confirmation_code}`);
  });

  it('400s a bad signed_request', async () => {
    const { value } = await signedRequest({ ...payload(), algorithm: 'none' });
    expect(
      (
        await postForm(
          '/meta/data-deletion',
          new URLSearchParams({ signed_request: value }).toString(),
        )
      ).status,
    ).toBe(400);
  });
});

describe('GET /meta/deletion', () => {
  it('serves the static status page, whatever the code', async () => {
    const logs = captureLogs();
    const response = await call('/meta/deletion?code=<script>alert(1)</script>');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    const html = await response.text();
    expect(html).toContain('keeps no personal data');
    expect(html).toContain('within about an hour and a half');
    expect(html).not.toContain('<script>');
    expect(logs.records()[0]).toMatchObject({ route: 'GET /meta/deletion', query: ['code'] });
  });
});
