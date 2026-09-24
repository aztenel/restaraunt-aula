import { describe, expect, it } from 'vitest';
import { normalizePolygon, pointInPolygon, polygonsOverlap } from './geo';

const square = (x: number, y: number, size: number) => [
  { lat: y, lng: x },
  { lat: y, lng: x + size },
  { lat: y + size, lng: x + size },
  { lat: y + size, lng: x },
];

describe('geo', () => {
  it('point in polygon', () => {
    const poly = square(0, 0, 1);
    expect(pointInPolygon({ lat: 0.5, lng: 0.5 }, poly)).toBe(true);
    expect(pointInPolygon({ lat: 1.5, lng: 0.5 }, poly)).toBe(false);
    expect(pointInPolygon({ lat: 0, lng: 0.5 }, poly)).toBe(true); // граница
  });

  it('detects overlap, allows touching edges', () => {
    expect(polygonsOverlap(square(0, 0, 1), square(0.5, 0.5, 1))).toBe(true);
    expect(polygonsOverlap(square(0, 0, 1), square(1, 0, 1))).toBe(false);
    expect(polygonsOverlap(square(0, 0, 3), square(1, 1, 1))).toBe(true); // вложенный
    expect(polygonsOverlap(square(0, 0, 1), square(0, 0, 1))).toBe(true); // совпадающие
    expect(polygonsOverlap(square(0, 0, 1), square(5, 5, 1))).toBe(false);
  });

  it('rejects invalid polygons', () => {
    expect(() => normalizePolygon([{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }])).toThrow();
    const bowtie = [
      { lat: 0, lng: 0 },
      { lat: 1, lng: 1 },
      { lat: 1, lng: 0 },
      { lat: 0, lng: 1 },
    ];
    expect(() => normalizePolygon(bowtie)).toThrow();
    expect(normalizePolygon([...square(0, 0, 1), { lat: 0, lng: 0 }])).toHaveLength(4);
  });
});
