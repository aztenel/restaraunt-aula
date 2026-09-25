import { describe, expect, it } from 'vitest';
import { bpToPercentText, firstResponseInfo, formatDuration, slaCountdown, slaShareTone } from './sla';

const created = '2026-10-01T10:00:00.000Z';
const deadline = '2026-10-01T10:30:00.000Z';
const at = (iso: string) => Date.parse(iso);

const fresh = (patch: Partial<Parameters<typeof slaCountdown>[0]> = {}) => ({
  status: 'new',
  slaDeadline: deadline,
  slaBreached: false,
  firstResponseAt: null,
  ...patch,
});

describe('обратный отсчёт SLA первого ответа (30 минут)', () => {
  it('сразу после создания — 30:00, идёт отсчёт', () => {
    expect(slaCountdown(fresh(), at(created))).toEqual({ state: 'running', seconds: 1800, text: '30:00' });
  });

  it('меньше 10 минут до срока — предупреждение', () => {
    expect(slaCountdown(fresh(), at('2026-10-01T10:20:00.000Z'))).toEqual({ state: 'warning', seconds: 600, text: '10:00' });
    expect(slaCountdown(fresh(), at('2026-10-01T10:29:59.500Z'))).toMatchObject({ state: 'warning', seconds: 1, text: '0:01' });
  });

  it('срок прошёл — нарушение, показывается просрочка', () => {
    expect(slaCountdown(fresh(), at(deadline))).toEqual({ state: 'breached', seconds: 0, text: '0:00' });
    expect(slaCountdown(fresh(), at('2026-10-01T11:45:30.000Z'))).toEqual({ state: 'breached', seconds: 4530, text: '1:15:30' });
  });

  it('сервер уже отметил нарушение — красный, даже если часы клиента отстают', () => {
    expect(slaCountdown(fresh({ slaBreached: true }), at('2026-10-01T10:10:00.000Z'))).toMatchObject({ state: 'breached', seconds: 0 });
  });

  it('заявка уже не новая или ответ был — таймера нет', () => {
    expect(slaCountdown(fresh({ status: 'in_progress' }), at(created))).toBeNull();
    expect(slaCountdown(fresh({ firstResponseAt: '2026-10-01T10:05:00.000Z' }), at(created))).toBeNull();
    expect(slaCountdown(fresh({ slaDeadline: 'не дата' }), at(created))).toBeNull();
  });

  it('формат длительности', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(59)).toBe('0:59');
    expect(formatDuration(3600)).toBe('1:00:00');
    expect(formatDuration(-5)).toBe('0:00');
  });
});

describe('первый ответ и доля в срок', () => {
  it('ответ в срок и с опозданием', () => {
    const base = { status: 'in_progress', slaDeadline: deadline, slaBreached: false, createdAt: created };
    expect(firstResponseInfo({ ...base, firstResponseAt: '2026-10-01T10:12:40.000Z' })).toEqual({ minutes: 12, withinSla: true });
    expect(firstResponseInfo({ ...base, firstResponseAt: '2026-10-01T10:30:00.000Z' })).toEqual({ minutes: 30, withinSla: true });
    expect(firstResponseInfo({ ...base, slaBreached: true, firstResponseAt: '2026-10-01T10:47:00.000Z' })).toEqual({ minutes: 47, withinSla: false });
    expect(firstResponseInfo({ ...base, firstResponseAt: null })).toBeNull();
  });

  it('базисные пункты → проценты', () => {
    expect(bpToPercentText(9500)).toBe('95');
    expect(bpToPercentText(9550)).toBe('95,5');
    expect(bpToPercentText(9505)).toBe('95,05');
    expect(bpToPercentText(10000)).toBe('100');
    expect(bpToPercentText(0)).toBe('0');
    expect(bpToPercentText(1250, 'en')).toBe('12.5');
    expect(bpToPercentText(null)).toBe('—');
  });

  it('цвет доли ответов относительно цели 95%', () => {
    expect(slaShareTone(9600, 9500)).toBe('success');
    expect(slaShareTone(9500, 9500)).toBe('success');
    expect(slaShareTone(9100, 9500)).toBe('warning');
    expect(slaShareTone(8000, 9500)).toBe('danger');
    expect(slaShareTone(null, 9500)).toBe('none');
  });
});
