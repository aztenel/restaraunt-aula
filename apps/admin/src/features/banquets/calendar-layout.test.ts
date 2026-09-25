import { describe, expect, it } from 'vitest';
import {
  addDays,
  banquetsByDate,
  calendarRange,
  cellKey,
  MAX_CALENDAR_DAYS,
  monthWeeks,
  occupancyByVenueDay,
  occupancySummaryByDate,
  overlaps,
  segmentPosition,
  shiftAnchor,
  splitOccupancy,
  startOfWeek,
  timeToMinutes,
  todayLocal,
  weekDays,
  weekdayIndex,
} from './calendar-layout';

const occ = (patch: Partial<Parameters<typeof splitOccupancy>[0][number]>) => ({
  reservationId: 'r1',
  venueId: 'hall-a',
  kind: 'regular',
  status: 'confirmed',
  start: '2026-10-10T13:00:00.000Z',
  end: '2026-10-10T16:00:00.000Z',
  guests: 6,
  banquetRequestId: null,
  ...patch,
});

describe('дни календаря (неделя с понедельника)', () => {
  it('арифметика дат без часовых поясов', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(weekdayIndex('2026-10-05')).toBe(0); // понедельник
    expect(weekdayIndex('2026-10-11')).toBe(6); // воскресенье
    expect(startOfWeek('2026-10-01')).toBe('2026-09-28');
  });

  it('сетка месяца: октябрь 2026 — 5 недель с 28.09 по 01.11', () => {
    const weeks = monthWeeks('2026-10-17');
    expect(weeks).toHaveLength(5);
    expect(weeks[0]![0]).toBe('2026-09-28');
    expect(weeks[4]![6]).toBe('2026-11-01');
    expect(weeks.every((w) => w.length === 7)).toBe(true);
  });

  it('сетка месяца, который начинается в понедельник и занимает 6 недель', () => {
    expect(monthWeeks('2026-06-10')[0]![0]).toBe('2026-06-01');
    const august = monthWeeks('2026-08-01');
    expect(august).toHaveLength(6);
    expect(august[5]![6]).toBe('2026-09-06');
  });

  it('диапазон запроса не превышает лимит сервера', () => {
    const month = calendarRange('month', '2026-08-15');
    expect(month).toMatchObject({ from: '2026-07-27', to: '2026-09-06' });
    expect(month.days.length).toBeLessThanOrEqual(MAX_CALENDAR_DAYS);
    expect(calendarRange('week', '2026-10-08')).toMatchObject({ from: '2026-10-05', to: '2026-10-11' });
    expect(weekDays('2026-10-11')).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']);
  });

  it('перелистывание', () => {
    expect(shiftAnchor('month', '2026-10-31', 1)).toBe('2026-11-01');
    expect(shiftAnchor('month', '2026-01-15', -1)).toBe('2025-12-01');
    expect(shiftAnchor('week', '2026-10-08', -1)).toBe('2026-10-01');
  });

  it('сегодня — по Алматы', () => {
    expect(todayLocal(Date.parse('2026-10-09T20:30:00.000Z'))).toBe('2026-10-10');
  });
});

describe('банкеты по датам', () => {
  it('группировка и порядок по времени (без времени — в конце)', () => {
    const map = banquetsByDate([
      { id: 'a', eventDate: '2026-10-10', eventTime: '19:00' },
      { id: 'b', eventDate: '2026-10-10', eventTime: null },
      { id: 'c', eventDate: '2026-10-10', eventTime: '12:00' },
      { id: 'd', eventDate: '2026-10-11', eventTime: '18:00' },
    ]);
    expect(map.get('2026-10-10')!.map((b) => b.id)).toEqual(['c', 'a', 'b']);
    expect(map.get('2026-10-11')!.map((b) => b.id)).toEqual(['d']);
  });
});

describe('занятость залов по дням (Asia/Almaty, UTC+5)', () => {
  it('обычная бронь внутри дня', () => {
    expect(splitOccupancy([occ({})])).toEqual([
      expect.objectContaining({ date: '2026-10-10', startMinute: 18 * 60, endMinute: 21 * 60, continuesBefore: false, continuesAfter: false, label: '18:00–21:00', kind: 'regular' }),
    ]);
  });

  it('банкет через полночь делится на два дня', () => {
    const segments = splitOccupancy([occ({ kind: 'banquet', banquetRequestId: 'b1', start: '2026-10-10T13:00:00.000Z', end: '2026-10-10T21:00:00.000Z' })]);
    expect(segments.map((s) => [s.date, s.startMinute, s.endMinute, s.continuesBefore, s.continuesAfter])).toEqual([
      ['2026-10-10', 1080, 1440, false, true],
      ['2026-10-11', 0, 120, true, false],
    ]);
    expect(segments[1]!.label).toBe('18:00–02:00');
  });

  it('окончание ровно в полночь не захватывает следующий день; некорректные интервалы пропускаются', () => {
    const segments = splitOccupancy([
      occ({ start: '2026-10-10T13:00:00.000Z', end: '2026-10-10T19:00:00.000Z' }),
      occ({ reservationId: 'bad', start: '2026-10-10T19:00:00.000Z', end: '2026-10-10T13:00:00.000Z' }),
    ]);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ date: '2026-10-10', endMinute: 1440, continuesAfter: false });
  });

  it('по залу и дню; сводка дня считает брони, а не отрезки', () => {
    const segments = splitOccupancy([
      occ({ reservationId: 'r1' }),
      occ({ reservationId: 'r2', venueId: 'hall-b', kind: 'banquet', start: '2026-10-10T12:00:00.000Z', end: '2026-10-10T20:00:00.000Z' }),
    ]);
    const cells = occupancyByVenueDay(segments);
    expect(cells.get(cellKey('hall-a', '2026-10-10'))!.map((s) => s.reservationId)).toEqual(['r1']);
    expect(cells.get(cellKey('hall-b', '2026-10-11'))!.map((s) => s.endMinute)).toEqual([60]);
    const summary = occupancySummaryByDate(segments);
    expect(summary.get('2026-10-10')).toEqual({ regular: 1, banquet: 1 });
    expect(summary.get('2026-10-11')).toEqual({ regular: 0, banquet: 1 });
  });

  it('полоса в ячейке и пересечение интервалов', () => {
    expect(segmentPosition({ startMinute: 720, endMinute: 1080 })).toEqual({ left: 50, width: 25 });
    expect(segmentPosition({ startMinute: 1439, endMinute: 1440 }).width).toBe(1);
    expect(overlaps([{ startMinute: 1080, endMinute: 1260 }], 1200, 1320)).toBe(true);
    expect(overlaps([{ startMinute: 1080, endMinute: 1260 }], 1260, 1320)).toBe(false);
    expect(timeToMinutes('18:30')).toBe(1110);
    expect(timeToMinutes('24:00')).toBeNull();
  });
});
