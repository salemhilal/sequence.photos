// Text and base64url encoding helpers.

const encoder = new TextEncoder();

export function utf8(text: string): Uint8Array {
  return encoder.encode(text);
}

/** Strict UTF-8 decoding: null on invalid bytes. */
export function decodeUtf8(bytes: ArrayBuffer | Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Strict base64url decoding (no padding, no other alphabets). Returns null unless `text`
 * is the canonical encoding of its bytes, so each value has exactly one spelling.
 */
export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  const base64 =
    text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    return null;
  }
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return toBase64Url(bytes) === text ? bytes : null;
}

export function randomBase64Url(byteLength: number): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

/** `base64url(SHA-256(text))`: the PKCE-style challenge for a verifier. */
export async function sha256Base64Url(text: string): Promise<string> {
  return toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(text))));
}
