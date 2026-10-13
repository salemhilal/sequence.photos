import { describe, expect, it } from 'vitest';
import { isBatchId, parseBearer, parseExp, parseFrameIndex } from '../src/formats';

describe('input formats', () => {
  it('batch ids are exactly 22 base64url characters', () => {
    expect(isBatchId('AAAAAAAAAAAAAAAAAAAAAA')).toBe(true);
    expect(isBatchId('abcdefghij-_0123456789')).toBe(true);
    expect(isBatchId('AAAAAAAAAAAAAAAAAAAAA')).toBe(false);
    expect(isBatchId('AAAAAAAAAAAAAAAAAAAAAAA')).toBe(false);
    expect(isBatchId('AAAAAAAAAAAAAAAAAAAAA=')).toBe(false);
    expect(isBatchId('AAAAAAAAAA/AAAAAAAAAAA')).toBe(false);
    expect(isBatchId('..')).toBe(false);
    expect(isBatchId(undefined)).toBe(false);
  });

  it('frame indexes are decimal, without leading zeros, below MAX_FRAMES', () => {
    expect(parseFrameIndex('0', 10)).toBe(0);
    expect(parseFrameIndex('9', 10)).toBe(9);
    expect(parseFrameIndex('10', 10)).toBeNull();
    expect(parseFrameIndex('19', 20)).toBe(19);
    for (const bad of ['01', '00', '-1', '+1', '1e1', ' 1', '1 ', '0x1', '1.0', '', '100']) {
      expect(parseFrameIndex(bad, 20)).toBeNull();
    }
    expect(parseFrameIndex(undefined, 10)).toBeNull();
  });

  it('exp is positive decimal unix seconds', () => {
    expect(parseExp('1700000000')).toBe(1_700_000_000);
    for (const bad of [null, '', '0', '01', '-1', '1.5', '1e9', '1234567890123']) {
      expect(parseExp(bad)).toBeNull();
    }
  });

  it('bearer tokens', () => {
    expect(parseBearer('Bearer IGAAabc.def-ghi_jkl')).toBe('IGAAabc.def-ghi_jkl');
    for (const bad of [null, '', 'Bearer', 'Bearer ', 'bearer abc', 'Basic abc', 'Bearer a b']) {
      expect(parseBearer(bad)).toBeNull();
    }
    expect(parseBearer(`Bearer ${'a'.repeat(3000)}`)).toBeNull();
  });
});
