import { describe, expect, it } from 'vitest';
import { markSeen, newReservationIds } from './feed-highlight';

const feed = [
  { stream: 'reservations', kind: 'created', entityId: 'r3' },
  { stream: 'orders', kind: 'created', entityId: 'o1' },
  { stream: 'reservations', kind: 'updated', entityId: 'r2' },
  { stream: 'reservations', kind: 'created', entityId: 'r1' },
  { stream: 'reservations', kind: 'created', entityId: 'r3' },
];

describe('новые брони из ленты событий', () => {
  it('только «создана» в потоке броней, без повторов и без просмотренных', () => {
    expect(newReservationIds(feed, new Set())).toEqual(['r3', 'r1']);
    expect(newReservationIds(feed, new Set(['r3']))).toEqual(['r1']);
  });

  it('просмотренные: новые в начало, без дублей', () => {
    expect(markSeen(['a'], ['b', 'a', 'c'])).toEqual(['b', 'c', 'a']);
    expect(markSeen(['a'], ['a'])).toEqual(['a']);
  });
});
