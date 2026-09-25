import { Generated } from 'kysely';

/** Таблицы схемы payments. Модуль видит только их. */
export interface PaymentsTable {
  id: string;
  invoice_no: Generated<number>;
  purpose: string;
  reference_id: string;
  branch_id: string | null;
  method: string;
  provider: string;
  status: string;
  payment_amount: number;
  payment_currency: string;
  refunded_amount: number;
  refunded_currency: string;
  external_id: string | null;
  payment_url: string | null;
  provider_data: unknown;
  description: string;
  customer_phone: string | null;
  customer_name: string | null;
  customer_email: string | null;
  return_url: string | null;
  idempotency_key: string;
  certificate_id: string | null;
  document_number: string | null;
  failure_reason: string | null;
  cancel_reason: string | null;
  initiate_attempts: number;
  last_checked_at: Date | null;
  expiry_check_at: Date | null;
  amount_mismatch_at: Date | null;
  expires_at: Date | null;
  paid_at: Date | null;
  failed_at: Date | null;
  cancelled_at: Date | null;
  created_at: Date;
  updated_at: Generated<Date>;
  deleted_at: Date | null;
}

export interface RefundsTable {
  id: string;
  payment_id: string;
  refund_amount: number;
  refund_currency: string;
  status: string;
  mode: string;
  reason: string;
  idempotency_key: string;
  external_refund_id: string | null;
  attempts: number;
  claimed_at: Date | null;
  failure_reason: string | null;
  comment: string | null;
  requested_by: string | null;
  completed_by: string | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Generated<Date>;
}

export interface WebhookEventsTable {
  id: string;
  provider: string;
  event_id: string;
  payment_id: string | null;
  external_id: string | null;
  status: string;
  reported_amount: number | null;
  reported_currency: string;
  outcome: string;
  received_at: Date;
}

export interface SandboxSessionsTable {
  external_id: string;
  payment_id: string;
  session_amount: number;
  session_currency: string;
  status: string;
  refunded_amount: number;
  refunded_currency: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface CertificateProductsTable {
  id: string;
  slug: string;
  kind: string;
  name: unknown;
  description: unknown;
  nominal_amount: number;
  nominal_currency: string;
  price_amount: number;
  price_currency: string;
  validity_months: number;
  design: unknown;
  is_active: boolean;
  sort_order: number;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  deleted_at: Date | null;
}

export interface CertificateOrdersTable {
  id: string;
  token: string;
  source: string;
  product_id: string;
  product_snapshot: unknown;
  quantity: number;
  unit_price_amount: number;
  unit_price_currency: string;
  total_amount: number;
  total_currency: string;
  buyer_name: string;
  buyer_phone: string | null;
  buyer_email: string | null;
  buyer_company: string | null;
  recipient_name: string;
  recipient_email: string | null;
  recipient_phone: string | null;
  message: string | null;
  delivery_channel: string;
  locale: string;
  status: string;
  payment_id: string | null;
  idempotency_key: string;
  consent_version: string | null;
  client_ip: string | null;
  created_by: string | null;
  issued_at: Date | null;
  created_at: Date;
  updated_at: Generated<Date>;
}

export interface GiftCertificatesTable {
  id: string;
  code_hash: string;
  last4: string;
  order_id: string;
  product_id: string;
  kind: string;
  name: unknown;
  set_description: unknown;
  nominal_amount: number;
  nominal_currency: string;
  balance_amount: number;
  balance_currency: string;
  price_amount: number;
  price_currency: string;
  status: string;
  status_reason: string | null;
  issued_at: Date;
  expires_at: Date;
  buyer_name: string | null;
  buyer_phone: string | null;
  buyer_email: string | null;
  recipient_name: string | null;
  recipient_email: string | null;
  recipient_phone: string | null;
  message: string | null;
  delivery_channel: string;
  locale: string;
  pdf_file_key: string | null;
  delivery_count: number;
  last_delivered_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface CertificateTransactionsTable {
  id: string;
  certificate_id: string;
  kind: string;
  change_amount: number;
  change_currency: string;
  balance_after_amount: number;
  balance_after_currency: string;
  channel: string;
  payment_id: string | null;
  refund_id: string | null;
  reference_type: string | null;
  reference_id: string | null;
  branch_id: string | null;
  actor_user_id: string | null;
  actor_name: string;
  comment: string | null;
  occurred_at: Date;
}

export interface CertificateCheckFailuresTable {
  id: string;
  ip: string;
  occurred_at: Date;
  /** Сотрудник (проверка из админки/с точки); null — гость витрины (учёт по IP). */
  user_id: string | null;
}

export interface PaymentStatusHistoryTable {
  id: string;
  payment_id: string;
  from_status: string | null;
  to_status: string;
  reason: string | null;
  actor_kind: string;
  actor_user_id: string | null;
  actor_name: string;
  occurred_at: Date;
}

export interface CertificateIpBlocksTable {
  ip: string;
  blocked_until: Date;
  failures: number;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface PaymentsTables {
  'payments.payments': PaymentsTable;
  'payments.refunds': RefundsTable;
  'payments.webhook_events': WebhookEventsTable;
  'payments.sandbox_sessions': SandboxSessionsTable;
  'payments.certificate_products': CertificateProductsTable;
  'payments.certificate_orders': CertificateOrdersTable;
  'payments.gift_certificates': GiftCertificatesTable;
  'payments.certificate_transactions': CertificateTransactionsTable;
  'payments.certificate_check_failures': CertificateCheckFailuresTable;
  'payments.certificate_ip_blocks': CertificateIpBlocksTable;
  'payments.payment_status_history': PaymentStatusHistoryTable;
}
