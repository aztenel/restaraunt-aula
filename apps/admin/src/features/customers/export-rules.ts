/**
 * Выгрузка базы гостей (защита ПД, закон РК о персональных данных) — правила, которые показываем
 * сотруднику до выгрузки (зеркало exportFilter на сервере, окончательно решает сервер):
 *  - маркетинг — только гости с маркетинговым согласием (условие «без согласия» несовместимо);
 *  - сервис (обзвон по действующим заказам/банкетам, сверка) — без этого ограничения, цель в журнале;
 *  - обезличенные гости не выгружаются никогда; каждая выгрузка пишется в журнал действий;
 *  - не больше 50 000 строк за раз.
 */
import { isFilterEmpty } from './customer-filter';
import type { CustomerFilterDto, ExportCustomersBody, ExportFormat, ExportPurpose } from './types';

export const MAX_EXPORT_ROWS = 50_000;

export type ExportNotice =
  | 'marketing_only_consented'
  | 'marketing_consent_added'
  | 'service_purpose_logged'
  | 'service_includes_unconsented'
  | 'anonymized_excluded'
  | 'audit_logged'
  | 'row_limit';

export type ExportBlocker = 'marketing_requires_consent';

export interface ExportPlan {
  purpose: ExportPurpose;
  /** Выгрузку с этими условиями сервер отклонит — кнопка недоступна. */
  blocker: ExportBlocker | null;
  /** Что увидит сотрудник перед выгрузкой (порядок — порядок показа). */
  notices: ExportNotice[];
  /** Фильтр, который фактически применит сервер (для маркетинга добавляется согласие). */
  effectiveFilter: CustomerFilterDto;
}

export function planExport(purpose: ExportPurpose, filter: CustomerFilterDto): ExportPlan {
  if (purpose === 'marketing') {
    if (filter.marketingConsent === false) {
      return { purpose, blocker: 'marketing_requires_consent', notices: ['marketing_only_consented'], effectiveFilter: { ...filter } };
    }
    const notices: ExportNotice[] = ['marketing_only_consented'];
    if (filter.marketingConsent === undefined) notices.push('marketing_consent_added');
    notices.push('anonymized_excluded', 'audit_logged', 'row_limit');
    return { purpose, blocker: null, notices, effectiveFilter: { ...filter, marketingConsent: true } };
  }
  const notices: ExportNotice[] = ['service_purpose_logged'];
  if (filter.marketingConsent !== true) notices.push('service_includes_unconsented');
  notices.push('anonymized_excluded', 'audit_logged', 'row_limit');
  return { purpose, blocker: null, notices, effectiveFilter: { ...filter } };
}

/** Тело POST /admin/customers/export: сегмент (если выбран) + условия экрана как уточнение. */
export function toExportBody(format: ExportFormat, purpose: ExportPurpose, filter: CustomerFilterDto, segmentId: string | null): ExportCustomersBody {
  const body: ExportCustomersBody = { format, purpose };
  if (segmentId) body.segmentId = segmentId;
  if (!isFilterEmpty(filter)) body.filter = filter;
  return body;
}

/** Имя файла, если сервер его не прислал: как exportFileName на сервере. */
export function fallbackExportName(purpose: ExportPurpose, format: ExportFormat, localDate: string): string {
  return `aula-customers-${purpose}-${localDate}.${format}`;
}
