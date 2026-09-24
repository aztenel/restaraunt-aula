import { Generated } from 'kysely';

/** Таблицы схемы notifications. Модуль видит только их. */
export interface TemplatesTable {
  id: string;
  key: string;
  channel: string;
  locale: string;
  subject: string | null;
  body: string;
  updated_by: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface MessagesTable {
  id: string;
  audience: string;
  template: string;
  locale: string;
  params: unknown;
  secret_params: string | null;
  recipient: unknown;
  attachments: unknown;
  channel_plan: unknown;
  status: string;
  attempts: Generated<number>;
  job_runs: Generated<number>;
  dedupe_key: string | null;
  related_type: string | null;
  related_id: string | null;
  branch_id: string | null;
  resent_from_id: string | null;
  created_by: string | null;
  planned_at: Date | null;
  locked_until: Date | null;
  expires_at: Date | null;
  completed_at: Date | null;
  last_error: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface DeliveriesTable {
  id: string;
  message_id: string;
  target_kind: string;
  staff_user_id: string | null;
  recipient_name: string | null;
  chain: unknown;
  step_index: number;
  channel: string;
  address: string;
  provider: string | null;
  status: string;
  attempts: number;
  channel_attempts: number;
  external_id: string | null;
  last_error: string | null;
  rendered_subject: string | null;
  rendered_text: string | null;
  sent_at: Date | null;
  delivered_at: Date | null;
  read_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface DeliveryAttemptsTable {
  id: string;
  delivery_id: string;
  message_id: string;
  attempt_no: number;
  channel: string;
  provider: string | null;
  address_masked: string;
  status: string;
  retryable: boolean;
  error_code: string | null;
  error: string | null;
  external_id: string | null;
  duration_ms: number | null;
  occurred_at: Date;
}

export interface ProviderEventsTable {
  key: string;
  received_at: Generated<Date>;
}

export interface AdminFeedTable {
  id: string;
  occurred_at: Date;
  branch_id: string | null;
  stream: string;
  kind: string;
  entity_id: string;
  title: string;
  sound: boolean;
}

export interface NotificationsTables {
  'notifications.templates': TemplatesTable;
  'notifications.messages': MessagesTable;
  'notifications.deliveries': DeliveriesTable;
  'notifications.delivery_attempts': DeliveryAttemptsTable;
  'notifications.provider_events': ProviderEventsTable;
  'notifications.admin_feed': AdminFeedTable;
}
