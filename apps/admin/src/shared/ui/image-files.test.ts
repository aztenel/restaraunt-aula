import { describe, expect, it } from 'vitest';
import { checkImageFiles, imageVariantUrl, largestImageUrl, MAX_IMAGE_BYTES } from './image-files';

const file = (name: string, type: string, size = 1000) => ({ name, type, size });

describe('проверка изображений до загрузки (как на сервере)', () => {
  it('JPEG/PNG/WebP до 10 МБ; остальное отклоняется с причиной', () => {
    const result = checkImageFiles([file('a.jpg', 'image/jpeg'), file('b.gif', 'image/gif'), file('c.png', 'image/png', MAX_IMAGE_BYTES + 1), file('d.webp', 'image/webp')]);
    expect(result.accepted.map((f) => f.name)).toEqual(['a.jpg', 'd.webp']);
    expect(result.rejected.map((r) => [r.file.name, r.issue])).toEqual([
      ['b.gif', 'type'],
      ['c.png', 'size'],
    ]);
  });

  it('лимит фото блюда: лишние файлы отклоняются', () => {
    const result = checkImageFiles([file('1.jpg', 'image/jpeg'), file('2.jpg', 'image/jpeg'), file('3.jpg', 'image/jpeg')], 2);
    expect(result.accepted).toHaveLength(2);
    expect(result.rejected).toEqual([{ file: file('3.jpg', 'image/jpeg'), issue: 'count' }]);
  });

  it('миниатюра — самый узкий вариант не уже нужной ширины', () => {
    const image = {
      id: 'i',
      url: 'u600',
      width: 600,
      height: 400,
      variants: [
        { width: 1200, height: 800, url: 'u1200' },
        { width: 300, height: 200, url: 'u300' },
        { width: 600, height: 400, url: 'u600' },
      ],
    };
    expect(imageVariantUrl(image, 120)).toBe('u300');
    expect(imageVariantUrl(image, 500)).toBe('u600');
    expect(imageVariantUrl(image, 2000)).toBe('u1200');
    expect(largestImageUrl(image)).toBe('u1200');
    expect(imageVariantUrl(null, 100)).toBeUndefined();
  });
});
