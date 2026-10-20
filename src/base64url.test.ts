import { describe, expect, it } from 'vitest';
import { decodeBase64Url, encodeBase64Url } from './base64url';

describe('base64url', () => {
  it('encodes with - and _, unpadded, and decodes back', () => {
    const bytes = new Uint8Array([251, 255, 191, 0, 1]);
    const text = encodeBase64Url(bytes);
    expect(text).toBe('-_-_AAE');
    expect(decodeBase64Url(text)).toBe(String.fromCharCode(...bytes));
  });
});
