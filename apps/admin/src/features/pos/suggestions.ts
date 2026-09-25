/**
 * Автоподбор сопоставлений: товары POS без сопоставления и похожие блюда меню (score 0..1, метод sku / name —
 * считает сервер). Здесь только выбор оператора и сборка тела POST /admin/pos/mappings/bulk:
 *  - по умолчанию отмечается лучший кандидат с совпавшим кодом (sku) или похожестью не ниже порога;
 *  - одно блюдо — не больше одного товара за запрос (сервер: pos.mapping_duplicate_dish): конфликты
 *    показываются, в запрос не попадают;
 *  - не больше 500 строк в одном запросе.
 */
import type { BulkMappingItem, MappingSuggestion } from './api';

export const DEFAULT_SCORE_THRESHOLD = 0.8;
export const BULK_MAPPINGS_MAX = 500;

/** Выбор оператора: externalProductId → dishId (null — не сопоставлять). */
export type SuggestionSelection = Record<string, string | null>;

/** Предварительный выбор: лучший кандидат, если совпал код или похожесть ≥ порога. */
export function defaultSelection(suggestions: readonly MappingSuggestion[], threshold = DEFAULT_SCORE_THRESHOLD): SuggestionSelection {
  const selection: SuggestionSelection = {};
  for (const suggestion of suggestions) {
    const best = [...suggestion.candidates].sort((a, b) => b.score - a.score)[0];
    selection[suggestion.product.externalProductId] = best && (best.method === 'sku' || best.score >= threshold) ? best.dishId : null;
  }
  return selection;
}

export interface BulkPlan {
  items: BulkMappingItem[];
  /** Блюда, выбранные для нескольких товаров: dishId → товары (в запрос не попадают). */
  conflicts: Record<string, string[]>;
  /** Сколько строк не выбрано. */
  skipped: number;
}

/** Выбор → тело массового сохранения (с названием товара POS). */
export function toBulkPlan(suggestions: readonly MappingSuggestion[], selection: SuggestionSelection): BulkPlan {
  const byDish = new Map<string, MappingSuggestion[]>();
  let skipped = 0;
  for (const suggestion of suggestions) {
    const dishId = selection[suggestion.product.externalProductId] ?? null;
    if (!dishId) {
      skipped += 1;
      continue;
    }
    byDish.set(dishId, [...(byDish.get(dishId) ?? []), suggestion]);
  }
  const items: BulkMappingItem[] = [];
  const conflicts: Record<string, string[]> = {};
  for (const [dishId, list] of byDish) {
    if (list.length > 1) {
      conflicts[dishId] = list.map((s) => s.product.externalProductId);
      continue;
    }
    const product = list[0]!.product;
    items.push({ dishId, externalProductId: product.externalProductId, externalName: product.name });
  }
  return { items, conflicts, skipped };
}

/** Разбить на запросы по BULK_MAPPINGS_MAX строк. */
export function chunk<T>(items: readonly T[], size = BULK_MAPPINGS_MAX): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

/** Похожесть 0..1 → проценты для подписи. */
export function scorePercent(score: number): number {
  return Math.round(Math.min(1, Math.max(0, score)) * 100);
}
