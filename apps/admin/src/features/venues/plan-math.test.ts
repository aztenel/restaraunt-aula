import { describe, expect, it } from 'vitest';
import {
  changedPositions,
  clientToPlan,
  fitToPlan,
  freeSpot,
  insidePlan,
  moveVenue,
  normalizeRotation,
  planViewport,
  resizeVenue,
  rotationFromPointer,
  screenDeltaToPlan,
  snap,
} from './plan-math';
import type { VenuePosition } from './types';

const plan = { width: 1000, height: 600 };
const table: VenuePosition = { x: 100, y: 100, w: 80, h: 60, shape: 'rect', rotation: 0 };

describe('координаты экрана → план зала', () => {
  it('план вписан по ширине: масштаб и поля сверху/снизу', () => {
    // Контейнер 500×500: масштаб 0.5, план 500×300 по центру (поля по 100 px).
    expect(planViewport({ width: 500, height: 500 }, plan)).toEqual({ scale: 0.5, offsetX: 0, offsetY: 100 });
    expect(clientToPlan({ x: 60, y: 160 }, { left: 10, top: 10, width: 500, height: 500 }, plan)).toEqual({ x: 100, y: 100 });
  });

  it('смещение указателя в пикселях → единицы плана', () => {
    expect(screenDeltaToPlan(50, -25, { width: 500, height: 300 }, plan)).toEqual({ x: 100, y: -50 });
  });
});

describe('перетаскивание места', () => {
  it('смещение от исходной позиции с округлением до целых', () => {
    expect(moveVenue(table, { x: 20.4, y: -10.6 }, plan)).toMatchObject({ x: 120, y: 89 });
  });

  it('привязка к сетке', () => {
    expect(moveVenue(table, { x: 13, y: 7 }, plan, 10)).toMatchObject({ x: 110, y: 110 });
    expect(snap(14, 5)).toBe(15);
    expect(snap(14.4, 1)).toBe(14);
  });

  it('место не выходит за план (сервер требует x + w ≤ ширины)', () => {
    expect(moveVenue(table, { x: -500, y: -500 }, plan)).toMatchObject({ x: 0, y: 0 });
    expect(moveVenue(table, { x: 5000, y: 5000 }, plan)).toMatchObject({ x: 920, y: 540 });
    expect(insidePlan(moveVenue(table, { x: 5000, y: 5000 }, plan), plan)).toBe(true);
  });

  it('размер, форма и поворот при перетаскивании не меняются', () => {
    const moved = moveVenue({ ...table, shape: 'circle', rotation: 45 }, { x: 10, y: 10 }, plan);
    expect(moved).toMatchObject({ w: 80, h: 60, shape: 'circle', rotation: 45 });
  });
});

describe('изменение размера и поворот', () => {
  it('правый нижний угол: не меньше минимума и не за край плана', () => {
    expect(resizeVenue(table, { x: 20, y: 40 }, plan)).toMatchObject({ x: 100, y: 100, w: 100, h: 100 });
    expect(resizeVenue(table, { x: -500, y: -500 }, plan)).toMatchObject({ w: 10, h: 10 });
    expect(resizeVenue(table, { x: 5000, y: 5000 }, plan)).toMatchObject({ w: 900, h: 500 });
  });

  it('круглое место остаётся кругом', () => {
    expect(resizeVenue({ ...table, shape: 'circle', w: 60, h: 60 }, { x: 40, y: 10 }, plan, 1, true)).toMatchObject({ w: 100, h: 100 });
  });

  it('поворот — целые градусы 0..359', () => {
    expect(normalizeRotation(360)).toBe(0);
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(45.6)).toBe(46);
  });

  it('ручка поворота: угол от центра места к указателю (0° — вверх, по часовой)', () => {
    const center = { x: 140, y: 130 };
    expect(rotationFromPointer(table, { x: center.x, y: center.y - 50 })).toBe(0);
    expect(rotationFromPointer(table, { x: center.x + 50, y: center.y })).toBe(90);
    expect(rotationFromPointer(table, { x: center.x, y: center.y + 50 })).toBe(180);
    expect(rotationFromPointer(table, { x: center.x - 50, y: center.y - 3 }, 15)).toBe(270);
  });
});

describe('план и правки', () => {
  it('позиция приводится к плану (после уменьшения плана)', () => {
    expect(fitToPlan({ x: 950.2, y: 590, w: 120, h: 30, shape: 'rect', rotation: 370 }, plan)).toEqual({
      x: 880,
      y: 570,
      w: 120,
      h: 30,
      shape: 'rect',
      rotation: 10,
    });
  });

  it('сохраняются только изменённые позиции', () => {
    const original = [
      { id: 'a', position: table },
      { id: 'b', position: { ...table, x: 300 } },
    ];
    const draft = new Map<string, VenuePosition>([
      ['a', { ...table }],
      ['b', { ...table, x: 320 }],
    ]);
    expect(changedPositions(original, draft)).toEqual([{ id: 'b', position: { ...table, x: 320 } }]);
  });

  it('новое место ставится на свободный участок', () => {
    expect(freeSpot([], { w: 60, h: 60 }, plan)).toEqual({ x: 20, y: 20 });
    expect(freeSpot([{ x: 20, y: 20, w: 60, h: 60, shape: 'rect', rotation: 0 }], { w: 60, h: 60 }, plan)).toEqual({ x: 100, y: 20 });
  });
});
