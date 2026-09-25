import { Generated } from 'kysely';

/** Таблицы схемы reporting. Модуль видит только их. jsonb пишется строкой JSON, читается объектом. */
export interface OrdersTable {
  order_id: string;
  number: string;
  branch_id: string;
  type: string;
  channel: string;
  status: string;
  status_at: Date;
  status_rank: number;
  customer_id: string | null;
  payment_method: string | null;
  promo_code: string | null;
  analytics_session_id: string | null;
  subtotal_amount: Generated<number>;
  subtotal_currency: Generated<string>;
  discount_amount: Generated<number>;
  discount_currency: Generated<string>;
  delivery_fee_amount: Generated<number>;
  delivery_fee_currency: Generated<string>;
  total_amount: Generated<number>;
  total_currency: Generated<string>;
  placed_at: Date | null;
  placed_date: string | null;
  completed_at: Date | null;
  completed_date: string | null;
  cancelled_at: Date | null;
  cancelled_date: string | null;
  cancel_reason_code: string | null;
  cancel_reason: string | null;
  was_paid: boolean | null;
  refunded_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface OrderItemsTable {
  order_id: string;
  line_no: number;
  dish_id: string;
  name: unknown;
  quantity: number;
  unit_price_amount: number;
  unit_price_currency: Generated<string>;
  line_total_amount: number;
  line_total_currency: Generated<string>;
}

export interface PaymentsTable {
  payment_id: string;
  purpose: string;
  reference_id: string;
  branch_id: string | null;
  method: string;
  provider: string;
  payment_amount: number;
  payment_currency: Generated<string>;
  paid_at: Date;
  paid_date: string;
  late: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface RefundsTable {
  refund_id: string;
  payment_id: string;
  purpose: string;
  reference_id: string;
  branch_id: string | null;
  refund_amount: number;
  refund_currency: Generated<string>;
  reason: Generated<string>;
  refunded_at: Date;
  refunded_date: string;
  payment_fully_refunded: Generated<boolean>;
  reference_fully_refunded: Generated<boolean>;
  created_at: Generated<Date>;
}

export interface SalesFactsTable {
  id: string;
  source_type: string;
  source_id: string;
  kind: string;
  channel: string;
  branch_id: string | null;
  order_channel: string | null;
  reference_id: string;
  occurred_at: Date;
  local_date: string;
  revenue_amount: number;
  revenue_currency: Generated<string>;
  created_at: Generated<Date>;
}

export interface ReservationsTable {
  reservation_id: string;
  number: string;
  branch_id: string;
  venue_id: string;
  venue_type_code: string;
  venue_name: unknown | null;
  kind: string;
  status: string;
  status_at: Date;
  status_rank: number;
  source: string | null;
  start_at: Date;
  end_at: Date;
  start_date: string;
  guests: number;
  banquet_request_id: string | null;
  deposit_amount: number | null;
  deposit_currency: Generated<string>;
  deposit_outcome: Generated<string>;
  booked_at: Date | null;
  booked_date: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface BanquetRequestsTable {
  request_id: string;
  number: string;
  branch_id: string | null;
  is_offsite: Generated<boolean>;
  event_date: string | null;
  event_type: string | null;
  guests: number | null;
  budget_amount: number | null;
  budget_currency: Generated<string>;
  manager_id: string | null;
  manager_at: Date | null;
  source: string | null;
  status: string;
  status_at: Date;
  status_rank: number;
  max_stage: Generated<number>;
  requested_at: Date | null;
  requested_date: string | null;
  first_response_at: Date | null;
  quote_total_amount: number | null;
  quote_total_currency: Generated<string>;
  held_at: Date | null;
  held_date: string | null;
  held_total_amount: number | null;
  held_total_currency: Generated<string>;
  cancelled_at: Date | null;
  cancelled_from: string | null;
  cancel_reason: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface BanquetStatusChangesTable {
  event_id: string;
  request_id: string;
  from_status: string;
  to_status: string;
  reason: string | null;
  occurred_at: Date;
}

export interface DocumentsTable {
  id: string;
  kind: string;
  number: string;
  request_id: string;
  branch_id: string | null;
  payer_type: string | null;
  company_name: string | null;
  company_bin: string | null;
  document_amount: number;
  document_currency: Generated<string>;
  vat_amount: Generated<number>;
  vat_currency: Generated<string>;
  paid_total_amount: Generated<number>;
  paid_total_currency: Generated<string>;
  fully_paid: Generated<boolean>;
  due_date: string | null;
  issued_at: Date;
  issued_date: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface CertificatesTable {
  certificate_id: string;
  product_id: string | null;
  kind: string;
  nominal_amount: number;
  nominal_currency: Generated<string>;
  price_amount: number | null;
  price_currency: Generated<string>;
  branch_id: string | null;
  issued_at: Date | null;
  issued_date: string | null;
  expires_at: Date | null;
  expired_at: Date | null;
  expired_date: string | null;
  expired_balance_amount: number | null;
  expired_balance_currency: Generated<string>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface CertificateRedemptionsTable {
  event_id: string;
  certificate_id: string;
  redeemed_amount: number;
  redeemed_currency: Generated<string>;
  balance_after_amount: number;
  balance_after_currency: Generated<string>;
  branch_id: string | null;
  channel: string;
  reference_id: string | null;
  redeemed_at: Date;
  redeemed_date: string;
}

export interface CertificateCreditsTable {
  event_id: string;
  certificate_id: string;
  credited_amount: number;
  credited_currency: Generated<string>;
  balance_after_amount: number;
  balance_after_currency: Generated<string>;
  branch_id: string | null;
  refund_id: string | null;
  payment_id: string | null;
  credited_at: Date;
  credited_date: string;
}

export interface StorefrontEventsTable {
  id: string;
  session_id: string;
  type: string;
  branch_id: string | null;
  path: string;
  occurred_at: Date;
  local_date: string;
}

export interface AggregatorVolumesTable {
  id: string;
  branch_id: string;
  month: string;
  source: string;
  source_name: string;
  orders_count: number;
  revenue_amount: Generated<number>;
  revenue_currency: Generated<string>;
  updated_by: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface DailyReportsTable {
  id: string;
  report_date: string;
  scope: string;
  branch_id: string | null;
  summary: unknown;
  file_key: string | null;
  generated_at: Date;
  notified_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface AccountingExportsTable {
  id: string;
  format: string;
  period_from: string;
  period_to: string;
  branch_id: string | null;
  status: string;
  build_attempts: Generated<number>;
  file_key: string | null;
  file_name: string | null;
  content_type: string | null;
  size_bytes: number | null;
  totals: unknown | null;
  error: string | null;
  push_requested: Generated<boolean>;
  push_status: Generated<string>;
  push_attempts: Generated<number>;
  pushed_at: Date | null;
  push_error: string | null;
  requested_by: string | null;
  requested_at: Date;
  completed_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ReportingTables {
  'reporting.orders': OrdersTable;
  'reporting.order_items': OrderItemsTable;
  'reporting.payments': PaymentsTable;
  'reporting.refunds': RefundsTable;
  'reporting.sales_facts': SalesFactsTable;
  'reporting.reservations': ReservationsTable;
  'reporting.banquet_requests': BanquetRequestsTable;
  'reporting.banquet_status_changes': BanquetStatusChangesTable;
  'reporting.documents': DocumentsTable;
  'reporting.certificates': CertificatesTable;
  'reporting.certificate_redemptions': CertificateRedemptionsTable;
  'reporting.certificate_credits': CertificateCreditsTable;
  'reporting.storefront_events': StorefrontEventsTable;
  'reporting.aggregator_volumes': AggregatorVolumesTable;
  'reporting.daily_reports': DailyReportsTable;
  'reporting.accounting_exports': AccountingExportsTable;
}
