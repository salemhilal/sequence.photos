import { describe, expect, it } from 'vitest';
import { TERMS, UNITS } from './units';

describe('UNITS', () => {
  it('keeps inches to eighths exactly, else hundredths', () => {
    const { round, format } = UNITS.print;
    expect(round(2.875)).toBe(2.875);
    expect(round(0.0625 * 2)).toBe(0.125);
    expect(round(1.23456)).toBe(1.23);
    expect(round(2.8751)).toBe(2.88);
    expect(format(2.875)).toBe('2.875');
    expect(format(1 / 3)).toBe('0.33');
  });

  it('keeps pixels whole', () => {
    expect(UNITS.digital.round(26.5)).toBe(27);
    expect(UNITS.digital.format(1079.6)).toBe('1080');
  });
});

describe('TERMS', () => {
  it('names a frame’s edges left and right, and a book page’s outside and inside', () => {
    expect(TERMS.print.edges).toEqual({ top: 'Top', bottom: 'Bottom', inside: 'Inside', outside: 'Outside' });
    expect(TERMS.digital.edges).toEqual({ top: 'Top', bottom: 'Bottom', inside: 'Right', outside: 'Left' });
  });

  it('counts a book’s pages (single first and last pages) and a sequence’s frames', () => {
    expect(TERMS.print.count(4)).toBe('6 pages');
    expect(TERMS.digital.count(1)).toBe('1 frame');
    expect(TERMS.digital.count(3)).toBe('3 frames');
  });
});
