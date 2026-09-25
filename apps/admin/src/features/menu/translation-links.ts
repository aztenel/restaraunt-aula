/**
 * Ссылки «исправить перевод» из отчёта о полноте переводов (GET /admin/catalog/translations)
 * на формы редактирования. Для опции модификатора отчёт отдаёт id опции — группа находится
 * по списку групп (GET /admin/catalog/modifier-groups).
 */
import type { ModifierGroup, TranslationGap } from '@aula/api-client';

export function translationEditPath(gap: Pick<TranslationGap, 'entityType' | 'entityId'>, groups: readonly Pick<ModifierGroup, 'id' | 'options'>[] = []): string | null {
  const id = encodeURIComponent(gap.entityId);
  switch (gap.entityType) {
    case 'category':
      return `/menu/categories?edit=${id}`;
    case 'dish':
      return `/menu/dishes/${id}`;
    case 'modifier_group':
      return `/menu/modifiers?edit=${id}`;
    case 'modifier_option': {
      const group = groups.find((g) => g.options.some((o) => o.id === gap.entityId));
      return group ? `/menu/modifiers?edit=${encodeURIComponent(group.id)}` : '/menu/modifiers';
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
