import { Generated } from 'kysely';

/** Таблицы схемы customers. Модуль видит только их. */
export interface CustomersTable {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  locale: string;
  /** date -> 'YYYY-MM-DD' (см. pg-types). */
  birthday: string | null;
  tags: string[];
  allergies: string | null;
  preferences: string | null;
  notes: string | null;
  personal_data_consent: boolean;
  personal_data_consent_version: string | null;
  personal_data_consent_at: Date | null;
  marketing_consent: boolean;
  marketing_consent_version: string | null;
  marketing_consent_at: Date | null;
  first_seen_at: Date;
  last_activity_at: Date | null;
  orders_count: number;
  completed_orders_count: number;
  total_spent_amount: number;
  total_spent_currency: string;
  reservations_count: number;
  no_show_count: number;
  banquets_count: number;
  anonymized_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  deleted_at: Date | null;
}

export interface ConsentsTable {
  id: string;
  customer_id: string;
  kind: string;
  granted: boolean;
  text_version: string;
  source: string;
  ip: string | null;
  recorded_by: string | null;
  recorded_at: Date;
  created_at: Generated<Date>;
}

export interface ConsentTextsTable {
  id: string;
  kind: string;
  version: string;
  text: unknown;
  published_at: Date;
  published_by: string | null;
  created_at: Generated<Date>;
}

export interface ActivitiesTable {
  id: string;
  customer_id: string;
  type: string;
  entity_type: string;
  entity_id: string;
  branch_id: string | null;
  money_amount: number | null;
  money_currency: string;
  counts_as_spent: boolean;
  summary: string;
  meta: unknown;
  occurred_at: Date;
  source_event_id: string | null;
  created_at: Generated<Date>;
}

export interface BanquetLinksTable {
  request_id: string;
  customer_id: string;
  number: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface SegmentsTable {
  id: string;
  name: string;
  description: string | null;
  filter: unknown;
  created_by: string | null;
  updated_by: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  deleted_at: Date | null;
}

export interface PhoneVerificationsTable {
  id: string;
  phone: string;
  code_hash: string;
  locale: string;
  expires_at: Date;
  attempts: number;
  verified_at: Date | null;
  superseded_at: Date | null;
  ip: string | null;
  created_at: Date;
}

export interface CustomersTables {
  'customers.customers': CustomersTable;
  'customers.consents': ConsentsTable;
  'customers.consent_texts': ConsentTextsTable;
  'customers.activities': ActivitiesTable;
  'customers.banquet_links': BanquetLinksTable;
  'customers.segments': SegmentsTable;
  'customers.phone_verifications': PhoneVerificationsTable;
}
