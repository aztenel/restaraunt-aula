/**
 * Фильтры списка платежей ⇄ параметры запроса GET /admin/payments.
 * Период — локальные даты Asia/Almaty (включительно) → ISO UTC [from, to).
 */
import { dateRangeToQuery, type DateRangeValue } from '@/shared/ui/DateRangeFilter';
import type { PaymentListQuery, PaymentMethod, PaymentPurpose, PaymentStatus } from './types';

export interface PaymentFilters {
  /** null — все доступные филиалы (сервер сам сузит до филиалов с payments.view). */
  branchId: string | null;
  purpose?: PaymentPurpose;
  method?: PaymentMethod;
  provider?: string;
  status?: PaymentStatus;
  /** Объект оплаты: id заказа, брони, счёта банкета, заказа сертификатов. */
  referenceId: string;
  range: DateRangeValue;
}

export function emptyPaymentFilters(branchId: string | null): PaymentFilters {
  return { branchId, referenceId: '', range: null };
}

export function toPaymentListQuery(filters: PaymentFilters, page: number, perPage: number): PaymentListQuery {
  const { from, to } = dateRangeToQuery(filters.range);
  const query: PaymentListQuery = { page, perPage };
  if (filters.branchId) query.branchId = filters.branchId;
  if (filters.purpose) query.purpose = filters.purpose;
  if (filters.method) query.method = filters.method;
  if (filters.provider?.trim()) query.provider = filters.provider.trim();
  if (filters.status) query.status = filters.status;
  if (filters.referenceId.trim()) query.referenceId = filters.referenceId.trim();
  if (from) query.from = from;
  if (to) query.to = to;
  return query;
}
