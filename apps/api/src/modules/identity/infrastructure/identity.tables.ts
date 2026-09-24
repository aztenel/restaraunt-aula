import { Generated } from 'kysely';

/** Таблицы схемы identity. Модуль видит только их. */
export interface LegalEntitiesTable {
  id: string;
  name: string;
  short_name: string;
  bin: string;
  legal_address: string;
  actual_address: string | null;
  director_name: string;
  director_position: string;
  acting_basis: string;
  bank_name: string;
  iban: string;
  bik: string;
  kbe: string;
  vat_payer: boolean;
  vat_rate_bp: number;
  vat_certificate: string | null;
  phone: string | null;
  email: string | null;
  is_default: boolean;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface BranchesTable {
  id: string;
  code: string;
  slug: string;
  name: unknown;
  address: unknown;
  lat: number;
  lng: number;
  phone: string;
  whatsapp: string | null;
  email: string | null;
  timezone: string;
  opening_hours: unknown;
  settings: unknown;
  legal_entity_id: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  deleted_at: Date | null;
}

export interface UsersTable {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  telegram_chat_id: string | null;
  password_hash: string;
  is_active: boolean;
  must_change_password: boolean;
  failed_login_count: number;
  locked_until: Date | null;
  last_login_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  deleted_at: Date | null;
}

export interface UserRolesTable {
  id: string;
  user_id: string;
  role: string;
  branch_id: string | null;
  created_at: Generated<Date>;
}

export interface RefreshTokensTable {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  created_at: Generated<Date>;
  revoked_at: Date | null;
  replaced_by: string | null;
  user_agent: string | null;
  ip: string | null;
}

export interface IdentityTables {
  'identity.legal_entities': LegalEntitiesTable;
  'identity.branches': BranchesTable;
  'identity.users': UsersTable;
  'identity.user_roles': UserRolesTable;
  'identity.refresh_tokens': RefreshTokensTable;
}
