import { describe, expect, it } from 'vitest';
import { needsModifierGroups, translationEditPath } from './translation-links';

describe('отчёт о переводах: ссылки на формы', () => {
  it('каждый тип объекта ведёт на свою форму', () => {
    expect(translationEditPath({ entityType: 'category', entityId: 'c1' })).toBe('/menu/categories?edit=c1');
    expect(translationEditPath({ entityType: 'dish', entityId: 'd1' })).toBe('/menu/dishes/d1');
    expect(translationEditPath({ entityType: 'modifier_group', entityId: 'g1' })).toBe('/menu/modifiers?edit=g1');
    expect(translationEditPath({ entityType: 'banner', entityId: 'b1' })).toBe('/content/banners?edit=b1');
    expect(translationEditPath({ entityType: 'promotion', entityId: 'p1' })).toBe('/content/promotions?edit=p1');
    expect(translationEditPath({ entityType: 'page', entityId: 'pg1' })).toBe('/content/pages/pg1');
  });

  it('опция модификатора — форма её группы из groupId отчёта (список групп не нужен)', () => {
    expect(translationEditPath({ entityType: 'modifier_option', entityId: 'o3', groupId: 'g2' })).toBe('/menu/modifiers?edit=g2');
    expect(needsModifierGroups([{ entityType: 'modifier_option', entityId: 'o3', groupId: 'g2' }, { entityType: 'dish', entityId: 'd1' }])).toBe(false);
    expect(needsModifierGroups([{ entityType: 'modifier_option', entityId: 'o4', groupId: null }])).toBe(true);
  });

  it('старый ответ без groupId — группа ищется по списку групп', () => {
    const groups = [
      { id: 'g1', options: [{ id: 'o1' }] },
      { id: 'g2', options: [{ id: 'o2' }, { id: 'o3' }] },
    ] as never;
    expect(translationEditPath({ entityType: 'modifier_option', entityId: 'o3' }, groups)).toBe('/menu/modifiers?edit=g2');
    expect(translationEditPath({ entityType: 'modifier_option', entityId: 'unknown' }, groups)).toBe('/menu/modifiers');
  });
});
