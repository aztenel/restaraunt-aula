/**
 * Ссылки «исправить перевод» из отчёта о полноте переводов (GET /admin/catalog/translations)
 * на формы редактирования. Для опции модификатора сервер отдаёт её группу (groupId); список групп
 * (GET /admin/catalog/modifier-groups) — только запасной вариант для старых ответов без groupId.
 */
import type { ModifierGroup, TranslationGap } from '@aula/api-client';

type GapRef = Pick<TranslationGap, 'entityType' | 'entityId'> & { groupId?: string | null };

/** Нужен ли список групп модификаторов, чтобы построить ссылки (есть опции без groupId). */
export function needsModifierGroups(gaps: readonly GapRef[]): boolean {
  return gaps.some((gap) => gap.entityType === 'modifier_option' && !gap.groupId);
}

export function translationEditPath(gap: GapRef, groups: readonly Pick<ModifierGroup, 'id' | 'options'>[] = []): string | null {
  const id = encodeURIComponent(gap.entityId);
  switch (gap.entityType) {
    case 'category':
      return `/menu/categories?edit=${id}`;
    case 'dish':
      return `/menu/dishes/${id}`;
    case 'modifier_group':
      return `/menu/modifiers?edit=${id}`;
    case 'modifier_option': {
      const groupId = gap.groupId ?? groups.find((g) => g.options.some((o) => o.id === gap.entityId))?.id;
      return groupId ? `/menu/modifiers?edit=${encodeURIComponent(groupId)}` : '/menu/modifiers';
    }
    case 'banner':
      return `/content/banners?edit=${id}`;
    case 'promotion':
      return `/content/promotions?edit=${id}`;
    case 'page':
      return `/content/pages/${id}`;
    default:
      return null;
  }
}
