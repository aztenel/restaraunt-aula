-- Notifications: шаблоны сообщений, очередь уведомлений (сообщение -> доставки -> попытки),
-- лента событий админки (SSE) и идемпотентность статусов от провайдеров.
--
-- Сообщение создаётся в транзакции бизнес-операции (заказ, бронь, банкет) вместе с задачей доставки
-- в outbox; доставка идёт асинхронно с повторами. Одно сообщение гостю — одна или несколько доставок
-- (цепочка каналов с резервом, например WhatsApp -> SMS); сообщение персоналу — по доставке на адресата.
-- branch_id и staff_user_id — ссылки на Identity по значению, без внешних ключей.
create schema if not exists notifications;

-- ---------------------------------------------------------------- Шаблоны

-- Тексты шаблонов: ключ шаблона (контракт модуля) x канал x язык. Стартовые тексты — сид (код),
-- администратор редактирует их в админке. Переменные — {{param}} из параметров шаблона.
create table notifications.templates (
  id uuid primary key,
  key text not null check (key ~ '^[a-z_]+\.[a-z_]+$'),
  channel text not null check (channel in ('whatsapp', 'sms', 'email', 'telegram')),
  locale text not null check (locale in ('kk', 'ru', 'en')),
  subject text check (subject is null or length(subject) <= 300),
  body text not null check (length(body) between 1 and 20000),
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index templates_key_channel_locale_uq on notifications.templates (key, channel, locale);
create trigger templates_touch before update on notifications.templates
  for each row execute function platform.touch_updated_at();

-- ---------------------------------------------------------------- Сообщения

create table notifications.messages (
  id uuid primary key,
  audience text not null check (audience in ('guest', 'staff')),
  template text not null,
  locale text not null check (locale in ('kk', 'ru', 'en')),
  -- Параметры шаблона (строки). Чувствительные значения (коды) здесь замаскированы,
  -- настоящие — в secret_params (AES-GCM), очищаются после завершения доставки.
  params jsonb not null default '{}'::jsonb check (jsonb_typeof(params) = 'object'),
  secret_params text,
  -- Гость: { phone, email, name }; персонал: { branchId, permission, userIds, includeBranchChannels };
  -- прямой адресат (повтор, тест): { channel, address, name }.
  recipient jsonb not null check (jsonb_typeof(recipient) = 'object'),
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array'),
  -- План каналов гостю: цепочки с резервом, например [["whatsapp","sms"]] или [["email"],["whatsapp","sms"]].
  channel_plan jsonb not null default '[]'::jsonb check (jsonb_typeof(channel_plan) = 'array'),
  status text not null default 'queued' check (status in ('queued', 'sent', 'partial', 'failed', 'skipped')),
  -- Всего попыток отправки по всем доставкам.
  attempts integer not null default 0 check (attempts >= 0),
  -- Запусков задачи доставки (защита от бесконечных повторов).
  job_runs integer not null default 0 check (job_runs >= 0),
  -- Повторный dedupe_key — no-op (NULL не участвует в уникальности).
  dedupe_key text unique check (dedupe_key is null or length(dedupe_key) between 1 and 300),
  related_type text,
  related_id text,
  branch_id uuid,
  resent_from_id uuid,
  created_by uuid,
  planned_at timestamptz,
  locked_until timestamptz,
  expires_at timestamptz,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index messages_created_idx on notifications.messages (created_at desc);
create index messages_status_idx on notifications.messages (status, created_at);
create index messages_related_idx on notifications.messages (related_type, related_id);
create index messages_template_idx on notifications.messages (template, created_at desc);
create index messages_secrets_idx on notifications.messages (completed_at) where secret_params is not null;
create trigger messages_touch before update on notifications.messages
  for each row execute function platform.touch_updated_at();

-- ---------------------------------------------------------------- Доставки

-- Доставка одному адресату по цепочке каналов: chain = [{ channel, address }], step_index — текущий шаг.
-- channel/address — текущий (или итоговый) канал и адрес.
create table notifications.deliveries (
  id uuid primary key,
  message_id uuid not null references notifications.messages (id),
  target_kind text not null check (target_kind in ('guest', 'staff_user', 'branch', 'direct')),
  staff_user_id uuid,
  recipient_name text,
  chain jsonb not null check (jsonb_typeof(chain) = 'array'),
  step_index integer not null default 0 check (step_index >= 0),
  channel text not null check (channel in ('whatsapp', 'sms', 'email', 'telegram')),
  address text not null,
  provider text,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  channel_attempts integer not null default 0 check (channel_attempts >= 0),
  external_id text,
  last_error text,
  -- Текст последней попытки с замаскированными чувствительными параметрами (для журнала доставки).
  rendered_subject text,
  rendered_text text,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index deliveries_message_idx on notifications.deliveries (message_id);
create index deliveries_created_idx on notifications.deliveries (created_at desc);
create index deliveries_status_idx on notifications.deliveries (status, created_at desc);
create index deliveries_address_idx on notifications.deliveries (address);
create index deliveries_external_idx on notifications.deliveries (provider, external_id) where external_id is not null;
create trigger deliveries_touch before update on notifications.deliveries
  for each row execute function platform.touch_updated_at();

-- Журнал попыток: каждая попытка по каналу — отдельная запись (только добавление).
create table notifications.delivery_attempts (
  id uuid primary key,
  delivery_id uuid not null references notifications.deliveries (id),
  message_id uuid not null references notifications.messages (id),
  attempt_no integer not null check (attempt_no >= 1),
  channel text not null check (channel in ('whatsapp', 'sms', 'email', 'telegram')),
  provider text,
  address_masked text not null,
  status text not null check (status in ('sent', 'failed', 'skipped')),
  retryable boolean not null default false,
  error_code text,
  error text,
  external_id text,
  duration_ms integer,
  occurred_at timestamptz not null default now()
);
create index delivery_attempts_delivery_idx on notifications.delivery_attempts (delivery_id, occurred_at);

-- Входящие статусы провайдеров (доставлено, прочитано, ошибка): повтор с тем же ключом не применяется второй раз.
create table notifications.provider_events (
  key text primary key,
  received_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- Лента админки

-- Недавняя история ленты (очереди новых заказов, броней, банкетных заявок, системные оповещения)
-- для догрузки после переподключения SSE. Хранится ограниченное время (очистка по расписанию).
create table notifications.admin_feed (
  id uuid primary key,
  occurred_at timestamptz not null,
  branch_id uuid,
  stream text not null check (stream in ('orders', 'reservations', 'banquets', 'system')),
  kind text not null check (kind in ('created', 'updated')),
  entity_id text not null,
  title text not null,
  sound boolean not null default false
);
create index admin_feed_time_idx on notifications.admin_feed (occurred_at desc);
create index admin_feed_stream_idx on notifications.admin_feed (stream, branch_id, occurred_at desc);
