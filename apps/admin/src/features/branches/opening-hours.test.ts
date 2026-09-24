import { describe, expect, it } from 'vitest';
import { cleanOpeningHours, copyDayToAll, isOvernight, validateOpeningHours } from './opening-hours';

describe('часы работы филиала', () => {
  it('интервал через полночь', () => {
    expect(isOvernight({ open: '18:00', close: '02:00' })).toBe(true);
    expect(isOvernight({ open: '10:00', close: '00:00' })).toBe(false);
    expect(isOvernight({ open: '10:00', close: '23:00' })).toBe(false);
  });

  it('проверки: формат, совпадение, пересечение (в т.ч. с ночным интервалом)', () => {
    const issues = validateOpeningHours({
      mon: [{ open: '10:00', close: '23:00' }],
      tue: [{ open: '25:00', close: '23:00' }],
      wed: [{ open: '10:00', close: '10:00' }],
      thu: [
        { open: '10:00', close: '15:00' },
        { open: '14:00', close: '20:00' },
      ],
      fri: [
        { open: '09:00', close: '12:00' },
        { open: '18:00', close: '02:00' },
      ],
      sat: [
        { open: '18:00', close: '03:00' },
        { open: '23:00', close: '23:30' },
      ],
    });
    expect(issues.mon).toBeUndefined();
    expect(issues.tue).toEqual(['invalid_time']);
    expect(issues.wed).toEqual(['same_time']);
    expect(issues.thu).toEqual(['overlap']);
    expect(issues.fri).toBeUndefined();
    expect(issues.sat).toEqual(['overlap']);
  });

  it('копирование дня на всю неделю и очистка перед отправкой', () => {
    const all = copyDayToAll({ mon: [{ open: '10:00', close: '22:00' }] }, 'mon');
    expect(Object.keys(all)).toHaveLength(7);
    expect(all.sun).toEqual([{ open: '10:00', close: '22:00' }]);
    all.sun![0]!.open = '11:00';
    expect(all.mon![0]!.open).toBe('10:00');

    const cleaned = cleanOpeningHours({ mon: [{ open: '10:00', close: '' }, { open: '12:00', close: '20:00' }] });
    expect(cleaned.mon).toEqual([{ open: '12:00', close: '20:00' }]);
    expect(cleaned.tue).toEqual([]);
  });
});
