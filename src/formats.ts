// Input formats: the patterns, schemas, and parsers for values from requests, Instagram,
// and the server's own signed and sealed values. Each rule lives here once.

import * as v from 'valibot';
import { decodeUtf8 } from './encoding';

// --- Patterns ---------------------------------------------------------------------------
//
// Unanchored sources, for composing into larger patterns (e.g. the enrollment message).

/** 32 bytes as base64url: 43 characters, no padding. */
export const BASE64URL_32_SOURCE = '[A-Za-z0-9_-]{43}';
/** Instagram user ids are decimal strings. */
export const USER_ID_SOURCE = '[0-9]{1,32}';
/** Unix seconds: positive decimal, no leading zeros. */
export const UNIX_SECONDS_SOURCE = '[1-9][0-9]{0,11}';
/** Instagram tokens are at most this long. */
export const MAX_TOKEN_LENGTH = 2048;
/** Enrollment credentials, as sent back by the app (they're about 120 characters). */
export const MAX_ENROLLMENT_LENGTH = 512;

const BASE64URL_32 = new RegExp(`^${BASE64URL_32_SOURCE}$`);
const USER_ID = new RegExp(`^${USER_ID_SOURCE}$`);
const UNIX_SECONDS = new RegExp(`^${UNIX_SECONDS_SOURCE}$`);
/** A client name: where the OAuth state says to send the user back (a `RETURN_URLS` key). */
export const CLIENT_NAME = /^[a-z][a-z0-9-]{0,31}$/;
/** Instagram usernames: letters, digits, periods, underscores (30 max; some slack). */
const USERNAME = /^[A-Za-z0-9._]{1,64}$/;
const BATCH_ID = /^[A-Za-z0-9_-]{22}$/;
/**
 * `MAX_FRAMES`: 1–99. The frame index pattern below allows at most two digits, so the two
 * stay in step: every index below `MAX_FRAMES` has a spelling the index pattern accepts.
 */
export const MAX_FRAMES_PATTERN = /^[1-9][0-9]?$/;
/** A frame index: decimal, no leading zeros, at most two digits (see `MAX_FRAMES_PATTERN`). */
const FRAME_INDEX = /^(0|[1-9][0-9]?)$/;
/** `Bearer <token>`, checked by length before the pattern runs. */
const MAX_AUTHORIZATION_LENGTH = 2100;
const BEARER = new RegExp(`^Bearer ([A-Za-z0-9._~+/-]{1,${MAX_TOKEN_LENGTH}}=*)$`);

// --- Schemas ----------------------------------------------------------------------------

/** A 32-byte value as base64url (nonce, PKCE challenge, verifier). */
export const Base64Url32 = v.pipe(v.string(), v.regex(BASE64URL_32));
export const UserId = v.pipe(v.string(), v.regex(USER_ID));
export const Token = v.pipe(v.string(), v.minLength(1), v.maxLength(MAX_TOKEN_LENGTH));
export const Enrollment = v.pipe(v.string(), v.maxLength(MAX_ENROLLMENT_LENGTH));
export const Username = v.pipe(v.string(), v.regex(USERNAME));

// --- Parsers ----------------------------------------------------------------------------

export function isBase64Url32(value: string): boolean {
  return BASE64URL_32.test(value);
}

export function isUserId(value: string): boolean {
  return USER_ID.test(value);
}

export function isUsername(value: string): boolean {
  return USERNAME.test(value);
}

/** An upload batch id: 128 random bits as base64url, exactly 22 characters. */
export function isBatchId(value: string | undefined): value is string {
  return value !== undefined && BATCH_ID.test(value);
}

/** A frame index below `maxFrames`. Null if invalid. */
export function parseFrameIndex(value: string | undefined, maxFrames: number): number | null {
  if (value === undefined || !FRAME_INDEX.test(value)) return null;
  const index = Number(value);
  return index < maxFrames ? index : null;
}

/** Unix seconds from a query parameter. Null if absent or malformed. */
export function parseExp(value: string | null): number | null {
  return value !== null && UNIX_SECONDS.test(value) ? Number(value) : null;
}

/** The token from `Authorization: Bearer <token>`, or null. */
export function parseBearer(header: string | null): string | null {
  if (header === null || header.length > MAX_AUTHORIZATION_LENGTH) return null;
  const match = BEARER.exec(header);
  return match?.[1] ?? null;
}

/**
 * Parses JSON (text, or strict UTF-8 bytes) with `schema`. Null if the bytes aren't UTF-8,
 * the text isn't JSON, or the value doesn't match.
 */
export function parseJsonWith<S extends v.GenericSchema>(
  schema: S,
  input: string | ArrayBuffer | Uint8Array,
): v.InferOutput<S> | null {
  const text = typeof input === 'string' ? input : decodeUtf8(input);
  if (text === null) return null;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = v.safeParse(schema, json);
  return parsed.success ? parsed.output : null;
}
