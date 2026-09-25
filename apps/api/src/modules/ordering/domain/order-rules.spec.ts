import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../shared/kernel/errors';
import { assertBranchAcceptsOrder, BranchOrderingSettings, cleanText, leadMinutesFor, orderEtaMinutes } from './order-rules';

const branch: BranchOrderingSettings = {
  isActive: true,
  acceptsDelivery: true,
  acceptsPickup: false,
  paymentMethods: ['online'],
  deliveryLeadMinutes: 60,
  pickupLeadMinutes: 30,
};

function code(fn: () => void): string | null {
  try {
    fn();
    return null;
  } catch (err) {
    expect(err).toBeInstanceOf(ValidationError);
    return (err as ValidationError).code;
  }
}

describe('branch ordering rules', () => {
  it('branch must be active, accept the type and the payment method', () => {
    expect(code(() => assertBranchAcceptsOrder(branch, 'delivery', 'online'))).toBeNull();
    expect(code(() => assertBranchAcceptsOrder({ ...branch, isActive: false }, 'delivery', 'online'))).toBe('order.branch_inactive');
    expect(code(() => assertBranchAcceptsOrder(branch, 'pickup'))).toBe('order.type_not_accepted');
    expect(code(() => assertBranchAcceptsOrder(branch, 'delivery', 'on_receipt'))).toBe('order.payment_method_not_accepted');
  });

  it('lead time and ETA by order type', () => {
    expect(leadMinutesFor(branch, 'delivery')).toBe(60);
    expect(leadMinutesFor(branch, 'pickup')).toBe(30);
    expect(orderEtaMinutes('pickup', 30, 90)).toBe(30);
    expect(orderEtaMinutes('delivery', 60, 45)).toBe(60);
    expect(orderEtaMinutes('delivery', 60, 90)).toBe(90);
    expect(orderEtaMinutes('delivery', 60, null)).toBe(60);
  });

  it('cleans free text', () => {
    expect(cleanText('  ')).toBeNull();
    expect(cleanText(null)).toBeNull();
    expect(cleanText(' Домофон 12 ')).toBe('Домофон 12');
    expect(cleanText('x'.repeat(20), 5)).toBe('xxxxx');
  });
});
