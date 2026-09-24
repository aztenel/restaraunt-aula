import { describe, expect, it } from 'vitest';
import { maskPhone, normalizePhone } from './phone';

describe('normalizePhone', () => {
  it.each([
    ['8 777 123 45 67', '+77771234567'],
    ['+7 (777) 123-45-67', '+77771234567'],
    ['7771234567', '+77771234567'],
    ['77771234567', '+77771234567'],
    ['+7 7172 55-66-77', '+77172556677'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(['123', '+1 555 123 4567', '', '8 077 123 45 67'])('rejects %s', (input) => {
    expect(() => normalizePhone(input)).toThrow();
  });

  it('masks', () => {
    expect(maskPhone('+77771234567')).toBe('+7 777 *** ** 67');
  });
});
