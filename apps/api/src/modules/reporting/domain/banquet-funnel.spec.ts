import { describe, expect, it } from 'vitest';
import { Money } from '../../../shared/kernel/money';
import { banquetStageRank, BanquetFunnelRow, computeBanquetFunnel } from './banquet-funnel';

const t0 = new Date('2026-10-01T05:00:00Z');
const min = (m: number) => new Date(t0.getTime() + m * 60_000);

function row(overrides: Partial<BanquetFunnelRow>): BanquetFunnelRow {
  return {
    status: 'new',
    maxStage: 0,
    requestedAt: t0,
    firstResponseAt: null,
    cancelledFrom: null,
    cancelReason: null,
    heldTotal: null,
    ...overrides,
  };
}

describe('banquet funnel', () => {
  it('stage ranks', () => {
    expect(banquetStageRank('new')).toBe(0);
    expect(banquetStageRank('held')).toBe(5);
    expect(banquetStageRank('cancelled')).toBe(-1);
  });

  it('counts reached stages, conversion, SLA share and lost requests', () => {
    const now = min(24 * 60);
    const rows = [
      // Ответ за 10 минут, проведён.
      row({ status: 'held', maxStage: 5, firstResponseAt: min(10), heldTotal: Money.of(50_000_000) }),
      // Ответ за 45 минут (просрочен), смета отправлена.
      row({ status: 'quote_sent', maxStage: 2, firstResponseAt: min(45) }),
      // Ответ за 30 минут ровно — в срок; отменён после согласования (не потеря).
      row({ status: 'cancelled', maxStage: 3, firstResponseAt: min(30), cancelledFrom: 'agreed', cancelReason: 'Перенос' }),
      // Отменён из new без ответа — потеря.
      row({ status: 'cancelled', maxStage: 0, firstResponseAt: min(5), cancelledFrom: 'new', cancelReason: 'Дорого' }),
      // Без ответа сутки — просрочен и потерян.
      row({ status: 'new', maxStage: 0 }),
      // Создан 10 минут назад — ответ ещё не должен быть.
      row({ status: 'new', maxStage: 0, requestedAt: min(24 * 60 - 10) }),
    ];
    const f = computeBanquetFunnel(rows, now);
    expect(f.total).toBe(6);
    expect(f.stages.find((s) => s.status === 'new')!.reached).toBe(6);
    expect(f.stages.find((s) => s.status === 'quote_sent')!.reached).toBe(3);
    expect(f.stages.find((s) => s.status === 'held')!).toEqual({ status: 'held', reached: 1, current: 1 });
    expect(f.held).toBe(1);
    expect(f.heldTotal.amount).toBe(50_000_000);
    expect(f.conversion).toBe(0.1667);
    expect(f.answerDue).toBe(5);
    expect(f.answeredWithinSla).toBe(3);
    expect(f.answeredWithinSlaShare).toBe(0.6);
    expect(f.unansweredOverdue).toBe(1);
    expect(f.cancelled).toBe(2);
    expect(f.cancelledBeforeAgreement).toBe(1);
    expect(f.lost).toBe(2);
    expect(f.medianFirstResponseMinutes).toBe(20);
    expect(f.averageFirstResponseMinutes).toBe(23);
    expect(f.cancelReasons).toHaveLength(2);
  });

  it('empty funnel has undefined ratios', () => {
    const f = computeBanquetFunnel([], t0);
    expect(f.conversion).toBeNull();
    expect(f.answeredWithinSlaShare).toBeNull();
    expect(f.heldTotal.isZero()).toBe(true);
  });
});
