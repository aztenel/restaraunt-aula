import { describe, expect, it } from 'vitest';
import { zonedTimeToUtc } from '../../../shared/kernel/time';
import { computeHallLoad, findOverbookings, LoadReservation, openMinutesOnDate } from './hall-load';

const HOURS = { thu: [{ open: '10:00', close: '00:00' }], fri: [{ open: '12:00', close: '02:00' }] };

function reservation(id: string, venueId: string, date: string, from: string, to: string, typeCode = 'vip'): LoadReservation {
  return {
    reservationId: id,
    branchId: 'b1',
    venueId,
    venueTypeCode: typeCode,
    startDate: date,
    start: zonedTimeToUtc(date, from),
    end: zonedTimeToUtc(date, to),
    guests: 10,
  };
}

describe('openMinutesOnDate', () => {
  it('counts intervals starting on the date, including ones crossing midnight', () => {
    expect(openMinutesOnDate(HOURS, '2026-10-01')).toBe(14 * 60); // четверг 10:00-00:00
    expect(openMinutesOnDate(HOURS, '2026-10-02')).toBe(14 * 60); // пятница 12:00-02:00
    expect(openMinutesOnDate(HOURS, '2026-10-03')).toBe(0); // суббота выходной
  });
});

describe('computeHallLoad', () => {
  it('booked vs open minutes by weekday and venue type', () => {
    const load = computeHallLoad({
      dates: ['2026-10-01', '2026-10-02'],
      branches: [{ branchId: 'b1', openingHours: HOURS }],
      venues: [
        { venueId: 'v1', branchId: 'b1', typeCode: 'vip', typeName: { ru: 'VIP-зал' } },
        { venueId: 'v2', branchId: 'b1', typeCode: 'vip', typeName: { ru: 'VIP-зал' } },
        { venueId: 't1', branchId: 'b1', typeCode: 'table', typeName: { ru: 'Стол' } },
      ],
      reservations: [
        reservation('r1', 'v1', '2026-10-01', '18:00', '21:00'),
        reservation('r2', 'v2', '2026-10-01', '19:00', '23:00'),
        reservation('r3', 't1', '2026-10-02', '13:00', '14:00', 'table'),
        // Вне периода — не учитывается.
        reservation('r4', 'v1', '2026-10-05', '18:00', '21:00'),
      ],
    });
    const thuVip = load.rows.find((r) => r.weekday === 'thu' && r.venueTypeCode === 'vip')!;
    expect(thuVip).toMatchObject({ venues: 2, openMinutes: 2 * 14 * 60, bookedMinutes: 7 * 60, reservations: 2, guests: 20 });
    expect(thuVip.load).toBe(0.25);
    expect(thuVip.venueTypeName).toEqual({ ru: 'VIP-зал' });
    const friTable = load.rows.find((r) => r.weekday === 'fri' && r.venueTypeCode === 'table')!;
    expect(friTable.load).toBe(0.0714);
    expect(load.weekdays.map((w) => w.weekday)).toEqual(['thu', 'fri']);
    expect(load.weekdays[0]).toMatchObject({ openMinutes: 3 * 14 * 60, bookedMinutes: 420 });
  });
});

describe('findOverbookings', () => {
  it('finds overlapping pairs on the same venue only', () => {
    const pairs = findOverbookings([
      { reservationId: 'a', venueId: 'v1', start: new Date('2026-10-01T10:00:00Z'), end: new Date('2026-10-01T12:00:00Z') },
      { reservationId: 'b', venueId: 'v1', start: new Date('2026-10-01T11:00:00Z'), end: new Date('2026-10-01T13:00:00Z') },
      // Касание по границе — не накладка.
      { reservationId: 'c', venueId: 'v1', start: new Date('2026-10-01T13:00:00Z'), end: new Date('2026-10-01T14:00:00Z') },
      { reservationId: 'd', venueId: 'v2', start: new Date('2026-10-01T10:00:00Z'), end: new Date('2026-10-01T12:00:00Z') },
    ]);
    expect(pairs.map(([x, y]) => `${x.reservationId}-${y.reservationId}`)).toEqual(['a-b']);
  });
});
