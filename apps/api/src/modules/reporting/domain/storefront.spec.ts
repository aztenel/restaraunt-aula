import { describe, expect, it } from 'vitest';
import { normalizeStorefrontEvent, sanitizePath } from './storefront';

describe('sanitizePath', () => {
  it('drops query string and fragment', () => {
    expect(sanitizePath('/menu/plov?phone=77011234567#top')).toBe('/menu/plov');
    expect(sanitizePath('https://aula.kz/greenline/menu?utm=1')).toBe('/greenline/menu');
  });

  it('masks identifiers, public tokens and long numbers', () => {
    expect(sanitizePath('/orders/0192f0a4-1b2c-7d3e-8f40-123456789abc')).toBe('/orders/:id');
    expect(sanitizePath('/order/Xk3fQ9zLm2Pq8Rt7Vw1Ab')).toBe('/order/:id');
    expect(sanitizePath('/r/87011234567')).toBe('/r/:n');
    expect(sanitizePath('/menu/beshbarmak-s-koninoy')).toBe('/menu/beshbarmak-s-koninoy');
  });

  it('normalizes relative paths and duplicate slashes', () => {
    expect(sanitizePath('menu//hot')).toBe('/menu/hot');
  });
});

describe('normalizeStorefrontEvent', () => {
  it('validates session, type and branch', () => {
    const ok = normalizeStorefrontEvent({ sessionId: '0192F0A4-1B2C-7D3E-8F40-123456789ABC', type: 'menu_view', path: '/menu' });
    expect(ok).toEqual({ sessionId: '0192f0a4-1b2c-7d3e-8f40-123456789abc', type: 'menu_view', branchId: null, path: '/menu' });
    expect(() => normalizeStorefrontEvent({ sessionId: 'nope', type: 'menu_view', path: '/' })).toThrowError(
      expect.objectContaining({ code: 'analytics.invalid_session' }),
    );
    expect(() =>
      normalizeStorefrontEvent({ sessionId: '0192f0a4-1b2c-7d3e-8f40-123456789abc', type: 'purchase', path: '/' }),
    ).toThrowError(expect.objectContaining({ code: 'analytics.invalid_type' }));
  });
});
