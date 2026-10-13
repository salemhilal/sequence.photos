import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { InstagramConnection } from '../src/api';
import { fromBase64Url, sha256Base64Url, toBase64Url, utf8 } from '../src/encoding';
import {
  ENROLL_RENEW_GRACE,
  getKeys,
  LIFETIME,
  makeEnrollment,
  messageText,
  readEnrollment,
  SEAL_LIFETIME,
  seal,
  sign,
  timingSafeEqualStrings,
  unseal,
  verify,
  type Signed,
} from '../src/keys';

const NOW = 1_700_000_000;
const ID = 'AAAAAAAAAAAAAAAAAAAAAA';
const USER = '17841400000000000';
const OTHER_SECRET = 'another-server-secret-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

const keys = () => getKeys(env.SERVER_SECRET);

describe('HKDF key derivation', () => {
  // Expected values computed independently with Node's crypto.hkdfSync + createHmac:
  // HKDF-SHA256(ikm = SERVER_SECRET, salt = empty, info = label, 32 bytes).
  it('derives the upload key per the spec', async () => {
    const m: Signed = { kind: 'PUT', id: ID, index: 3, exp: 1_700_000_000 };
    expect(messageText(m)).toBe(`v1\nPUT\n${ID}\n3\n1700000000`);
    expect(await sign(await keys(), m)).toBe('vltwCWKAAPb7WAGvZPDJBgjx1ck9UiCItF2YCQE10kU');
  });

  it('derives the enrollment key per the spec', async () => {
    const m: Signed = { kind: 'ENROLL', userId: USER, exp: 1_700_000_000 };
    expect(await sign(await keys(), m)).toBe('5lTRUFBn2Rlxu0BLmjbAFLontgNXes-i7_Nj9u76wLM');
  });

  it('caches keys per secret', async () => {
    expect(getKeys(env.SERVER_SECRET)).toBe(getKeys(env.SERVER_SECRET));
    const other = await getKeys(OTHER_SECRET);
    expect(other).not.toBe(await keys());
  });

  it('refuses a short secret', async () => {
    await expect(getKeys('too-short')).rejects.toThrow('SERVER_SECRET is too short');
  });
});

describe('sign and verify', () => {
  const put: Signed = { kind: 'PUT', id: ID, index: 2, exp: NOW + LIFETIME.PUT };

  it('accepts a fresh signature', async () => {
    const k = await keys();
    expect(await verify(k, put, await sign(k, put), NOW)).toBe('ok');
  });

  it('rejects an expired value', async () => {
    const k = await keys();
    expect(await verify(k, put, await sign(k, put), put.exp)).toBe('expired');
    expect(await verify(k, put, await sign(k, put), put.exp + 1)).toBe('expired');
  });

  it('rejects an exp further ahead than the lifetime allows', async () => {
    const k = await keys();
    const far: Signed = { ...put, exp: NOW + LIFETIME.PUT + 3600 };
    expect(await verify(k, far, await sign(k, far), NOW)).toBe('bad_signature');
    const del: Signed = { kind: 'DELETE', id: ID, exp: NOW + LIFETIME.DELETE + 3600 };
    expect(await verify(k, del, await sign(k, del), NOW)).toBe('bad_signature');
  });

  it('rejects tampered or malformed signatures', async () => {
    const k = await keys();
    const sig = await sign(k, put);
    const flipped = (sig.startsWith('A') ? 'B' : 'A') + sig.slice(1);
    expect(await verify(k, put, flipped, NOW)).toBe('bad_signature');
    expect(await verify(k, put, sig.slice(0, -1), NOW)).toBe('bad_signature');
    expect(await verify(k, put, `${sig}=`, NOW)).toBe('bad_signature');
    expect(await verify(k, put, '', NOW)).toBe('bad_signature');
  });

  it('rejects a signature for another index, id, exp, or method', async () => {
    const k = await keys();
    const sig = await sign(k, put);
    expect(await verify(k, { ...put, index: 3 }, sig, NOW)).toBe('bad_signature');
    expect(await verify(k, { ...put, id: 'BAAAAAAAAAAAAAAAAAAAAA' }, sig, NOW)).toBe(
      'bad_signature',
    );
    expect(await verify(k, { ...put, exp: put.exp - 1 }, sig, NOW)).toBe('bad_signature');
    const del: Signed = { kind: 'DELETE', id: ID, exp: put.exp };
    expect(await verify(k, del, sig, NOW)).toBe('bad_signature');
  });

  it('rejects a signature made with another secret', async () => {
    const sig = await sign(await getKeys(OTHER_SECRET), put);
    expect(await verify(await keys(), put, sig, NOW)).toBe('bad_signature');
  });
});

describe('enrollment', () => {
  it('round-trips', async () => {
    const k = await keys();
    const token = await makeEnrollment(k, USER, NOW);
    expect(await readEnrollment(k, token, NOW + 1)).toEqual({
      ok: true,
      userId: USER,
      exp: NOW + LIFETIME.ENROLL,
    });
  });

  it('expires after 60 days, renewable for 30 more', async () => {
    const k = await keys();
    const token = await makeEnrollment(k, USER, NOW);
    const expired = NOW + LIFETIME.ENROLL + 1;
    expect(await readEnrollment(k, token, expired)).toEqual({ ok: false, reason: 'expired' });
    expect((await readEnrollment(k, token, expired, ENROLL_RENEW_GRACE)).ok).toBe(true);
    const tooOld = NOW + LIFETIME.ENROLL + ENROLL_RENEW_GRACE;
    expect(await readEnrollment(k, token, tooOld, ENROLL_RENEW_GRACE)).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('rejects a changed user id', async () => {
    const k = await keys();
    const token = await makeEnrollment(k, USER, NOW);
    const [, sig] = token.split('.');
    const forged = `${toBase64Url(utf8(`v1\nENROLL\n1234\n${NOW + 100}`))}.${sig ?? ''}`;
    expect(await readEnrollment(k, forged, NOW)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects an upload-key signature over an enrollment message (wrong purpose)', async () => {
    const k = await keys();
    const message = `v1\nENROLL\n${USER}\n${NOW + 100}`;
    const mac = await crypto.subtle.sign('HMAC', k.upload, utf8(message));
    const token = `${toBase64Url(utf8(message))}.${toBase64Url(new Uint8Array(mac))}`;
    expect(await readEnrollment(k, token, NOW)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects malformed tokens', async () => {
    const k = await keys();
    const sig = 'A'.repeat(43);
    for (const token of [
      '',
      'abc',
      `.${sig}`,
      `${toBase64Url(utf8(`v2\nENROLL\n${USER}\n${NOW}`))}.${sig}`,
      `${toBase64Url(utf8(`v1\nPUT\n${USER}\n${NOW}`))}.${sig}`,
      `${toBase64Url(utf8(`v1\nENROLL\nabc\n${NOW}`))}.${sig}`,
      `${toBase64Url(new Uint8Array([0xff, 0xfe]))}.${sig}`,
    ]) {
      expect(await readEnrollment(k, token, NOW)).toEqual({ ok: false, reason: 'malformed' });
    }
  });
});

describe('seal and unseal', () => {
  const connection: InstagramConnection = {
    token: 'IGAAtesttoken',
    expiresAt: NOW + 5_184_000,
    refreshedAt: NOW,
    userId: USER,
    username: 'someone',
    enrollment: 'enrollment-value',
  };
  const verifier = 'v'.repeat(43);

  it('round-trips, and the challenge matches the verifier', async () => {
    const k = await keys();
    const challenge = await sha256Base64Url(verifier);
    const sealed = await seal(k, { connection, challenge }, NOW);
    const opened = await unseal(k, sealed, NOW + 10);
    expect(opened).toEqual({ connection, challenge });
    expect(timingSafeEqualStrings(opened?.challenge ?? '', await sha256Base64Url(verifier))).toBe(
      true,
    );
    expect(
      timingSafeEqualStrings(opened?.challenge ?? '', await sha256Base64Url('w'.repeat(43))),
    ).toBe(false);
  });

  it('uses a fresh IV each time', async () => {
    const k = await keys();
    const challenge = await sha256Base64Url(verifier);
    expect(await seal(k, { connection, challenge }, NOW)).not.toBe(
      await seal(k, { connection, challenge }, NOW),
    );
  });

  it('expires after five minutes', async () => {
    const k = await keys();
    const sealed = await seal(k, { connection, challenge: 'c'.repeat(43) }, NOW);
    expect(await unseal(k, sealed, NOW + SEAL_LIFETIME - 1)).not.toBeNull();
    expect(await unseal(k, sealed, NOW + SEAL_LIFETIME)).toBeNull();
  });

  it('rejects a seal from too far in the future', async () => {
    const k = await keys();
    const sealed = await seal(k, { connection, challenge: 'c'.repeat(43) }, NOW + 3600);
    expect(await unseal(k, sealed, NOW)).toBeNull();
  });

  it('applies the sign-in checks to the sealed connection (e.g. the username)', async () => {
    const k = await keys();
    const bad = { ...connection, username: '<script>' };
    const sealed = await seal(k, { connection: bad, challenge: 'c'.repeat(43) }, NOW);
    expect(await unseal(k, sealed, NOW)).toBeNull();
  });

  it('rejects tampering, truncation, garbage, and another key', async () => {
    const k = await keys();
    const sealed = await seal(k, { connection, challenge: 'c'.repeat(43) }, NOW);
    const bytes = fromBase64Url(sealed);
    if (!bytes) throw new Error('unreachable');
    for (const at of [0, 12, bytes.length - 1]) {
      const tampered = bytes.slice();
      tampered[at] = (tampered[at] ?? 0) ^ 1;
      expect(await unseal(k, toBase64Url(tampered), NOW)).toBeNull();
    }
    expect(await unseal(k, sealed.slice(0, 20), NOW)).toBeNull();
    expect(await unseal(k, 'not base64url!', NOW)).toBeNull();
    expect(await unseal(await getKeys(OTHER_SECRET), sealed, NOW)).toBeNull();
  });
});
