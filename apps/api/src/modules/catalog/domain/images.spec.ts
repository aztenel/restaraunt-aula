import { describe, expect, it } from 'vitest';
import { assertImageDimensions, assertUploadableImage, imageKey, isStoredImage, pickVariant } from './images';

describe('images', () => {
  it('validates type, size and width', () => {
    expect(() => assertUploadableImage({ mimetype: 'image/gif', size: 10 })).toThrow(/JPEG/);
    expect(() => assertUploadableImage({ mimetype: 'image/png', size: 11 * 1024 * 1024 })).toThrow(/10 MB/);
    expect(() => assertUploadableImage({ mimetype: 'image/webp', size: 1000 })).not.toThrow();
    expect(() => assertImageDimensions(200, 200)).toThrow(/300px/);
    expect(() => assertImageDimensions(undefined, 10)).toThrow();
  });

  it('keys and variant selection', () => {
    expect(imageKey('dishes', 'd1', 'p1', 600)).toBe('catalog/dishes/d1/p1-600.webp');
    const image = {
      id: 'p1',
      variants: [
        { width: 1200, height: 800, key: 'a' },
        { width: 600, height: 400, key: 'b' },
        { width: 300, height: 200, key: 'c' },
      ],
    };
    expect(pickVariant(image, 600)?.key).toBe('b');
    expect(pickVariant(image, 500)?.key).toBe('b');
    expect(pickVariant(image, 2000)?.key).toBe('a');
    expect(pickVariant({ id: 'x', variants: [] }, 600)).toBeNull();
    expect(isStoredImage(image)).toBe(true);
    expect(isStoredImage({ id: 1 })).toBe(false);
    expect(isStoredImage(null)).toBe(false);
  });
});
