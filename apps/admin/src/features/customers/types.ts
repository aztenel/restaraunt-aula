/**
 * База гостей (модуль Customers): формы ответов API — из docs/openapi.json (Schemas).
 * Гость общий для сети и определяется нормализованным телефоном +7XXXXXXXXXX.
 */
import type { Schemas } from '@aula/api-client';

export type Customer = Schemas['CustomerDto'];
export type CustomerDetail = Schemas['CustomerDetailDto'];
export type CustomerActivity = Schemas['ActivityDto'];
export type ConsentRecord = Schemas['ConsentRecordDto'];
export type PeriodTotals = Schemas['PeriodTotalsDto'];
export type CustomerFilterDto = Schemas['CustomerFilterDto'];
export type Segment = Schemas['SegmentDto'];
export type SegmentDetail = Schemas['SegmentDetailDto'];
export type SaveSegmentBody = Schemas['SaveSegmentDto'];
export type ExportCustomersBody = Schemas['ExportCustomersDto'];
export type ConsentText = Schemas['ConsentTextDto'];
export type PublishConsentTextBody = Schemas['PublishConsentTextDto'];
export type RecordConsentBody = Schemas['RecordConsentDto'];
export type UpdateCustomerBody = Schemas['UpdateCustomerDto'];
export type TagStat = Schemas['TagStatDto'];

export const CONSENT_KINDS = ['personal_data', 'marketing'] as const;
export type ConsentKind = ConsentText['kind'];

export const STAFF_CONSENT_SOURCES = ['admin', 'phone'] as const;
export type StaffConsentSource = RecordConsentBody['source'];

export const CUSTOMER_SORTS = ['lastActivity', 'totalSpent', 'name', 'firstSeen'] as const;
export type CustomerSort = (typeof CUSTOMER_SORTS)[number];

export const EXPORT_FORMATS = ['xlsx', 'csv'] as const;
export type ExportFormat = ExportCustomersBody['format'];
export const EXPORT_PURPOSES = ['marketing', 'service'] as const;
export type ExportPurpose = ExportCustomersBody['purpose'];

/** Автотеги (ТЗ): постоянный — от 3 выполненных заказов, банкетный — после заявки, корпоративный — счёт юрлицу. */
export const AUTO_TAGS = ['regular', 'banquet', 'corporate'] as const;

export type ActivityType = CustomerActivity['type'];

/** Параметры GET /admin/customers (как в OpenAPI). */
export interface CustomerListQuery {
  q?: string;
  tag?: string;
  spentMin?: number;
  spentMax?: number;
  lastActivityFrom?: string;
  lastActivityTo?: string;
  branchId?: string;
  hasBanquet?: boolean;
  marketingConsent?: boolean;
  segmentId?: string;
  includeAnonymized?: boolean;
  sort?: CustomerSort;
  order?: 'asc' | 'desc';
  page: number;
  perPage: number;
}
