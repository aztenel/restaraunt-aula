import { describe, expect, it } from 'vitest';
import { Money } from '../../../shared/kernel/money';
import { blockedUntil, retryAfterSeconds, shouldAlertGlobal, shouldBlockIp } from './brute-force';
import { formatTenge, parseMajorAmount, toMajorString } from './money-format';

describe('money format', () => {
  it('converts tiyn to provider decimal string', () => {
    expect(toMajorString(Money.of(150_050))).toBe('1500.50');
    expect(toMajorString(Money.of(5))).toBe('0.05');
    expect(toMajorString(Money.of(-1_000))).toBe('-10.00');
  });

  it('parses provider amounts without float math', () => {
    expect(parseMajorAmount('1500.5').amount).toBe(150_050);
    expect(parseMajorAmount(1500.5).amount).toBe(150_050);
    expect(parseMajorAmount('1500,05').amount).toBe(150_005);
    expect(parseMajorAmount(1500).amount).toBe(150_000);
    expect(parseMajorAmount('0.1').amount).toBe(10);
    expect(() => parseMajorAmount('1.005')).toThrow();
    expect(() => parseMajorAmount('abc')).toThrow();
  });

  it('formats tenge for texts', () => {
    expect(formatTenge(Money.tenge(5000))).toBe('5 000 ₸');
    expect(formatTenge(Money.of(150_050))).toBe('1 500,50 ₸');
  });
});

describe('certificate brute-force policy', () => {
  it('blocks after 20 failures per hour', () => {
    expect(shouldBlockIp(19)).toBe(false);
    expect(shouldBlockIp(20)).toBe(true);
    const now = new Date('2026-10-01T10:00:00Z');
    expect(blockedUntil(now).toISOString()).toBe('2026-10-01T11:00:00.000Z');
    expect(retryAfterSeconds(blockedUntil(now), now)).toBe(3600);
    expect(shouldAlertGlobal(199)).toBe(false);
    expect(shouldAlertGlobal(200)).toBe(true);
  });
});
