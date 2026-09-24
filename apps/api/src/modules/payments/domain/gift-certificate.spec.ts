import { describe, expect, it } from 'vitest';
import { ConflictError, InvalidStateTransitionError, ValidationError } from '../../../shared/kernel/errors';
import { Money } from '../../../shared/kernel/money';
import { addMonthsToDate, certificateExpiresAt, expiresAtForLastDay, GiftCertificate, lastValidDate } from './gift-certificate';

const now = new Date('2026-10-01T06:00:00Z'); // 11:00 в Астане

function cert(kind: 'amount' | 'set' = 'amount', nominal = 10_000) {
  return GiftCertificate.issue(
    {
      id: 'c1',
      orderId: 'o1',
      productId: 'p1',
      kind,
      name: { ru: 'Сертификат' },
      setDescription: kind === 'set' ? { ru: 'Ужин на двоих' } : null,
      nominal: Money.tenge(nominal),
      price: Money.tenge(nominal),
      last4: 'AB12',
      validityMonths: 12,
    },
    now,
  );
}

describe('certificate expiry', () => {
  it('adds months clamping the day', () => {
    expect(addMonthsToDate('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsToDate('2027-12-15', 2)).toBe('2028-02-15');
    expect(addMonthsToDate('2026-10-01', 12)).toBe('2027-10-01');
  });

  it('is valid through the whole last local day (Asia/Almaty)', () => {
    const expires = certificateExpiresAt(now, 12);
    expect(expires.toISOString()).toBe('2027-10-01T19:00:00.000Z'); // 02.10.2027 00:00 UTC+5
    expect(lastValidDate(expires)).toBe('2027-10-01');
    expect(expiresAtForLastDay('2027-10-01')).toEqual(expires);
    expect(() => certificateExpiresAt(now, 0)).toThrow(ValidationError);
  });
});

describe('GiftCertificate', () => {
  it('issues active with full balance', () => {
    const c = cert();
    expect(c.status).toBe('active');
    expect(c.balance.amount).toBe(1_000_000);
  });

  it('partially debits amount certificates and becomes redeemed at zero', () => {
    const c = cert();
    expect(c.debit(Money.tenge(4000), now).balanceAfter.amount).toBe(600_000);
    expect(() => c.debit(Money.tenge(7000), now)).toThrow(ConflictError);
    expect(() => c.debit(Money.zero(), now)).toThrow(ValidationError);
    expect(() => c.debit(null, now)).toThrow(ValidationError);
    c.debit(Money.tenge(6000), now);
    expect(c.status).toBe('redeemed');
    expect(c.balance.amount).toBe(0);
    expect(() => c.debit(Money.of(1), now)).toThrow(ConflictError);
  });

  it('redeems set certificates in full only', () => {
    const c = cert('set', 25_000);
    expect(() => c.debit(Money.tenge(1000), now)).toThrow(ValidationError);
    const res = c.debit(null, now);
    expect(res.amount.amount).toBe(2_500_000);
    expect(c.status).toBe('redeemed');
  });

  it('credits back up to nominal and reactivates', () => {
    const c = cert();
    c.debit(Money.tenge(10_000), now);
    expect(c.status).toBe('redeemed');
    c.credit(Money.tenge(3000), now);
    expect(c.status).toBe('active');
    expect(() => c.credit(Money.tenge(7001), now)).toThrow(ConflictError);
    // Возврат после истечения срока: сертификат остаётся истёкшим.
    const late = cert();
    late.debit(Money.tenge(10_000), now);
    late.credit(Money.tenge(1000), new Date('2028-01-01T00:00:00Z'));
    expect(late.status).toBe('expired');
  });

  it('refuses blocked and expired certificates', () => {
    const c = cert();
    c.block('Утерян');
    expect(() => c.debit(Money.tenge(1), now)).toThrow(ConflictError);
    c.unblock(now);
    expect(c.status).toBe('active');
    const later = new Date('2027-10-02T00:00:00Z');
    expect(() => c.debit(Money.tenge(1), later)).toThrow(/expired/);
    expect(c.expire(now)).toBe(false);
    expect(c.expire(later)).toBe(true);
    expect(c.status).toBe('expired');
    expect(() => c.unblock(now)).toThrow(ConflictError);
  });

  it('unblocks into expired when the date has passed', () => {
    const c = cert();
    c.block('Проверка');
    c.unblock(new Date('2028-01-01T00:00:00Z'));
    expect(c.status).toBe('expired');
  });

  it('extends expiry forward and reinstates expired certificates', () => {
    const c = cert();
    const later = new Date('2027-10-02T00:00:00Z');
    c.expire(later);
    expect(() => c.extend(new Date('2027-01-01T00:00:00Z'), later)).toThrow(ValidationError);
    const res = c.extend(new Date('2028-01-01T00:00:00Z'), later);
    expect(res.reinstated).toBe(true);
    expect(c.status).toBe('active');
    const redeemed = cert();
    redeemed.debit(Money.tenge(10_000), now);
    expect(() => redeemed.extend(new Date('2030-01-01T00:00:00Z'), now)).toThrow(ConflictError);
  });

  it('forbids transitions outside the scheme', () => {
    const c = cert();
    c.debit(Money.tenge(10_000), now);
    expect(() => c.block('x')).toThrow(InvalidStateTransitionError);
  });
});
