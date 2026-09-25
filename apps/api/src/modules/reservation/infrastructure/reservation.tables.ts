import { Generated } from 'kysely';

/** Таблицы схемы reservation. Модуль видит только их. */
export interface VenueTypesTable {
  id: string;
  code: string;
  name: unknown;
  description: unknown;
  duration_minutes: number;
  hold_minutes: number;
  cancellation_deadline_hours: number;
  requires_manual_confirmation: boolean;
  cleanup_minutes: number;
  slot_step_minutes: number;
  bookable_online: boolean;
  sort_order: number;
  is_active: boolean;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  deleted_at: Date | null;
}

export interface HallsTable {
  id: string;
  branch_id: string;
  code: string;
  name: unknown;
  description: unknown;
  plan_width: number;
  plan_height: number;
  background_image: unknown | null;
  sort_order: number;
  is_active: boolean;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  deleted_at: Date | null;
}

export interface VenuesTable {
  id: string;
  branch_id: string;
  hall_id: string;
  type_id: string;
  code: string;
  name: unknown;
  description: unknown;
  capacity_min: number;
  capacity_max: number;
  deposit_amount: number | null;
  deposit_currency: Generated<string>;
  rules: unknown;
  pos_x: number;
  pos_y: number;
  pos_w: number;
  pos_h: number;
  shape: string;
  rotation: number;
  photos: unknown;
  sort_order: number;
  is_active: boolean;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  deleted_at: Date | null;
}

export interface ReservationsTable {
  id: string;
  number: string;
  branch_id: string;
  venue_id: string;
  kind: string;
  status: string;
  source: string;
  start_at: Date;
  end_at: Date;
  blocked_until: Date;
  /** Вычисляемая колонка tstzrange(start_at, blocked_until) — только чтение. */
  blocked_range: Generated<string>;
  guests: number;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  comment: string | null;
  occasion: string | null;
  locale: string;
  public_token: string | null;
  idempotency_key: string | null;
  banquet_request_id: string | null;
  note: string | null;
  requires_confirmation: boolean;
  rules: unknown;
  hold_expires_at: Date | null;
  deposit_amount: number | null;
  deposit_currency: Generated<string>;
  deposit_status: string;
  deposit_payment_id: string | null;
  deposit_paid_payment_id: string | null;
  deposit_paid_at: Date | null;
  deposit_waive_reason: string | null;
  deposit_attempts: number;
  deposit_outcome: string;
  cancel_reason: string | null;
  cancelled_by: string | null;
  confirmed_at: Date | null;
  arrived_at: Date | null;
  no_show_at: Date | null;
  cancelled_at: Date | null;
  expired_at: Date | null;
  reminder_sent_at: Date | null;
  created_by_user_id: string | null;
  created_at: Date;
  updated_at: Generated<Date>;
  deleted_at: Date | null;
}

export interface StatusHistoryTable {
  id: string;
  reservation_id: string;
  from_status: string | null;
  to_status: string;
  reason: string | null;
  deposit_outcome: string;
  actor_kind: string;
  actor_user_id: string | null;
  actor_name: string;
  occurred_at: Date;
}

export interface BranchSettingsTable {
  branch_id: string;
  reminder_hours_before: number;
  min_lead_minutes: number;
  max_days_ahead: number;
  policy_text: unknown;
  updated_at: Generated<Date>;
  updated_by: string | null;
}

export interface ReservationTables {
  'reservation.venue_types': VenueTypesTable;
  'reservation.halls': HallsTable;
  'reservation.venues': VenuesTable;
  'reservation.reservations': ReservationsTable;
  'reservation.status_history': StatusHistoryTable;
  'reservation.branch_settings': BranchSettingsTable;
}
