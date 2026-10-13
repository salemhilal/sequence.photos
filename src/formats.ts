// Input formats: the patterns and parsers for values from requests.

/** An upload batch id: 128 random bits as base64url, exactly 22 characters. */
export function isBatchId(value: string | undefined): value is string {
  return value !== undefined && /^[A-Za-z0-9_-]{22}$/.test(value);
}

/** A frame index: decimal, no leading zeros, below `maxFrames`. Null if invalid. */
export function parseFrameIndex(value: string | undefined, maxFrames: number): number | null {
  if (value === undefined || !/^(0|[1-9][0-9]?)$/.test(value)) return null;
  const index = Number(value);
  return index < maxFrames ? index : null;
}

/** Unix seconds from a query parameter. Null if absent or malformed. */
export function parseExp(value: string | null): number | null {
  return value !== null && /^[1-9][0-9]{0,11}$/.test(value) ? Number(value) : null;
}

/** A 32-byte value as base64url (nonce, PKCE challenge, verifier). */
export function isBase64Url32(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}

/** The token from `Authorization: Bearer <token>`, or null. */
export function parseBearer(header: string | null): string | null {
  if (header === null || header.length > 2100) return null;
  const match = /^Bearer ([A-Za-z0-9._~+/-]{1,2048}=*)$/.exec(header);
  return match?.[1] ?? null;
}
