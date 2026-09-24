import { describe, expect, it } from 'vitest';
import { Money } from '../../../shared/kernel/money';
import { orderTransitionsForDispatch, isTerminalDispatchStatus } from './courier-dispatch';
import { cancelReasonLabel, formatEta, formatMoney, orderTypeLabel } from './order-texts';

describe('order texts', () => {
  it('formats money without floats', () => {
    expect(formatMoney(Money.tenge(12500))).toBe('12 500 ₸');
    expect(formatMoney(Money.of(150_050))).toBe('1 500,50 ₸');
    expect(formatMoney(Money.of(5))).toBe('0,05 ₸');
    expect(formatMoney(Money.zero())).toBe('0 ₸');
  });

  it('formats eta in branch time', () => {
    const now = new Date('2026-10-01T07:00:00Z');
    expect(formatEta(new Date('2026-10-01T14:30:00Z'), now, 'Asia/Almaty')).toBe('19:30');
    expect(formatEta(new Date('2026-10-02T14:30:00Z'), now, 'Asia/Almaty')).toBe('02.10 19:30');
  });

  it('localized labels', () => {
    expect(orderTypeLabel('delivery', 'kk')).toBe('Жеткізу');
    expect(orderTypeLabel('pickup', 'ru')).toBe('Самовывоз');
    expect(cancelReasonLabel('not_paid_in_time', 'ru')).toContain('не был оплачен');
  });
});

describe('courier dispatch -> order transitions', () => {
  it('picked up moves a ready order to delivering, delivered completes it through delivering', () => {
    expect(orderTransitionsForDispatch('picked_up', 'ready')).toEqual(['delivering']);
    expect(orderTransitionsForDispatch('picked_up', 'delivering')).toEqual([]);
    expect(orderTransitionsForDispatch('delivered', 'ready')).toEqual(['delivering', 'completed']);
    expect(orderTransitionsForDispatch('delivered', 'delivering')).toEqual(['completed']);
    expect(orderTransitionsForDispatch('delivered', 'completed')).toEqual([]);
    expect(orderTransitionsForDispatch('searching', 'ready')).toEqual([]);
  });

  it('terminal statuses', () => {
    expect(isTerminalDispatchStatus('delivered')).toBe(true);
    expect(isTerminalDispatchStatus('failed')).toBe(true);
    expect(isTerminalDispatchStatus('searching')).toBe(false);
  });
});
