import { describe, expect, it } from 'vitest';
import { fromBase64Url, toBase64Url } from '../src/encoding';

describe('base64url', () => {
  it('round-trips bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    const text = toBase64Url(bytes);
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(fromBase64Url(text)).toEqual(bytes);
  });

  it('rejects padding, other alphabets, impossible lengths, and non-canonical spellings', () => {
    expect(fromBase64Url('AA==')).toBeNull();
    expect(fromBase64Url('A+/A')).toBeNull();
    expect(fromBase64Url('AAAAA')).toBeNull();
    // "AB" decodes to the same byte as "AA" (unused low bits set).
    expect(fromBase64Url('AA')).toEqual(new Uint8Array([0]));
    expect(fromBase64Url('AB')).toBeNull();
  });
});
