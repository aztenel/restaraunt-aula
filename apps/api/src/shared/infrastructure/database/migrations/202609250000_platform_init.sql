-- Платформа: общие механизмы, которыми пользуются все модули.
-- Каждый модуль держит свои таблицы в собственной схеме PostgreSQL.

create extension if not exists btree_gist;
create extension if not exists pg_trgm;

create schema if not exists platform;

-- Запрет физического удаления (заказы, платежи, брони). Удаление только логическое (deleted_at).
create or replace function platform.forbid_delete() returns trigger
language plpgsql as $$
begin
  raise exception 'Physical delete is forbidden for %.%: use deleted_at', tg_table_schema, tg_table_name
    using errcode = 'restrict_violation';
end;
$$;

-- Запрет изменения и удаления (журнал аудита: только добавление).
create or replace function platform.forbid_update_delete() returns trigger
language plpgsql as $$
begin
  raise exception 'Table %.% is append-only', tg_table_schema, tg_table_name
    using errcode = 'restrict_violation';
end;
$$;

-- Автоматическое обновление updated_at.
create or replace function platform.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Transactional outbox: события и задачи пишутся в той же транзакции, что и изменение данных,
-- затем relay переносит их в очередь. Ничего не теряется при падении процесса.
create table platform.outbox (
  id uuid primary key,
  kind text not null check (kind in ('event', 'job')),
  topic text not null,
  payload jsonb not null,
  meta jsonb not null default '{}'::jsonb,
  available_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  dispatched_at timestamptz,
  attempts integer not null default 0,
  last_error text
);
create index outbox_pending_idx on platform.outbox (available_at) where dispatched_at is null;

create or replace function platform.notify_outbox() returns trigger
language plpgsql as $$
begin
  perform pg_notify('aula_outbox', new.kind);
  return new;
end;
$$;
create trigger outbox_notify after insert on platform.outbox
  for each row execute function platform.notify_outbox();

-- Очередь неудач: задачи и обработчики, исчерпавшие лимит повторов.
create table platform.failed_jobs (
  id uuid primary key,
  kind text not null,
  topic text not null,
  handler text,
  payload jsonb not null,
  error text not null,
  attempts integer not null,
  failed_at timestamptz not null default now(),
  retried_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid
);
create index failed_jobs_open_idx on platform.failed_jobs (failed_at desc) where resolved_at is null;

-- Идемпотентность обработчиков событий и входящих сообщений.
create table platform.idempotency_keys (
  key text primary key,
  created_at timestamptz not null default now()
);

-- Журнал действий пользователей: только добавление.
create table platform.audit_log (
  id uuid primary key,
  occurred_at timestamptz not null default now(),
  actor_kind text not null check (actor_kind in ('staff', 'system', 'guest')),
  actor_user_id uuid,
  actor_name text not null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  branch_id uuid,
  before jsonb,
  after jsonb,
  meta jsonb not null default '{}'::jsonb,
  ip inet,
  request_id text
);
create index audit_log_time_idx on platform.audit_log (occurred_at desc);
create index audit_log_entity_idx on platform.audit_log (entity_type, entity_id);
create index audit_log_actor_idx on platform.audit_log (actor_user_id, occurred_at desc);
create index audit_log_branch_idx on platform.audit_log (branch_id, occurred_at desc);
create index audit_log_action_idx on platform.audit_log (action, occurred_at desc);
create trigger audit_log_append_only before update or delete on platform.audit_log
  for each row execute function platform.forbid_update_delete();

-- Полные ответы внешних систем (с маскированием платёжных данных).
create table platform.integration_logs (
  id uuid primary key,
  occurred_at timestamptz not null default now(),
  integration text not null,
  direction text not null check (direction in ('outbound', 'inbound')),
  operation text not null,
  correlation_id text,
  request jsonb,
  response jsonb,
  status_code integer,
  success boolean not null,
  duration_ms integer,
  error text
);
create index integration_logs_idx on platform.integration_logs (integration, occurred_at desc);
create index integration_logs_corr_idx on platform.integration_logs (correlation_id);

-- Настройки интеграций (управляет администратор системы). Секреты шифруются AES-256-GCM.
create table platform.integration_settings (
  key text primary key,
  enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  secrets_encrypted text,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- Нумерация документов: последовательность в разрезе филиала и года (заказы, счета, акты).
create table platform.number_sequences (
  scope text not null,
  branch_id uuid not null,
  year integer not null,
  last_value bigint not null default 0,
  primary key (scope, branch_id, year)
);
