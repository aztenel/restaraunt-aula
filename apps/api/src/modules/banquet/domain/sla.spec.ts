import { describe, expect, it } from 'vitest';
import { pickManager } from './assignment';
import { isSlaBreached, slaDeadline, slaStats, SlaSubject } from './sla';

const t0 = new Date('2026-10-01T06:00:00Z');
const min = (m: number) => new Date(t0.getTime() + m * 60_000);

describe('SLA', () => {
  it('breaches after 30 minutes only for new requests without response', () => {
    expect(slaDeadline(t0)).toEqual(min(30));
    const subject: SlaSubject = { status: 'new', createdAt: t0, firstResponseAt: null };
    expect(isSlaBreached(subject, min(29))).toBe(false);
    expect(isSlaBreached(subject, min(31))).toBe(true);
    expect(isSlaBreached({ ...subject, firstResponseAt: min(5) }, min(31))).toBe(false);
    expect(isSlaBreached({ ...subject, status: 'cancelled' }, min(31))).toBe(false);
  });

  it('computes stats: share within 30 minutes, breaches, lost requests', () => {
    const rows: SlaSubject[] = [
      { status: 'in_progress', createdAt: t0, firstResponseAt: min(10) },
      { status: 'agreed', createdAt: t0, firstResponseAt: min(30) },
      { status: 'in_progress', createdAt: t0, firstResponseAt: min(50) },
      { status: 'new', createdAt: min(100), firstResponseAt: null },
      { status: 'cancelled', createdAt: t0, firstResponseAt: null },
    ];
    const stats = slaStats(rows, min(110));
    expect(stats).toEqual({
      total: 5,
      answered: 3,
      answeredWithinSla: 2,
      withinSlaShareBp: 4000,
      breached: 2,
      unanswered: 2,
      lost: 1,
      averageFirstResponseMinutes: 30,
    });
    expect(slaStats([], t0).withinSlaShareBp).toBeNull();
  });
});

describe('pickManager', () => {
  it('picks the manager with the fewest open requests, then the longest idle', () => {
    const loads = new Map([
      ['a', { managerId: 'a', openRequests: 3, lastAssignedAt: min(1) }],
      ['b', { managerId: 'b', openRequests: 1, lastAssignedAt: min(5) }],
      ['c', { managerId: 'c', openRequests: 1, lastAssignedAt: min(2) }],
    ]);
    expect(pickManager(['a', 'b', 'c'], loads)).toBe('c');
    expect(pickManager(['a', 'b', 'c', 'd'], loads)).toBe('d');
    expect(pickManager(['a'], loads)).toBe('a');
    expect(pickManager([], loads)).toBeNull();
  });
});
