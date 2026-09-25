import { describe, expect, it } from 'vitest';
import {
  assignLanes,
  closedSegments,
  hourTicks,
  itemGeometry,
  localDateTime,
  nowOffset,
  segmentOf,
  shiftDate,
  timeAtFraction,
  timelineWindow,
  todayIn,
  zonedToMs,
} from './timeline-layout';

const TZ = 'Asia/Almaty'; // UTC+5
// Локальные сутки 25.10.2026 в Алматы: 24.10 19:00Z — 25.10 19:00Z.
const FROM = '2026-10-24T19:00:00.000Z';
const TO = '2026-10-25T19:00:00.000Z';
const at = (localTime: string, date = '2026-10-25') => zonedToMs(date, localTime, TZ);
const iso = (localTime: string, date = '2026-10-25') => new Date(at(localTime, date)).toISOString();

describe('окно шкалы дня', () => {
  it('часы работы филиала задают окно, края округляются до часа', () => {
    const window = timelineWindow({
      from: FROM,
      to: TO,
      openingRanges: [{ start: iso('10:30'), end: iso('23:00') }],
      items: [],
      timezone: TZ,
    });
    expect(window).toEqual({ start: at('10:00'), end: at('23:00') });
  });

  it('брони за пределами часов работы расширяют окно (включая буфер уборки)', () => {
    const window = timelineWindow({
      from: FROM,
      to: TO,
      openingRanges: [{ start: iso('11:00'), end: iso('22:00') }],
      items: [{ start: iso('09:15'), blockedUntil: iso('22:40') }],
      timezone: TZ,
    });
    expect(window).toEqual({ start: at('09:00'), end: at('23:00') });
  });

  it('работа после полуночи показывается, брони с предыдущего дня обрезаются началом суток', () => {
    const window = timelineWindow({
      from: FROM,
      to: TO,
      openingRanges: [{ start: iso('12:00'), end: iso('02:00', '2026-10-26') }],
      items: [{ start: iso('23:00', '2026-10-24'), blockedUntil: iso('01:30') }],
      timezone: TZ,
    });
    expect(window.start).toBe(new Date(FROM).getTime());
    expect(window.end).toBe(at('02:00', '2026-10-26'));
  });

  it('выходной без броней — запасное окно 10:00–24:00', () => {
    expect(timelineWindow({ from: FROM, to: TO, openingRanges: [], items: [], timezone: TZ })).toEqual({
      start: at('10:00'),
      end: new Date(TO).getTime(),
    });
  });
});

describe('позиции броней на шкале', () => {
  const window = { start: at('10:00'), end: at('22:00') }; // 12 часов

  it('позиция и ширина — доли окна в процентах', () => {
    const segment = segmentOf({ start: at('13:00'), end: at('16:00') }, window);
    expect(segment).toEqual({ left: 25, width: 25, clippedStart: false, clippedEnd: false });
  });

  it('бронь делится на основную часть и буфер уборки [конец, blockedUntil)', () => {
    const geometry = itemGeometry({ start: iso('19:00'), end: iso('21:00'), blockedUntil: iso('21:30') }, window);
    expect(geometry.main).toMatchObject({ left: 75, clippedEnd: false });
    expect(geometry.main!.width).toBeCloseTo((2 / 12) * 100);
    expect(geometry.buffer!.left).toBeCloseTo((11 / 12) * 100);
    expect(geometry.buffer!.width).toBeCloseTo((0.5 / 12) * 100);
  });

  it('без буфера уборки (blockedUntil = end) буфер не рисуется', () => {
    expect(itemGeometry({ start: iso('12:00'), end: iso('13:00'), blockedUntil: iso('13:00') }, window).buffer).toBeNull();
  });

  it('бронь, выходящая за окно, обрезается с отметкой; вне окна — не рисуется', () => {
    const clipped = segmentOf({ start: at('21:00'), end: at('23:30') }, window);
    expect(clipped).toMatchObject({ clippedStart: false, clippedEnd: true });
    expect(clipped!.left + clipped!.width).toBeCloseTo(100);
    expect(segmentOf({ start: at('22:00'), end: at('23:00') }, window)).toBeNull();
    expect(segmentOf({ start: at('12:00'), end: at('12:00') }, window)).toBeNull();
  });

  it('буфер брони, закончившейся у края окна, обрезается окном', () => {
    const geometry = itemGeometry({ start: iso('20:00'), end: iso('22:00'), blockedUntil: iso('22:30') }, window);
    expect(geometry.main).toMatchObject({ clippedEnd: false });
    expect(geometry.buffer).toBeNull();
  });
});

describe('дорожки внутри строки места', () => {
  it('непересекающиеся брони — одна дорожка; буфер уборки учитывается', () => {
    const { lanes, count } = assignLanes([
      { id: 'a', start: iso('12:00'), blockedUntil: iso('14:15') },
      { id: 'b', start: iso('14:15'), blockedUntil: iso('16:00') },
    ]);
    expect(count).toBe(1);
    expect(lanes.get('a')).toBe(0);
    expect(lanes.get('b')).toBe(0);
  });

  it('«не пришли» и новая бронь на то же время — разные дорожки', () => {
    const { lanes, count } = assignLanes([
      { id: 'noshow', start: iso('19:00'), blockedUntil: iso('21:15') },
      { id: 'new', start: iso('19:30'), blockedUntil: iso('21:00') },
      { id: 'late', start: iso('21:15'), blockedUntil: iso('22:00') },
    ]);
    expect(count).toBe(2);
    expect(lanes.get('noshow')).toBe(0);
    expect(lanes.get('new')).toBe(1);
    expect(lanes.get('late')).toBe(0);
  });

  it('пустая строка — одна дорожка', () => {
    expect(assignLanes([]).count).toBe(1);
  });
});

describe('шкала, нерабочее время, клик по дорожке', () => {
  const window = { start: at('10:00'), end: at('14:00') };

  it('деления каждый час в местном времени филиала', () => {
    const ticks = hourTicks(window, TZ);
    expect(ticks.map((t) => t.label)).toEqual(['10:00', '11:00', '12:00', '13:00', '14:00']);
    expect(ticks.map((t) => t.left)).toEqual([0, 25, 50, 75, 100]);
  });

  it('нерабочее время — дополнение часов работы внутри окна', () => {
    const closed = closedSegments(window, [{ start: iso('11:00'), end: iso('13:00') }]);
    expect(closed).toEqual([
      { left: 0, width: 25, clippedStart: false, clippedEnd: false },
      { left: 75, width: 25, clippedStart: false, clippedEnd: false },
    ]);
    expect(closedSegments(window, [])).toHaveLength(1);
  });

  it('клик по дорожке → время начала брони с шагом 15 минут (вниз), не позже конца окна', () => {
    expect(timeAtFraction(0.5, window)).toBe(at('12:00'));
    expect(timeAtFraction(0.53, window)).toBe(at('12:00'));
    expect(timeAtFraction(0.57, window)).toBe(at('12:15'));
    expect(timeAtFraction(1, window)).toBe(at('13:45'));
    expect(timeAtFraction(-1, window)).toBe(at('10:00'));
    expect(localDateTime(timeAtFraction(0.57, window), TZ)).toEqual({ date: '2026-10-25', time: '12:15' });
  });

  it('линия «сейчас» только внутри окна', () => {
    expect(nowOffset(at('11:00'), window)).toBe(25);
    expect(nowOffset(at('09:00'), window)).toBeNull();
  });
});

describe('даты филиала', () => {
  it('сегодня — по часовому поясу филиала, сдвиг даты — календарный', () => {
    // 24.10 20:30Z — уже 25.10 в Алматы.
    expect(todayIn(TZ, Date.parse('2026-10-24T20:30:00Z'))).toBe('2026-10-25');
    expect(shiftDate('2026-10-31', 1)).toBe('2026-11-01');
    expect(shiftDate('2026-03-01', -1)).toBe('2026-02-28');
  });
});
