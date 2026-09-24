import { describe, expect, it } from 'vitest';
import { InvalidStateTransitionError, ValidationError } from '../../../shared/kernel/errors';
import { Money } from '../../../shared/kernel/money';
import { assertQuantity, CertificateOrderFsm, resolveDeliveryTarget, splitEvenly } from './certificate-order';

describe('certificate order', () => {
  it('limits quantity by source', () => {
    expect(() => assertQuantity(1, 'online')).not.toThrow();
    expect(() => assertQuantity(10, 'online')).not.toThrow();
    expect(() => assertQuantity(11, 'online')).toThrow(ValidationError);
    expect(() => assertQuantity(0, 'online')).toThrow(ValidationError);
    expect(() => assertQuantity(100, 'manual')).not.toThrow();
    expect(() => assertQuantity(101, 'manual')).toThrow(ValidationError);
  });

  it('resolves delivery target: recipient first, then buyer', () => {
    expect(resolveDeliveryTarget('email', { email: 'r@x.kz' }, { email: 'b@x.kz' })).toEqual({ email: 'r@x.kz', phone: null });
    expect(resolveDeliveryTarget('email', {}, { email: 'b@x.kz' })).toEqual({ email: 'b@x.kz', phone: null });
    expect(() => resolveDeliveryTarget('email', {}, { phone: '+77770000000' })).toThrow(ValidationError);
    expect(resolveDeliveryTarget('whatsapp', { phone: '+77010000000' }, { phone: '+77770000000' })).toEqual({
      email: null,
      phone: '+77010000000',
    });
    expect(resolveDeliveryTarget('whatsapp', {}, { phone: '+77770000000' }).phone).toBe('+77770000000');
    expect(resolveDeliveryTarget('none', {}, {})).toEqual({ email: null, phone: null });
  });

  it('splits money without losing tiyn', () => {
    const parts = splitEvenly(Money.of(1000), 3);
    expect(parts.map((p) => p.amount)).toEqual([334, 333, 333]);
    expect(Money.sum(parts).amount).toBe(1000);
    expect(splitEvenly(Money.of(900), 3).map((p) => p.amount)).toEqual([300, 300, 300]);
  });

  it('allows late issue after failed payment, nothing after issue', () => {
    expect(CertificateOrderFsm.canTransition('payment_failed', 'issued')).toBe(true);
    expect(() => CertificateOrderFsm.assertTransition('issued', 'payment_failed')).toThrow(InvalidStateTransitionError);
  });
});
