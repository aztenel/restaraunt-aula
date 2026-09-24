import { ValidationError } from '../../../shared/kernel/errors';
import { Money } from '../../../shared/kernel/money';
import { ratio } from './amounts';
import { isMonth } from './period';

/**
 * Доля своего канала (цель ТЗ: «доля заказов мимо агрегаторов»). Заказы агрегаторов в систему
 * не попадают (docs/decisions.md): управляющий вносит помесячные итоги вручную (заказы, выручка),
 * отчёт сравнивает их с заказами своего канала (сайт + оператор по телефону).
 */
export interface AggregatorVolumeInput {
  month: string;
  source: string;
  sourceName: string;
  orders: number;
  revenue: Money;
}

const SOURCE_RE = /^[a-z0-9_]{2,32}$/;

export function normalizeAggregatorVolume(input: AggregatorVolumeInput): AggregatorVolumeInput {
  if (!isMonth(input.month)) throw new ValidationError('aggregator_volume.invalid_month', 'Month must be YYYY-MM');
  const source = input.source.trim().toLowerCase();
  if (!SOURCE_RE.test(source)) {
    throw new ValidationError('aggregator_volume.invalid_source', 'Source code: 2-32 latin letters, digits or _');
  }
  const sourceName = input.sourceName.trim();
  if (sourceName.length < 1 || sourceName.length > 120) {
    throw new ValidationError('aggregator_volume.invalid_source_name', 'Source name: 1-120 characters');
  }
  if (!Number.isSafeInteger(input.orders) || input.orders < 0 || input.orders > 1_000_000) {
    throw new ValidationError('aggregator_volume.invalid_orders', 'Orders count must be a non-negative integer');
  }
  if (input.revenue.isNegative()) throw new ValidationError('aggregator_volume.invalid_revenue', 'Revenue must not be negative');
  return { month: input.month, source, sourceName, orders: input.orders, revenue: input.revenue };
}

/** Доля своего канала: own / (own + агрегаторы). Нет данных агрегаторов — null. */
export function ownChannelShare(ownOrders: number, aggregatorOrders: number | null): number | null {
  if (aggregatorOrders === null) return null;
  return ratio(ownOrders, ownOrders + aggregatorOrders);
}
