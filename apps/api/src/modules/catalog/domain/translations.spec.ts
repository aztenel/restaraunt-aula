import { describe, expect, it } from 'vitest';
import { missingTranslations } from './translations';

describe('translation completeness', () => {
  it('required fields need kk and ru; optional only if started', () => {
    expect(
      missingTranslations([
        { field: 'name', value: { ru: 'Плов' }, required: true },
        { field: 'description', value: {}, required: false },
        { field: 'composition', value: { kk: 'Күріш' }, required: false },
        { field: 'seoTitle', value: { kk: 'Палау', ru: 'Плов' }, required: false },
      ]),
    ).toEqual([
      { field: 'name', missing: ['kk'] },
      { field: 'composition', missing: ['ru'] },
    ]);
    expect(missingTranslations([{ field: 'name', value: { ru: 'Плов', kk: ' ' }, required: true }], ['kk', 'ru', 'en'])).toEqual([
      { field: 'name', missing: ['kk', 'en'] },
    ]);
  });
});
