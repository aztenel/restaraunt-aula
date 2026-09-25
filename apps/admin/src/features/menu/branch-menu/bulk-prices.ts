/**
 * Массовое изменение цен: на сервер уходят только блюда, у которых введена новая цена,
 * отличная от текущей (целые тиыны). Никаких процентов и пересчётов на фронте.
 */
import type { BranchMenuItem } from '@aula/api-client';

/** Как MAX_BULK_PRICES на сервере. */
export const MAX_BULK_PRICES = 500;

export function changedPrices(
  items: readonly Pick<BranchMenuItem, 'dishId' | 'price'>[],
  next: Readonly<Record<string, number | null | undefined>>,
): Array<{ dishId: string; price: { amount: number } }> {
  const result: Array<{ dishId: string; price: { amount: number } }> = [];
  for (const item of items) {
    const amount = next[item.dishId];
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount === item.price.amount) continue;
    result.push({ dishId: item.dishId, price: { amount } });
  }
  return result;
}
