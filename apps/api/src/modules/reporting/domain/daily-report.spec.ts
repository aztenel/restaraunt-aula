import { describe, expect, it } from 'vitest';
import { Money } from '../../../shared/kernel/money';
import { zonedTimeToUtc } from '../../../shared/kernel/time';
import { ValidationError } from '../../../shared/kernel/errors';
import { normalizeAggregatorVolume, ownChannelShare } from './aggregator';
import { dailyReportDate, dailyScope, dailySummaryText, DailySummary, formatDisplayDate } from './daily-report';

describe('daily report', () => {
  it('report date: 23:30 — today, delayed run after midnight — yesterday', () => {
    expect(dailyReportDate(zonedTimeToUtc('2026-10-01', '23:30'))).toBe('2026-10-01');
    expect(dailyReportDate(zonedTimeToUtc('2026-10-02', '00:20'))).toBe('2026-10-01');
    expect(dailyScope(null)).toBe('all');
    expect(dailyScope('b1')).toBe('b1');
    expect(formatDisplayDate('2026-10-01')).toBe('01.10.2026');
  });

  it('summary text for staff messages', () => {
    const summary: DailySummary = {
      date: '2026-10-01',
      branchId: null,
      revenue: {
        delivery: Money.of(100_000_00),
        pickup: Money.of(50_000_00),
        banquet: Money.zero(),
        certificate: Money.of(20_000_00),
        refunds: Money.of(-5_000_00),
        total: Money.of(165_000_00),
      },
      orders: { placed: 12, completed: 10, cancelled: 1, averageCheck: Money.of(15_000_00) },
      reservations: { created: 4, guests: 20, starting: 3 },
      banquets: { newRequests: 2, answeredWithinSla: 1, unansweredOverdue: 1, held: 0, heldTotal: Money.zero() },
      payments: { received: Money.of(170_000_00), refunded: Money.of(5_000_00) },
      storefront: { sessions: 200, orderedSessions: 9, conversion: 0.045 },
      topDishes: [],
    };
    const text = dailySummaryText(summary, 'Сеть');
    expect(text).toContain('выручка 165 000 ₸');
    expect(text).toContain('возвраты −5 000 ₸');
    expect(text).toContain('10 выполнено');
    expect(text).toContain('конверсия витрины 4.5%');
  });
});

describe('aggregator volumes', () => {
  it('normalizes and validates manual input', () => {
    expect(normalizeAggregatorVolume({ month: '2026-09', source: ' Agg_A ', sourceName: ' Агрегатор A ', orders: 120, revenue: Money.of(1) })).toEqual({
      month: '2026-09',
      source: 'agg_a',
      sourceName: 'Агрегатор A',
      orders: 120,
      revenue: Money.of(1),
    });
    expect(() => normalizeAggregatorVolume({ month: '2026-9', source: 'a1', sourceName: 'x', orders: 1, revenue: Money.zero() })).toThrow(
      ValidationError,
    );
    expect(() => normalizeAggregatorVolume({ month: '2026-09', source: 'a b', sourceName: 'x', orders: 1, revenue: Money.zero() })).toThrowError(
      expect.objectContaining({ code: 'aggregator_volume.invalid_source' }),
    );
    expect(() => normalizeAggregatorVolume({ month: '2026-09', source: 'ab', sourceName: 'x', orders: -1, revenue: Money.zero() })).toThrowError(
      expect.objectContaining({ code: 'aggregator_volume.invalid_orders' }),
    );
  });

  it('own channel share', () => {
    expect(ownChannelShare(30, 70)).toBe(0.3);
    expect(ownChannelShare(30, null)).toBeNull();
    expect(ownChannelShare(0, 0)).toBeNull();
  });
});
