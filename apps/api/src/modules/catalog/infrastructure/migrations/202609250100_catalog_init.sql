-- Catalog: меню (категории, блюда, модификаторы), цены и стоп-лист по филиалам, контент витрины
-- (баннеры, акции, статические страницы).
--
-- Инварианты ТЗ:
--  * цена не хранится в блюде — только в catalog.branch_menu_items (цена и стоп-лист в разрезе филиала);
--  * блюдо есть в меню филиала, только если есть неудалённая строка branch_menu_items;
--  * цена опции модификатора — в тиынах, вместе с валютой.
-- branch_id — ссылка на филиал модуля Identity по значению, без внешнего ключа (модуль выносится отдельно).
-- Поиск: tsvector (ru — конфигурация 'russian', kk/en — 'simple') + pg_trgm по названиям для частичных совпадений.
create schema if not exists catalog;

-- ---------------------------------------------------------------- Категории

create table catalog.categories (
  id uuid primary key,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 80),
  name jsonb not null check (jsonb_typeof(name) = 'object'),
  description jsonb not null default '{}'::jsonb check (jsonb_typeof(description) = 'object'),
  seo_title jsonb not null default '{}'::jsonb check (jsonb_typeof(seo_title) = 'object'),
  seo_description jsonb not null default '{}'::jsonb check (jsonb_typeof(seo_description) = 'object'),
  -- Изображение: { id, variants: [{ width, height, key }] } (webp, публичное хранилище).
  image jsonb check (image is null or jsonb_typeof(image) = 'object'),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index categories_slug_uq on catalog.categories (slug) where deleted_at is null;
create index categories_sort_idx on catalog.categories (sort_order) where deleted_at is null;
create trigger categories_touch before update on catalog.categories
  for each row execute function platform.touch_updated_at();

-- ---------------------------------------------------------------- Блюда (без цены)

create table catalog.dishes (
  id uuid primary key,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 80),
  category_id uuid not null references catalog.categories (id),
  name jsonb not null check (jsonb_typeof(name) = 'object'),
  description jsonb not null default '{}'::jsonb check (jsonb_typeof(description) = 'object'),
  composition jsonb not null default '{}'::jsonb check (jsonb_typeof(composition) = 'object'),
  seo_title jsonb not null default '{}'::jsonb check (jsonb_typeof(seo_title) = 'object'),
  seo_description jsonb not null default '{}'::jsonb check (jsonb_typeof(seo_description) = 'object'),
  weight_grams integer check (weight_grams is null or (weight_grams between 1 and 100000)),
  calories integer check (calories is null or (calories between 0 and 20000)),
  is_vegetarian boolean not null default false,
  spicy_level smallint not null default 0 check (spicy_level between 0 and 3),
  is_halal boolean not null default true,
  allergens text[] not null default '{}'::text[] check (
    allergens <@ array['gluten','milk','eggs','nuts','peanuts','soy','fish','crustaceans','molluscs','sesame',
                       'celery','mustard','sulphites','lupin']::text[]
  ),
  -- Внешний код в POS (общий для сети). Переопределение для филиала — branch_menu_items.sku.
  sku text check (sku is null or (length(sku) between 1 and 64)),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  search_vector tsvector generated always as (
    setweight(to_tsvector('russian'::regconfig, coalesce(name ->> 'ru', '')), 'A') ||
    setweight(to_tsvector('simple'::regconfig, coalesce(name ->> 'kk', '') || ' ' || coalesce(name ->> 'en', '')), 'A') ||
    setweight(to_tsvector('russian'::regconfig, coalesce(composition ->> 'ru', '')), 'B') ||
    setweight(to_tsvector('simple'::regconfig, coalesce(composition ->> 'kk', '') || ' ' || coalesce(composition ->> 'en', '')), 'B') ||
    setweight(to_tsvector('russian'::regconfig, coalesce(description ->> 'ru', '')), 'C') ||
    setweight(to_tsvector('simple'::regconfig, coalesce(description ->> 'kk', '') || ' ' || coalesce(description ->> 'en', '')), 'C')
  ) stored,
  search_text text generated always as (
    lower(coalesce(name ->> 'ru', '') || ' ' || coalesce(name ->> 'kk', '') || ' ' || coalesce(name ->> 'en', ''))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index dishes_slug_uq on catalog.dishes (slug) where deleted_at is null;
create unique index dishes_sku_uq on catalog.dishes (sku) where deleted_at is null and sku is not null;
create index dishes_category_idx on catalog.dishes (category_id, sort_order) where deleted_at is null;
create index dishes_search_idx on catalog.dishes using gin (search_vector);
create index dishes_search_trgm_idx on catalog.dishes using gin (search_text gin_trgm_ops);
create trigger dishes_touch before update on catalog.dishes
  for each row execute function platform.touch_updated_at();

-- Фото блюда: несколько, упорядочены. Варианты webp 1200/600/300 px.
create table catalog.dish_photos (
  id uuid primary key,
  dish_id uuid not null references catalog.dishes (id),
  sort_order integer not null default 0,
  variants jsonb not null check (jsonb_typeof(variants) = 'array'),
  alt jsonb not null default '{}'::jsonb check (jsonb_typeof(alt) = 'object'),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index dish_photos_dish_idx on catalog.dish_photos (dish_id, sort_order) where deleted_at is null;

-- ---------------------------------------------------------------- Модификаторы

create table catalog.modifier_groups (
  id uuid primary key,
  code text not null check (code ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(code) <= 80),
  name jsonb not null check (jsonb_typeof(name) = 'object'),
  description jsonb not null default '{}'::jsonb check (jsonb_typeof(description) = 'object'),
  -- Обязательность: min_select >= 1.
  min_select integer not null default 0 check (min_select >= 0),
  max_select integer not null default 1 check (max_select between 1 and 20),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (min_select <= max_select)
);
create unique index modifier_groups_code_uq on catalog.modifier_groups (code) where deleted_at is null;
create trigger modifier_groups_touch before update on catalog.modifier_groups
  for each row execute function platform.touch_updated_at();

create table catalog.modifier_options (
  id uuid primary key,
  group_id uuid not null references catalog.modifier_groups (id),
  name jsonb not null check (jsonb_typeof(name) = 'object'),
  price_amount bigint not null default 0 check (price_amount >= 0),
  price_currency char(3) not null default 'KZT',
  is_default boolean not null default false,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index modifier_options_group_idx on catalog.modifier_options (group_id, sort_order) where deleted_at is null;
create trigger modifier_options_touch before update on catalog.modifier_options
  for each row execute function platform.touch_updated_at();

-- Связь блюдо <-> группы модификаторов (многие ко многим, упорядочено).
create table catalog.dish_modifier_groups (
  dish_id uuid not null references catalog.dishes (id),
  group_id uuid not null references catalog.modifier_groups (id),
  sort_order integer not null default 0,
  primary key (dish_id, group_id)
);
create index dish_modifier_groups_group_idx on catalog.dish_modifier_groups (group_id);

-- ---------------------------------------------------------------- Меню филиала (BranchDishPrice)

create table catalog.branch_menu_items (
  id uuid primary key,
  branch_id uuid not null,
  dish_id uuid not null references catalog.dishes (id),
  price_amount bigint not null check (price_amount >= 0),
  price_currency char(3) not null default 'KZT',
  -- Стоп-лист: available — в меню и доступно; stopped — в стоп-листе (скрыть/пометить — настройка филиала).
  availability text not null default 'available' check (availability in ('available', 'stopped')),
  stopped_until timestamptz,
  stop_reason text check (stop_reason is null or length(stop_reason) <= 500),
  stop_source text check (stop_source is null or stop_source in ('manual', 'pos')),
  stopped_at timestamptz,
  -- Код блюда в POS этого филиала (если номенклатура точки отличается от сетевой).
  sku text check (sku is null or (length(sku) between 1 and 64)),
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (availability = 'stopped' or (stopped_until is null and stop_reason is null and stop_source is null and stopped_at is null))
);
create unique index branch_menu_items_uq on catalog.branch_menu_items (branch_id, dish_id) where deleted_at is null;
create unique index branch_menu_items_sku_uq on catalog.branch_menu_items (branch_id, sku) where deleted_at is null and sku is not null;
create index branch_menu_items_dish_idx on catalog.branch_menu_items (dish_id) where deleted_at is null;
create index branch_menu_items_restore_idx on catalog.branch_menu_items (stopped_until)
  where deleted_at is null and availability = 'stopped' and stopped_until is not null;
create trigger branch_menu_items_touch before update on catalog.branch_menu_items
  for each row execute function platform.touch_updated_at();

-- ---------------------------------------------------------------- Контент витрины

create table catalog.banners (
  id uuid primary key,
  placement text not null check (placement in ('home_hero', 'home_secondary', 'menu_top')),
  -- null — баннер для всех филиалов.
  branch_id uuid,
  title jsonb not null check (jsonb_typeof(title) = 'object'),
  subtitle jsonb not null default '{}'::jsonb check (jsonb_typeof(subtitle) = 'object'),
  cta_label jsonb not null default '{}'::jsonb check (jsonb_typeof(cta_label) = 'object'),
  link_url text check (link_url is null or length(link_url) <= 1000),
  image jsonb check (image is null or jsonb_typeof(image) = 'object'),
  active_from timestamptz,
  active_to timestamptz,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (active_from is null or active_to is null or active_to > active_from)
);
create index banners_placement_idx on catalog.banners (placement, sort_order) where deleted_at is null;
create trigger banners_touch before update on catalog.banners
  for each row execute function platform.touch_updated_at();

create table catalog.promotions (
  id uuid primary key,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 80),
  title jsonb not null check (jsonb_typeof(title) = 'object'),
  description jsonb not null default '{}'::jsonb check (jsonb_typeof(description) = 'object'),
  terms jsonb not null default '{}'::jsonb check (jsonb_typeof(terms) = 'object'),
  seo_title jsonb not null default '{}'::jsonb check (jsonb_typeof(seo_title) = 'object'),
  seo_description jsonb not null default '{}'::jsonb check (jsonb_typeof(seo_description) = 'object'),
  image jsonb check (image is null or jsonb_typeof(image) = 'object'),
  valid_from timestamptz,
  valid_to timestamptz,
  -- Пустой массив — акция во всех филиалах.
  branch_ids uuid[] not null default '{}'::uuid[],
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (valid_from is null or valid_to is null or valid_to > valid_from)
);
create unique index promotions_slug_uq on catalog.promotions (slug) where deleted_at is null;
create trigger promotions_touch before update on catalog.promotions
  for each row execute function platform.touch_updated_at();

-- Статические страницы: о нас, доставка, оплата, публичная оферта, политика конфиденциальности, контакты.
-- body — санитизированный HTML по языкам.
create table catalog.pages (
  id uuid primary key,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 80),
  title jsonb not null check (jsonb_typeof(title) = 'object'),
  body jsonb not null default '{}'::jsonb check (jsonb_typeof(body) = 'object'),
  seo_title jsonb not null default '{}'::jsonb check (jsonb_typeof(seo_title) = 'object'),
  seo_description jsonb not null default '{}'::jsonb check (jsonb_typeof(seo_description) = 'object'),
  is_published boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index pages_slug_uq on catalog.pages (slug) where deleted_at is null;
create trigger pages_touch before update on catalog.pages
  for each row execute function platform.touch_updated_at();
