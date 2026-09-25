import { describe, expect, it } from 'vitest';
import {
  amountToDebit,
  compactCode,
  formatCodeInput,
  hasAmbiguousChars,
  isCodeComplete,
  redeemBlocker,
  redeemMode,
  toRedeemBody,
  validateRedeem,
} from './redeem-form';
import type { CertificateBalance } from './types';

const money = (amount: number) => ({ amount, currency: 'KZT' as const });

function balance(patch: Partial<CertificateBalance> = {}): CertificateBalance {
  return {
    id: 'c1',
    maskedCode: '****-****-AB23',
    kind: 'amount',
    status: 'active',
    nominal: money(1_000_000),
    balance: money(400_000),
    expiresAt: '2027-09-26T19:00:00.000Z',
    validUntil: '2027-09-26',
    setDescription: null,
    ...patch,
  };
}

describe('код сертификата: ввод кассира', () => {
  it('регистр, пробелы и дефисы не важны; формат XXXX-XXXX-XXXX', () => {
    expect(formatCodeInput('abcd efgh jkmn')).toBe('ABCD-EFGH-JKMN');
    expect(formatCodeInput('ABCD-EFGH-JKMN')).toBe('ABCD-EFGH-JKMN');
    expect(formatCodeInput('abcdefg')).toBe('ABCD-EFG');
    expect(formatCodeInput('abcd-efgh-jkmn-pq')).toBe('ABCD-EFGH-JKMN');
    expect(compactCode(' ab-cd ')).toBe('ABCD');
  });

  it('код полный — 12 символов из алфавита без похожих символов', () => {
    expect(isCodeComplete('ABCD-EFGH-JKMN')).toBe(true);
    expect(isCodeComplete('ABCD-EFGH-JKM')).toBe(false);
    // O, 0, 1, I, L в кодах не бывает — вероятная опечатка
    expect(hasAmbiguousChars('ABCD-EFGH-JKMO')).toBe(true);
    expect(isCodeComplete('ABCD-EFGH-JKM0')).toBe(false);
    expect(hasAmbiguousChars('2345-6789-ABCD')).toBe(false);
  });
});

describe('погашение: сертификат на сумму и на набор', () => {
  it('на сумму — частичное списание, набор — только целиком', () => {
    expect(redeemMode('amount')).toBe('partial');
    expect(redeemMode('set')).toBe('full');
  });

  it('на сумму: сумма обязательна, больше нуля и не больше остатка', () => {
    const cert = balance();
    expect(validateRedeem({}, cert)).toEqual({ amount: 'amount_required' });
    expect(validateRedeem({ amount: 0 }, cert)).toEqual({ amount: 'amount_positive' });
    expect(validateRedeem({ amount: 400_001 }, cert)).toEqual({ amount: 'amount_exceeds_balance' });
    expect(validateRedeem({ amount: 400_000 }, cert)).toEqual({});
    expect(validateRedeem({ amount: 150_050 }, cert)).toEqual({});
  });

  it('набор: сумма не нужна и не проверяется (списывается весь остаток)', () => {
    const set = balance({ kind: 'set', balance: money(1_000_000), setDescription: 'Плов на 4 персоны' });
    expect(validateRedeem({}, set)).toEqual({});
    expect(validateRedeem({ amount: 5 }, set)).toEqual({});
    expect(amountToDebit({ amount: 5 }, set)).toBe(1_000_000);
  });

  it('комментарий (номер чека) — до 500 символов', () => {
    expect(validateRedeem({ amount: 100, comment: 'x'.repeat(501) }, balance())).toEqual({ comment: 'comment_too_long' });
  });

  it('тело запроса: на сумму — с суммой в тиынах, набор — без суммы', () => {
    expect(toRedeemBody('abcd efgh jkmn', { amount: 150_000, comment: '  чек 123 ' }, balance(), 'branch-1')).toEqual({
      code: 'ABCD-EFGH-JKMN',
      branchId: 'branch-1',
      comment: 'чек 123',
      amount: { amount: 150_000, currency: 'KZT' },
    });
    expect(toRedeemBody('ABCD-EFGH-JKMN', { amount: 150_000, comment: '' }, balance({ kind: 'set' }), 'branch-1')).toEqual({
      code: 'ABCD-EFGH-JKMN',
      branchId: 'branch-1',
    });
    expect(() => toRedeemBody('ABCD-EFGH-JKMN', {}, balance(), 'branch-1')).toThrow();
  });

  it('сумма к списанию для подтверждения: на сумму — введённая', () => {
    expect(amountToDebit({ amount: 120_000 }, balance())).toBe(120_000);
    expect(amountToDebit({}, balance())).toBeNull();
  });

  it('почему погасить нельзя: статус не active или остаток ноль', () => {
    expect(redeemBlocker(balance())).toBeNull();
    expect(redeemBlocker(balance({ status: 'blocked' }))).toBe('blocked');
    expect(redeemBlocker(balance({ status: 'expired' }))).toBe('expired');
    expect(redeemBlocker(balance({ status: 'redeemed', balance: money(0) }))).toBe('redeemed');
    expect(redeemBlocker(balance({ balance: money(0) }))).toBe('empty');
  });
});
