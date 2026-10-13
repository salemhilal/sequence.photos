import { describe, expect, it } from 'vitest';
import { UNITS } from './units';

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
