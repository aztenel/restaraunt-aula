import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../shared/kernel/errors';
import {
  assertImageDimensions,
  assertPhotoLimit,
  assertUploadableImage,
  imageKey,
  isStoredImage,
  MAX_PHOTOS_PER_VENUE,
  pickVariant,
  variantWidths,
} from './images';

describe('reservation images', () => {
  it('accepts only JPEG/PNG/WebP up to 10 MB', () => {
    expect(() => assertUploadableImage({ mimetype: 'image/png', size: 1000 })).not.toThrow();
    expect(() => assertUploadableImage(undefined)).toThrow(ValidationError);
    expect(() => assertUploadableImage({ mimetype: 'image/gif', size: 1000 })).toThrow(ValidationError);
    expect(() => assertUploadableImage({ mimetype: 'image/jpeg', size: 11 * 1024 * 1024 })).toThrow(ValidationError);
    expect(() => assertImageDimensions(200, 200)).toThrow(ValidationError);
    expect(() => assertImageDimensions(undefined, 200)).toThrow(ValidationError);
    expect(() => assertImageDimensions(800, 600)).not.toThrow();
  });

  it('variants are never upscaled', () => {
    expect(variantWidths('venues', 5000)).toEqual([1600, 800, 400]);
    expect(variantWidths('venues', 1000)).toEqual([800, 400]);
    expect(variantWidths('venues', 350)).toEqual([350]);
    expect(variantWidths('halls', 1500)).toEqual([1200]);
  });

  it('keys, variant choice, photo limit', () => {
    expect(imageKey('venues', 'v1', 'i1', 800)).toBe('reservation/venues/v1/i1-800.webp');
    const image = {
      id: 'i1',
      variants: [
        { width: 1600, height: 900, key: 'a' },
        { width: 400, height: 225, key: 'c' },
        { width: 800, height: 450, key: 'b' },
      ],
    };
    expect(pickVariant(image, 500)?.key).toBe('b');
    expect(pickVariant(image, 3000)?.key).toBe('a');
    expect(pickVariant({ id: 'x', variants: [] }, 100)).toBeNull();
    expect(isStoredImage(image)).toBe(true);
    expect(isStoredImage({ url: 'x' })).toBe(false);
    expect(() => assertPhotoLimit(MAX_PHOTOS_PER_VENUE - 1, 1)).not.toThrow();
    expect(() => assertPhotoLimit(MAX_PHOTOS_PER_VENUE, 1)).toThrow(ValidationError);
  });
});
