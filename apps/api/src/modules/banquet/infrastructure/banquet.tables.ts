import { Generated } from 'kysely';

/** Таблицы схемы banquet. Модуль видит только их. jsonb пишется строкой (JSON.stringify), читается объектом. */
export interface ClientCompaniesTable {
  id: string;
  name: string;
  bin: string;
  legal_address: string;
  bank_name: string | null;
  iban: string | null;
  bik: string | null;
  kbe: string | null;
  director_name: string | null;
  director_position: string | null;
  acting_basis: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  deleted_at: Date | null;
}

export interface ContractTemplatesTable {
  id: string;
  code: string;
  name: string;
  body: string;
  is_default: boolean;
  updated_by: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  deleted_at: Date | null;
}

export interface RequestsTable {
  id: string;
  number: string;
  status: string;
  source: string;
  branch_id: string | null;
  is_offsite: boolean;
  offsite_address: string | null;
  event_date: string;
  event_time: string | null;
  event_type: string;
  guests: number;
  budget_amount: number | null;
  budget_currency: string;
  customer_id: string | null;
  contact_name: string;
  contact_phone: string;
  contact_email: string | null;
  wishes: string | null;
  locale: string;
  manager_id: string;
  assigned_at: Date;
  company_id: string | null;
  prepayment_amount: number | null;
  prepayment_currency: string;
  prepayment_is_custom: boolean;
  venue_id: string | null;
  venue_reservation_id: string | null;
  venue_start: Date | null;
  venue_end: Date | null;
  contract_number: string | null;
  contract_date: string | null;
  first_response_at: Date | null;
  sla_breached_at: Date | null;
  cancel_reason: string | null;
  held_at: Date | null;
  cancelled_at: Date | null;
  public_token: string;
  created_at: Date;
  updated_at: Generated<Date>;
  deleted_at: Date | null;
}

export interface RequestActivitiesTable {
  id: string;
  request_id: string;
  kind: string;
  text: string | null;
  data: unknown;
  author_kind: string;
  author_id: string | null;
  author_name: string;
  occurred_at: Date;
}

export interface QuotesTable {
  id: string;
  request_id: string;
  version: number;
  branch_id: string | null;
  guests: number;
  discount_type: string | null;
  discount_bp: number | null;
  discount_value_amount: number | null;
  discount_value_currency: string;
  service_charge_bp: number;
  vat_payer: boolean;
  vat_rate_bp: number;
  subtotal_amount: number;
  subtotal_currency: string;
  discount_amount: number;
  discount_currency: string;
  service_amount: number;
  service_currency: string;
  total_amount: number;
  total_currency: string;
  vat_amount: number;
  vat_currency: string;
  per_guest_amount: number;
  per_guest_currency: string;
  valid_until: string | null;
  notes: string | null;
  seller: unknown;
  pdf_file_key: string | null;
  created_by: string | null;
  created_by_name: string;
  created_at: Date;
  sent_at: Date | null;
  accepted_at: Date | null;
}

export interface QuoteLinesTable {
  id: string;
  quote_id: string;
  position: number;
  kind: string;
  dish_id: string | null;
  title: unknown;
  unit: string;
  quantity: number;
  unit_price_amount: number;
  unit_price_currency: string;
  discount_type: string | null;
  discount_bp: number | null;
  discount_value_amount: number | null;
  discount_value_currency: string;
  gross_amount: number;
  gross_currency: string;
  discount_amount: number;
  discount_currency: string;
  total_amount: number;
  total_currency: string;
}

export interface InvoicesTable {
  id: string;
  request_id: string;
  number: string;
  branch_id: string | null;
  payer_type: string;
  company_id: string | null;
  buyer: unknown;
  seller: unknown;
  purpose: string;
  description: string;
  amount_amount: number;
  amount_currency: string;
  vat_amount: number;
  vat_currency: string;
  vat_rate_bp: number;
  paid_amount: number;
  paid_currency: string;
  refunded_amount: number;
  refunded_currency: string;
  due_date: string;
  status: string;
  payment_id: string | null;
  public_token: string;
  pdf_file_key: string | null;
  issued_at: Date;
  paid_at: Date | null;
  cancelled_at: Date | null;
  cancel_reason: string | null;
  created_by: string | null;
  created_by_name: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface InvoicePaymentsTable {
  id: string;
  invoice_id: string;
  payment_id: string;
  method: string;
  amount_amount: number;
  amount_currency: string;
  refunded_amount: number;
  refunded_currency: string;
  document_number: string | null;
  paid_at: Date;
  recorded_at: Date;
  recorded_by: string | null;
  recorded_by_name: string;
}

export interface ActsTable {
  id: string;
  request_id: string;
  number: string;
  branch_id: string | null;
  quote_id: string;
  payer_type: string;
  company_id: string | null;
  buyer: unknown;
  seller: unknown;
  amount_amount: number;
  amount_currency: string;
  vat_amount: number;
  vat_currency: string;
  vat_rate_bp: number;
  act_date: string;
  pdf_file_key: string;
  esf_status: string;
  esf_provider: string | null;
  esf_id: string | null;
  esf_registration_number: string | null;
  esf_error: string | null;
  esf_file_key: string | null;
  esf_updated_at: Date | null;
  created_by: string | null;
  created_by_name: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface DocumentsTable {
  id: string;
  request_id: string;
  kind: string;
  number: string | null;
  title: string;
  related_id: string | null;
  file_key: string;
  filename: string;
  content_type: string;
  created_by: string | null;
  created_by_name: string;
  created_at: Date;
}

export interface BanquetTables {
  'banquet.client_companies': ClientCompaniesTable;
  'banquet.contract_templates': ContractTemplatesTable;
  'banquet.requests': RequestsTable;
  'banquet.request_activities': RequestActivitiesTable;
  'banquet.quotes': QuotesTable;
  'banquet.quote_lines': QuoteLinesTable;
  'banquet.invoices': InvoicesTable;
  'banquet.invoice_payments': InvoicePaymentsTable;
  'banquet.acts': ActsTable;
  'banquet.documents': DocumentsTable;
}
