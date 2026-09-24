import { describe, expect, it } from 'vitest';
import { isBannerPlacement, isBannerVisible, isPromotionVisible, isProtectedPage, normalizeLink, validateWindow } from './content';

const now = new Date('2026-10-01T06:00:00Z');
const day = 86_400_000;

describe('content rules', () => {
  it('placements are a closed list', () => {
    expect(isBannerPlacement('home_hero')).toBe(true);
    expect(isBannerPlacement('sidebar')).toBe(false);
  });

  it('banner links: site path or http(s) URL only', () => {
    expect(normalizeLink(' /greenline/menu ')).toBe('/greenline/menu');
    expect(normalizeLink('https://aula.kz/promo')).toBe('https://aula.kz/promo');
    expect(normalizeLink('')).toBeNull();
    expect(() => normalizeLink('javascript:alert(1)')).toThrow();
    expect(() => normalizeLink('//evil.example')).toThrow();
    expect(() => normalizeLink('menu')).toThrow();
  });

  it('active window: end after start', () => {
    expect(() => validateWindow(now, new Date(now.getTime() - 1))).toThrow(/after/);
    expect(() => validateWindow(now, now)).toThrow();
    expect(() => validateWindow(null, now)).not.toThrow();
  });

  it('banner visibility: active, window, global or own branch', () => {
    const base = { isActive: true, branchId: null, activeFrom: null, activeTo: null };
    expect(isBannerVisible(base, now, 'b1')).toBe(true);
    expect(isBannerVisible({ ...base, isActive: false }, now, 'b1')).toBe(false);
    expect(isBannerVisible({ ...base, branchId: 'b2' }, now, 'b1')).toBe(false);
    expect(isBannerVisible({ ...base, branchId: 'b1' }, now, 'b1')).toBe(true);
    expect(isBannerVisible({ ...base, activeFrom: new Date(now.getTime() + day) }, now, null)).toBe(false);
    expect(isBannerVisible({ ...base, activeTo: now }, now, null)).toBe(false);
    expect(isBannerVisible({ ...base, activeFrom: now, activeTo: new Date(now.getTime() + day) }, now, null)).toBe(true);
  });

  it('promotion visibility: branch scope and validity', () => {
    const base = { isActive: true, branchIds: [] as string[], validFrom: null, validTo: null };
    expect(isPromotionVisible(base, now, 'b1')).toBe(true);
    expect(isPromotionVisible({ ...base, branchIds: ['b2'] }, now, 'b1')).toBe(false);
    expect(isPromotionVisible({ ...base, branchIds: ['b2'] }, now, null)).toBe(true);
    expect(isPromotionVisible({ ...base, validTo: new Date(now.getTime() - day) }, now, 'b1')).toBe(false);
  });

  it('legal pages are protected', () => {
    expect(isProtectedPage('privacy')).toBe(true);
    expect(isProtectedPage('offer')).toBe(true);
    expect(isProtectedPage('about')).toBe(false);
  });
});
