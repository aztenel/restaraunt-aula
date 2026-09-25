/**
 * Добавление блюд в меню филиала одним запросом (POST .../menu/bulk-add — всё или ничего).
 * Тело запроса и привязка ошибки сервера к строкам таблицы (details.dishIds / details.sku).
 */
import type { AddMenuItemInput, ApiError } from '@aula/api-client';

export interface AddDraft {
  /** Цена филиала, тиыны; null — не введена. */
  price: number | null;
  /** Код POS филиала (необязательно). */
  sku: string;
}

export const MAX_BULK_ADD = 500;

/** Выбранные блюда → позиции запроса; null — у какого-то блюда нет цены (кнопка не активна). */
export function bulkAddItems(selected: readonly string[], drafts: Readonly<Record<string, AddDraft | undefined>>): AddMenuItemInput[] | null {
  const items: AddMenuItemInput[] = [];
  for (const dishId of selected) {
    const draft = drafts[dishId];
    if (!draft || draft.price === null) return null;
    items.push({ dishId, price: { amount: draft.price }, sku: draft.sku.trim() || null });
  }
  return items;
}

/**
 * Ошибка пакетного добавления → строки, к которым она относится: блюда из details.dishIds
 * (нет такого блюда, уже в меню) или строки с тем же кодом POS (details.sku). Пусто — ошибка общая.
 */
export function rowsForBulkAddError(error: Pick<ApiError, 'code' | 'details'>, items: readonly AddMenuItemInput[]): string[] {
  const ids = error.details.dishIds;
  if (Array.isArray(ids)) return ids.filter((id): id is string => typeof id === 'string');
  const sku = error.details.sku;
  if (typeof sku === 'string' && sku) {
    const needle = sku.trim().toLowerCase();
    return items.filter((i) => (i.sku ?? '').trim().toLowerCase() === needle).map((i) => i.dishId);
  }
  return [];
}
