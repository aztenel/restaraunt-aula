/**
 * Порядок элементов (категории, фото блюда, группы модификаторов у блюда, опции группы):
 * перемещение кнопками вверх/вниз и перетаскиванием. Сервер принимает полный список id в новом порядке.
 */

/** Переместить элемент с позиции from на позицию to (индексы вне списка — без изменений). */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const result = [...list];
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return result;
  const [item] = result.splice(from, 1);
  result.splice(to, 0, item as T);
  return result;
}

/** Сдвинуть элемент на delta позиций (−1 — вверх, +1 — вниз); у края списка — без изменений. */
export function moveBy<T>(list: readonly T[], index: number, delta: number): T[] {
  return moveItem(list, index, index + delta);
}

/** Перетаскивание: элемент с id `dragId` встаёт на место элемента `overId`. */
export function moveById<T extends { id: string }>(list: readonly T[], dragId: string, overId: string): T[] {
  return moveItem(
    list,
    list.findIndex((item) => item.id === dragId),
    list.findIndex((item) => item.id === overId),
  );
}

/** Одинаков ли порядок id (нужно ли отправлять изменение на сервер). */
export function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/** Сортировка по sortOrder (стабильная, как на сервере — дальше по исходному порядку). */
export function bySortOrder<T extends { sortOrder: number }>(list: readonly T[]): T[] {
  return list
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.sortOrder - b.item.sortOrder || a.index - b.index)
    .map(({ item }) => item);
}

/** Применить порядок id к списку объектов (для оптимистичного обновления кэша). Неизвестные id — в конце. */
export function applyOrder<T extends { id: string }>(list: readonly T[], ids: readonly string[]): T[] {
  const position = new Map(ids.map((id, index) => [id, index]));
  return list
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (position.get(a.item.id) ?? ids.length + a.index) - (position.get(b.item.id) ?? ids.length + b.index))
    .map(({ item }) => item);
}
