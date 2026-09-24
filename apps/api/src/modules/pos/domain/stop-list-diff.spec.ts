import { describe, expect, it } from 'vitest';
import { availabilityByProduct, diffStopList } from './stop-list-diff';

const mappings = [
  { dishId: 'plov', externalProductId: 'P1' },
  { dishId: 'plov-combo', externalProductId: 'P1' },
  { dishId: 'lagman', externalProductId: 'P2' },
  { dishId: 'manty', externalProductId: 'P3' },
];

describe('stop-list diff', () => {
  it('unavailable wins when a product is listed several times', () => {
    const map = availabilityByProduct([
      { externalProductId: 'P1', available: true },
      { externalProductId: 'P1', available: false },
      { externalProductId: 'P2', available: true },
    ]);
    expect(map.get('P1')).toBe(false);
    expect(map.get('P2')).toBe(true);
  });

  it('first sync stops only what POS has stopped (manual stops are not lifted)', () => {
    const diff = diffStopList({ provider: 'pos_a', mappings, stopList: [{ externalProductId: 'P2', available: false }], snapshot: [] });
    expect(diff.changes).toEqual([{ dishId: 'lagman', externalProductId: 'P2', available: false }]);
    expect(diff.snapshot).toHaveLength(4);
    expect(diff.snapshot.find((s) => s.dishId === 'plov')?.available).toBe(true);
    expect(diff.staleDishIds).toEqual([]);
  });

  it('sends only changes relative to the last snapshot', () => {
    const snapshot = [
      { dishId: 'plov', provider: 'pos_a', externalProductId: 'P1', available: true },
      { dishId: 'plov-combo', provider: 'pos_a', externalProductId: 'P1', available: true },
      { dishId: 'lagman', provider: 'pos_a', externalProductId: 'P2', available: false },
      { dishId: 'manty', provider: 'pos_a', externalProductId: 'P3', available: true },
      { dishId: 'removed', provider: 'pos_a', externalProductId: 'P9', available: false },
    ];
    const diff = diffStopList({
      provider: 'pos_a',
      mappings,
      stopList: [
        { externalProductId: 'P1', available: false },
        { externalProductId: 'P3', available: true },
      ],
      snapshot,
    });
    expect(diff.changes).toEqual([
      { dishId: 'plov', externalProductId: 'P1', available: false },
      { dishId: 'plov-combo', externalProductId: 'P1', available: false },
      { dishId: 'lagman', externalProductId: 'P2', available: true },
    ]);
    expect(diff.staleDishIds).toEqual(['removed']);
  });

  it('a snapshot of another provider is ignored (routing switched)', () => {
    const diff = diffStopList({
      provider: 'pos_b',
      mappings: [{ dishId: 'lagman', externalProductId: 'X2' }],
      stopList: [],
      snapshot: [{ dishId: 'lagman', provider: 'pos_a', externalProductId: 'P2', available: false }],
    });
    expect(diff.changes).toEqual([]);
    expect(diff.snapshot).toEqual([{ dishId: 'lagman', provider: 'pos_b', externalProductId: 'X2', available: true }]);
  });

  it('no changes when nothing changed', () => {
    const snapshot = mappings.map((m) => ({ ...m, provider: 'pos_a', available: m.dishId !== 'manty' }));
    const diff = diffStopList({ provider: 'pos_a', mappings, stopList: [{ externalProductId: 'P3', available: false }], snapshot });
    expect(diff.changes).toEqual([]);
  });
});
