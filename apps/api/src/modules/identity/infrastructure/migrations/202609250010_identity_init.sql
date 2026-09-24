-- Identity: филиалы, юрлица, пользователи, роли, refresh-токены.
create schema if not exists identity;
create extension if not exists citext;

create table identity.legal_entities (
  id uuid primary key,
  name text not null,
  short_name text not null,
  bin char(12) not null check (bin ~ '^\d{12}$'),
  legal_address text not null,
  actual_address text,
  director_name text not null,
  director_position text not null default 'Директор',
  acting_basis text not null default 'Устава',
  bank_name text not null default '',
  iban text not null default '',
  bik text not null default '',
  kbe text not null default '17',
  vat_payer boolean not null default false,
  vat_rate_bp integer not null default 0 check (vat_rate_bp >= 0 and vat_rate_bp <= 10000),
  vat_certificate text,
  phone text,
  email text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index legal_entities_bin_uq on identity.legal_entities (bin);
create unique index legal_entities_default_uq on identity.legal_entities (is_default) where is_default;
create trigger legal_entities_touch before update on identity.legal_entities
  for each row execute function platform.touch_updated_at();

create table identity.branches (
  id uuid primary key,
  code text not null check (code ~ '^[A-Z0-9]{1,6}$'),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name jsonb not null,
  address jsonb not null,
  lat double precision not null,
  lng double precision not null,
  phone text not null,
  whatsapp text,
  email text,
  timezone text not null default 'Asia/Almaty',
  opening_hours jsonb not null default '{}'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  legal_entity_id uuid references identity.legal_entities(id),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index branches_code_uq on identity.branches (code) where deleted_at is null;
create unique index branches_slug_uq on identity.branches (slug) where deleted_at is null;
create trigger branches_touch before update on identity.branches
  for each row execute function platform.touch_updated_at();

create table identity.users (
  id uuid primary key,
  email citext not null,
  name text not null,
  phone text,
  telegram_chat_id text,
  password_hash text not null,
  is_active boolean not null default true,
  must_change_password boolean not null default false,
  failed_login_count integer not null default 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index users_email_uq on identity.users (email) where deleted_at is null;
create trigger users_touch before update on identity.users
  for each row execute function platform.touch_updated_at();

create table identity.user_roles (
  id uuid primary key,
  user_id uuid not null references identity.users(id),
  role text not null check (role in ('branch_operator','banquet_manager','branch_manager','content_manager','finance','owner','sysadmin')),
  branch_id uuid references identity.branches(id),
  created_at timestamptz not null default now()
);
create unique index user_roles_uq on identity.user_roles (user_id, role, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index user_roles_role_idx on identity.user_roles (role, branch_id);

create table identity.refresh_tokens (
  id uuid primary key,
  user_id uuid not null references identity.users(id),
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  replaced_by uuid,
  user_agent text,
  ip inet
);
create index refresh_tokens_user_idx on identity.refresh_tokens (user_id) where revoked_at is null;
