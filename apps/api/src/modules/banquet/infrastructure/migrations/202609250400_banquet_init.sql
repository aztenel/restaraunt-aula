-- Банкеты и кейтеринг: заявки и воронка, сметы (версии), счета и оплаты, документы для юрлиц, ЭСФ.
-- Все таблицы — в схеме banquet. Внешних ключей на таблицы других модулей нет.
create schema if not exists banquet;

-- Реквизиты компаний-заказчиков: хранятся и переиспользуются между заявками.
create table banquet.client_companies (
  id uuid primary key,
  name text not null,
  bin text not null check (bin ~ '^[0-9]{12}$'),
  legal_address text not null,
  bank_name text,
  iban text,
  bik text,
  kbe text,
  director_name text,
  director_position text,
  acting_basis text,
  contact_name text,
  contact_phone text,
  contact_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index client_companies_bin_uq on banquet.client_companies (bin) where deleted_at is null;
create index client_companies_name_trgm_idx on banquet.client_companies using gin (lower(name) gin_trgm_ops);
create trigger client_companies_touch before update on banquet.client_companies
  for each row execute function platform.touch_updated_at();

-- Шаблоны договоров (текст с подстановками {{seller.name}}, {{client.bin}} …), редактируются в админке.
create table banquet.contract_templates (
  id uuid primary key,
  code text not null check (code ~ '^[a-z0-9_-]{2,60}$'),
  name text not null,
  body text not null,
  is_default boolean not null default false,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index contract_templates_code_uq on banquet.contract_templates (code) where deleted_at is null;
create unique index contract_templates_default_uq on banquet.contract_templates ((true)) where is_default and deleted_at is null;
create trigger contract_templates_touch before update on banquet.contract_templates
  for each row execute function platform.touch_updated_at();

-- Заявка на банкет / кейтеринг. Инвариант ТЗ: у заявки всегда есть ответственный менеджер.
create table banquet.requests (
  id uuid primary key,
  number text not null,
  status text not null check (status in ('new', 'in_progress', 'quote_sent', 'agreed', 'prepaid', 'held', 'cancelled')),
  source text not null check (source in ('web', 'admin')),
  -- Филиал проведения; для выезда — филиал-исполнитель (цены, нумерация), может быть не выбран.
  branch_id uuid,
  is_offsite boolean not null default false,
  offsite_address text,
  event_date date not null,
  event_time text check (event_time is null or event_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  event_type text not null check (event_type in ('wedding', 'birthday', 'corporate', 'anniversary', 'kudalyk', 'memorial', 'graduation', 'other')),
  guests integer not null check (guests > 0),
  budget_amount bigint check (budget_amount is null or budget_amount >= 0),
  budget_currency char(3) not null default 'KZT',
  customer_id uuid,
  contact_name text not null,
  contact_phone text not null,
  contact_email text,
  wishes text,
  locale text not null default 'ru' check (locale in ('kk', 'ru', 'en')),
  manager_id uuid not null,
  assigned_at timestamptz not null,
  company_id uuid references banquet.client_companies (id),
  prepayment_amount bigint check (prepayment_amount is null or prepayment_amount >= 0),
  prepayment_currency char(3) not null default 'KZT',
  prepayment_is_custom boolean not null default false,
  venue_id uuid,
  venue_reservation_id uuid,
  venue_start timestamptz,
  venue_end timestamptz,
  contract_number text,
  contract_date date,
  first_response_at timestamptz,
  sla_breached_at timestamptz,
  cancel_reason text,
  held_at timestamptz,
  cancelled_at timestamptz,
  public_token text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint requests_offsite_address check (not is_offsite or offsite_address is not null),
  constraint requests_branch_or_offsite check (is_offsite or branch_id is not null),
  constraint requests_venue_consistent check (
    (venue_id is null) = (venue_reservation_id is null)
    and (venue_id is null) = (venue_start is null)
    and (venue_id is null) = (venue_end is null)
  )
);
create unique index requests_number_uq on banquet.requests (number);
create unique index requests_token_uq on banquet.requests (public_token);
create unique index requests_contract_number_uq on banquet.requests (contract_number) where contract_number is not null;
create index requests_status_idx on banquet.requests (status, created_at desc) where deleted_at is null;
create index requests_manager_idx on banquet.requests (manager_id, status);
create index requests_branch_date_idx on banquet.requests (branch_id, event_date);
create index requests_event_date_idx on banquet.requests (event_date);
create index requests_customer_idx on banquet.requests (customer_id);
create index requests_sla_idx on banquet.requests (created_at)
  where status = 'new' and first_response_at is null and sla_breached_at is null;
create trigger requests_touch before update on banquet.requests
  for each row execute function platform.touch_updated_at();
-- Заявки не удаляются физически (цель ТЗ: ноль потерянных заявок).
create trigger requests_forbid_delete before delete on banquet.requests
  for each row execute function platform.forbid_delete();

-- Лента заявки: заметки, звонки, смены статусов, документы, оплаты.
create table banquet.request_activities (
  id uuid primary key,
  request_id uuid not null references banquet.requests (id),
  kind text not null check (kind in (
    'created', 'note', 'call', 'contact', 'meeting', 'status_changed', 'assigned', 'details_updated',
    'venue_set', 'venue_released', 'quote_saved', 'quote_sent', 'quote_accepted', 'prepayment_set',
    'invoice_issued', 'invoice_cancelled', 'payment_recorded', 'refund_requested', 'refund_recorded',
    'document_generated', 'act_issued', 'esf', 'sla_breach'
  )),
  text text,
  data jsonb not null default '{}'::jsonb,
  author_kind text not null check (author_kind in ('staff', 'system', 'guest')),
  author_id uuid,
  author_name text not null,
  occurred_at timestamptz not null
);
create index request_activities_request_idx on banquet.request_activities (request_id, occurred_at desc, id desc);

-- Смета: каждое сохранение — новая версия; прошлые версии не меняются.
create table banquet.quotes (
  id uuid primary key,
  request_id uuid not null references banquet.requests (id),
  version integer not null check (version > 0),
  branch_id uuid,
  guests integer not null check (guests > 0),
  discount_type text check (discount_type in ('percent', 'amount')),
  discount_bp integer check (discount_bp is null or discount_bp between 0 and 10000),
  discount_value_amount bigint check (discount_value_amount is null or discount_value_amount >= 0),
  discount_value_currency char(3) not null default 'KZT',
  service_charge_bp integer not null default 0 check (service_charge_bp between 0 and 10000),
  vat_payer boolean not null,
  vat_rate_bp integer not null default 0 check (vat_rate_bp >= 0),
  subtotal_amount bigint not null,
  subtotal_currency char(3) not null default 'KZT',
  discount_amount bigint not null,
  discount_currency char(3) not null default 'KZT',
  service_amount bigint not null,
  service_currency char(3) not null default 'KZT',
  total_amount bigint not null check (total_amount >= 0),
  total_currency char(3) not null default 'KZT',
  vat_amount bigint not null,
  vat_currency char(3) not null default 'KZT',
  per_guest_amount bigint not null,
  per_guest_currency char(3) not null default 'KZT',
  valid_until date,
  notes text,
  seller jsonb not null,
  pdf_file_key text,
  created_by uuid,
  created_by_name text not null,
  created_at timestamptz not null,
  sent_at timestamptz,
  accepted_at timestamptz,
  unique (request_id, version)
);

create table banquet.quote_lines (
  id uuid primary key,
  quote_id uuid not null references banquet.quotes (id),
  position integer not null check (position > 0),
  kind text not null check (kind in ('menu', 'hall_rent', 'musicians', 'decoration', 'service', 'other')),
  dish_id uuid,
  title jsonb not null,
  unit text not null,
  quantity integer not null check (quantity > 0),
  unit_price_amount bigint not null check (unit_price_amount >= 0),
  unit_price_currency char(3) not null default 'KZT',
  discount_type text check (discount_type in ('percent', 'amount')),
  discount_bp integer check (discount_bp is null or discount_bp between 0 and 10000),
  discount_value_amount bigint check (discount_value_amount is null or discount_value_amount >= 0),
  discount_value_currency char(3) not null default 'KZT',
  gross_amount bigint not null,
  gross_currency char(3) not null default 'KZT',
  discount_amount bigint not null,
  discount_currency char(3) not null default 'KZT',
  total_amount bigint not null check (total_amount >= 0),
  total_currency char(3) not null default 'KZT',
  unique (quote_id, position),
  constraint quote_lines_menu_dish check (kind <> 'menu' or dish_id is not null)
);

-- Неизменяемость версий сметы: меняются только служебные отметки (PDF, отправка, согласование).
create function banquet.forbid_quote_change() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Quote versions are immutable (delete of %)', old.id using errcode = 'restrict_violation';
  end if;
  if (to_jsonb(new) - 'pdf_file_key' - 'sent_at' - 'accepted_at') <> (to_jsonb(old) - 'pdf_file_key' - 'sent_at' - 'accepted_at') then
    raise exception 'Quote versions are immutable (update of %)', old.id using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
create trigger quotes_immutable before update or delete on banquet.quotes
  for each row execute function banquet.forbid_quote_change();
create trigger quote_lines_immutable before update or delete on banquet.quote_lines
  for each row execute function platform.forbid_update_delete();

-- Счета: физлицу (онлайн-оплата) и юрлицу (счёт на оплату с реквизитами).
create table banquet.invoices (
  id uuid primary key,
  request_id uuid not null references banquet.requests (id),
  number text not null,
  branch_id uuid,
  payer_type text not null check (payer_type in ('individual', 'company')),
  company_id uuid references banquet.client_companies (id),
  buyer jsonb not null,
  seller jsonb not null,
  purpose text not null check (purpose in ('prepayment', 'payment')),
  description text not null,
  amount_amount bigint not null check (amount_amount > 0),
  amount_currency char(3) not null default 'KZT',
  vat_amount bigint not null default 0 check (vat_amount >= 0),
  vat_currency char(3) not null default 'KZT',
  vat_rate_bp integer not null default 0 check (vat_rate_bp >= 0),
  paid_amount bigint not null default 0 check (paid_amount >= 0),
  paid_currency char(3) not null default 'KZT',
  refunded_amount bigint not null default 0 check (refunded_amount >= 0),
  refunded_currency char(3) not null default 'KZT',
  due_date date not null,
  status text not null check (status in ('issued', 'partially_paid', 'paid', 'cancelled')),
  payment_id uuid,
  public_token text not null,
  pdf_file_key text,
  issued_at timestamptz not null,
  paid_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  created_by uuid,
  created_by_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Инвариант ТЗ: сумма оплат по счёту не превышает сумму счёта.
  constraint invoices_paid_not_exceed check (paid_amount <= amount_amount),
  constraint invoices_refund_not_exceed check (refunded_amount <= paid_amount),
  constraint invoices_company_payer check (payer_type <> 'company' or company_id is not null)
);
create unique index invoices_number_uq on banquet.invoices (number);
create unique index invoices_token_uq on banquet.invoices (public_token);
create index invoices_request_idx on banquet.invoices (request_id);
create index invoices_open_idx on banquet.invoices (due_date) where status in ('issued', 'partially_paid');
create trigger invoices_touch before update on banquet.invoices
  for each row execute function platform.touch_updated_at();
create trigger invoices_forbid_delete before delete on banquet.invoices
  for each row execute function platform.forbid_delete();

-- Поступления по счёту (онлайн-оплата или банковский перевод). Один платёж — одна запись.
create table banquet.invoice_payments (
  id uuid primary key,
  invoice_id uuid not null references banquet.invoices (id),
  payment_id uuid not null,
  method text not null,
  amount_amount bigint not null check (amount_amount > 0),
  amount_currency char(3) not null default 'KZT',
  refunded_amount bigint not null default 0 check (refunded_amount >= 0),
  refunded_currency char(3) not null default 'KZT',
  document_number text,
  paid_at timestamptz not null,
  recorded_at timestamptz not null,
  recorded_by uuid,
  recorded_by_name text not null,
  constraint invoice_payments_refund_not_exceed check (refunded_amount <= amount_amount)
);
create unique index invoice_payments_payment_uq on banquet.invoice_payments (payment_id);
create index invoice_payments_invoice_idx on banquet.invoice_payments (invoice_id);
create trigger invoice_payments_forbid_delete before delete on banquet.invoice_payments
  for each row execute function platform.forbid_delete();

-- Вторая линия защиты инварианта: сумма поступлений по счёту не больше суммы счёта.
create function banquet.check_invoice_payments_total() returns trigger
language plpgsql as $$
declare
  total bigint;
  limit_amount bigint;
begin
  select coalesce(sum(p.amount_amount), 0) into total from banquet.invoice_payments p where p.invoice_id = new.invoice_id;
  select i.amount_amount into limit_amount from banquet.invoices i where i.id = new.invoice_id;
  if total > limit_amount then
    raise exception 'Invoice % payments (%) exceed invoice amount (%)', new.invoice_id, total, limit_amount
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create constraint trigger invoice_payments_total after insert or update on banquet.invoice_payments
  deferrable initially immediate
  for each row execute function banquet.check_invoice_payments_total();

-- Акт выполненных работ (после проведения банкета) и статус ЭСФ по нему.
create table banquet.acts (
  id uuid primary key,
  request_id uuid not null references banquet.requests (id),
  number text not null,
  branch_id uuid,
  quote_id uuid not null references banquet.quotes (id),
  payer_type text not null check (payer_type in ('individual', 'company')),
  company_id uuid references banquet.client_companies (id),
  buyer jsonb not null,
  seller jsonb not null,
  amount_amount bigint not null check (amount_amount >= 0),
  amount_currency char(3) not null default 'KZT',
  vat_amount bigint not null default 0 check (vat_amount >= 0),
  vat_currency char(3) not null default 'KZT',
  vat_rate_bp integer not null default 0 check (vat_rate_bp >= 0),
  act_date date not null,
  pdf_file_key text not null,
  esf_status text not null check (esf_status in ('not_required', 'pending', 'draft_ready', 'sent', 'registered', 'failed')),
  esf_provider text,
  esf_id text,
  esf_registration_number text,
  esf_error text,
  esf_file_key text,
  esf_updated_at timestamptz,
  created_by uuid,
  created_by_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index acts_number_uq on banquet.acts (number);
create unique index acts_request_uq on banquet.acts (request_id);
create index acts_esf_idx on banquet.acts (esf_status) where esf_status in ('pending', 'sent', 'failed');
create trigger acts_touch before update on banquet.acts
  for each row execute function platform.touch_updated_at();
create trigger acts_forbid_delete before delete on banquet.acts
  for each row execute function platform.forbid_delete();

-- Файлы документов заявки (PDF смет, договоров, счетов, актов; XML ЭСФ). Файлы приватные.
create table banquet.documents (
  id uuid primary key,
  request_id uuid not null references banquet.requests (id),
  kind text not null check (kind in ('quote', 'contract', 'invoice', 'act', 'esf_xml')),
  number text,
  title text not null,
  related_id uuid,
  file_key text not null,
  filename text not null,
  content_type text not null,
  created_by uuid,
  created_by_name text not null,
  created_at timestamptz not null
);
create index documents_request_idx on banquet.documents (request_id, created_at desc);
create index documents_related_idx on banquet.documents (related_id);
