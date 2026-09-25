import { describe, expect, it } from 'vitest';
import { Money } from '../../../shared/kernel/money';
import { depositNote, formatLocalDate, formatLocalDateTime, formatLocalTime, formatTenge } from './texts';

describe('notification texts', () => {
  it('formats tenge with thousand separators and tiyn', () => {
    expect(formatTenge(Money.tenge(50_000))).toBe('50 000 ₸');
    expect(formatTenge(Money.of(150_050))).toBe('1 500,50 ₸');
    expect(formatTenge(Money.of(-100))).toBe('-1 ₸');
  });

  it('formats local date and time in the branch timezone', () => {
    const at = new Date('2026-10-24T20:30:00Z'); // 01:30 25.10 по Астане
    expect(formatLocalDate(at, 'Asia/Almaty')).toBe('25.10.2026');
    expect(formatLocalTime(at, 'Asia/Almaty')).toBe('01:30');
    expect(formatLocalDateTime(at, 'Asia/Almaty')).toBe('01:30, 25.10.2026');
  });

  it('deposit note depends on the outcome and locale', () => {
    expect(depositNote('none', 'ru')).toBe('');
    expect(depositNote('refunded', 'ru')).toContain('возвращён');
    expect(depositNote('retained', 'kk')).toContain('ұсталды');
    expect(depositNote('retained', 'en')).toContain('retained');
  });
});
