import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../shared/kernel/errors';
import { assertProviderName, normalizeMapping, parseModifierMappings } from './product-mapping';

const OPT = '0191f000-0000-7000-8000-000000000001';

describe('product mapping', () => {
  it('normalizes input: trims ids, empty name -> null, modifiers keyed by option', () => {
    expect(
      normalizeMapping({
        externalProductId: '  P-1 ',
        externalName: '  ',
        modifiers: [{ optionId: OPT, externalProductId: ' M-1 ', externalGroupId: ' ' }],
      }),
    ).toEqual({ externalProductId: 'P-1', externalName: null, modifiers: { [OPT]: { externalProductId: 'M-1', externalGroupId: null } } });
  });

  it('rejects empty/oversized ids, bad option ids and duplicates', () => {
    expect(() => normalizeMapping({ externalProductId: ' ' })).toThrow(ValidationError);
    expect(() => normalizeMapping({ externalProductId: 'x'.repeat(201) })).toThrow(ValidationError);
    expect(() => normalizeMapping({ externalProductId: 'P', modifiers: [{ optionId: 'not-uuid', externalProductId: 'M' }] })).toThrow(
      ValidationError,
    );
    try {
      normalizeMapping({
        externalProductId: 'P',
        modifiers: [
          { optionId: OPT, externalProductId: 'M1' },
          { optionId: OPT, externalProductId: 'M2' },
        ],
      });
      expect.fail('should throw');
    } catch (err) {
      expect((err as ValidationError).code).toBe('pos.mapping_duplicate_option');
    }
  });

  it('parses stored modifier mappings defensively', () => {
    expect(parseModifierMappings(null)).toEqual({});
    expect(parseModifierMappings([])).toEqual({});
    expect(
      parseModifierMappings({ [OPT]: { externalProductId: 'M', externalGroupId: 'G' }, broken: { externalProductId: 5 }, x: null }),
    ).toEqual({ [OPT]: { externalProductId: 'M', externalGroupId: 'G' } });
  });

  it('validates provider names', () => {
    expect(assertProviderName('manual')).toBe('manual');
    expect(() => assertProviderName('Bad Name')).toThrow(ValidationError);
  });
});
