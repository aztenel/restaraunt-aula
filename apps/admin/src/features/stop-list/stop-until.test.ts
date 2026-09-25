import { describe, expect, it } from 'vitest';
import { describeUntil, MAX_STOP_DAYS, resolveStopUntil } from './stop-until';

// 25.09.2026 14:10 в Астане (UTC+5).
const now = new Date('2026-09-25T09:10:00.000Z');

describe('стоп «до»: быстрые варианты', () => {
  it('до конца дня — считает сервер по часовому поясу филиала', () => {
    expect(resolveStopUntil('end_of_day', now)).toEqual({ ok: true, payload: { until: null, untilEndOfDay: true } });
  });

  it('на 1 и 2 часа — точное время в ISO UTC', () => {
    expect(resolveStopUntil('hour_1', now)).toEqual({ ok: true, payload: { until: '2026-09-25T10:10:00.000Z' } });
    expect(resolveStopUntil('hour_2', now)).toEqual({ ok: true, payload: { until: '2026-09-25T11:10:00.000Z' } });
  });

  it('до ручного возврата — без срока', () => {
    expect(resolveStopUntil('manual', now)).toEqual({ ok: true, payload: { until: null } });
  });

  it('своё время: обязательно, в будущем и не дальше 30 дней', () => {
    expect(resolveStopUntil('custom', now, null)).toEqual({ ok: false, error: 'custom_required' });
    expect(resolveStopUntil('custom', now, new Date('2026-09-25T09:00:00.000Z'))).toEqual({ ok: false, error: 'past' });
    expect(resolveStopUntil('custom', now, now)).toEqual({ ok: false, error: 'past' });
    const tooFar = new Date(now.getTime() + (MAX_STOP_DAYS + 1) * 86_400_000);
    expect(resolveStopUntil('custom', now, tooFar)).toEqual({ ok: false, error: 'too_far' });
    expect(resolveStopUntil('custom', now, new Date('2026-09-26T04:00:00.000Z'))).toEqual({
      ok: true,
      payload: { until: '2026-09-26T04:00:00.000Z' },
    });
  });
});

describe('подпись срока стопа (Asia/Almaty)', () => {
  it('без срока — до ручного возврата', () => {
    expect(describeUntil(null, now)).toEqual({ kind: 'manual' });
  });

  it('ближайшая полночь филиала — «до конца дня»', () => {
    // 26.09 00:00 в Астане = 25.09 19:00 UTC
    expect(describeUntil('2026-09-25T19:00:00.000Z', now)).toEqual({ kind: 'end_of_day' });
  });

  it('сегодня — время, другой день — дата и время', () => {
    expect(describeUntil('2026-09-25T13:30:00.000Z', now)).toEqual({ kind: 'today', time: '18:30' });
    expect(describeUntil('2026-09-27T07:00:00.000Z', now)).toEqual({ kind: 'date', date: '27.09 12:00' });
  });

  it('истёкший срок — позиция уже вернётся в продажу', () => {
    expect(describeUntil('2026-09-25T09:00:00.000Z', now)).toEqual({ kind: 'expired' });
  });
});
