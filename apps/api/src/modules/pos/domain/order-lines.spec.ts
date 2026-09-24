import { describe, expect, it } from 'vitest';
import { describeMissing, resolveOrderLines } from './order-lines';
import { DishMapping } from './product-mapping';

const OPT_CHEESE = '0191f000-0000-7000-8000-000000000001';
const OPT_SAUCE = '0191f000-0000-7000-8000-000000000002';

const mappings: DishMapping[] = [
  { dishId: 'plov', externalProductId: 'P-PLOV', modifiers: { [OPT_CHEESE]: { externalProductId: 'M-CHEESE', externalGroupId: 'G-ADD' } } },
  { dishId: 'lagman', externalProductId: 'P-LAGMAN', modifiers: {} },
];

describe('resolveOrderLines', () => {
  it('maps dishes and modifiers, aggregating repeated options', () => {
    const { lines, missing } = resolveOrderLines(
      [
        {
          dishId: 'plov',
          name: { ru: 'Плов', kk: 'Палау' },
          quantity: 2,
          modifiers: [
            { optionId: OPT_CHEESE, name: { ru: 'Сыр' } },
            { optionId: OPT_CHEESE, name: { ru: 'Сыр' } },
          ],
        },
        { dishId: 'lagman', name: { kk: 'Лағман' }, quantity: 1, modifiers: [] },
      ],
      mappings,
    );
    expect(missing).toEqual([]);
    expect(lines).toEqual([
      {
        dishId: 'plov',
        externalProductId: 'P-PLOV',
        quantity: 2,
        name: 'Плов',
        modifiers: [{ optionId: OPT_CHEESE, externalProductId: 'M-CHEESE', externalGroupId: 'G-ADD', amount: 2 }],
      },
      { dishId: 'lagman', externalProductId: 'P-LAGMAN', quantity: 1, name: 'Лағман', modifiers: [] },
    ]);
  });

  it('reports unmapped dishes and unmapped options; the order is not partially sent', () => {
    const { lines, missing } = resolveOrderLines(
      [
        { dishId: 'plov', name: { ru: 'Плов' }, quantity: 1, modifiers: [{ optionId: OPT_SAUCE, name: { ru: 'Соус' } }] },
        { dishId: 'manty', name: { ru: 'Манты' }, quantity: 3, modifiers: [{ optionId: OPT_SAUCE, name: { ru: 'Соус' } }] },
        { dishId: 'manty', name: { ru: 'Манты' }, quantity: 1, modifiers: [] },
        { dishId: 'lagman', name: { ru: 'Лагман' }, quantity: 1, modifiers: [] },
      ],
      mappings,
    );
    expect(lines.map((l) => l.dishId)).toEqual(['lagman']);
    expect(missing).toEqual([
      { dishId: 'plov', dishName: 'Плов', dishMissing: false, options: [{ optionId: OPT_SAUCE, name: 'Соус' }] },
      { dishId: 'manty', dishName: 'Манты', dishMissing: true, options: [{ optionId: OPT_SAUCE, name: 'Соус' }] },
    ]);
    expect(describeMissing(missing)).toBe('Плов: опции Соус; Манты (и опции: Соус)');
  });
});
