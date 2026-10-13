// Keys and the values the server signs or seals. See README "Secrets and keys".
//
// Every key is derived from SERVER_SECRET with HKDF-SHA256 under its own label, so a
// value made for one purpose can't be passed off as another. Every signed or sealed
// value carries an `exp` the server set; verifiers reject an `exp` in the past and one
// further in the future than that kind of value's lifetime allows.

import * as v from 'valibot';
import type { InstagramConnection } from './api';
import { decodeUtf8, fromBase64Url, toBase64Url, utf8 } from './encoding';
import {
  BASE64URL_32_SOURCE,
  Base64Url32,
  Enrollment,
  isUserId,
  Token,
  UNIX_SECONDS_SOURCE,
  USER_ID_SOURCE,
  UserId,
  Username,
} from './formats';

// --- Comparison -------------------------------------------------------------------------

/** Constant-time string comparison (for values derived from secrets). */
export function timingSafeEqualStrings(a: string, b: string): boolean {
  const left = utf8(a);
  const right = utf8(b);
  // timingSafeEqual requires equal lengths; comparing `left` with itself keeps the
  // timing independent of where the lengths differ.
  if (left.byteLength !== right.byteLength) {
    crypto.subtle.timingSafeEqual(left, left);
    return false;
  }
  return crypto.subtle.timingSafeEqual(left, right);
}

// --- Key derivation ---------------------------------------------------------------------

export interface Keys {
  /** AES-256-GCM: the sign-in handoff. */
  seal: CryptoKey;
  /** HMAC-SHA256: enrollment credentials. */
  enroll: CryptoKey;
  /** HMAC-SHA256: upload PUT and DELETE URLs. */
  upload: CryptoKey;
  /** HMAC-SHA256: short user hashes in log lines (see log.ts). */
  log: CryptoKey;
}

export const LABELS = {
  seal: 'sequence/v1/seal',
  enroll: 'sequence/v1/enroll',
  upload: 'sequence/v1/upload',
  log: 'sequence/v1/log',
} as const;

/** base64url of 32 bytes. */
const MIN_SECRET_LENGTH = 43;

async function deriveKeys(secret: string): Promise<Keys> {
  if (secret.length < MIN_SECRET_LENGTH) throw new Error('SERVER_SECRET is too short');
  const base = await crypto.subtle.importKey('raw', utf8(secret), 'HKDF', false, ['deriveKey']);
  const params = (label: string): SubtleCryptoDeriveKeyAlgorithm => ({
    name: 'HKDF',
    hash: 'SHA-256',
    salt: new Uint8Array(0),
    info: utf8(label),
  });
  const hmac = (label: string) =>
    crypto.subtle.deriveKey(
      params(label),
      base,
      { name: 'HMAC', hash: 'SHA-256', length: 256 },
      false,
      ['sign', 'verify'],
    );
  const [seal, enroll, upload, log] = await Promise.all([
    crypto.subtle.deriveKey(params(LABELS.seal), base, { name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]),
    hmac(LABELS.enroll),
    hmac(LABELS.upload),
    hmac(LABELS.log),
  ]);
  return { seal, enroll, upload, log };
}

// Derived once per isolate. Keyed on the secret so a changed secret (or a test with a
// different one) isn't served stale keys.
let cache: { secret: string; keys: Promise<Keys> } | undefined;

export function getKeys(secret: string): Promise<Keys> {
  if (cache?.secret !== secret) {
    const keys = deriveKeys(secret);
    cache = { secret, keys };
    // Don't cache a failure.
    keys.catch(() => {
      if (cache?.keys === keys) cache = undefined;
    });
  }
  return cache.keys;
}

// --- Signed values ----------------------------------------------------------------------

export type Signed =
  | { kind: 'ENROLL'; userId: string; exp: number }
  | { kind: 'PUT'; id: string; index: number; exp: number }
  | { kind: 'DELETE'; id: string; exp: number };

/** Each kind's lifetime in seconds: `exp` is set to now + this, and never trusted beyond it. */
export const LIFETIME = {
  ENROLL: 60 * 24 * 60 * 60,
  PUT: 30 * 60,
  DELETE: 2 * 60 * 60,
} as const satisfies Record<Signed['kind'], number>;

/** How long past its `exp` an enrollment can still be renewed. */
export const ENROLL_RENEW_GRACE = 30 * 24 * 60 * 60;

/**
 * How long a frame is served after upload (by R2's `uploaded` time), and the age past
 * which the sweep deletes it. Leaves room for Meta's recommended container polling.
 */
export const FRAME_MAX_AGE = 60 * 60;

/**
 * Allowance for clock differences between the isolate that set an `exp` and the one
 * checking it, in the "too far in the future" check only.
 */
const CLOCK_SKEW = 60;

/** The versioned, domain-separated message a signature covers. */
export function messageText(m: Signed): string {
  switch (m.kind) {
    case 'ENROLL':
      return `v1\nENROLL\n${m.userId}\n${m.exp}`;
    case 'PUT':
      return `v1\nPUT\n${m.id}\n${m.index}\n${m.exp}`;
    case 'DELETE':
      return `v1\nDELETE\n${m.id}\n${m.exp}`;
  }
}

function keyFor(keys: Keys, m: Signed): CryptoKey {
  return m.kind === 'ENROLL' ? keys.enroll : keys.upload;
}

/** base64url(HMAC-SHA256(key, message)). */
export async function sign(keys: Keys, m: Signed): Promise<string> {
  const mac = await crypto.subtle.sign('HMAC', keyFor(keys, m), utf8(messageText(m)));
  return toBase64Url(new Uint8Array(mac));
}

export type VerifyResult = 'ok' | 'bad_signature' | 'expired';

/**
 * Checks `sig` over `m` (in constant time, by crypto.subtle.verify), then its expiry.
 * `grace` allows an `exp` up to that many seconds in the past (enrollment renewal).
 * An `exp` beyond the kind's lifetime counts as a bad signature: the server never makes
 * one, so it means a bug or a leaked key.
 */
export async function verify(
  keys: Keys,
  m: Signed,
  sig: string,
  now: number,
  grace = 0,
): Promise<VerifyResult> {
  const mac = fromBase64Url(sig);
  if (mac?.byteLength !== 32) return 'bad_signature';
  const valid = await crypto.subtle.verify('HMAC', keyFor(keys, m), mac, utf8(messageText(m)));
  if (!valid) return 'bad_signature';
  if (!Number.isSafeInteger(m.exp) || m.exp > now + LIFETIME[m.kind] + CLOCK_SKEW) {
    return 'bad_signature';
  }
  if (m.exp <= now - grace) return 'expired';
  return 'ok';
}

// --- Enrollment credentials -------------------------------------------------------------
//
// `base64url(message) + "." + base64url(HMAC(enroll key, message))`, where message is
// `v1\nENROLL\n<userId>\n<exp>`.

const ENROLLMENT_PATTERN = new RegExp(`^([A-Za-z0-9_-]{1,200})\\.(${BASE64URL_32_SOURCE})$`);
const ENROLLMENT_MESSAGE = new RegExp(
  `^v1\\nENROLL\\n(${USER_ID_SOURCE})\\n(${UNIX_SECONDS_SOURCE})$`,
);

export async function makeEnrollment(keys: Keys, userId: string, now: number): Promise<string> {
  if (!isUserId(userId)) throw new Error('invalid user id');
  const m: Signed = { kind: 'ENROLL', userId, exp: now + LIFETIME.ENROLL };
  return `${toBase64Url(utf8(messageText(m)))}.${await sign(keys, m)}`;
}

export type EnrollmentResult =
  | { ok: true; userId: string; exp: number }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' };

export async function readEnrollment(
  keys: Keys,
  token: string,
  now: number,
  grace = 0,
): Promise<EnrollmentResult> {
  const parts = ENROLLMENT_PATTERN.exec(token);
  const payload = parts?.[1];
  const sig = parts?.[2];
  if (payload === undefined || sig === undefined) return { ok: false, reason: 'malformed' };
  const bytes = fromBase64Url(payload);
  if (!bytes) return { ok: false, reason: 'malformed' };
  const text = decodeUtf8(bytes);
  if (text === null) return { ok: false, reason: 'malformed' };
  const fields = ENROLLMENT_MESSAGE.exec(text);
  const userId = fields?.[1];
  const exp = fields?.[2];
  if (userId === undefined || exp === undefined) return { ok: false, reason: 'malformed' };
  const m: Signed = { kind: 'ENROLL', userId, exp: Number(exp) };
  const result = await verify(keys, m, sig, now, grace);
  return result === 'ok' ? { ok: true, userId, exp: m.exp } : { ok: false, reason: result };
}

// --- Sealed sign-in handoff -------------------------------------------------------------
//
// `base64url(iv + AES-256-GCM(seal key, JSON { v: 1, connection, challenge, exp }))`.

export const SEAL_LIFETIME = 300;
const IV_BYTES = 12;
/** Binds ciphertexts to this use of the seal key. */
const SEAL_AAD = utf8('v1\nSEAL');

export interface SignInHandoff {
  connection: InstagramConnection;
  /** base64url(SHA-256(verifier)), from the OAuth state. */
  challenge: string;
}

const ConnectionSchema = v.strictObject({
  token: Token,
  expiresAt: v.pipe(v.number(), v.safeInteger()),
  refreshedAt: v.pipe(v.number(), v.safeInteger()),
  userId: UserId,
  username: Username,
  enrollment: Enrollment,
});

const SealedSchema = v.strictObject({
  v: v.literal(1),
  connection: ConnectionSchema,
  challenge: Base64Url32,
  exp: v.pipe(v.number(), v.safeInteger()),
});

export async function seal(keys: Keys, handoff: SignInHandoff, now: number): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plaintext = JSON.stringify({ v: 1, ...handoff, exp: now + SEAL_LIFETIME });
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: SEAL_AAD },
    keys.seal,
    utf8(plaintext),
  );
  const out = new Uint8Array(IV_BYTES + ciphertext.byteLength);
  out.set(iv);
  out.set(new Uint8Array(ciphertext), IV_BYTES);
  return toBase64Url(out);
}

/** The handoff, or null if `sealed` is malformed, tampered with, or expired. */
export async function unseal(
  keys: Keys,
  sealed: string,
  now: number,
): Promise<SignInHandoff | null> {
  const bytes = fromBase64Url(sealed);
  // IV + at least the 16-byte GCM tag.
  if (!bytes || bytes.byteLength < IV_BYTES + 16) return null;
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.subarray(0, IV_BYTES), additionalData: SEAL_AAD },
      keys.seal,
      bytes.subarray(IV_BYTES),
    );
  } catch {
    return null;
  }
  const text = decodeUtf8(plaintext);
  if (text === null) return null;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = v.safeParse(SealedSchema, json);
  if (!parsed.success) return null;
  const { exp, connection, challenge } = parsed.output;
  if (exp <= now || exp > now + SEAL_LIFETIME + CLOCK_SKEW) return null;
  return { connection, challenge };
}
