import { PosStopListItem } from './pos-client';

/**
 * Синхронизация стоп-листа POS с витриной. Витрине отправляются только изменения относительно
 * последнего снимка — чтобы не перетирать ручные решения персонала при каждом опросе.
 *
 * Правила:
 * - товар POS в стоп-листе с available=false -> блюдо недоступно; нет в стоп-листе -> доступно;
 * - один товар POS может быть сопоставлен нескольким блюдам — меняются все;
 * - если товар встречается в стоп-листе несколько раз (несколько касс/групп) — «недоступно» сильнее;
 * - нет снимка по блюду (первая синхронизация, смена провайдера) -> считаем, что блюдо было доступно:
 *   первая синхронизация только ставит в стоп то, что в стопе в POS, и не снимает ручные стопы.
 */
export interface StopListSnapshotEntry {
  dishId: string;
  provider: string;
  externalProductId: string;
  available: boolean;
}

export interface StopListChange {
  dishId: string;
  externalProductId: string;
  available: boolean;
}

export interface StopListDiff {
  /** Что отправить в стоп-лист витрины. */
  changes: StopListChange[];
  /** Новый снимок по всем сопоставленным блюдам (после успешного применения изменений). */
  snapshot: StopListSnapshotEntry[];
  /** Блюда, по которым снимок больше не нужен (сопоставление удалено). */
  staleDishIds: string[];
}

export function availabilityByProduct(items: readonly PosStopListItem[]): Map<string, boolean> {
  const result = new Map<string, boolean>();
  for (const item of items) {
    const current = result.get(item.externalProductId);
    result.set(item.externalProductId, current === undefined ? item.available : current && item.available);
  }
  return result;
}

export function diffStopList(input: {
  provider: string;
  mappings: ReadonlyArray<{ dishId: string; externalProductId: string }>;
  stopList: readonly PosStopListItem[];
  snapshot: readonly StopListSnapshotEntry[];
}): StopListDiff {
  const posAvailability = availabilityByProduct(input.stopList);
  const previous = new Map(input.snapshot.filter((s) => s.provider === input.provider).map((s) => [s.dishId, s.available]));
  const mappedDishIds = new Set<string>();
  const changes: StopListChange[] = [];
  const snapshot: StopListSnapshotEntry[] = [];

  for (const mapping of input.mappings) {
    if (mappedDishIds.has(mapping.dishId)) continue;
    mappedDishIds.add(mapping.dishId);
    const available = posAvailability.get(mapping.externalProductId) ?? true;
    const before = previous.get(mapping.dishId) ?? true;
    if (available !== before) {
      changes.push({ dishId: mapping.dishId, externalProductId: mapping.externalProductId, available });
    }
    snapshot.push({ dishId: mapping.dishId, provider: input.provider, externalProductId: mapping.externalProductId, available });
  }

  const staleDishIds = input.snapshot.filter((s) => !mappedDishIds.has(s.dishId)).map((s) => s.dishId);
  return { changes, snapshot, staleDishIds };
}
