# Схема базы данных AULA

Документ сгенерирован командой `pnpm --filter @aula/api db:schema-doc` по базе после применения всех миграций.
Не редактировать вручную. Каждый модуль владеет своей схемой PostgreSQL и не обращается к таблицам других модулей;
внешних ключей между схемами нет (модуль можно вынести в отдельный сервис). Деньги — `*_amount bigint` (тиыны) + `*_currency`;
время — `timestamptz` (UTC); переводимые поля — `jsonb` `{kk, ru, en}`; физическое удаление заказов, платежей и броней запрещено триггером.

## Миграции

| Файл | Модуль |
| --- | --- |
| 202609250000_platform_init.sql | platform |
| 202609250010_identity_init.sql | identity |
| 202609250100_catalog_init.sql | catalog |
| 202609250200_ordering_init.sql | ordering |
| 202609250300_reservation_init.sql | reservation |
| 202609250400_banquet_init.sql | banquet |
| 202609250500_payments_init.sql | payments |
| 202609250600_customers_init.sql | customers |
| 202609250700_notifications_init.sql | notifications |
| 202609250800_reporting_init.sql | reporting |
| 202609250900_pos_init.sql | pos |
| 202609250901_pos_order_confirmation.sql | pos |
| 202609260000_reporting_certificate_credits.sql | reporting |

## Схема `platform` — Платформа (outbox, аудит, интеграции, нумерация)

### `platform.audit_log`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| occurred_at | timestamp with time zone | нет | `now()` |
| actor_kind | text | нет |  |
| actor_user_id | uuid | да |  |
| actor_name | text | нет |  |
| action | text | нет |  |
| entity_type | text | нет |  |
| entity_id | text | нет |  |
| branch_id | uuid | да |  |
| before | jsonb | да |  |
| after | jsonb | да |  |
| meta | jsonb | нет | `'{}'::jsonb` |
| ip | inet | да |  |
| request_id | text | да |  |

Ограничения:

- CHECK `audit_log_actor_kind_check`: `CHECK ((actor_kind = ANY (ARRAY['staff'::text, 'system'::text, 'guest'::text])))`
- PRIMARY KEY `audit_log_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE INDEX audit_log_action_idx ON platform.audit_log USING btree (action, occurred_at DESC)`
- `CREATE INDEX audit_log_actor_idx ON platform.audit_log USING btree (actor_user_id, occurred_at DESC)`
- `CREATE INDEX audit_log_branch_idx ON platform.audit_log USING btree (branch_id, occurred_at DESC)`
- `CREATE INDEX audit_log_entity_idx ON platform.audit_log USING btree (entity_type, entity_id)`
- `CREATE INDEX audit_log_time_idx ON platform.audit_log USING btree (occurred_at DESC)`

Триггеры:

- `CREATE TRIGGER audit_log_append_only BEFORE DELETE OR UPDATE ON platform.audit_log FOR EACH ROW EXECUTE FUNCTION platform.forbid_update_delete()`

### `platform.failed_jobs`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| kind | text | нет |  |
| topic | text | нет |  |
| handler | text | да |  |
| payload | jsonb | нет |  |
| error | text | нет |  |
| attempts | integer | нет |  |
| failed_at | timestamp with time zone | нет | `now()` |
| retried_at | timestamp with time zone | да |  |
| resolved_at | timestamp with time zone | да |  |
| resolved_by | uuid | да |  |

Ограничения:

- PRIMARY KEY `failed_jobs_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE INDEX failed_jobs_open_idx ON platform.failed_jobs USING btree (failed_at DESC) WHERE (resolved_at IS NULL)`

### `platform.idempotency_keys`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| key | text | нет |  |
| created_at | timestamp with time zone | нет | `now()` |

Ограничения:

- PRIMARY KEY `idempotency_keys_pkey`: `PRIMARY KEY (key)`

### `platform.integration_logs`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| occurred_at | timestamp with time zone | нет | `now()` |
| integration | text | нет |  |
| direction | text | нет |  |
| operation | text | нет |  |
| correlation_id | text | да |  |
| request | jsonb | да |  |
| response | jsonb | да |  |
| status_code | integer | да |  |
| success | boolean | нет |  |
| duration_ms | integer | да |  |
| error | text | да |  |

Ограничения:

- CHECK `integration_logs_direction_check`: `CHECK ((direction = ANY (ARRAY['outbound'::text, 'inbound'::text])))`
- PRIMARY KEY `integration_logs_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE INDEX integration_logs_corr_idx ON platform.integration_logs USING btree (correlation_id)`
- `CREATE INDEX integration_logs_idx ON platform.integration_logs USING btree (integration, occurred_at DESC)`

### `platform.integration_settings`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| key | text | нет |  |
| enabled | boolean | нет | `false` |
| config | jsonb | нет | `'{}'::jsonb` |
| secrets_encrypted | text | да |  |
| updated_at | timestamp with time zone | нет | `now()` |
| updated_by | uuid | да |  |

Ограничения:

- PRIMARY KEY `integration_settings_pkey`: `PRIMARY KEY (key)`

### `platform.number_sequences`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| scope | text | нет |  |
| branch_id | uuid | нет |  |
| year | integer | нет |  |
| last_value | bigint | нет | `0` |

Ограничения:

- PRIMARY KEY `number_sequences_pkey`: `PRIMARY KEY (scope, branch_id, year)`

### `platform.outbox`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| kind | text | нет |  |
| topic | text | нет |  |
| payload | jsonb | нет |  |
| meta | jsonb | нет | `'{}'::jsonb` |
| available_at | timestamp with time zone | нет | `now()` |
| created_at | timestamp with time zone | нет | `now()` |
| dispatched_at | timestamp with time zone | да |  |
| attempts | integer | нет | `0` |
| last_error | text | да |  |

Ограничения:

- CHECK `outbox_kind_check`: `CHECK ((kind = ANY (ARRAY['event'::text, 'job'::text])))`
- PRIMARY KEY `outbox_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE INDEX outbox_pending_idx ON platform.outbox USING btree (available_at) WHERE (dispatched_at IS NULL)`

Триггеры:

- `CREATE TRIGGER outbox_notify AFTER INSERT ON platform.outbox FOR EACH ROW EXECUTE FUNCTION platform.notify_outbox()`

### `platform.schema_migrations`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | text | нет |  |
| module | text | нет |  |
| checksum | text | нет |  |
| applied_at | timestamp with time zone | нет | `now()` |

Ограничения:

- PRIMARY KEY `schema_migrations_pkey`: `PRIMARY KEY (id)`

## Схема `identity` — Identity — филиалы, юрлица, пользователи, роли

### `identity.branches`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| code | text | нет |  |
| slug | text | нет |  |
| name | jsonb | нет |  |
| address | jsonb | нет |  |
| lat | double precision | нет |  |
| lng | double precision | нет |  |
| phone | text | нет |  |
| whatsapp | text | да |  |
| email | text | да |  |
| timezone | text | нет | `'Asia/Almaty'::text` |
| opening_hours | jsonb | нет | `'{}'::jsonb` |
| settings | jsonb | нет | `'{}'::jsonb` |
| legal_entity_id | uuid | да |  |
| is_active | boolean | нет | `true` |
| sort_order | integer | нет | `0` |
| created_at | timestamp with time zone | нет | `now()` |
| updated_at | timestamp with time zone | нет | `now()` |
| deleted_at | timestamp with time zone | да |  |

Ограничения:

- CHECK `branches_code_check`: `CHECK ((code ~ '^[A-Z0-9]{1,6}$'::text))`
- CHECK `branches_slug_check`: `CHECK ((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text))`
- FOREIGN KEY `branches_legal_entity_id_fkey`: `FOREIGN KEY (legal_entity_id) REFERENCES identity.legal_entities(id)`
- PRIMARY KEY `branches_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE UNIQUE INDEX branches_code_uq ON identity.branches USING btree (code) WHERE (deleted_at IS NULL)`
- `CREATE UNIQUE INDEX branches_slug_uq ON identity.branches USING btree (slug) WHERE (deleted_at IS NULL)`

Триггеры:

- `CREATE TRIGGER branches_touch BEFORE UPDATE ON identity.branches FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at()`

### `identity.legal_entities`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| name | text | нет |  |
| short_name | text | нет |  |
| bin | character(12) | нет |  |
| legal_address | text | нет |  |
| actual_address | text | да |  |
| director_name | text | нет |  |
| director_position | text | нет | `'Директор'::text` |
| acting_basis | text | нет | `'Устава'::text` |
| bank_name | text | нет | `''::text` |
| iban | text | нет | `''::text` |
| bik | text | нет | `''::text` |
| kbe | text | нет | `'17'::text` |
| vat_payer | boolean | нет | `false` |
| vat_rate_bp | integer | нет | `0` |
| vat_certificate | text | да |  |
| phone | text | да |  |
| email | text | да |  |
| is_default | boolean | нет | `false` |
| created_at | timestamp with time zone | нет | `now()` |
| updated_at | timestamp with time zone | нет | `now()` |

Ограничения:

- CHECK `legal_entities_bin_check`: `CHECK ((bin ~ '^\d{12}$'::text))`
- CHECK `legal_entities_vat_rate_bp_check`: `CHECK (((vat_rate_bp >= 0) AND (vat_rate_bp <= 10000)))`
- PRIMARY KEY `legal_entities_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE UNIQUE INDEX legal_entities_bin_uq ON identity.legal_entities USING btree (bin)`
- `CREATE UNIQUE INDEX legal_entities_default_uq ON identity.legal_entities USING btree (is_default) WHERE is_default`

Триггеры:

- `CREATE TRIGGER legal_entities_touch BEFORE UPDATE ON identity.legal_entities FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at()`

### `identity.refresh_tokens`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| user_id | uuid | нет |  |
| token_hash | text | нет |  |
| expires_at | timestamp with time zone | нет |  |
| created_at | timestamp with time zone | нет | `now()` |
| revoked_at | timestamp with time zone | да |  |
| replaced_by | uuid | да |  |
| user_agent | text | да |  |
| ip | inet | да |  |

Ограничения:

- FOREIGN KEY `refresh_tokens_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES identity.users(id)`
- PRIMARY KEY `refresh_tokens_pkey`: `PRIMARY KEY (id)`
- UNIQUE `refresh_tokens_token_hash_key`: `UNIQUE (token_hash)`

Индексы:

- `CREATE INDEX refresh_tokens_user_idx ON identity.refresh_tokens USING btree (user_id) WHERE (revoked_at IS NULL)`

### `identity.user_roles`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| user_id | uuid | нет |  |
| role | text | нет |  |
| branch_id | uuid | да |  |
| created_at | timestamp with time zone | нет | `now()` |

Ограничения:

- CHECK `user_roles_role_check`: `CHECK ((role = ANY (ARRAY['branch_operator'::text, 'banquet_manager'::text, 'branch_manager'::text, 'content_manager'::text, 'finance'::text, 'owner'::text, 'sysadmin'::text])))`
- FOREIGN KEY `user_roles_branch_id_fkey`: `FOREIGN KEY (branch_id) REFERENCES identity.branches(id)`
- FOREIGN KEY `user_roles_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES identity.users(id)`
- PRIMARY KEY `user_roles_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE INDEX user_roles_role_idx ON identity.user_roles USING btree (role, branch_id)`
- `CREATE UNIQUE INDEX user_roles_uq ON identity.user_roles USING btree (user_id, role, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid))`

### `identity.users`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| email | citext | нет |  |
| name | text | нет |  |
| phone | text | да |  |
| telegram_chat_id | text | да |  |
| password_hash | text | нет |  |
| is_active | boolean | нет | `true` |
| must_change_password | boolean | нет | `false` |
| failed_login_count | integer | нет | `0` |
| locked_until | timestamp with time zone | да |  |
| last_login_at | timestamp with time zone | да |  |
| created_at | timestamp with time zone | нет | `now()` |
| updated_at | timestamp with time zone | нет | `now()` |
| deleted_at | timestamp with time zone | да |  |

Ограничения:

- PRIMARY KEY `users_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE UNIQUE INDEX users_email_uq ON identity.users USING btree (email) WHERE (deleted_at IS NULL)`

Триггеры:

- `CREATE TRIGGER users_touch BEFORE UPDATE ON identity.users FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at()`

## Схема `catalog` — Catalog — меню, цены по филиалам, стоп-лист, контент

### `catalog.banners`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| placement | text | нет |  |
| branch_id | uuid | да |  |
| title | jsonb | нет |  |
| subtitle | jsonb | нет | `'{}'::jsonb` |
| cta_label | jsonb | нет | `'{}'::jsonb` |
| link_url | text | да |  |
| image | jsonb | да |  |
| active_from | timestamp with time zone | да |  |
| active_to | timestamp with time zone | да |  |
| sort_order | integer | нет | `0` |
| is_active | boolean | нет | `true` |
| created_at | timestamp with time zone | нет | `now()` |
| updated_at | timestamp with time zone | нет | `now()` |
| deleted_at | timestamp with time zone | да |  |

Ограничения:

- CHECK `banners_check`: `CHECK (((active_from IS NULL) OR (active_to IS NULL) OR (active_to > active_from)))`
- CHECK `banners_cta_label_check`: `CHECK ((jsonb_typeof(cta_label) = 'object'::text))`
- CHECK `banners_image_check`: `CHECK (((image IS NULL) OR (jsonb_typeof(image) = 'object'::text)))`
- CHECK `banners_link_url_check`: `CHECK (((link_url IS NULL) OR (length(link_url) <= 1000)))`
- CHECK `banners_placement_check`: `CHECK ((placement = ANY (ARRAY['home_hero'::text, 'home_secondary'::text, 'menu_top'::text])))`
- CHECK `banners_subtitle_check`: `CHECK ((jsonb_typeof(subtitle) = 'object'::text))`
- CHECK `banners_title_check`: `CHECK ((jsonb_typeof(title) = 'object'::text))`
- PRIMARY KEY `banners_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE INDEX banners_placement_idx ON catalog.banners USING btree (placement, sort_order) WHERE (deleted_at IS NULL)`

Триггеры:

- `CREATE TRIGGER banners_touch BEFORE UPDATE ON catalog.banners FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at()`

### `catalog.branch_menu_items`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| branch_id | uuid | нет |  |
| dish_id | uuid | нет |  |
| price_amount | bigint | нет |  |
| price_currency | character(3) | нет | `'KZT'::bpchar` |
| availability | text | нет | `'available'::text` |
| stopped_until | timestamp with time zone | да |  |
| stop_reason | text | да |  |
| stop_source | text | да |  |
| stopped_at | timestamp with time zone | да |  |
| sku | text | да |  |
| updated_by | uuid | да |  |
| created_at | timestamp with time zone | нет | `now()` |
| updated_at | timestamp with time zone | нет | `now()` |
| deleted_at | timestamp with time zone | да |  |

Ограничения:

- CHECK `branch_menu_items_availability_check`: `CHECK ((availability = ANY (ARRAY['available'::text, 'stopped'::text])))`
- CHECK `branch_menu_items_check`: `CHECK (((availability = 'stopped'::text) OR ((stopped_until IS NULL) AND (stop_reason IS NULL) AND (stop_source IS NULL) AND (stopped_at IS NULL))))`
- CHECK `branch_menu_items_price_amount_check`: `CHECK ((price_amount >= 0))`
- CHECK `branch_menu_items_sku_check`: `CHECK (((sku IS NULL) OR ((length(sku) >= 1) AND (length(sku) <= 64))))`
- CHECK `branch_menu_items_stop_reason_check`: `CHECK (((stop_reason IS NULL) OR (length(stop_reason) <= 500)))`
- CHECK `branch_menu_items_stop_source_check`: `CHECK (((stop_source IS NULL) OR (stop_source = ANY (ARRAY['manual'::text, 'pos'::text]))))`
- FOREIGN KEY `branch_menu_items_dish_id_fkey`: `FOREIGN KEY (dish_id) REFERENCES catalog.dishes(id)`
- PRIMARY KEY `branch_menu_items_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE INDEX branch_menu_items_dish_idx ON catalog.branch_menu_items USING btree (dish_id) WHERE (deleted_at IS NULL)`
- `CREATE INDEX branch_menu_items_restore_idx ON catalog.branch_menu_items USING btree (stopped_until) WHERE ((deleted_at IS NULL) AND (availability = 'stopped'::text) AND (stopped_until IS NOT NULL))`
- `CREATE UNIQUE INDEX branch_menu_items_sku_uq ON catalog.branch_menu_items USING btree (branch_id, sku) WHERE ((deleted_at IS NULL) AND (sku IS NOT NULL))`
- `CREATE UNIQUE INDEX branch_menu_items_uq ON catalog.branch_menu_items USING btree (branch_id, dish_id) WHERE (deleted_at IS NULL)`

Триггеры:

- `CREATE TRIGGER branch_menu_items_touch BEFORE UPDATE ON catalog.branch_menu_items FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at()`

### `catalog.categories`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| slug | text | нет |  |
| name | jsonb | нет |  |
| description | jsonb | нет | `'{}'::jsonb` |
| seo_title | jsonb | нет | `'{}'::jsonb` |
| seo_description | jsonb | нет | `'{}'::jsonb` |
| image | jsonb | да |  |
| sort_order | integer | нет | `0` |
| is_active | boolean | нет | `true` |
| created_at | timestamp with time zone | нет | `now()` |
| updated_at | timestamp with time zone | нет | `now()` |
| deleted_at | timestamp with time zone | да |  |

Ограничения:

- CHECK `categories_description_check`: `CHECK ((jsonb_typeof(description) = 'object'::text))`
- CHECK `categories_image_check`: `CHECK (((image IS NULL) OR (jsonb_typeof(image) = 'object'::text)))`
- CHECK `categories_name_check`: `CHECK ((jsonb_typeof(name) = 'object'::text))`
- CHECK `categories_seo_description_check`: `CHECK ((jsonb_typeof(seo_description) = 'object'::text))`
- CHECK `categories_seo_title_check`: `CHECK ((jsonb_typeof(seo_title) = 'object'::text))`
- CHECK `categories_slug_check`: `CHECK (((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text) AND (length(slug) <= 80)))`
- PRIMARY KEY `categories_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE UNIQUE INDEX categories_slug_uq ON catalog.categories USING btree (slug) WHERE (deleted_at IS NULL)`
- `CREATE INDEX categories_sort_idx ON catalog.categories USING btree (sort_order) WHERE (deleted_at IS NULL)`

Триггеры:

- `CREATE TRIGGER categories_touch BEFORE UPDATE ON catalog.categories FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at()`

### `catalog.dish_modifier_groups`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| dish_id | uuid | нет |  |
| group_id | uuid | нет |  |
| sort_order | integer | нет | `0` |

Ограничения:

- FOREIGN KEY `dish_modifier_groups_dish_id_fkey`: `FOREIGN KEY (dish_id) REFERENCES catalog.dishes(id)`
- FOREIGN KEY `dish_modifier_groups_group_id_fkey`: `FOREIGN KEY (group_id) REFERENCES catalog.modifier_groups(id)`
- PRIMARY KEY `dish_modifier_groups_pkey`: `PRIMARY KEY (dish_id, group_id)`

Индексы:

- `CREATE INDEX dish_modifier_groups_group_idx ON catalog.dish_modifier_groups USING btree (group_id)`

### `catalog.dish_photos`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| dish_id | uuid | нет |  |
| sort_order | integer | нет | `0` |
| variants | jsonb | нет |  |
| alt | jsonb | нет | `'{}'::jsonb` |
| created_at | timestamp with time zone | нет | `now()` |
| deleted_at | timestamp with time zone | да |  |

Ограничения:

- CHECK `dish_photos_alt_check`: `CHECK ((jsonb_typeof(alt) = 'object'::text))`
- CHECK `dish_photos_variants_check`: `CHECK ((jsonb_typeof(variants) = 'array'::text))`
- FOREIGN KEY `dish_photos_dish_id_fkey`: `FOREIGN KEY (dish_id) REFERENCES catalog.dishes(id)`
- PRIMARY KEY `dish_photos_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE INDEX dish_photos_dish_idx ON catalog.dish_photos USING btree (dish_id, sort_order) WHERE (deleted_at IS NULL)`

### `catalog.dishes`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| slug | text | нет |  |
| category_id | uuid | нет |  |
| name | jsonb | нет |  |
| description | jsonb | нет | `'{}'::jsonb` |
| composition | jsonb | нет | `'{}'::jsonb` |
| seo_title | jsonb | нет | `'{}'::jsonb` |
| seo_description | jsonb | нет | `'{}'::jsonb` |
| weight_grams | integer | да |  |
| calories | integer | да |  |
| is_vegetarian | boolean | нет | `false` |
| spicy_level | smallint | нет | `0` |
| is_halal | boolean | нет | `true` |
| allergens | _text | нет | `'{}'::text[]` |
| sku | text | да |  |
| sort_order | integer | нет | `0` |
| is_active | boolean | нет | `true` |
| search_vector | tsvector | да |  |
| search_text | text | да |  |
| created_at | timestamp with time zone | нет | `now()` |
| updated_at | timestamp with time zone | нет | `now()` |
| deleted_at | timestamp with time zone | да |  |

Ограничения:

- CHECK `dishes_allergens_check`: `CHECK ((allergens <@ ARRAY['gluten'::text, 'milk'::text, 'eggs'::text, 'nuts'::text, 'peanuts'::text, 'soy'::text, 'fish'::text, 'crustaceans'::text, 'molluscs'::text, 'sesame'::text, 'celery'::text, 'mustard'::text, 'sulphites'::text, 'lupin'::text]))`
- CHECK `dishes_calories_check`: `CHECK (((calories IS NULL) OR ((calories >= 0) AND (calories <= 20000))))`
- CHECK `dishes_composition_check`: `CHECK ((jsonb_typeof(composition) = 'object'::text))`
- CHECK `dishes_description_check`: `CHECK ((jsonb_typeof(description) = 'object'::text))`
- CHECK `dishes_name_check`: `CHECK ((jsonb_typeof(name) = 'object'::text))`
- CHECK `dishes_seo_description_check`: `CHECK ((jsonb_typeof(seo_description) = 'object'::text))`
- CHECK `dishes_seo_title_check`: `CHECK ((jsonb_typeof(seo_title) = 'object'::text))`
- CHECK `dishes_sku_check`: `CHECK (((sku IS NULL) OR ((length(sku) >= 1) AND (length(sku) <= 64))))`
- CHECK `dishes_slug_check`: `CHECK (((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text) AND (length(slug) <= 80)))`
- CHECK `dishes_spicy_level_check`: `CHECK (((spicy_level >= 0) AND (spicy_level <= 3)))`
- CHECK `dishes_weight_grams_check`: `CHECK (((weight_grams IS NULL) OR ((weight_grams >= 1) AND (weight_grams <= 100000))))`
- FOREIGN KEY `dishes_category_id_fkey`: `FOREIGN KEY (category_id) REFERENCES catalog.categories(id)`
- PRIMARY KEY `dishes_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE INDEX dishes_category_idx ON catalog.dishes USING btree (category_id, sort_order) WHERE (deleted_at IS NULL)`
- `CREATE INDEX dishes_search_idx ON catalog.dishes USING gin (search_vector)`
- `CREATE INDEX dishes_search_trgm_idx ON catalog.dishes USING gin (search_text gin_trgm_ops)`
- `CREATE UNIQUE INDEX dishes_sku_uq ON catalog.dishes USING btree (sku) WHERE ((deleted_at IS NULL) AND (sku IS NOT NULL))`
- `CREATE UNIQUE INDEX dishes_slug_uq ON catalog.dishes USING btree (slug) WHERE (deleted_at IS NULL)`

Триггеры:

- `CREATE TRIGGER dishes_touch BEFORE UPDATE ON catalog.dishes FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at()`

### `catalog.modifier_groups`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| code | text | нет |  |
| name | jsonb | нет |  |
| description | jsonb | нет | `'{}'::jsonb` |
| min_select | integer | нет | `0` |
| max_select | integer | нет | `1` |
| sort_order | integer | нет | `0` |
| is_active | boolean | нет | `true` |
| created_at | timestamp with time zone | нет | `now()` |
| updated_at | timestamp with time zone | нет | `now()` |
| deleted_at | timestamp with time zone | да |  |

Ограничения:

- CHECK `modifier_groups_check`: `CHECK ((min_select <= max_select))`
- CHECK `modifier_groups_code_check`: `CHECK (((code ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text) AND (length(code) <= 80)))`
- CHECK `modifier_groups_description_check`: `CHECK ((jsonb_typeof(description) = 'object'::text))`
- CHECK `modifier_groups_max_select_check`: `CHECK (((max_select >= 1) AND (max_select <= 20)))`
- CHECK `modifier_groups_min_select_check`: `CHECK ((min_select >= 0))`
- CHECK `modifier_groups_name_check`: `CHECK ((jsonb_typeof(name) = 'object'::text))`
- PRIMARY KEY `modifier_groups_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE UNIQUE INDEX modifier_groups_code_uq ON catalog.modifier_groups USING btree (code) WHERE (deleted_at IS NULL)`

Триггеры:

- `CREATE TRIGGER modifier_groups_touch BEFORE UPDATE ON catalog.modifier_groups FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at()`

### `catalog.modifier_options`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| group_id | uuid | нет |  |
| name | jsonb | нет |  |
| price_amount | bigint | нет | `0` |
| price_currency | character(3) | нет | `'KZT'::bpchar` |
| is_default | boolean | нет | `false` |
| sort_order | integer | нет | `0` |
| is_active | boolean | нет | `true` |
| created_at | timestamp with time zone | нет | `now()` |
| updated_at | timestamp with time zone | нет | `now()` |
| deleted_at | timestamp with time zone | да |  |

Ограничения:

- CHECK `modifier_options_name_check`: `CHECK ((jsonb_typeof(name) = 'object'::text))`
- CHECK `modifier_options_price_amount_check`: `CHECK ((price_amount >= 0))`
- FOREIGN KEY `modifier_options_group_id_fkey`: `FOREIGN KEY (group_id) REFERENCES catalog.modifier_groups(id)`
- PRIMARY KEY `modifier_options_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE INDEX modifier_options_group_idx ON catalog.modifier_options USING btree (group_id, sort_order) WHERE (deleted_at IS NULL)`

Триггеры:

- `CREATE TRIGGER modifier_options_touch BEFORE UPDATE ON catalog.modifier_options FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at()`

### `catalog.pages`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| slug | text | нет |  |
| title | jsonb | нет |  |
| body | jsonb | нет | `'{}'::jsonb` |
| seo_title | jsonb | нет | `'{}'::jsonb` |
| seo_description | jsonb | нет | `'{}'::jsonb` |
| is_published | boolean | нет | `true` |
| sort_order | integer | нет | `0` |
| created_at | timestamp with time zone | нет | `now()` |
| updated_at | timestamp with time zone | нет | `now()` |
| deleted_at | timestamp with time zone | да |  |

Ограничения:

- CHECK `pages_body_check`: `CHECK ((jsonb_typeof(body) = 'object'::text))`
- CHECK `pages_seo_description_check`: `CHECK ((jsonb_typeof(seo_description) = 'object'::text))`
- CHECK `pages_seo_title_check`: `CHECK ((jsonb_typeof(seo_title) = 'object'::text))`
- CHECK `pages_slug_check`: `CHECK (((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text) AND (length(slug) <= 80)))`
- CHECK `pages_title_check`: `CHECK ((jsonb_typeof(title) = 'object'::text))`
- PRIMARY KEY `pages_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE UNIQUE INDEX pages_slug_uq ON catalog.pages USING btree (slug) WHERE (deleted_at IS NULL)`

Триггеры:

- `CREATE TRIGGER pages_touch BEFORE UPDATE ON catalog.pages FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at()`

### `catalog.promotions`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| slug | text | нет |  |
| title | jsonb | нет |  |
| description | jsonb | нет | `'{}'::jsonb` |
| terms | jsonb | нет | `'{}'::jsonb` |
| seo_title | jsonb | нет | `'{}'::jsonb` |
| seo_description | jsonb | нет | `'{}'::jsonb` |
| image | jsonb | да |  |
| valid_from | timestamp with time zone | да |  |
| valid_to | timestamp with time zone | да |  |
| branch_ids | _uuid | нет | `'{}'::uuid[]` |
| sort_order | integer | нет | `0` |
| is_active | boolean | нет | `true` |
| created_at | timestamp with time zone | нет | `now()` |
| updated_at | timestamp with time zone | нет | `now()` |
| deleted_at | timestamp with time zone | да |  |

Ограничения:

- CHECK `promotions_check`: `CHECK (((valid_from IS NULL) OR (valid_to IS NULL) OR (valid_to > valid_from)))`
- CHECK `promotions_description_check`: `CHECK ((jsonb_typeof(description) = 'object'::text))`
- CHECK `promotions_image_check`: `CHECK (((image IS NULL) OR (jsonb_typeof(image) = 'object'::text)))`
- CHECK `promotions_seo_description_check`: `CHECK ((jsonb_typeof(seo_description) = 'object'::text))`
- CHECK `promotions_seo_title_check`: `CHECK ((jsonb_typeof(seo_title) = 'object'::text))`
- CHECK `promotions_slug_check`: `CHECK (((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text) AND (length(slug) <= 80)))`
- CHECK `promotions_terms_check`: `CHECK ((jsonb_typeof(terms) = 'object'::text))`
- CHECK `promotions_title_check`: `CHECK ((jsonb_typeof(title) = 'object'::text))`
- PRIMARY KEY `promotions_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE UNIQUE INDEX promotions_slug_uq ON catalog.promotions USING btree (slug) WHERE (deleted_at IS NULL)`

Триггеры:

- `CREATE TRIGGER promotions_touch BEFORE UPDATE ON catalog.promotions FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at()`

## Схема `ordering` — Ordering — заказы, зоны доставки, промокоды, курьеры

### `ordering.courier_dispatches`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| order_id | uuid | нет |  |
| branch_id | uuid | нет |  |
| provider | text | нет |  |
| status | text | нет |  |
| provider_status | text | да |  |
| external_id | text | да |  |
| tracking_url | text | да |  |
| courier_name | text | да |  |
| courier_phone | text | да |  |
| price_amount | bigint | да |  |
| price_currency | character(3) | нет | `'KZT'::bpchar` |
| attempts | integer | нет | `0` |
| polls | integer | нет | `0` |
| last_error | text | да |  |
| requested_at | timestamp with time zone | нет |  |
| finished_at | timestamp with time zone | да |  |
| created_at | timestamp with time zone | нет | `now()` |
| updated_at | timestamp with time zone | нет | `now()` |

Ограничения:

- CHECK `courier_dispatches_status_check`: `CHECK ((status = ANY (ARRAY['requested'::text, 'estimating'::text, 'awaiting_confirmation'::text, 'searching'::text, 'courier_assigned'::text, 'picked_up'::text, 'delivered'::text, 'cancelled'::text, 'failed'::text])))`
- FOREIGN KEY `courier_dispatches_order_id_fkey`: `FOREIGN KEY (order_id) REFERENCES ordering.orders(id)`
- PRIMARY KEY `courier_dispatches_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE UNIQUE INDEX courier_dispatches_active_uq ON ordering.courier_dispatches USING btree (order_id) WHERE (status <> ALL (ARRAY['delivered'::text, 'cancelled'::text, 'failed'::text]))`
- `CREATE INDEX courier_dispatches_order_idx ON ordering.courier_dispatches USING btree (order_id, requested_at DESC)`

Триггеры:

- `CREATE TRIGGER courier_dispatches_touch BEFORE UPDATE ON ordering.courier_dispatches FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at()`

### `ordering.delivery_zones`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| branch_id | uuid | нет |  |
| name | jsonb | нет |  |
| polygon | jsonb | нет |  |
| min_order_amount | bigint | нет |  |
| min_order_currency | character(3) | нет | `'KZT'::bpchar` |
| delivery_fee_amount | bigint | нет |  |
| delivery_fee_currency | character(3) | нет | `'KZT'::bpchar` |
| free_delivery_from_amount | bigint | да |  |
| free_delivery_from_currency | character(3) | нет | `'KZT'::bpchar` |
| eta_minutes | integer | нет |  |
| is_active | boolean | нет | `true` |
| sort_order | integer | нет | `0` |
| created_at | timestamp with time zone | нет | `now()` |
| updated_at | timestamp with time zone | нет | `now()` |
| deleted_at | timestamp with time zone | да |  |

Ограничения:

- CHECK `delivery_zones_delivery_fee_amount_check`: `CHECK ((delivery_fee_amount >= 0))`
- CHECK `delivery_zones_eta_minutes_check`: `CHECK (((eta_minutes >= 1) AND (eta_minutes <= 600)))`
- CHECK `delivery_zones_free_delivery_from_amount_check`: `CHECK (((free_delivery_from_amount IS NULL) OR (free_delivery_from_amount >= 0)))`
- CHECK `delivery_zones_min_order_amount_check`: `CHECK ((min_order_amount >= 0))`
- PRIMARY KEY `delivery_zones_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE INDEX delivery_zones_branch_idx ON ordering.delivery_zones USING btree (branch_id, sort_order) WHERE (deleted_at IS NULL)`

Триггеры:

- `CREATE TRIGGER delivery_zones_touch BEFORE UPDATE ON ordering.delivery_zones FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at()`

### `ordering.order_items`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| order_id | uuid | нет |  |
| position | integer | нет |  |
| dish_id | uuid | нет |  |
| dish_slug | text | нет |  |
| category_id | text | да |  |
| sku | text | да |  |
| name | jsonb | нет |  |
| photo_url | text | да |  |
| weight_grams | integer | да |  |
| quantity | integer | нет |  |
| base_price_amount | bigint | нет |  |
| base_price_currency | character(3) | нет | `'KZT'::bpchar` |
| unit_price_amount | bigint | нет |  |
| unit_price_currency | character(3) | нет | `'KZT'::bpchar` |
| line_total_amount | bigint | нет |  |
| line_total_currency | character(3) | нет | `'KZT'::bpchar` |
| modifiers | jsonb | нет | `'[]'::jsonb` |
| created_at | timestamp with time zone | нет | `now()` |

Ограничения:

- CHECK `order_items_base_price_amount_check`: `CHECK ((base_price_amount >= 0))`
- CHECK `order_items_line_total_amount_check`: `CHECK ((line_total_amount >= 0))`
- CHECK `order_items_quantity_check`: `CHECK (((quantity >= 1) AND (quantity <= 99)))`
- CHECK `order_items_unit_price_amount_check`: `CHECK ((unit_price_amount >= 0))`
- FOREIGN KEY `order_items_order_id_fkey`: `FOREIGN KEY (order_id) REFERENCES ordering.orders(id)`
- PRIMARY KEY `order_items_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE INDEX order_items_dish_idx ON ordering.order_items USING btree (dish_id)`
- `CREATE UNIQUE INDEX order_items_position_uq ON ordering.order_items USING btree (order_id, "position")`

Триггеры:

- `CREATE TRIGGER order_items_forbid_delete BEFORE DELETE ON ordering.order_items FOR EACH ROW EXECUTE FUNCTION platform.forbid_delete()`

### `ordering.order_payments`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| payment_id | uuid | нет |  |
| order_id | uuid | нет |  |
| kind | text | нет |  |
| attempt | integer | нет | `1` |
| amount_amount | bigint | нет |  |
| amount_currency | character(3) | нет | `'KZT'::bpchar` |
| created_at | timestamp with time zone | нет | `now()` |

Ограничения:

- CHECK `order_payments_amount_amount_check`: `CHECK ((amount_amount >= 0))`
- CHECK `order_payments_kind_check`: `CHECK ((kind = ANY (ARRAY['certificate'::text, 'online'::text, 'on_receipt'::text])))`
- FOREIGN KEY `order_payments_order_id_fkey`: `FOREIGN KEY (order_id) REFERENCES ordering.orders(id)`
- PRIMARY KEY `order_payments_pkey`: `PRIMARY KEY (payment_id)`

Индексы:

- `CREATE INDEX order_payments_order_idx ON ordering.order_payments USING btree (order_id, created_at)`

Триггеры:

- `CREATE TRIGGER order_payments_forbid_delete BEFORE DELETE ON ordering.order_payments FOR EACH ROW EXECUTE FUNCTION platform.forbid_delete()`

### `ordering.order_refunds`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| refund_id | uuid | нет |  |
| order_id | uuid | нет |  |
| payment_id | uuid | нет |  |
| kind | text | нет |  |
| status | text | нет |  |
| amount_amount | bigint | нет |  |
| amount_currency | character(3) | нет | `'KZT'::bpchar` |
| reason | text | нет |  |
| requested_by | uuid | да |  |
| created_at | timestamp with time zone | нет | `now()` |
| updated_at | timestamp with time zone | нет | `now()` |
| completed_at | timestamp with time zone | да |  |

Ограничения:

- CHECK `order_refunds_amount_amount_check`: `CHECK ((amount_amount > 0))`
- CHECK `order_refunds_kind_check`: `CHECK ((kind = ANY (ARRAY['cancellation'::text, 'partial'::text, 'late_payment'::text, 'duplicate_payment'::text, 'external'::text])))`
- CHECK `order_refunds_status_check`: `CHECK ((status = ANY (ARRAY['pending'::text, 'succeeded'::text, 'failed'::text])))`
- FOREIGN KEY `order_refunds_order_id_fkey`: `FOREIGN KEY (order_id) REFERENCES ordering.orders(id)`
- PRIMARY KEY `order_refunds_pkey`: `PRIMARY KEY (refund_id)`

Индексы:

- `CREATE INDEX order_refunds_order_idx ON ordering.order_refunds USING btree (order_id)`
- `CREATE INDEX order_refunds_payment_idx ON ordering.order_refunds USING btree (payment_id)`

Триггеры:

- `CREATE TRIGGER order_refunds_forbid_delete BEFORE DELETE ON ordering.order_refunds FOR EACH ROW EXECUTE FUNCTION platform.forbid_delete()`
- `CREATE TRIGGER order_refunds_touch BEFORE UPDATE ON ordering.order_refunds FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at()`

### `ordering.order_status_history`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| order_id | uuid | нет |  |
| from_status | text | да |  |
| to_status | text | нет |  |
| occurred_at | timestamp with time zone | нет |  |
| actor_kind | text | нет |  |
| actor_user_id | uuid | да |  |
| actor_name | text | нет |  |
| reason_code | text | да |  |
| reason | text | да |  |

Ограничения:

- CHECK `order_status_history_actor_kind_check`: `CHECK ((actor_kind = ANY (ARRAY['staff'::text, 'system'::text, 'guest'::text])))`
- FOREIGN KEY `order_status_history_order_id_fkey`: `FOREIGN KEY (order_id) REFERENCES ordering.orders(id)`
- PRIMARY KEY `order_status_history_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE INDEX order_status_history_order_idx ON ordering.order_status_history USING btree (order_id, occurred_at)`

Триггеры:

- `CREATE TRIGGER order_status_history_forbid_delete BEFORE DELETE ON ordering.order_status_history FOR EACH ROW EXECUTE FUNCTION platform.forbid_delete()`

### `ordering.orders`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| number | text | нет |  |
| public_token | text | нет |  |
| branch_id | uuid | нет |  |
| type | text | нет |  |
| channel | text | нет |  |
| status | text | нет |  |
| customer_id | uuid | да |  |
| customer_name | text | да |  |
| customer_phone | text | нет |  |
| customer_email | text | да |  |
| delivery_lat | double precision | да |  |
| delivery_lng | double precision | да |  |
| delivery_address | text | да |  |
| delivery_apartment | text | да |  |
| delivery_entrance | text | да |  |
| delivery_floor | text | да |  |
| delivery_intercom | text | да |  |
| delivery_courier_comment | text | да |  |
| delivery_zone_id | uuid | да |  |
| contactless | boolean | нет | `false` |
| scheduled_for | timestamp with time zone | да |  |
| eta_minutes | integer | нет |  |
| promised_at | timestamp with time zone | нет |  |
| comment | text | да |  |
| promo_code_id | uuid | да |  |
| promo_code | text | да |  |
| promo_kind | text | да |  |
| certificate_masked_code | text | да |  |
| payment_method | text | нет |  |
| current_payment_id | uuid | да |  |
| subtotal_amount | bigint | нет |  |
| subtotal_currency | character(3) | нет | `'KZT'::bpchar` |
| discount_amount | bigint | нет |  |
| discount_currency | character(3) | нет | `'KZT'::bpchar` |
| delivery_fee_amount | bigint | нет |  |
| delivery_fee_currency | character(3) | нет | `'KZT'::bpchar` |
| total_amount | bigint | нет |  |
| total_currency | character(3) | нет | `'KZT'::bpchar` |
| locale | text | нет |  |
| analytics_session_id | text | да |  |
| idempotency_key | text | нет |  |
| created_by | uuid | да |  |
| cancel_reason_code | text | да |  |
| cancel_reason | text | да |  |
| was_paid | boolean | нет | `false` |
| placed_at | timestamp with time zone | нет |  |
| paid_at | timestamp with time zone | да |  |
| accepted_at | timestamp with time zone | да |  |
| cooking_at | timestamp with time zone | да |  |
| ready_at | timestamp with time zone | да |  |
| delivering_at | timestamp with time zone | да |  |
| completed_at | timestamp with time zone | да |  |
| cancelled_at | timestamp with time zone | да |  |
| refunded_at | timestamp with time zone | да |  |
| created_at | timestamp with time zone | нет | `now()` |
| updated_at | timestamp with time zone | нет | `now()` |
| deleted_at | timestamp with time zone | да |  |

Ограничения:

- CHECK `orders_cancel_reason_code_check`: `CHECK ((cancel_reason_code = ANY (ARRAY['guest_request'::text, 'not_paid_in_time'::text, 'out_of_stock'::text, 'cannot_deliver'::text, 'duplicate'::text, 'other'::text])))`
- CHECK `orders_channel_check`: `CHECK ((channel = ANY (ARRAY['web'::text, 'admin'::text])))`
- CHECK `orders_check`: `CHECK ((discount_amount <= subtotal_amount))`
- CHECK `orders_check1`: `CHECK (((type = 'pickup'::text) OR ((delivery_lat IS NOT NULL) AND (delivery_lng IS NOT NULL) AND (delivery_address IS NOT NULL))))`
- CHECK `orders_delivery_fee_amount_check`: `CHECK ((delivery_fee_amount >= 0))`
- CHECK `orders_discount_amount_check`: `CHECK ((discount_amount >= 0))`
- CHECK `orders_eta_minutes_check`: `CHECK ((eta_minutes >= 0))`
- CHECK `orders_locale_check`: `CHECK ((locale = ANY (ARRAY['kk'::text, 'ru'::text, 'en'::text])))`
- CHECK `orders_payment_method_check`: `CHECK ((payment_method = ANY (ARRAY['online'::text, 'on_receipt'::text])))`
- CHECK `orders_promo_kind_check`: `CHECK ((promo_kind = ANY (ARRAY['percent'::text, 'fixed'::text, 'free_delivery'::text])))`
- CHECK `orders_status_check`: `CHECK ((status = ANY (ARRAY['draft'::text, 'awaiting_payment'::text, 'paid'::text, 'accepted'::text, 'cooking'::text, 'ready'::text, 'delivering'::text, 'completed'::text, 'cancelled'::text, 'refunded'::text])))`
- CHECK `orders_subtotal_amount_check`: `CHECK ((subtotal_amount >= 0))`
- CHECK `orders_total_amount_check`: `CHECK ((total_amount >= 0))`
- CHECK `orders_type_check`: `CHECK ((type = ANY (ARRAY['delivery'::text, 'pickup'::text])))`
- PRIMARY KEY `orders_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE INDEX orders_awaiting_payment_idx ON ordering.orders USING btree (branch_id, placed_at) WHERE (status = 'awaiting_payment'::text)`
- `CREATE INDEX orders_branch_status_idx ON ordering.orders USING btree (branch_id, status, placed_at DESC)`
- `CREATE INDEX orders_customer_idx ON ordering.orders USING btree (customer_id)`
- `CREATE UNIQUE INDEX orders_idempotency_key_uq ON ordering.orders USING btree (idempotency_key)`
- `CREATE UNIQUE INDEX orders_number_uq ON ordering.orders USING btree (number)`
- `CREATE INDEX orders_phone_idx ON ordering.orders USING btree (customer_phone)`
- `CREATE INDEX orders_placed_idx ON ordering.orders USING btree (placed_at DESC)`
- `CREATE UNIQUE INDEX orders_public_token_uq ON ordering.orders USING btree (public_token)`

Триггеры:

- `CREATE TRIGGER orders_forbid_delete BEFORE DELETE ON ordering.orders FOR EACH ROW EXECUTE FUNCTION platform.forbid_delete()`
- `CREATE TRIGGER orders_touch BEFORE UPDATE ON ordering.orders FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at()`

### `ordering.promo_code_usages`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| promo_code_id | uuid | нет |  |
| order_id | uuid | нет |  |
| phone | text | нет |  |
| status | text | нет |  |
| discount_amount | bigint | нет |  |
| discount_currency | character(3) | нет | `'KZT'::bpchar` |
| created_at | timestamp with time zone | нет | `now()` |
| updated_at | timestamp with time zone | нет | `now()` |

Ограничения:

- CHECK `promo_code_usages_discount_amount_check`: `CHECK ((discount_amount >= 0))`
- CHECK `promo_code_usages_status_check`: `CHECK ((status = ANY (ARRAY['reserved'::text, 'used'::text, 'released'::text])))`
- FOREIGN KEY `promo_code_usages_order_id_fkey`: `FOREIGN KEY (order_id) REFERENCES ordering.orders(id)`
- FOREIGN KEY `promo_code_usages_promo_code_id_fkey`: `FOREIGN KEY (promo_code_id) REFERENCES ordering.promo_codes(id)`
- PRIMARY KEY `promo_code_usages_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE UNIQUE INDEX promo_code_usages_order_uq ON ordering.promo_code_usages USING btree (order_id)`
- `CREATE INDEX promo_code_usages_phone_idx ON ordering.promo_code_usages USING btree (promo_code_id, phone) WHERE (status <> 'released'::text)`
- `CREATE INDEX promo_code_usages_promo_idx ON ordering.promo_code_usages USING btree (promo_code_id, status)`

Триггеры:

- `CREATE TRIGGER promo_code_usages_touch BEFORE UPDATE ON ordering.promo_code_usages FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at()`

### `ordering.promo_codes`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| code | text | нет |  |
| description | text | да |  |
| kind | text | нет |  |
| percent_bp | integer | да |  |
| fixed_amount | bigint | да |  |
| fixed_currency | character(3) | нет | `'KZT'::bpchar` |
| min_subtotal_amount | bigint | да |  |
| min_subtotal_currency | character(3) | нет | `'KZT'::bpchar` |
| valid_from | timestamp with time zone | да |  |
| valid_to | timestamp with time zone | да |  |
| total_limit | integer | да |  |
| per_phone_limit | integer | да |  |
| branch_id | uuid | да |  |
| is_active | boolean | нет | `true` |
| created_at | timestamp with time zone | нет | `now()` |
| updated_at | timestamp with time zone | нет | `now()` |
| deleted_at | timestamp with time zone | да |  |

Ограничения:

- CHECK `promo_codes_check`: `CHECK (((kind <> 'percent'::text) OR (percent_bp IS NOT NULL)))`
- CHECK `promo_codes_check1`: `CHECK (((kind <> 'fixed'::text) OR (fixed_amount IS NOT NULL)))`
- CHECK `promo_codes_check2`: `CHECK (((valid_from IS NULL) OR (valid_to IS NULL) OR (valid_from < valid_to)))`
- CHECK `promo_codes_code_check`: `CHECK ((code ~ '^[A-Z0-9_-]{3,32}$'::text))`
- CHECK `promo_codes_fixed_amount_check`: `CHECK (((fixed_amount IS NULL) OR (fixed_amount > 0)))`
- CHECK `promo_codes_kind_check`: `CHECK ((kind = ANY (ARRAY['percent'::text, 'fixed'::text, 'free_delivery'::text])))`
- CHECK `promo_codes_min_subtotal_amount_check`: `CHECK (((min_subtotal_amount IS NULL) OR (min_subtotal_amount >= 0)))`
- CHECK `promo_codes_per_phone_limit_check`: `CHECK (((per_phone_limit IS NULL) OR (per_phone_limit > 0)))`
- CHECK `promo_codes_percent_bp_check`: `CHECK (((percent_bp IS NULL) OR ((percent_bp >= 1) AND (percent_bp <= 10000))))`
- CHECK `promo_codes_total_limit_check`: `CHECK (((total_limit IS NULL) OR (total_limit > 0)))`
- PRIMARY KEY `promo_codes_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE INDEX promo_codes_branch_idx ON ordering.promo_codes USING btree (branch_id) WHERE (deleted_at IS NULL)`
- `CREATE UNIQUE INDEX promo_codes_code_uq ON ordering.promo_codes USING btree (code) WHERE (deleted_at IS NULL)`

Триггеры:

- `CREATE TRIGGER promo_codes_touch BEFORE UPDATE ON ordering.promo_codes FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at()`

## Схема `reservation` — Reservation — залы, места, брони

### `reservation.branch_settings`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| branch_id | uuid | нет |  |
| reminder_hours_before | integer | нет | `3` |
| min_lead_minutes | integer | нет | `60` |
| max_days_ahead | integer | нет | `60` |
| policy_text | jsonb | нет | `'{}'::jsonb` |
| updated_at | timestamp with time zone | нет | `now()` |
| updated_by | uuid | да |  |

Ограничения:

- CHECK `branch_settings_max_days_ahead_check`: `CHECK (((max_days_ahead >= 1) AND (max_days_ahead <= 365)))`
- CHECK `branch_settings_min_lead_minutes_check`: `CHECK (((min_lead_minutes >= 0) AND (min_lead_minutes <= 10080)))`
- CHECK `branch_settings_reminder_hours_before_check`: `CHECK (((reminder_hours_before >= 0) AND (reminder_hours_before <= 72)))`
- PRIMARY KEY `branch_settings_pkey`: `PRIMARY KEY (branch_id)`

Триггеры:

- `CREATE TRIGGER branch_settings_touch BEFORE UPDATE ON reservation.branch_settings FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at()`

### `reservation.halls`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| branch_id | uuid | нет |  |
| code | text | нет |  |
| name | jsonb | нет |  |
| description | jsonb | нет | `'{}'::jsonb` |
| plan_width | integer | нет | `1000` |
| plan_height | integer | нет | `600` |
| background_image | jsonb | да |  |
| sort_order | integer | нет | `0` |
| is_active | boolean | нет | `true` |
| created_at | timestamp with time zone | нет | `now()` |
| updated_at | timestamp with time zone | нет | `now()` |
| deleted_at | timestamp with time zone | да |  |

Ограничения:

- CHECK `halls_code_check`: `CHECK ((code ~ '^[a-z0-9][a-z0-9_-]{0,31}$'::text))`
- CHECK `halls_plan_height_check`: `CHECK (((plan_height >= 100) AND (plan_height <= 10000)))`
- CHECK `halls_plan_width_check`: `CHECK (((plan_width >= 100) AND (plan_width <= 10000)))`
- PRIMARY KEY `halls_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE INDEX halls_branch_idx ON reservation.halls USING btree (branch_id) WHERE (deleted_at IS NULL)`
- `CREATE UNIQUE INDEX halls_code_uq ON reservation.halls USING btree (branch_id, code) WHERE (deleted_at IS NULL)`

Триггеры:

- `CREATE TRIGGER halls_touch BEFORE UPDATE ON reservation.halls FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at()`

### `reservation.reservations`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| number | text | нет |  |
| branch_id | uuid | нет |  |
| venue_id | uuid | нет |  |
| kind | text | нет |  |
| status | text | нет |  |
| source | text | нет |  |
| start_at | timestamp with time zone | нет |  |
| end_at | timestamp with time zone | нет |  |
| blocked_until | timestamp with time zone | нет |  |
| blocked_range | tstzrange | да |  |
| guests | integer | нет |  |
| customer_id | uuid | да |  |
| customer_name | text | да |  |
| customer_phone | text | да |  |
| customer_email | text | да |  |
| comment | text | да |  |
| occasion | text | да |  |
| locale | text | нет | `'ru'::text` |
| public_token | text | да |  |
| idempotency_key | text | да |  |
| banquet_request_id | uuid | да |  |
| note | text | да |  |
| requires_confirmation | boolean | нет | `false` |
| rules | jsonb | нет | `'{}'::jsonb` |
| hold_expires_at | timestamp with time zone | да |  |
| deposit_amount | bigint | да |  |
| deposit_currency | character(3) | нет | `'KZT'::bpchar` |
| deposit_status | text | нет | `'none'::text` |
| deposit_payment_id | uuid | да |  |
| deposit_paid_payment_id | uuid | да |  |
| deposit_paid_at | timestamp with time zone | да |  |
| deposit_waive_reason | text | да |  |
| deposit_attempts | integer | нет | `0` |
| deposit_outcome | text | нет | `'none'::text` |
| cancel_reason | text | да |  |
| cancelled_by | text | да |  |
| confirmed_at | timestamp with time zone | да |  |
| arrived_at | timestamp with time zone | да |  |
| no_show_at | timestamp with time zone | да |  |
| cancelled_at | timestamp with time zone | да |  |
| expired_at | timestamp with time zone | да |  |
| reminder_sent_at | timestamp with time zone | да |  |
| created_by_user_id | uuid | да |  |
| created_at | timestamp with time zone | нет | `now()` |
| updated_at | timestamp with time zone | нет | `now()` |
| deleted_at | timestamp with time zone | да |  |

Ограничения:

- CHECK `reservations_banquet_chk`: `CHECK (((kind = 'banquet'::text) = (banquet_request_id IS NOT NULL)))`
- CHECK `reservations_cancelled_by_check`: `CHECK ((cancelled_by = ANY (ARRAY['guest'::text, 'staff'::text, 'system'::text, 'banquet'::text])))`
- CHECK `reservations_deposit_amount_check`: `CHECK (((deposit_amount IS NULL) OR (deposit_amount > 0)))`
- CHECK `reservations_deposit_outcome_check`: `CHECK ((deposit_outcome = ANY (ARRAY['none'::text, 'refunded'::text, 'retained'::text])))`
- CHECK `reservations_deposit_status_check`: `CHECK ((deposit_status = ANY (ARRAY['none'::text, 'waived'::text, 'pending'::text, 'unpaid'::text, 'paid'::text, 'refund_pending'::text, 'refunded'::text, 'refund_failed'::text, 'retained'::text, 'applied'::text])))`
- CHECK `reservations_guests_check`: `CHECK (((guests >= 1) AND (guests <= 1000)))`
- CHECK `reservations_interval_chk`: `CHECK (((end_at > start_at) AND (blocked_until >= end_at)))`
- CHECK `reservations_kind_check`: `CHECK ((kind = ANY (ARRAY['regular'::text, 'banquet'::text])))`
- CHECK `reservations_locale_check`: `CHECK ((locale = ANY (ARRAY['kk'::text, 'ru'::text, 'en'::text])))`
- CHECK `reservations_source_check`: `CHECK ((source = ANY (ARRAY['web'::text, 'admin'::text, 'banquet'::text])))`
- CHECK `reservations_status_check`: `CHECK ((status = ANY (ARRAY['pending'::text, 'awaiting_deposit'::text, 'confirmed'::text, 'arrived'::text, 'no_show'::text, 'cancelled'::text, 'expired'::text])))`
- FOREIGN KEY `reservations_venue_id_fkey`: `FOREIGN KEY (venue_id) REFERENCES reservation.venues(id)`
- PRIMARY KEY `reservations_pkey`: `PRIMARY KEY (id)`
- EXCLUDE `reservations_no_overlap`: `EXCLUDE USING gist (venue_id WITH =, blocked_range WITH &&) WHERE (((status = ANY (ARRAY['pending'::text, 'awaiting_deposit'::text, 'confirmed'::text, 'arrived'::text])) AND (deleted_at IS NULL)))`

Индексы:

- `CREATE INDEX reservations_banquet_idx ON reservation.reservations USING btree (banquet_request_id) WHERE (banquet_request_id IS NOT NULL)`
- `CREATE INDEX reservations_branch_start_idx ON reservation.reservations USING btree (branch_id, start_at)`
- `CREATE INDEX reservations_customer_idx ON reservation.reservations USING btree (customer_id) WHERE (customer_id IS NOT NULL)`
- `CREATE INDEX reservations_deposit_payment_idx ON reservation.reservations USING btree (deposit_payment_id) WHERE (deposit_payment_id IS NOT NULL)`
- `CREATE INDEX reservations_hold_idx ON reservation.reservations USING btree (hold_expires_at) WHERE (status = ANY (ARRAY['pending'::text, 'awaiting_deposit'::text]))`
- `CREATE UNIQUE INDEX reservations_idempotency_uq ON reservation.reservations USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL)`
- `CREATE UNIQUE INDEX reservations_number_uq ON reservation.reservations USING btree (number)`
- `CREATE INDEX reservations_phone_idx ON reservation.reservations USING btree (customer_phone)`
- `CREATE UNIQUE INDEX reservations_token_uq ON reservation.reservations USING btree (public_token) WHERE (public_token IS NOT NULL)`
- `CREATE INDEX reservations_venue_start_idx ON reservation.reservations USING btree (venue_id, start_at)`

Триггеры:

- `CREATE TRIGGER reservations_forbid_delete BEFORE DELETE ON reservation.reservations FOR EACH ROW EXECUTE FUNCTION platform.forbid_delete()`
- `CREATE TRIGGER reservations_touch BEFORE UPDATE ON reservation.reservations FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at()`

### `reservation.status_history`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| reservation_id | uuid | нет |  |
| from_status | text | да |  |
| to_status | text | нет |  |
| reason | text | да |  |
| deposit_outcome | text | нет | `'none'::text` |
| actor_kind | text | нет |  |
| actor_user_id | uuid | да |  |
| actor_name | text | нет |  |
| occurred_at | timestamp with time zone | нет |  |

Ограничения:

- CHECK `status_history_deposit_outcome_check`: `CHECK ((deposit_outcome = ANY (ARRAY['none'::text, 'refunded'::text, 'retained'::text])))`
- FOREIGN KEY `status_history_reservation_id_fkey`: `FOREIGN KEY (reservation_id) REFERENCES reservation.reservations(id)`
- PRIMARY KEY `status_history_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE INDEX status_history_reservation_idx ON reservation.status_history USING btree (reservation_id, occurred_at)`

Триггеры:

- `CREATE TRIGGER status_history_append_only BEFORE DELETE OR UPDATE ON reservation.status_history FOR EACH ROW EXECUTE FUNCTION platform.forbid_update_delete()`

### `reservation.venue_types`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| code | text | нет |  |
| name | jsonb | нет |  |
| description | jsonb | нет | `'{}'::jsonb` |
| duration_minutes | integer | нет |  |
| hold_minutes | integer | нет |  |
| cancellation_deadline_hours | integer | нет |  |
| requires_manual_confirmation | boolean | нет | `false` |
| cleanup_minutes | integer | нет | `0` |
| slot_step_minutes | integer | нет | `30` |
| bookable_online | boolean | нет | `true` |
| sort_order | integer | нет | `0` |
| is_active | boolean | нет | `true` |
| created_at | timestamp with time zone | нет | `now()` |
| updated_at | timestamp with time zone | нет | `now()` |
| deleted_at | timestamp with time zone | да |  |

Ограничения:

- CHECK `venue_types_cancellation_deadline_hours_check`: `CHECK (((cancellation_deadline_hours >= 0) AND (cancellation_deadline_hours <= 720)))`
- CHECK `venue_types_cleanup_minutes_check`: `CHECK (((cleanup_minutes >= 0) AND (cleanup_minutes <= 720)))`
- CHECK `venue_types_code_check`: `CHECK ((code ~ '^[a-z][a-z0-9_]{1,31}$'::text))`
- CHECK `venue_types_duration_minutes_check`: `CHECK (((duration_minutes >= 15) AND (duration_minutes <= 1440)))`
- CHECK `venue_types_hold_minutes_check`: `CHECK (((hold_minutes >= 1) AND (hold_minutes <= 10080)))`
- CHECK `venue_types_slot_step_minutes_check`: `CHECK (((slot_step_minutes >= 5) AND (slot_step_minutes <= 240)))`
- PRIMARY KEY `venue_types_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE UNIQUE INDEX venue_types_code_uq ON reservation.venue_types USING btree (code) WHERE (deleted_at IS NULL)`

Триггеры:

- `CREATE TRIGGER venue_types_touch BEFORE UPDATE ON reservation.venue_types FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at()`

### `reservation.venues`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| branch_id | uuid | нет |  |
| hall_id | uuid | нет |  |
| type_id | uuid | нет |  |
| code | text | нет |  |
| name | jsonb | нет |  |
| description | jsonb | нет | `'{}'::jsonb` |
| capacity_min | integer | нет |  |
| capacity_max | integer | нет |  |
| deposit_amount | bigint | да |  |
| deposit_currency | character(3) | нет | `'KZT'::bpchar` |
| rules | jsonb | нет | `'{}'::jsonb` |
| pos_x | integer | нет | `0` |
| pos_y | integer | нет | `0` |
| pos_w | integer | нет | `60` |
| pos_h | integer | нет | `60` |
| shape | text | нет | `'rect'::text` |
| rotation | integer | нет | `0` |
| photos | jsonb | нет | `'[]'::jsonb` |
| sort_order | integer | нет | `0` |
| is_active | boolean | нет | `true` |
| created_at | timestamp with time zone | нет | `now()` |
| updated_at | timestamp with time zone | нет | `now()` |
| deleted_at | timestamp with time zone | да |  |

Ограничения:

- CHECK `venues_capacity_min_check`: `CHECK ((capacity_min >= 1))`
- CHECK `venues_check`: `CHECK (((capacity_max >= capacity_min) AND (capacity_max <= 1000)))`
- CHECK `venues_code_check`: `CHECK ((code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$'::text))`
- CHECK `venues_deposit_amount_check`: `CHECK (((deposit_amount IS NULL) OR (deposit_amount > 0)))`
- CHECK `venues_pos_h_check`: `CHECK ((pos_h >= 1))`
- CHECK `venues_pos_w_check`: `CHECK ((pos_w >= 1))`
- CHECK `venues_pos_x_check`: `CHECK ((pos_x >= 0))`
- CHECK `venues_pos_y_check`: `CHECK ((pos_y >= 0))`
- CHECK `venues_rotation_check`: `CHECK (((rotation >= 0) AND (rotation <= 359)))`
- CHECK `venues_shape_check`: `CHECK ((shape = ANY (ARRAY['rect'::text, 'circle'::text])))`
- FOREIGN KEY `venues_hall_id_fkey`: `FOREIGN KEY (hall_id) REFERENCES reservation.halls(id)`
- FOREIGN KEY `venues_type_id_fkey`: `FOREIGN KEY (type_id) REFERENCES reservation.venue_types(id)`
- PRIMARY KEY `venues_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE INDEX venues_branch_idx ON reservation.venues USING btree (branch_id) WHERE (deleted_at IS NULL)`
- `CREATE UNIQUE INDEX venues_code_uq ON reservation.venues USING btree (branch_id, code) WHERE (deleted_at IS NULL)`
- `CREATE INDEX venues_hall_idx ON reservation.venues USING btree (hall_id) WHERE (deleted_at IS NULL)`
- `CREATE INDEX venues_type_idx ON reservation.venues USING btree (type_id) WHERE (deleted_at IS NULL)`

Триггеры:

- `CREATE TRIGGER venues_touch BEFORE UPDATE ON reservation.venues FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at()`

## Схема `banquet` — Banquet — заявки, сметы, счета, документы, ЭСФ

### `banquet.acts`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| request_id | uuid | нет |  |
| number | text | нет |  |
| branch_id | uuid | да |  |
| quote_id | uuid | нет |  |
| payer_type | text | нет |  |
| company_id | uuid | да |  |
| buyer | jsonb | нет |  |
| seller | jsonb | нет |  |
| amount_amount | bigint | нет |  |
| amount_currency | character(3) | нет | `'KZT'::bpchar` |
| vat_amount | bigint | нет | `0` |
| vat_currency | character(3) | нет | `'KZT'::bpchar` |
| vat_rate_bp | integer | нет | `0` |
| act_date | date | нет |  |
| pdf_file_key | text | нет |  |
| esf_status | text | нет |  |
| esf_provider | text | да |  |
| esf_id | text | да |  |
| esf_registration_number | text | да |  |
| esf_error | text | да |  |
| esf_file_key | text | да |  |
| esf_updated_at | timestamp with time zone | да |  |
| created_by | uuid | да |  |
| created_by_name | text | нет |  |
| created_at | timestamp with time zone | нет | `now()` |
| updated_at | timestamp with time zone | нет | `now()` |

Ограничения:

- CHECK `acts_amount_amount_check`: `CHECK ((amount_amount >= 0))`
- CHECK `acts_esf_status_check`: `CHECK ((esf_status = ANY (ARRAY['not_required'::text, 'pending'::text, 'draft_ready'::text, 'sent'::text, 'registered'::text, 'failed'::text])))`
- CHECK `acts_payer_type_check`: `CHECK ((payer_type = ANY (ARRAY['individual'::text, 'company'::text])))`
- CHECK `acts_vat_amount_check`: `CHECK ((vat_amount >= 0))`
- CHECK `acts_vat_rate_bp_check`: `CHECK ((vat_rate_bp >= 0))`
- FOREIGN KEY `acts_company_id_fkey`: `FOREIGN KEY (company_id) REFERENCES banquet.client_companies(id)`
- FOREIGN KEY `acts_quote_id_fkey`: `FOREIGN KEY (quote_id) REFERENCES banquet.quotes(id)`
- FOREIGN KEY `acts_request_id_fkey`: `FOREIGN KEY (request_id) REFERENCES banquet.requests(id)`
- PRIMARY KEY `acts_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE INDEX acts_esf_idx ON banquet.acts USING btree (esf_status) WHERE (esf_status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text]))`
- `CREATE UNIQUE INDEX acts_number_uq ON banquet.acts USING btree (number)`
- `CREATE UNIQUE INDEX acts_request_uq ON banquet.acts USING btree (request_id)`

Триггеры:

- `CREATE TRIGGER acts_forbid_delete BEFORE DELETE ON banquet.acts FOR EACH ROW EXECUTE FUNCTION platform.forbid_delete()`
- `CREATE TRIGGER acts_touch BEFORE UPDATE ON banquet.acts FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at()`

### `banquet.client_companies`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| name | text | нет |  |
| bin | text | нет |  |
| legal_address | text | нет |  |
| bank_name | text | да |  |
| iban | text | да |  |
| bik | text | да |  |
| kbe | text | да |  |
| director_name | text | да |  |
| director_position | text | да |  |
| acting_basis | text | да |  |
| contact_name | text | да |  |
| contact_phone | text | да |  |
| contact_email | text | да |  |
| created_at | timestamp with time zone | нет | `now()` |
| updated_at | timestamp with time zone | нет | `now()` |
| deleted_at | timestamp with time zone | да |  |

Ограничения:

- CHECK `client_companies_bin_check`: `CHECK ((bin ~ '^[0-9]{12}$'::text))`
- PRIMARY KEY `client_companies_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE UNIQUE INDEX client_companies_bin_uq ON banquet.client_companies USING btree (bin) WHERE (deleted_at IS NULL)`
- `CREATE INDEX client_companies_name_trgm_idx ON banquet.client_companies USING gin (lower(name) gin_trgm_ops)`

Триггеры:

- `CREATE TRIGGER client_companies_touch BEFORE UPDATE ON banquet.client_companies FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at()`

### `banquet.contract_templates`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| code | text | нет |  |
| name | text | нет |  |
| body | text | нет |  |
| is_default | boolean | нет | `false` |
| updated_by | uuid | да |  |
| created_at | timestamp with time zone | нет | `now()` |
| updated_at | timestamp with time zone | нет | `now()` |
| deleted_at | timestamp with time zone | да |  |

Ограничения:

- CHECK `contract_templates_code_check`: `CHECK ((code ~ '^[a-z0-9_-]{2,60}$'::text))`
- PRIMARY KEY `contract_templates_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE UNIQUE INDEX contract_templates_code_uq ON banquet.contract_templates USING btree (code) WHERE (deleted_at IS NULL)`
- `CREATE UNIQUE INDEX contract_templates_default_uq ON banquet.contract_templates USING btree ((true)) WHERE (is_default AND (deleted_at IS NULL))`

Триггеры:

- `CREATE TRIGGER contract_templates_touch BEFORE UPDATE ON banquet.contract_templates FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at()`

### `banquet.documents`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| request_id | uuid | нет |  |
| kind | text | нет |  |
| number | text | да |  |
| title | text | нет |  |
| related_id | uuid | да |  |
| file_key | text | нет |  |
| filename | text | нет |  |
| content_type | text | нет |  |
| created_by | uuid | да |  |
| created_by_name | text | нет |  |
| created_at | timestamp with time zone | нет |  |

Ограничения:

- CHECK `documents_kind_check`: `CHECK ((kind = ANY (ARRAY['quote'::text, 'contract'::text, 'invoice'::text, 'act'::text, 'esf_xml'::text])))`
- FOREIGN KEY `documents_request_id_fkey`: `FOREIGN KEY (request_id) REFERENCES banquet.requests(id)`
- PRIMARY KEY `documents_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE INDEX documents_related_idx ON banquet.documents USING btree (related_id)`
- `CREATE INDEX documents_request_idx ON banquet.documents USING btree (request_id, created_at DESC)`

### `banquet.invoice_payments`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| invoice_id | uuid | нет |  |
| payment_id | uuid | нет |  |
| method | text | нет |  |
| amount_amount | bigint | нет |  |
| amount_currency | character(3) | нет | `'KZT'::bpchar` |
| refunded_amount | bigint | нет | `0` |
| refunded_currency | character(3) | нет | `'KZT'::bpchar` |
| document_number | text | да |  |
| paid_at | timestamp with time zone | нет |  |
| recorded_at | timestamp with time zone | нет |  |
| recorded_by | uuid | да |  |
| recorded_by_name | text | нет |  |

Ограничения:

- CHECK `invoice_payments_amount_amount_check`: `CHECK ((amount_amount > 0))`
- CHECK `invoice_payments_refund_not_exceed`: `CHECK ((refunded_amount <= amount_amount))`
- CHECK `invoice_payments_refunded_amount_check`: `CHECK ((refunded_amount >= 0))`
- FOREIGN KEY `invoice_payments_invoice_id_fkey`: `FOREIGN KEY (invoice_id) REFERENCES banquet.invoices(id)`
- PRIMARY KEY `invoice_payments_pkey`: `PRIMARY KEY (id)`
- t `invoice_payments_total`: `TRIGGER DEFERRABLE`

Индексы:

- `CREATE INDEX invoice_payments_invoice_idx ON banquet.invoice_payments USING btree (invoice_id)`
- `CREATE UNIQUE INDEX invoice_payments_payment_uq ON banquet.invoice_payments USING btree (payment_id)`

Триггеры:

- `CREATE TRIGGER invoice_payments_forbid_delete BEFORE DELETE ON banquet.invoice_payments FOR EACH ROW EXECUTE FUNCTION platform.forbid_delete()`
- `CREATE CONSTRAINT TRIGGER invoice_payments_total AFTER INSERT OR UPDATE ON banquet.invoice_payments DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION banquet.check_invoice_payments_total()`

### `banquet.invoices`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| request_id | uuid | нет |  |
| number | text | нет |  |
| branch_id | uuid | да |  |
| payer_type | text | нет |  |
| company_id | uuid | да |  |
| buyer | jsonb | нет |  |
| seller | jsonb | нет |  |
| purpose | text | нет |  |
| description | text | нет |  |
| amount_amount | bigint | нет |  |
| amount_currency | character(3) | нет | `'KZT'::bpchar` |
| vat_amount | bigint | нет | `0` |
| vat_currency | character(3) | нет | `'KZT'::bpchar` |
| vat_rate_bp | integer | нет | `0` |
| paid_amount | bigint | нет | `0` |
| paid_currency | character(3) | нет | `'KZT'::bpchar` |
| refunded_amount | bigint | нет | `0` |
| refunded_currency | character(3) | нет | `'KZT'::bpchar` |
| due_date | date | нет |  |
| status | text | нет |  |
| payment_id | uuid | да |  |
| public_token | text | нет |  |
| pdf_file_key | text | да |  |
| issued_at | timestamp with time zone | нет |  |
| paid_at | timestamp with time zone | да |  |
| cancelled_at | timestamp with time zone | да |  |
| cancel_reason | text | да |  |
| created_by | uuid | да |  |
| created_by_name | text | нет |  |
| created_at | timestamp with time zone | нет | `now()` |
| updated_at | timestamp with time zone | нет | `now()` |

Ограничения:

- CHECK `invoices_amount_amount_check`: `CHECK ((amount_amount > 0))`
- CHECK `invoices_company_payer`: `CHECK (((payer_type <> 'company'::text) OR (company_id IS NOT NULL)))`
- CHECK `invoices_paid_amount_check`: `CHECK ((paid_amount >= 0))`
- CHECK `invoices_paid_not_exceed`: `CHECK ((paid_amount <= amount_amount))`
- CHECK `invoices_payer_type_check`: `CHECK ((payer_type = ANY (ARRAY['individual'::text, 'company'::text])))`
- CHECK `invoices_purpose_check`: `CHECK ((purpose = ANY (ARRAY['prepayment'::text, 'payment'::text])))`
- CHECK `invoices_refund_not_exceed`: `CHECK ((refunded_amount <= paid_amount))`
- CHECK `invoices_refunded_amount_check`: `CHECK ((refunded_amount >= 0))`
- CHECK `invoices_status_check`: `CHECK ((status = ANY (ARRAY['issued'::text, 'partially_paid'::text, 'paid'::text, 'cancelled'::text])))`
- CHECK `invoices_vat_amount_check`: `CHECK ((vat_amount >= 0))`
- CHECK `invoices_vat_rate_bp_check`: `CHECK ((vat_rate_bp >= 0))`
- FOREIGN KEY `invoices_company_id_fkey`: `FOREIGN KEY (company_id) REFERENCES banquet.client_companies(id)`
- FOREIGN KEY `invoices_request_id_fkey`: `FOREIGN KEY (request_id) REFERENCES banquet.requests(id)`
- PRIMARY KEY `invoices_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE UNIQUE INDEX invoices_number_uq ON banquet.invoices USING btree (number)`
- `CREATE INDEX invoices_open_idx ON banquet.invoices USING btree (due_date) WHERE (status = ANY (ARRAY['issued'::text, 'partially_paid'::text]))`
- `CREATE INDEX invoices_request_idx ON banquet.invoices USING btree (request_id)`
- `CREATE UNIQUE INDEX invoices_token_uq ON banquet.invoices USING btree (public_token)`

Триггеры:

- `CREATE TRIGGER invoices_forbid_delete BEFORE DELETE ON banquet.invoices FOR EACH ROW EXECUTE FUNCTION platform.forbid_delete()`
- `CREATE TRIGGER invoices_touch BEFORE UPDATE ON banquet.invoices FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at()`

### `banquet.quote_lines`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| quote_id | uuid | нет |  |
| position | integer | нет |  |
| kind | text | нет |  |
| dish_id | uuid | да |  |
| title | jsonb | нет |  |
| unit | text | нет |  |
| quantity | integer | нет |  |
| unit_price_amount | bigint | нет |  |
| unit_price_currency | character(3) | нет | `'KZT'::bpchar` |
| discount_type | text | да |  |
| discount_bp | integer | да |  |
| discount_value_amount | bigint | да |  |
| discount_value_currency | character(3) | нет | `'KZT'::bpchar` |
| gross_amount | bigint | нет |  |
| gross_currency | character(3) | нет | `'KZT'::bpchar` |
| discount_amount | bigint | нет |  |
| discount_currency | character(3) | нет | `'KZT'::bpchar` |
| total_amount | bigint | нет |  |
| total_currency | character(3) | нет | `'KZT'::bpchar` |

Ограничения:

- CHECK `quote_lines_discount_bp_check`: `CHECK (((discount_bp IS NULL) OR ((discount_bp >= 0) AND (discount_bp <= 10000))))`
- CHECK `quote_lines_discount_type_check`: `CHECK ((discount_type = ANY (ARRAY['percent'::text, 'amount'::text])))`
- CHECK `quote_lines_discount_value_amount_check`: `CHECK (((discount_value_amount IS NULL) OR (discount_value_amount >= 0)))`
- CHECK `quote_lines_kind_check`: `CHECK ((kind = ANY (ARRAY['menu'::text, 'hall_rent'::text, 'musicians'::text, 'decoration'::text, 'service'::text, 'other'::text])))`
- CHECK `quote_lines_menu_dish`: `CHECK (((kind <> 'menu'::text) OR (dish_id IS NOT NULL)))`
- CHECK `quote_lines_position_check`: `CHECK (("position" > 0))`
- CHECK `quote_lines_quantity_check`: `CHECK ((quantity > 0))`
- CHECK `quote_lines_total_amount_check`: `CHECK ((total_amount >= 0))`
- CHECK `quote_lines_unit_price_amount_check`: `CHECK ((unit_price_amount >= 0))`
- FOREIGN KEY `quote_lines_quote_id_fkey`: `FOREIGN KEY (quote_id) REFERENCES banquet.quotes(id)`
- PRIMARY KEY `quote_lines_pkey`: `PRIMARY KEY (id)`
- UNIQUE `quote_lines_quote_id_position_key`: `UNIQUE (quote_id, "position")`

Триггеры:

- `CREATE TRIGGER quote_lines_immutable BEFORE DELETE OR UPDATE ON banquet.quote_lines FOR EACH ROW EXECUTE FUNCTION platform.forbid_update_delete()`

### `banquet.quotes`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| request_id | uuid | нет |  |
| version | integer | нет |  |
| branch_id | uuid | да |  |
| guests | integer | нет |  |
| discount_type | text | да |  |
| discount_bp | integer | да |  |
| discount_value_amount | bigint | да |  |
| discount_value_currency | character(3) | нет | `'KZT'::bpchar` |
| service_charge_bp | integer | нет | `0` |
| vat_payer | boolean | нет |  |
| vat_rate_bp | integer | нет | `0` |
| subtotal_amount | bigint | нет |  |
| subtotal_currency | character(3) | нет | `'KZT'::bpchar` |
| discount_amount | bigint | нет |  |
| discount_currency | character(3) | нет | `'KZT'::bpchar` |
| service_amount | bigint | нет |  |
| service_currency | character(3) | нет | `'KZT'::bpchar` |
| total_amount | bigint | нет |  |
| total_currency | character(3) | нет | `'KZT'::bpchar` |
| vat_amount | bigint | нет |  |
| vat_currency | character(3) | нет | `'KZT'::bpchar` |
| per_guest_amount | bigint | нет |  |
| per_guest_currency | character(3) | нет | `'KZT'::bpchar` |
| valid_until | date | да |  |
| notes | text | да |  |
| seller | jsonb | нет |  |
| pdf_file_key | text | да |  |
| created_by | uuid | да |  |
| created_by_name | text | нет |  |
| created_at | timestamp with time zone | нет |  |
| sent_at | timestamp with time zone | да |  |
| accepted_at | timestamp with time zone | да |  |

Ограничения:

- CHECK `quotes_discount_bp_check`: `CHECK (((discount_bp IS NULL) OR ((discount_bp >= 0) AND (discount_bp <= 10000))))`
- CHECK `quotes_discount_type_check`: `CHECK ((discount_type = ANY (ARRAY['percent'::text, 'amount'::text])))`
- CHECK `quotes_discount_value_amount_check`: `CHECK (((discount_value_amount IS NULL) OR (discount_value_amount >= 0)))`
- CHECK `quotes_guests_check`: `CHECK ((guests > 0))`
- CHECK `quotes_service_charge_bp_check`: `CHECK (((service_charge_bp >= 0) AND (service_charge_bp <= 10000)))`
- CHECK `quotes_total_amount_check`: `CHECK ((total_amount >= 0))`
- CHECK `quotes_vat_rate_bp_check`: `CHECK ((vat_rate_bp >= 0))`
- CHECK `quotes_version_check`: `CHECK ((version > 0))`
- FOREIGN KEY `quotes_request_id_fkey`: `FOREIGN KEY (request_id) REFERENCES banquet.requests(id)`
- PRIMARY KEY `quotes_pkey`: `PRIMARY KEY (id)`
- UNIQUE `quotes_request_id_version_key`: `UNIQUE (request_id, version)`

Триггеры:

- `CREATE TRIGGER quotes_immutable BEFORE DELETE OR UPDATE ON banquet.quotes FOR EACH ROW EXECUTE FUNCTION banquet.forbid_quote_change()`

### `banquet.request_activities`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| request_id | uuid | нет |  |
| kind | text | нет |  |
| text | text | да |  |
| data | jsonb | нет | `'{}'::jsonb` |
| author_kind | text | нет |  |
| author_id | uuid | да |  |
| author_name | text | нет |  |
| occurred_at | timestamp with time zone | нет |  |

Ограничения:

- CHECK `request_activities_author_kind_check`: `CHECK ((author_kind = ANY (ARRAY['staff'::text, 'system'::text, 'guest'::text])))`
- CHECK `request_activities_kind_check`: `CHECK ((kind = ANY (ARRAY['created'::text, 'note'::text, 'call'::text, 'contact'::text, 'meeting'::text, 'status_changed'::text, 'assigned'::text, 'details_updated'::text, 'venue_set'::text, 'venue_released'::text, 'quote_saved'::text, 'quote_sent'::text, 'quote_accepted'::text, 'prepayment_set'::text, 'invoice_issued'::text, 'invoice_cancelled'::text, 'payment_recorded'::text, 'refund_requested'::text, 'refund_recorded'::text, 'document_generated'::text, 'act_issued'::text, 'esf'::text, 'sla_breach'::text])))`
- FOREIGN KEY `request_activities_request_id_fkey`: `FOREIGN KEY (request_id) REFERENCES banquet.requests(id)`
- PRIMARY KEY `request_activities_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE INDEX request_activities_request_idx ON banquet.request_activities USING btree (request_id, occurred_at DESC, id DESC)`

### `banquet.requests`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| number | text | нет |  |
| status | text | нет |  |
| source | text | нет |  |
| branch_id | uuid | да |  |
| is_offsite | boolean | нет | `false` |
| offsite_address | text | да |  |
| event_date | date | нет |  |
| event_time | text | да |  |
| event_type | text | нет |  |
| guests | integer | нет |  |
| budget_amount | bigint | да |  |
| budget_currency | character(3) | нет | `'KZT'::bpchar` |
| customer_id | uuid | да |  |
| contact_name | text | нет |  |
| contact_phone | text | нет |  |
| contact_email | text | да |  |
| wishes | text | да |  |
| locale | text | нет | `'ru'::text` |
| manager_id | uuid | нет |  |
| assigned_at | timestamp with time zone | нет |  |
| company_id | uuid | да |  |
| prepayment_amount | bigint | да |  |
| prepayment_currency | character(3) | нет | `'KZT'::bpchar` |
| prepayment_is_custom | boolean | нет | `false` |
| venue_id | uuid | да |  |
| venue_reservation_id | uuid | да |  |
| venue_start | timestamp with time zone | да |  |
| venue_end | timestamp with time zone | да |  |
| contract_number | text | да |  |
| contract_date | date | да |  |
| first_response_at | timestamp with time zone | да |  |
| sla_breached_at | timestamp with time zone | да |  |
| cancel_reason | text | да |  |
| held_at | timestamp with time zone | да |  |
| cancelled_at | timestamp with time zone | да |  |
| public_token | text | нет |  |
| created_at | timestamp with time zone | нет | `now()` |
| updated_at | timestamp with time zone | нет | `now()` |
| deleted_at | timestamp with time zone | да |  |

Ограничения:

- CHECK `requests_branch_or_offsite`: `CHECK ((is_offsite OR (branch_id IS NOT NULL)))`
- CHECK `requests_budget_amount_check`: `CHECK (((budget_amount IS NULL) OR (budget_amount >= 0)))`
- CHECK `requests_event_time_check`: `CHECK (((event_time IS NULL) OR (event_time ~ '^([01][0-9]\|2[0-3]):[0-5][0-9]$'::text)))`
- CHECK `requests_event_type_check`: `CHECK ((event_type = ANY (ARRAY['wedding'::text, 'birthday'::text, 'corporate'::text, 'anniversary'::text, 'kudalyk'::text, 'memorial'::text, 'graduation'::text, 'other'::text])))`
- CHECK `requests_guests_check`: `CHECK ((guests > 0))`
- CHECK `requests_locale_check`: `CHECK ((locale = ANY (ARRAY['kk'::text, 'ru'::text, 'en'::text])))`
- CHECK `requests_offsite_address`: `CHECK (((NOT is_offsite) OR (offsite_address IS NOT NULL)))`
- CHECK `requests_prepayment_amount_check`: `CHECK (((prepayment_amount IS NULL) OR (prepayment_amount >= 0)))`
- CHECK `requests_source_check`: `CHECK ((source = ANY (ARRAY['web'::text, 'admin'::text])))`
- CHECK `requests_status_check`: `CHECK ((status = ANY (ARRAY['new'::text, 'in_progress'::text, 'quote_sent'::text, 'agreed'::text, 'prepaid'::text, 'held'::text, 'cancelled'::text])))`
- CHECK `requests_venue_consistent`: `CHECK ((((venue_id IS NULL) = (venue_reservation_id IS NULL)) AND ((venue_id IS NULL) = (venue_start IS NULL)) AND ((venue_id IS NULL) = (venue_end IS NULL))))`
- FOREIGN KEY `requests_company_id_fkey`: `FOREIGN KEY (company_id) REFERENCES banquet.client_companies(id)`
- PRIMARY KEY `requests_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE INDEX requests_branch_date_idx ON banquet.requests USING btree (branch_id, event_date)`
- `CREATE UNIQUE INDEX requests_contract_number_uq ON banquet.requests USING btree (contract_number) WHERE (contract_number IS NOT NULL)`
- `CREATE INDEX requests_customer_idx ON banquet.requests USING btree (customer_id)`
- `CREATE INDEX requests_event_date_idx ON banquet.requests USING btree (event_date)`
- `CREATE INDEX requests_manager_idx ON banquet.requests USING btree (manager_id, status)`
- `CREATE UNIQUE INDEX requests_number_uq ON banquet.requests USING btree (number)`
- `CREATE INDEX requests_sla_idx ON banquet.requests USING btree (created_at) WHERE ((status = 'new'::text) AND (first_response_at IS NULL) AND (sla_breached_at IS NULL))`
- `CREATE INDEX requests_status_idx ON banquet.requests USING btree (status, created_at DESC) WHERE (deleted_at IS NULL)`
- `CREATE UNIQUE INDEX requests_token_uq ON banquet.requests USING btree (public_token)`

Триггеры:

- `CREATE TRIGGER requests_forbid_delete BEFORE DELETE ON banquet.requests FOR EACH ROW EXECUTE FUNCTION platform.forbid_delete()`
- `CREATE TRIGGER requests_touch BEFORE UPDATE ON banquet.requests FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at()`

## Схема `payments` — Payments — платежи, возвраты, сертификаты

### `payments.certificate_check_failures`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| ip | text | нет |  |
| occurred_at | timestamp with time zone | нет |  |

Ограничения:

- PRIMARY KEY `certificate_check_failures_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE INDEX certificate_check_failures_ip_idx ON payments.certificate_check_failures USING btree (ip, occurred_at DESC)`
- `CREATE INDEX certificate_check_failures_time_idx ON payments.certificate_check_failures USING btree (occurred_at)`

### `payments.certificate_ip_blocks`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| ip | text | нет |  |
| blocked_until | timestamp with time zone | нет |  |
| failures | integer | нет |  |
| created_at | timestamp with time zone | нет | `now()` |
| updated_at | timestamp with time zone | нет | `now()` |

Ограничения:

- PRIMARY KEY `certificate_ip_blocks_pkey`: `PRIMARY KEY (ip)`

Триггеры:

- `CREATE TRIGGER certificate_ip_blocks_touch BEFORE UPDATE ON payments.certificate_ip_blocks FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at()`

### `payments.certificate_orders`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| token | text | нет |  |
| source | text | нет |  |
| product_id | uuid | нет |  |
| product_snapshot | jsonb | нет |  |
| quantity | integer | нет |  |
| unit_price_amount | bigint | нет |  |
| unit_price_currency | character(3) | нет | `'KZT'::bpchar` |
| total_amount | bigint | нет |  |
| total_currency | character(3) | нет | `'KZT'::bpchar` |
| buyer_name | text | нет |  |
| buyer_phone | text | да |  |
| buyer_email | text | да |  |
| buyer_company | text | да |  |
| recipient_name | text | нет |  |
| recipient_email | text | да |  |
| recipient_phone | text | да |  |
| message | text | да |  |
| delivery_channel | text | нет |  |
| locale | text | нет |  |
| status | text | нет |  |
| payment_id | uuid | да |  |
| idempotency_key | text | нет |  |
| consent_version | text | да |  |
| client_ip | text | да |  |
| created_by | uuid | да |  |
| issued_at | timestamp with time zone | да |  |
| created_at | timestamp with time zone | нет | `now()` |
| updated_at | timestamp with time zone | нет | `now()` |

Ограничения:

- CHECK `certificate_orders_delivery_channel_check`: `CHECK ((delivery_channel = ANY (ARRAY['email'::text, 'whatsapp'::text, 'none'::text])))`
- CHECK `certificate_orders_locale_check`: `CHECK ((locale = ANY (ARRAY['kk'::text, 'ru'::text, 'en'::text])))`
- CHECK `certificate_orders_quantity_check`: `CHECK (((quantity >= 1) AND (quantity <= 500)))`
- CHECK `certificate_orders_source_check`: `CHECK ((source = ANY (ARRAY['online'::text, 'manual'::text])))`
- CHECK `certificate_orders_status_check`: `CHECK ((status = ANY (ARRAY['awaiting_payment'::text, 'issued'::text, 'payment_failed'::text])))`
- CHECK `certificate_orders_total_amount_check`: `CHECK ((total_amount > 0))`
- CHECK `certificate_orders_unit_price_amount_check`: `CHECK ((unit_price_amount >= 0))`
- FOREIGN KEY `certificate_orders_product_id_fkey`: `FOREIGN KEY (product_id) REFERENCES payments.certificate_products(id)`
- PRIMARY KEY `certificate_orders_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE INDEX certificate_orders_buyer_idx ON payments.certificate_orders USING btree (buyer_phone)`
- `CREATE UNIQUE INDEX certificate_orders_idempotency_uq ON payments.certificate_orders USING btree (idempotency_key)`
- `CREATE UNIQUE INDEX certificate_orders_token_uq ON payments.certificate_orders USING btree (token)`

Триггеры:

- `CREATE TRIGGER certificate_orders_touch BEFORE UPDATE ON payments.certificate_orders FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at()`

### `payments.certificate_products`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| slug | text | нет |  |
| kind | text | нет |  |
| name | jsonb | нет |  |
| description | jsonb | нет | `'{}'::jsonb` |
| nominal_amount | bigint | нет |  |
| nominal_currency | character(3) | нет | `'KZT'::bpchar` |
| price_amount | bigint | нет |  |
| price_currency | character(3) | нет | `'KZT'::bpchar` |
| validity_months | integer | нет | `12` |
| design | jsonb | нет | `'{}'::jsonb` |
| is_active | boolean | нет | `true` |
| sort_order | integer | нет | `0` |
| created_at | timestamp with time zone | нет | `now()` |
| updated_at | timestamp with time zone | нет | `now()` |
| deleted_at | timestamp with time zone | да |  |

Ограничения:

- CHECK `certificate_products_kind_check`: `CHECK ((kind = ANY (ARRAY['amount'::text, 'set'::text])))`
- CHECK `certificate_products_nominal_amount_check`: `CHECK ((nominal_amount > 0))`
- CHECK `certificate_products_price_amount_check`: `CHECK ((price_amount >= 0))`
- CHECK `certificate_products_slug_check`: `CHECK ((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text))`
- CHECK `certificate_products_validity_months_check`: `CHECK (((validity_months >= 1) AND (validity_months <= 60)))`
- PRIMARY KEY `certificate_products_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE UNIQUE INDEX certificate_products_slug_uq ON payments.certificate_products USING btree (slug) WHERE (deleted_at IS NULL)`

Триггеры:

- `CREATE TRIGGER certificate_products_touch BEFORE UPDATE ON payments.certificate_products FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at()`

### `payments.certificate_transactions`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| certificate_id | uuid | нет |  |
| kind | text | нет |  |
| change_amount | bigint | нет |  |
| change_currency | character(3) | нет | `'KZT'::bpchar` |
| balance_after_amount | bigint | нет |  |
| balance_after_currency | character(3) | нет | `'KZT'::bpchar` |
| channel | text | нет |  |
| payment_id | uuid | да |  |
| refund_id | uuid | да |  |
| reference_type | text | да |  |
| reference_id | text | да |  |
| branch_id | uuid | да |  |
| actor_user_id | uuid | да |  |
| actor_name | text | нет |  |
| comment | text | да |  |
| occurred_at | timestamp with time zone | нет |  |

Ограничения:

- CHECK `certificate_transactions_balance_after_amount_check`: `CHECK ((balance_after_amount >= 0))`
- CHECK `certificate_transactions_change_amount_check`: `CHECK ((change_amount >= 0))`
- CHECK `certificate_transactions_channel_check`: `CHECK ((channel = ANY (ARRAY['order'::text, 'point'::text, 'refund'::text, 'sale'::text, 'system'::text, 'admin'::text])))`
- CHECK `certificate_transactions_kind_check`: `CHECK ((kind = ANY (ARRAY['issue'::text, 'debit'::text, 'credit'::text, 'expire'::text, 'reinstate'::text])))`
- FOREIGN KEY `certificate_transactions_certificate_id_fkey`: `FOREIGN KEY (certificate_id) REFERENCES payments.gift_certificates(id)`
- PRIMARY KEY `certificate_transactions_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE INDEX certificate_transactions_cert_idx ON payments.certificate_transactions USING btree (certificate_id, occurred_at)`
- `CREATE INDEX certificate_transactions_time_idx ON payments.certificate_transactions USING btree (occurred_at, kind)`

Триггеры:

- `CREATE TRIGGER certificate_transactions_append_only BEFORE DELETE OR UPDATE ON payments.certificate_transactions FOR EACH ROW EXECUTE FUNCTION platform.forbid_update_delete()`

### `payments.gift_certificates`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| code_hash | text | нет |  |
| last4 | character(4) | нет |  |
| order_id | uuid | нет |  |
| product_id | uuid | нет |  |
| kind | text | нет |  |
| name | jsonb | нет |  |
| set_description | jsonb | да |  |
| nominal_amount | bigint | нет |  |
| nominal_currency | character(3) | нет | `'KZT'::bpchar` |
| balance_amount | bigint | нет |  |
| balance_currency | character(3) | нет | `'KZT'::bpchar` |
| price_amount | bigint | нет |  |
| price_currency | character(3) | нет | `'KZT'::bpchar` |
| status | text | нет |  |
| status_reason | text | да |  |
| issued_at | timestamp with time zone | нет |  |
| expires_at | timestamp with time zone | нет |  |
| buyer_name | text | да |  |
| buyer_phone | text | да |  |
| buyer_email | text | да |  |
| recipient_name | text | да |  |
| recipient_email | text | да |  |
| recipient_phone | text | да |  |
| message | text | да |  |
| delivery_channel | text | нет |  |
| locale | text | нет |  |
| pdf_file_key | text | да |  |
| delivery_count | integer | нет | `0` |
| last_delivered_at | timestamp with time zone | да |  |
| created_at | timestamp with time zone | нет | `now()` |
| updated_at | timestamp with time zone | нет | `now()` |

Ограничения:

- CHECK `gift_certificates_balance_le_nominal`: `CHECK ((balance_amount <= nominal_amount))`
- CHECK `gift_certificates_balance_non_negative`: `CHECK ((balance_amount >= 0))`
- CHECK `gift_certificates_delivery_channel_check`: `CHECK ((delivery_channel = ANY (ARRAY['email'::text, 'whatsapp'::text, 'none'::text])))`
- CHECK `gift_certificates_kind_check`: `CHECK ((kind = ANY (ARRAY['amount'::text, 'set'::text])))`
- CHECK `gift_certificates_locale_check`: `CHECK ((locale = ANY (ARRAY['kk'::text, 'ru'::text, 'en'::text])))`
- CHECK `gift_certificates_nominal_amount_check`: `CHECK ((nominal_amount > 0))`
- CHECK `gift_certificates_price_amount_check`: `CHECK ((price_amount >= 0))`
- CHECK `gift_certificates_status_check`: `CHECK ((status = ANY (ARRAY['active'::text, 'redeemed'::text, 'expired'::text, 'blocked'::text])))`
- FOREIGN KEY `gift_certificates_order_id_fkey`: `FOREIGN KEY (order_id) REFERENCES payments.certificate_orders(id)`
- PRIMARY KEY `gift_certificates_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE INDEX gift_certificates_buyer_idx ON payments.gift_certificates USING btree (buyer_phone)`
- `CREATE UNIQUE INDEX gift_certificates_code_uq ON payments.gift_certificates USING btree (code_hash)`
- `CREATE INDEX gift_certificates_expiry_idx ON payments.gift_certificates USING btree (expires_at) WHERE (status = 'active'::text)`
- `CREATE INDEX gift_certificates_last4_idx ON payments.gift_certificates USING btree (last4)`
- `CREATE INDEX gift_certificates_order_idx ON payments.gift_certificates USING btree (order_id)`

Триггеры:

- `CREATE TRIGGER gift_certificates_forbid_delete BEFORE DELETE ON payments.gift_certificates FOR EACH ROW EXECUTE FUNCTION platform.forbid_delete()`
- `CREATE TRIGGER gift_certificates_touch BEFORE UPDATE ON payments.gift_certificates FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at()`

### `payments.payments`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| invoice_no | bigint | нет | `nextval('payments.invoice_no_seq'::regclass)` |
| purpose | text | нет |  |
| reference_id | text | нет |  |
| branch_id | uuid | да |  |
| method | text | нет |  |
| provider | text | нет |  |
| status | text | нет |  |
| payment_amount | bigint | нет |  |
| payment_currency | character(3) | нет | `'KZT'::bpchar` |
| refunded_amount | bigint | нет | `0` |
| refunded_currency | character(3) | нет | `'KZT'::bpchar` |
| external_id | text | да |  |
| payment_url | text | да |  |
| provider_data | jsonb | нет | `'{}'::jsonb` |
| description | text | нет |  |
| customer_phone | text | да |  |
| customer_name | text | да |  |
| customer_email | text | да |  |
| return_url | text | да |  |
| idempotency_key | text | нет |  |
| certificate_id | uuid | да |  |
| document_number | text | да |  |
| failure_reason | text | да |  |
| cancel_reason | text | да |  |
| initiate_attempts | integer | нет | `0` |
| last_checked_at | timestamp with time zone | да |  |
| expiry_check_at | timestamp with time zone | да |  |
| amount_mismatch_at | timestamp with time zone | да |  |
| expires_at | timestamp with time zone | да |  |
| paid_at | timestamp with time zone | да |  |
| failed_at | timestamp with time zone | да |  |
| cancelled_at | timestamp with time zone | да |  |
| created_at | timestamp with time zone | нет | `now()` |
| updated_at | timestamp with time zone | нет | `now()` |
| deleted_at | timestamp with time zone | да |  |

Ограничения:

- CHECK `payments_certificate_required`: `CHECK (((method <> 'gift_certificate'::text) OR (certificate_id IS NOT NULL)))`
- CHECK `payments_method_check`: `CHECK ((method = ANY (ARRAY['online'::text, 'on_receipt'::text, 'gift_certificate'::text, 'bank_transfer'::text])))`
- CHECK `payments_payment_amount_check`: `CHECK ((payment_amount > 0))`
- CHECK `payments_provider_check`: `CHECK ((provider ~ '^[a-z0-9_]+$'::text))`
- CHECK `payments_purpose_check`: `CHECK ((purpose = ANY (ARRAY['order'::text, 'reservation_deposit'::text, 'banquet_invoice'::text, 'gift_certificate'::text])))`
- CHECK `payments_refunded_currency`: `CHECK ((refunded_currency = payment_currency))`
- CHECK `payments_refunded_le_amount`: `CHECK (((refunded_amount >= 0) AND (refunded_amount <= payment_amount)))`
- CHECK `payments_status_check`: `CHECK ((status = ANY (ARRAY['created'::text, 'pending'::text, 'succeeded'::text, 'failed'::text, 'cancelled'::text, 'partially_refunded'::text, 'refunded'::text])))`
- PRIMARY KEY `payments_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE INDEX payments_branch_idx ON payments.payments USING btree (branch_id, created_at DESC)`
- `CREATE INDEX payments_created_idx ON payments.payments USING btree (created_at DESC)`
- `CREATE UNIQUE INDEX payments_external_uq ON payments.payments USING btree (provider, external_id) WHERE (external_id IS NOT NULL)`
- `CREATE UNIQUE INDEX payments_idempotency_uq ON payments.payments USING btree (idempotency_key)`
- `CREATE UNIQUE INDEX payments_invoice_no_uq ON payments.payments USING btree (invoice_no)`
- `CREATE INDEX payments_open_idx ON payments.payments USING btree (status, expires_at) WHERE (status = ANY (ARRAY['created'::text, 'pending'::text]))`
- `CREATE INDEX payments_reference_idx ON payments.payments USING btree (purpose, reference_id)`

Триггеры:

- `CREATE TRIGGER payments_forbid_delete BEFORE DELETE ON payments.payments FOR EACH ROW EXECUTE FUNCTION platform.forbid_delete()`
- `CREATE TRIGGER payments_touch BEFORE UPDATE ON payments.payments FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at()`

### `payments.refunds`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| payment_id | uuid | нет |  |
| refund_amount | bigint | нет |  |
| refund_currency | character(3) | нет | `'KZT'::bpchar` |
| status | text | нет |  |
| mode | text | нет |  |
| reason | text | нет |  |
| idempotency_key | text | нет |  |
| external_refund_id | text | да |  |
| attempts | integer | нет | `0` |
| claimed_at | timestamp with time zone | да |  |
| failure_reason | text | да |  |
| comment | text | да |  |
| requested_by | uuid | да |  |
| completed_by | uuid | да |  |
| completed_at | timestamp with time zone | да |  |
| created_at | timestamp with time zone | нет | `now()` |
| updated_at | timestamp with time zone | нет | `now()` |

Ограничения:

- CHECK `refunds_mode_check`: `CHECK ((mode = ANY (ARRAY['gateway'::text, 'certificate'::text, 'manual'::text])))`
- CHECK `refunds_refund_amount_check`: `CHECK ((refund_amount > 0))`
- CHECK `refunds_status_check`: `CHECK ((status = ANY (ARRAY['pending'::text, 'succeeded'::text, 'failed'::text])))`
- FOREIGN KEY `refunds_payment_id_fkey`: `FOREIGN KEY (payment_id) REFERENCES payments.payments(id)`
- PRIMARY KEY `refunds_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE UNIQUE INDEX refunds_idempotency_uq ON payments.refunds USING btree (idempotency_key)`
- `CREATE INDEX refunds_payment_idx ON payments.refunds USING btree (payment_id)`
- `CREATE INDEX refunds_status_idx ON payments.refunds USING btree (status, created_at)`

Триггеры:

- `CREATE TRIGGER refunds_forbid_delete BEFORE DELETE ON payments.refunds FOR EACH ROW EXECUTE FUNCTION platform.forbid_delete()`
- `CREATE TRIGGER refunds_touch BEFORE UPDATE ON payments.refunds FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at()`

### `payments.sandbox_sessions`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| external_id | text | нет |  |
| payment_id | uuid | нет |  |
| session_amount | bigint | нет |  |
| session_currency | character(3) | нет | `'KZT'::bpchar` |
| status | text | нет |  |
| refunded_amount | bigint | нет | `0` |
| refunded_currency | character(3) | нет | `'KZT'::bpchar` |
| created_at | timestamp with time zone | нет | `now()` |
| updated_at | timestamp with time zone | нет | `now()` |

Ограничения:

- CHECK `sandbox_sessions_session_amount_check`: `CHECK ((session_amount > 0))`
- CHECK `sandbox_sessions_status_check`: `CHECK ((status = ANY (ARRAY['pending'::text, 'succeeded'::text, 'failed'::text])))`
- PRIMARY KEY `sandbox_sessions_pkey`: `PRIMARY KEY (external_id)`

Триггеры:

- `CREATE TRIGGER sandbox_sessions_touch BEFORE UPDATE ON payments.sandbox_sessions FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at()`

### `payments.webhook_events`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| provider | text | нет |  |
| event_id | text | нет |  |
| payment_id | uuid | да |  |
| external_id | text | да |  |
| status | text | нет |  |
| reported_amount | bigint | да |  |
| reported_currency | character(3) | нет | `'KZT'::bpchar` |
| outcome | text | нет |  |
| received_at | timestamp with time zone | нет | `now()` |

Ограничения:

- CHECK `webhook_events_outcome_check`: `CHECK ((outcome = ANY (ARRAY['applied'::text, 'ignored'::text, 'unknown_payment'::text, 'amount_mismatch'::text])))`
- PRIMARY KEY `webhook_events_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE INDEX webhook_events_payment_idx ON payments.webhook_events USING btree (payment_id, received_at DESC)`
- `CREATE UNIQUE INDEX webhook_events_uq ON payments.webhook_events USING btree (provider, event_id)`

## Схема `customers` — Customers — гости, согласия, история, сегменты

### `customers.activities`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| customer_id | uuid | нет |  |
| type | text | нет |  |
| entity_type | text | нет |  |
| entity_id | text | нет |  |
| branch_id | uuid | да |  |
| money_amount | bigint | да |  |
| money_currency | character(3) | нет | `'KZT'::bpchar` |
| counts_as_spent | boolean | нет | `false` |
| summary | text | нет |  |
| meta | jsonb | нет | `'{}'::jsonb` |
| occurred_at | timestamp with time zone | нет |  |
| source_event_id | uuid | да |  |
| created_at | timestamp with time zone | нет | `now()` |

Ограничения:

- CHECK `activities_spent_amount`: `CHECK (((NOT counts_as_spent) OR ((money_amount IS NOT NULL) AND ((money_amount >= 0) OR (type = 'order_refunded'::text)))))`
- CHECK `activities_type_check`: `CHECK ((type = ANY (ARRAY['order_placed'::text, 'order_completed'::text, 'order_cancelled'::text, 'order_refunded'::text, 'reservation_created'::text, 'reservation_arrived'::text, 'reservation_no_show'::text, 'reservation_cancelled'::text, 'reservation_expired'::text, 'reservation_status_changed'::text, 'banquet_requested'::text, 'banquet_status_changed'::text, 'banquet_held'::text, 'banquet_cancelled'::text, 'banquet_invoice_issued'::text, 'certificate_purchased'::text])))`
- FOREIGN KEY `activities_customer_id_fkey`: `FOREIGN KEY (customer_id) REFERENCES customers.customers(id)`
- PRIMARY KEY `activities_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE INDEX activities_branch_idx ON customers.activities USING btree (branch_id, customer_id)`
- `CREATE INDEX activities_customer_idx ON customers.activities USING btree (customer_id, occurred_at DESC)`
- `CREATE UNIQUE INDEX activities_source_event_uq ON customers.activities USING btree (source_event_id, type) WHERE (source_event_id IS NOT NULL)`

Триггеры:

- `CREATE TRIGGER activities_append_only BEFORE DELETE OR UPDATE ON customers.activities FOR EACH ROW EXECUTE FUNCTION platform.forbid_update_delete()`

### `customers.banquet_links`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| request_id | text | нет |  |
| customer_id | uuid | нет |  |
| number | text | нет |  |
| created_at | timestamp with time zone | нет | `now()` |
| updated_at | timestamp with time zone | нет | `now()` |

Ограничения:

- FOREIGN KEY `banquet_links_customer_id_fkey`: `FOREIGN KEY (customer_id) REFERENCES customers.customers(id)`
- PRIMARY KEY `banquet_links_pkey`: `PRIMARY KEY (request_id)`

Индексы:

- `CREATE INDEX banquet_links_customer_idx ON customers.banquet_links USING btree (customer_id)`

Триггеры:

- `CREATE TRIGGER banquet_links_touch BEFORE UPDATE ON customers.banquet_links FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at()`

### `customers.consent_texts`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| kind | text | нет |  |
| version | text | нет |  |
| text | jsonb | нет |  |
| published_at | timestamp with time zone | нет |  |
| published_by | uuid | да |  |
| created_at | timestamp with time zone | нет | `now()` |

Ограничения:

- CHECK `consent_texts_kind_check`: `CHECK ((kind = ANY (ARRAY['personal_data'::text, 'marketing'::text])))`
- CHECK `consent_texts_version_check`: `CHECK ((version ~ '^[A-Za-z0-9._-]{1,32}$'::text))`
- PRIMARY KEY `consent_texts_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE INDEX consent_texts_current_idx ON customers.consent_texts USING btree (kind, published_at DESC, id DESC)`
- `CREATE UNIQUE INDEX consent_texts_kind_version_uq ON customers.consent_texts USING btree (kind, version)`

Триггеры:

- `CREATE TRIGGER consent_texts_append_only BEFORE DELETE OR UPDATE ON customers.consent_texts FOR EACH ROW EXECUTE FUNCTION platform.forbid_update_delete()`

### `customers.consents`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| customer_id | uuid | нет |  |
| kind | text | нет |  |
| granted | boolean | нет |  |
| text_version | text | нет |  |
| source | text | нет |  |
| ip | text | да |  |
| recorded_by | uuid | да |  |
| recorded_at | timestamp with time zone | нет |  |
| created_at | timestamp with time zone | нет | `now()` |

Ограничения:

- CHECK `consents_kind_check`: `CHECK ((kind = ANY (ARRAY['personal_data'::text, 'marketing'::text])))`
- CHECK `consents_source_check`: `CHECK ((source = ANY (ARRAY['web'::text, 'admin'::text, 'phone'::text])))`
- FOREIGN KEY `consents_customer_id_fkey`: `FOREIGN KEY (customer_id) REFERENCES customers.customers(id)`
- PRIMARY KEY `consents_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE INDEX consents_customer_idx ON customers.consents USING btree (customer_id, recorded_at DESC)`

Триггеры:

- `CREATE TRIGGER consents_append_only BEFORE DELETE OR UPDATE ON customers.consents FOR EACH ROW EXECUTE FUNCTION customers.consents_append_only()`

### `customers.customers`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| phone | text | нет |  |
| name | text | да |  |
| email | text | да |  |
| locale | text | нет | `'ru'::text` |
| birthday | date | да |  |
| tags | _text | нет | `'{}'::text[]` |
| allergies | text | да |  |
| preferences | text | да |  |
| notes | text | да |  |
| personal_data_consent | boolean | нет | `false` |
| personal_data_consent_version | text | да |  |
| personal_data_consent_at | timestamp with time zone | да |  |
| marketing_consent | boolean | нет | `false` |
| marketing_consent_version | text | да |  |
| marketing_consent_at | timestamp with time zone | да |  |
| first_seen_at | timestamp with time zone | нет |  |
| last_activity_at | timestamp with time zone | да |  |
| orders_count | integer | нет | `0` |
| completed_orders_count | integer | нет | `0` |
| total_spent_amount | bigint | нет | `0` |
| total_spent_currency | character(3) | нет | `'KZT'::bpchar` |
| reservations_count | integer | нет | `0` |
| no_show_count | integer | нет | `0` |
| banquets_count | integer | нет | `0` |
| anonymized_at | timestamp with time zone | да |  |
| created_at | timestamp with time zone | нет | `now()` |
| updated_at | timestamp with time zone | нет | `now()` |
| deleted_at | timestamp with time zone | да |  |

Ограничения:

- CHECK `customers_banquets_count_check`: `CHECK ((banquets_count >= 0))`
- CHECK `customers_completed_orders_count_check`: `CHECK ((completed_orders_count >= 0))`
- CHECK `customers_email_lower`: `CHECK (((email IS NULL) OR (email = lower(email))))`
- CHECK `customers_locale_check`: `CHECK ((locale = ANY (ARRAY['kk'::text, 'ru'::text, 'en'::text])))`
- CHECK `customers_no_show_count_check`: `CHECK ((no_show_count >= 0))`
- CHECK `customers_orders_count_check`: `CHECK ((orders_count >= 0))`
- CHECK `customers_phone_format`: `CHECK (((phone ~ '^\+7\d{10}$'::text) OR ((anonymized_at IS NOT NULL) AND (phone ~ '^anon:[0-9a-f]{64}$'::text))))`
- CHECK `customers_reservations_count_check`: `CHECK ((reservations_count >= 0))`
- CHECK `customers_total_spent_amount_check`: `CHECK ((total_spent_amount >= 0))`
- PRIMARY KEY `customers_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE INDEX customers_email_trgm_idx ON customers.customers USING gin (email gin_trgm_ops)`
- `CREATE INDEX customers_last_activity_idx ON customers.customers USING btree (last_activity_at DESC NULLS LAST)`
- `CREATE INDEX customers_name_trgm_idx ON customers.customers USING gin (lower(name) gin_trgm_ops)`
- `CREATE UNIQUE INDEX customers_phone_uq ON customers.customers USING btree (phone) WHERE (deleted_at IS NULL)`
- `CREATE INDEX customers_tags_idx ON customers.customers USING gin (tags)`
- `CREATE INDEX customers_total_spent_idx ON customers.customers USING btree (total_spent_amount)`

Триггеры:

- `CREATE TRIGGER customers_touch BEFORE UPDATE ON customers.customers FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at()`

### `customers.phone_verifications`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| phone | text | нет |  |
| code_hash | text | нет |  |
| locale | text | нет | `'ru'::text` |
| expires_at | timestamp with time zone | нет |  |
| attempts | integer | нет | `0` |
| verified_at | timestamp with time zone | да |  |
| superseded_at | timestamp with time zone | да |  |
| ip | text | да |  |
| created_at | timestamp with time zone | нет |  |

Ограничения:

- CHECK `phone_verifications_attempts_check`: `CHECK ((attempts >= 0))`
- CHECK `phone_verifications_locale_check`: `CHECK ((locale = ANY (ARRAY['kk'::text, 'ru'::text, 'en'::text])))`
- CHECK `phone_verifications_phone_check`: `CHECK ((phone ~ '^\+7\d{10}$'::text))`
- PRIMARY KEY `phone_verifications_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE INDEX phone_verifications_created_idx ON customers.phone_verifications USING btree (created_at)`
- `CREATE INDEX phone_verifications_phone_idx ON customers.phone_verifications USING btree (phone, created_at DESC)`

### `customers.segments`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| name | text | нет |  |
| description | text | да |  |
| filter | jsonb | нет | `'{}'::jsonb` |
| created_by | uuid | да |  |
| updated_by | uuid | да |  |
| created_at | timestamp with time zone | нет | `now()` |
| updated_at | timestamp with time zone | нет | `now()` |
| deleted_at | timestamp with time zone | да |  |

Ограничения:

- CHECK `segments_name_check`: `CHECK (((length(name) >= 1) AND (length(name) <= 120)))`
- PRIMARY KEY `segments_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE UNIQUE INDEX segments_name_uq ON customers.segments USING btree (lower(name)) WHERE (deleted_at IS NULL)`

Триггеры:

- `CREATE TRIGGER segments_touch BEFORE UPDATE ON customers.segments FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at()`

## Схема `notifications` — Notifications — сообщения, шаблоны, лента админки

### `notifications.admin_feed`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| occurred_at | timestamp with time zone | нет |  |
| branch_id | uuid | да |  |
| stream | text | нет |  |
| kind | text | нет |  |
| entity_id | text | нет |  |
| title | text | нет |  |
| sound | boolean | нет | `false` |

Ограничения:

- CHECK `admin_feed_kind_check`: `CHECK ((kind = ANY (ARRAY['created'::text, 'updated'::text])))`
- CHECK `admin_feed_stream_check`: `CHECK ((stream = ANY (ARRAY['orders'::text, 'reservations'::text, 'banquets'::text, 'system'::text])))`
- PRIMARY KEY `admin_feed_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE INDEX admin_feed_stream_idx ON notifications.admin_feed USING btree (stream, branch_id, occurred_at DESC)`
- `CREATE INDEX admin_feed_time_idx ON notifications.admin_feed USING btree (occurred_at DESC)`

### `notifications.deliveries`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| message_id | uuid | нет |  |
| target_kind | text | нет |  |
| staff_user_id | uuid | да |  |
| recipient_name | text | да |  |
| chain | jsonb | нет |  |
| step_index | integer | нет | `0` |
| channel | text | нет |  |
| address | text | нет |  |
| provider | text | да |  |
| status | text | нет | `'pending'::text` |
| attempts | integer | нет | `0` |
| channel_attempts | integer | нет | `0` |
| external_id | text | да |  |
| last_error | text | да |  |
| rendered_subject | text | да |  |
| rendered_text | text | да |  |
| sent_at | timestamp with time zone | да |  |
| delivered_at | timestamp with time zone | да |  |
| read_at | timestamp with time zone | да |  |
| created_at | timestamp with time zone | нет | `now()` |
| updated_at | timestamp with time zone | нет | `now()` |

Ограничения:

- CHECK `deliveries_attempts_check`: `CHECK ((attempts >= 0))`
- CHECK `deliveries_chain_check`: `CHECK ((jsonb_typeof(chain) = 'array'::text))`
- CHECK `deliveries_channel_attempts_check`: `CHECK ((channel_attempts >= 0))`
- CHECK `deliveries_channel_check`: `CHECK ((channel = ANY (ARRAY['whatsapp'::text, 'sms'::text, 'email'::text, 'telegram'::text])))`
- CHECK `deliveries_status_check`: `CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text])))`
- CHECK `deliveries_step_index_check`: `CHECK ((step_index >= 0))`
- CHECK `deliveries_target_kind_check`: `CHECK ((target_kind = ANY (ARRAY['guest'::text, 'staff_user'::text, 'branch'::text, 'direct'::text])))`
- FOREIGN KEY `deliveries_message_id_fkey`: `FOREIGN KEY (message_id) REFERENCES notifications.messages(id)`
- PRIMARY KEY `deliveries_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE INDEX deliveries_address_idx ON notifications.deliveries USING btree (address)`
- `CREATE INDEX deliveries_created_idx ON notifications.deliveries USING btree (created_at DESC)`
- `CREATE INDEX deliveries_external_idx ON notifications.deliveries USING btree (provider, external_id) WHERE (external_id IS NOT NULL)`
- `CREATE INDEX deliveries_message_idx ON notifications.deliveries USING btree (message_id)`
- `CREATE INDEX deliveries_status_idx ON notifications.deliveries USING btree (status, created_at DESC)`

Триггеры:

- `CREATE TRIGGER deliveries_touch BEFORE UPDATE ON notifications.deliveries FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at()`

### `notifications.delivery_attempts`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| delivery_id | uuid | нет |  |
| message_id | uuid | нет |  |
| attempt_no | integer | нет |  |
| channel | text | нет |  |
| provider | text | да |  |
| address_masked | text | нет |  |
| status | text | нет |  |
| retryable | boolean | нет | `false` |
| error_code | text | да |  |
| error | text | да |  |
| external_id | text | да |  |
| duration_ms | integer | да |  |
| occurred_at | timestamp with time zone | нет | `now()` |

Ограничения:

- CHECK `delivery_attempts_attempt_no_check`: `CHECK ((attempt_no >= 1))`
- CHECK `delivery_attempts_channel_check`: `CHECK ((channel = ANY (ARRAY['whatsapp'::text, 'sms'::text, 'email'::text, 'telegram'::text])))`
- CHECK `delivery_attempts_status_check`: `CHECK ((status = ANY (ARRAY['sent'::text, 'failed'::text, 'skipped'::text])))`
- FOREIGN KEY `delivery_attempts_delivery_id_fkey`: `FOREIGN KEY (delivery_id) REFERENCES notifications.deliveries(id)`
- FOREIGN KEY `delivery_attempts_message_id_fkey`: `FOREIGN KEY (message_id) REFERENCES notifications.messages(id)`
- PRIMARY KEY `delivery_attempts_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE INDEX delivery_attempts_delivery_idx ON notifications.delivery_attempts USING btree (delivery_id, occurred_at)`

### `notifications.messages`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| audience | text | нет |  |
| template | text | нет |  |
| locale | text | нет |  |
| params | jsonb | нет | `'{}'::jsonb` |
| secret_params | text | да |  |
| recipient | jsonb | нет |  |
| attachments | jsonb | нет | `'[]'::jsonb` |
| channel_plan | jsonb | нет | `'[]'::jsonb` |
| status | text | нет | `'queued'::text` |
| attempts | integer | нет | `0` |
| job_runs | integer | нет | `0` |
| dedupe_key | text | да |  |
| related_type | text | да |  |
| related_id | text | да |  |
| branch_id | uuid | да |  |
| resent_from_id | uuid | да |  |
| created_by | uuid | да |  |
| planned_at | timestamp with time zone | да |  |
| locked_until | timestamp with time zone | да |  |
| expires_at | timestamp with time zone | да |  |
| completed_at | timestamp with time zone | да |  |
| last_error | text | да |  |
| created_at | timestamp with time zone | нет | `now()` |
| updated_at | timestamp with time zone | нет | `now()` |

Ограничения:

- CHECK `messages_attachments_check`: `CHECK ((jsonb_typeof(attachments) = 'array'::text))`
- CHECK `messages_attempts_check`: `CHECK ((attempts >= 0))`
- CHECK `messages_audience_check`: `CHECK ((audience = ANY (ARRAY['guest'::text, 'staff'::text])))`
- CHECK `messages_channel_plan_check`: `CHECK ((jsonb_typeof(channel_plan) = 'array'::text))`
- CHECK `messages_dedupe_key_check`: `CHECK (((dedupe_key IS NULL) OR ((length(dedupe_key) >= 1) AND (length(dedupe_key) <= 300))))`
- CHECK `messages_job_runs_check`: `CHECK ((job_runs >= 0))`
- CHECK `messages_locale_check`: `CHECK ((locale = ANY (ARRAY['kk'::text, 'ru'::text, 'en'::text])))`
- CHECK `messages_params_check`: `CHECK ((jsonb_typeof(params) = 'object'::text))`
- CHECK `messages_recipient_check`: `CHECK ((jsonb_typeof(recipient) = 'object'::text))`
- CHECK `messages_status_check`: `CHECK ((status = ANY (ARRAY['queued'::text, 'sent'::text, 'partial'::text, 'failed'::text, 'skipped'::text])))`
- PRIMARY KEY `messages_pkey`: `PRIMARY KEY (id)`
- UNIQUE `messages_dedupe_key_key`: `UNIQUE (dedupe_key)`

Индексы:

- `CREATE INDEX messages_created_idx ON notifications.messages USING btree (created_at DESC)`
- `CREATE INDEX messages_related_idx ON notifications.messages USING btree (related_type, related_id)`
- `CREATE INDEX messages_secrets_idx ON notifications.messages USING btree (completed_at) WHERE (secret_params IS NOT NULL)`
- `CREATE INDEX messages_status_idx ON notifications.messages USING btree (status, created_at)`
- `CREATE INDEX messages_template_idx ON notifications.messages USING btree (template, created_at DESC)`

Триггеры:

- `CREATE TRIGGER messages_touch BEFORE UPDATE ON notifications.messages FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at()`

### `notifications.provider_events`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| key | text | нет |  |
| received_at | timestamp with time zone | нет | `now()` |

Ограничения:

- PRIMARY KEY `provider_events_pkey`: `PRIMARY KEY (key)`

### `notifications.templates`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| key | text | нет |  |
| channel | text | нет |  |
| locale | text | нет |  |
| subject | text | да |  |
| body | text | нет |  |
| updated_by | uuid | да |  |
| created_at | timestamp with time zone | нет | `now()` |
| updated_at | timestamp with time zone | нет | `now()` |

Ограничения:

- CHECK `templates_body_check`: `CHECK (((length(body) >= 1) AND (length(body) <= 20000)))`
- CHECK `templates_channel_check`: `CHECK ((channel = ANY (ARRAY['whatsapp'::text, 'sms'::text, 'email'::text, 'telegram'::text])))`
- CHECK `templates_key_check`: `CHECK ((key ~ '^[a-z_]+\.[a-z_]+$'::text))`
- CHECK `templates_locale_check`: `CHECK ((locale = ANY (ARRAY['kk'::text, 'ru'::text, 'en'::text])))`
- CHECK `templates_subject_check`: `CHECK (((subject IS NULL) OR (length(subject) <= 300)))`
- PRIMARY KEY `templates_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE UNIQUE INDEX templates_key_channel_locale_uq ON notifications.templates USING btree (key, channel, locale)`

Триггеры:

- `CREATE TRIGGER templates_touch BEFORE UPDATE ON notifications.templates FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at()`

## Схема `reporting` — Reporting — проекции для отчётов (только чтение)

### `reporting.accounting_exports`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| format | text | нет |  |
| period_from | date | нет |  |
| period_to | date | нет |  |
| branch_id | uuid | да |  |
| status | text | нет |  |
| build_attempts | integer | нет | `0` |
| file_key | text | да |  |
| file_name | text | да |  |
| content_type | text | да |  |
| size_bytes | integer | да |  |
| totals | jsonb | да |  |
| error | text | да |  |
| push_requested | boolean | нет | `true` |
| push_status | text | нет | `'not_required'::text` |
| push_attempts | integer | нет | `0` |
| pushed_at | timestamp with time zone | да |  |
| push_error | text | да |  |
| requested_by | uuid | да |  |
| requested_at | timestamp with time zone | нет |  |
| completed_at | timestamp with time zone | да |  |
| created_at | timestamp with time zone | нет | `now()` |
| updated_at | timestamp with time zone | нет | `now()` |

Ограничения:

- CHECK `accounting_exports_format_check`: `CHECK ((format = ANY (ARRAY['onec_xml'::text, 'xlsx'::text])))`
- CHECK `accounting_exports_period`: `CHECK ((period_to >= period_from))`
- CHECK `accounting_exports_push_status_check`: `CHECK ((push_status = ANY (ARRAY['not_required'::text, 'pending'::text, 'pushed'::text, 'failed'::text])))`
- CHECK `accounting_exports_status_check`: `CHECK ((status = ANY (ARRAY['pending'::text, 'ready'::text, 'failed'::text])))`
- PRIMARY KEY `accounting_exports_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE INDEX accounting_exports_requested_idx ON reporting.accounting_exports USING btree (requested_at DESC)`

Триггеры:

- `CREATE TRIGGER accounting_exports_touch BEFORE UPDATE ON reporting.accounting_exports FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at()`

### `reporting.aggregator_volumes`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| branch_id | uuid | нет |  |
| month | date | нет |  |
| source | text | нет |  |
| source_name | text | нет |  |
| orders_count | integer | нет |  |
| revenue_amount | bigint | нет | `0` |
| revenue_currency | character(3) | нет | `'KZT'::bpchar` |
| updated_by | uuid | да |  |
| created_at | timestamp with time zone | нет | `now()` |
| updated_at | timestamp with time zone | нет | `now()` |

Ограничения:

- CHECK `aggregator_volumes_month_check`: `CHECK ((EXTRACT(day FROM month) = (1)::numeric))`
- CHECK `aggregator_volumes_orders_count_check`: `CHECK ((orders_count >= 0))`
- CHECK `aggregator_volumes_revenue_amount_check`: `CHECK ((revenue_amount >= 0))`
- CHECK `aggregator_volumes_source_check`: `CHECK ((source ~ '^[a-z0-9_]{2,32}$'::text))`
- PRIMARY KEY `aggregator_volumes_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE UNIQUE INDEX aggregator_volumes_uq ON reporting.aggregator_volumes USING btree (branch_id, month, source)`

Триггеры:

- `CREATE TRIGGER aggregator_volumes_touch BEFORE UPDATE ON reporting.aggregator_volumes FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at()`

### `reporting.banquet_requests`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| request_id | uuid | нет |  |
| number | text | нет |  |
| branch_id | uuid | да |  |
| is_offsite | boolean | нет | `false` |
| event_date | date | да |  |
| event_type | text | да |  |
| guests | integer | да |  |
| budget_amount | bigint | да |  |
| budget_currency | character(3) | нет | `'KZT'::bpchar` |
| manager_id | uuid | да |  |
| manager_at | timestamp with time zone | да |  |
| source | text | да |  |
| status | text | нет |  |
| status_at | timestamp with time zone | нет |  |
| status_rank | smallint | нет |  |
| max_stage | smallint | нет | `0` |
| requested_at | timestamp with time zone | да |  |
| requested_date | date | да |  |
| first_response_at | timestamp with time zone | да |  |
| quote_total_amount | bigint | да |  |
| quote_total_currency | character(3) | нет | `'KZT'::bpchar` |
| held_at | timestamp with time zone | да |  |
| held_date | date | да |  |
| held_total_amount | bigint | да |  |
| held_total_currency | character(3) | нет | `'KZT'::bpchar` |
| cancelled_at | timestamp with time zone | да |  |
| cancelled_from | text | да |  |
| cancel_reason | text | да |  |
| created_at | timestamp with time zone | нет | `now()` |
| updated_at | timestamp with time zone | нет | `now()` |

Ограничения:

- CHECK `banquet_requests_source_check`: `CHECK ((source = ANY (ARRAY['web'::text, 'admin'::text])))`
- CHECK `banquet_requests_status_check`: `CHECK ((status = ANY (ARRAY['new'::text, 'in_progress'::text, 'quote_sent'::text, 'agreed'::text, 'prepaid'::text, 'held'::text, 'cancelled'::text])))`
- PRIMARY KEY `banquet_requests_pkey`: `PRIMARY KEY (request_id)`

Индексы:

- `CREATE INDEX banquet_requests_held_idx ON reporting.banquet_requests USING btree (held_date) WHERE (held_date IS NOT NULL)`
- `CREATE INDEX banquet_requests_requested_idx ON reporting.banquet_requests USING btree (requested_date, branch_id)`

Триггеры:

- `CREATE TRIGGER banquet_requests_touch BEFORE UPDATE ON reporting.banquet_requests FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at()`

### `reporting.banquet_status_changes`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| event_id | uuid | нет |  |
| request_id | uuid | нет |  |
| from_status | text | нет |  |
| to_status | text | нет |  |
| reason | text | да |  |
| occurred_at | timestamp with time zone | нет |  |

Ограничения:

- PRIMARY KEY `banquet_status_changes_pkey`: `PRIMARY KEY (event_id)`

Индексы:

- `CREATE INDEX banquet_status_changes_request_idx ON reporting.banquet_status_changes USING btree (request_id, occurred_at)`

### `reporting.certificate_credits`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| event_id | uuid | нет |  |
| certificate_id | uuid | нет |  |
| credited_amount | bigint | нет |  |
| credited_currency | character(3) | нет | `'KZT'::bpchar` |
| balance_after_amount | bigint | нет |  |
| balance_after_currency | character(3) | нет | `'KZT'::bpchar` |
| branch_id | uuid | да |  |
| refund_id | uuid | да |  |
| payment_id | uuid | да |  |
| credited_at | timestamp with time zone | нет |  |
| credited_date | date | нет |  |

Ограничения:

- CHECK `certificate_credits_credited_amount_check`: `CHECK ((credited_amount >= 0))`
- PRIMARY KEY `certificate_credits_pkey`: `PRIMARY KEY (event_id)`

Индексы:

- `CREATE INDEX certificate_credits_cert_idx ON reporting.certificate_credits USING btree (certificate_id)`
- `CREATE INDEX certificate_credits_date_idx ON reporting.certificate_credits USING btree (credited_date, branch_id)`

### `reporting.certificate_redemptions`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| event_id | uuid | нет |  |
| certificate_id | uuid | нет |  |
| redeemed_amount | bigint | нет |  |
| redeemed_currency | character(3) | нет | `'KZT'::bpchar` |
| balance_after_amount | bigint | нет |  |
| balance_after_currency | character(3) | нет | `'KZT'::bpchar` |
| branch_id | uuid | да |  |
| channel | text | нет |  |
| reference_id | text | да |  |
| redeemed_at | timestamp with time zone | нет |  |
| redeemed_date | date | нет |  |

Ограничения:

- CHECK `certificate_redemptions_channel_check`: `CHECK ((channel = ANY (ARRAY['order'::text, 'point'::text])))`
- CHECK `certificate_redemptions_redeemed_amount_check`: `CHECK ((redeemed_amount >= 0))`
- PRIMARY KEY `certificate_redemptions_pkey`: `PRIMARY KEY (event_id)`

Индексы:

- `CREATE INDEX certificate_redemptions_cert_idx ON reporting.certificate_redemptions USING btree (certificate_id)`
- `CREATE INDEX certificate_redemptions_date_idx ON reporting.certificate_redemptions USING btree (redeemed_date, branch_id)`

### `reporting.certificates`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| certificate_id | uuid | нет |  |
| product_id | text | да |  |
| kind | text | нет |  |
| nominal_amount | bigint | нет |  |
| nominal_currency | character(3) | нет | `'KZT'::bpchar` |
| price_amount | bigint | да |  |
| price_currency | character(3) | нет | `'KZT'::bpchar` |
| branch_id | uuid | да |  |
| issued_at | timestamp with time zone | да |  |
| issued_date | date | да |  |
| expires_at | timestamp with time zone | да |  |
| expired_at | timestamp with time zone | да |  |
| expired_date | date | да |  |
| expired_balance_amount | bigint | да |  |
| expired_balance_currency | character(3) | нет | `'KZT'::bpchar` |
| created_at | timestamp with time zone | нет | `now()` |
| updated_at | timestamp with time zone | нет | `now()` |

Ограничения:

- CHECK `certificates_kind_check`: `CHECK ((kind = ANY (ARRAY['amount'::text, 'set'::text])))`
- PRIMARY KEY `certificates_pkey`: `PRIMARY KEY (certificate_id)`

Индексы:

- `CREATE INDEX certificates_expired_idx ON reporting.certificates USING btree (expired_date) WHERE (expired_date IS NOT NULL)`
- `CREATE INDEX certificates_issued_idx ON reporting.certificates USING btree (issued_date)`

Триггеры:

- `CREATE TRIGGER certificates_touch BEFORE UPDATE ON reporting.certificates FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at()`

### `reporting.daily_reports`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| report_date | date | нет |  |
| scope | text | нет |  |
| branch_id | uuid | да |  |
| summary | jsonb | нет |  |
| file_key | text | да |  |
| generated_at | timestamp with time zone | нет |  |
| notified_at | timestamp with time zone | да |  |
| created_at | timestamp with time zone | нет | `now()` |
| updated_at | timestamp with time zone | нет | `now()` |

Ограничения:

- CHECK `daily_reports_scope`: `CHECK ((((scope = 'all'::text) AND (branch_id IS NULL)) OR (scope = (branch_id)::text)))`
- PRIMARY KEY `daily_reports_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE UNIQUE INDEX daily_reports_uq ON reporting.daily_reports USING btree (report_date, scope)`

Триггеры:

- `CREATE TRIGGER daily_reports_touch BEFORE UPDATE ON reporting.daily_reports FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at()`

### `reporting.documents`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| kind | text | нет |  |
| number | text | нет |  |
| request_id | uuid | нет |  |
| branch_id | uuid | да |  |
| payer_type | text | да |  |
| company_name | text | да |  |
| company_bin | text | да |  |
| document_amount | bigint | нет |  |
| document_currency | character(3) | нет | `'KZT'::bpchar` |
| vat_amount | bigint | нет | `0` |
| vat_currency | character(3) | нет | `'KZT'::bpchar` |
| paid_total_amount | bigint | нет | `0` |
| paid_total_currency | character(3) | нет | `'KZT'::bpchar` |
| fully_paid | boolean | нет | `false` |
| due_date | date | да |  |
| issued_at | timestamp with time zone | нет |  |
| issued_date | date | нет |  |
| created_at | timestamp with time zone | нет | `now()` |
| updated_at | timestamp with time zone | нет | `now()` |

Ограничения:

- CHECK `documents_kind_check`: `CHECK ((kind = ANY (ARRAY['invoice'::text, 'act'::text])))`
- CHECK `documents_payer_type_check`: `CHECK ((payer_type = ANY (ARRAY['individual'::text, 'company'::text])))`
- PRIMARY KEY `documents_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE INDEX documents_date_idx ON reporting.documents USING btree (issued_date, kind)`
- `CREATE INDEX documents_request_idx ON reporting.documents USING btree (request_id)`

Триггеры:

- `CREATE TRIGGER documents_touch BEFORE UPDATE ON reporting.documents FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at()`

### `reporting.order_items`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| order_id | uuid | нет |  |
| line_no | integer | нет |  |
| dish_id | uuid | нет |  |
| name | jsonb | нет |  |
| quantity | integer | нет |  |
| unit_price_amount | bigint | нет |  |
| unit_price_currency | character(3) | нет | `'KZT'::bpchar` |
| line_total_amount | bigint | нет |  |
| line_total_currency | character(3) | нет | `'KZT'::bpchar` |

Ограничения:

- CHECK `order_items_quantity_check`: `CHECK ((quantity > 0))`
- PRIMARY KEY `order_items_pkey`: `PRIMARY KEY (order_id, line_no)`

Индексы:

- `CREATE INDEX order_items_dish_idx ON reporting.order_items USING btree (dish_id)`

### `reporting.orders`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| order_id | uuid | нет |  |
| number | text | нет |  |
| branch_id | uuid | нет |  |
| type | text | нет |  |
| channel | text | нет |  |
| status | text | нет |  |
| status_at | timestamp with time zone | нет |  |
| status_rank | smallint | нет |  |
| customer_id | uuid | да |  |
| payment_method | text | да |  |
| promo_code | text | да |  |
| analytics_session_id | text | да |  |
| subtotal_amount | bigint | нет | `0` |
| subtotal_currency | character(3) | нет | `'KZT'::bpchar` |
| discount_amount | bigint | нет | `0` |
| discount_currency | character(3) | нет | `'KZT'::bpchar` |
| delivery_fee_amount | bigint | нет | `0` |
| delivery_fee_currency | character(3) | нет | `'KZT'::bpchar` |
| total_amount | bigint | нет | `0` |
| total_currency | character(3) | нет | `'KZT'::bpchar` |
| placed_at | timestamp with time zone | да |  |
| placed_date | date | да |  |
| completed_at | timestamp with time zone | да |  |
| completed_date | date | да |  |
| cancelled_at | timestamp with time zone | да |  |
| cancelled_date | date | да |  |
| cancel_reason_code | text | да |  |
| cancel_reason | text | да |  |
| was_paid | boolean | да |  |
| refunded_at | timestamp with time zone | да |  |
| created_at | timestamp with time zone | нет | `now()` |
| updated_at | timestamp with time zone | нет | `now()` |

Ограничения:

- CHECK `orders_channel_check`: `CHECK ((channel = ANY (ARRAY['web'::text, 'admin'::text])))`
- CHECK `orders_payment_method_check`: `CHECK ((payment_method = ANY (ARRAY['online'::text, 'on_receipt'::text])))`
- CHECK `orders_status_check`: `CHECK ((status = ANY (ARRAY['draft'::text, 'awaiting_payment'::text, 'paid'::text, 'accepted'::text, 'cooking'::text, 'ready'::text, 'delivering'::text, 'completed'::text, 'cancelled'::text, 'refunded'::text])))`
- CHECK `orders_type_check`: `CHECK ((type = ANY (ARRAY['delivery'::text, 'pickup'::text])))`
- PRIMARY KEY `orders_pkey`: `PRIMARY KEY (order_id)`

Индексы:

- `CREATE INDEX orders_cancelled_idx ON reporting.orders USING btree (cancelled_date, branch_id) WHERE (cancelled_date IS NOT NULL)`
- `CREATE INDEX orders_completed_idx ON reporting.orders USING btree (completed_date, branch_id) WHERE (completed_date IS NOT NULL)`
- `CREATE INDEX orders_placed_idx ON reporting.orders USING btree (placed_date, branch_id)`
- `CREATE INDEX orders_session_idx ON reporting.orders USING btree (analytics_session_id) WHERE (analytics_session_id IS NOT NULL)`

Триггеры:

- `CREATE TRIGGER orders_forbid_delete BEFORE DELETE ON reporting.orders FOR EACH ROW EXECUTE FUNCTION platform.forbid_delete()`
- `CREATE TRIGGER orders_touch BEFORE UPDATE ON reporting.orders FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at()`

### `reporting.payments`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| payment_id | uuid | нет |  |
| purpose | text | нет |  |
| reference_id | text | нет |  |
| branch_id | uuid | да |  |
| method | text | нет |  |
| provider | text | нет |  |
| payment_amount | bigint | нет |  |
| payment_currency | character(3) | нет | `'KZT'::bpchar` |
| paid_at | timestamp with time zone | нет |  |
| paid_date | date | нет |  |
| late | boolean | нет | `false` |
| created_at | timestamp with time zone | нет | `now()` |
| updated_at | timestamp with time zone | нет | `now()` |

Ограничения:

- CHECK `payments_method_check`: `CHECK ((method = ANY (ARRAY['online'::text, 'on_receipt'::text, 'gift_certificate'::text, 'bank_transfer'::text])))`
- CHECK `payments_payment_amount_check`: `CHECK ((payment_amount >= 0))`
- CHECK `payments_provider_check`: `CHECK ((provider ~ '^[a-z0-9_]+$'::text))`
- CHECK `payments_purpose_check`: `CHECK ((purpose = ANY (ARRAY['order'::text, 'reservation_deposit'::text, 'banquet_invoice'::text, 'gift_certificate'::text])))`
- PRIMARY KEY `payments_pkey`: `PRIMARY KEY (payment_id)`

Индексы:

- `CREATE INDEX payments_date_idx ON reporting.payments USING btree (paid_date, branch_id)`
- `CREATE INDEX payments_reference_idx ON reporting.payments USING btree (purpose, reference_id)`

Триггеры:

- `CREATE TRIGGER payments_forbid_delete BEFORE DELETE ON reporting.payments FOR EACH ROW EXECUTE FUNCTION platform.forbid_delete()`
- `CREATE TRIGGER payments_touch BEFORE UPDATE ON reporting.payments FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at()`

### `reporting.refunds`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| refund_id | uuid | нет |  |
| payment_id | uuid | нет |  |
| purpose | text | нет |  |
| reference_id | text | нет |  |
| branch_id | uuid | да |  |
| refund_amount | bigint | нет |  |
| refund_currency | character(3) | нет | `'KZT'::bpchar` |
| reason | text | нет | `''::text` |
| refunded_at | timestamp with time zone | нет |  |
| refunded_date | date | нет |  |
| payment_fully_refunded | boolean | нет | `false` |
| reference_fully_refunded | boolean | нет | `false` |
| created_at | timestamp with time zone | нет | `now()` |

Ограничения:

- CHECK `refunds_purpose_check`: `CHECK ((purpose = ANY (ARRAY['order'::text, 'reservation_deposit'::text, 'banquet_invoice'::text, 'gift_certificate'::text])))`
- CHECK `refunds_refund_amount_check`: `CHECK ((refund_amount > 0))`
- PRIMARY KEY `refunds_pkey`: `PRIMARY KEY (refund_id)`

Индексы:

- `CREATE INDEX refunds_date_idx ON reporting.refunds USING btree (refunded_date, branch_id)`
- `CREATE INDEX refunds_payment_idx ON reporting.refunds USING btree (payment_id)`
- `CREATE INDEX refunds_reference_idx ON reporting.refunds USING btree (purpose, reference_id)`

Триггеры:

- `CREATE TRIGGER refunds_forbid_delete BEFORE DELETE ON reporting.refunds FOR EACH ROW EXECUTE FUNCTION platform.forbid_delete()`

### `reporting.reservations`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| reservation_id | uuid | нет |  |
| number | text | нет |  |
| branch_id | uuid | нет |  |
| venue_id | uuid | нет |  |
| venue_type_code | text | нет |  |
| venue_name | jsonb | да |  |
| kind | text | нет |  |
| status | text | нет |  |
| status_at | timestamp with time zone | нет |  |
| status_rank | smallint | нет |  |
| source | text | да |  |
| start_at | timestamp with time zone | нет |  |
| end_at | timestamp with time zone | нет |  |
| start_date | date | нет |  |
| guests | integer | нет |  |
| banquet_request_id | uuid | да |  |
| deposit_amount | bigint | да |  |
| deposit_currency | character(3) | нет | `'KZT'::bpchar` |
| deposit_outcome | text | нет | `'none'::text` |
| booked_at | timestamp with time zone | да |  |
| booked_date | date | да |  |
| created_at | timestamp with time zone | нет | `now()` |
| updated_at | timestamp with time zone | нет | `now()` |

Ограничения:

- CHECK `reservations_deposit_outcome_check`: `CHECK ((deposit_outcome = ANY (ARRAY['none'::text, 'refunded'::text, 'retained'::text])))`
- CHECK `reservations_guests_check`: `CHECK ((guests >= 0))`
- CHECK `reservations_interval`: `CHECK ((end_at > start_at))`
- CHECK `reservations_kind_check`: `CHECK ((kind = ANY (ARRAY['regular'::text, 'banquet'::text])))`
- CHECK `reservations_source_check`: `CHECK ((source = ANY (ARRAY['web'::text, 'admin'::text, 'banquet'::text])))`
- CHECK `reservations_status_check`: `CHECK ((status = ANY (ARRAY['pending'::text, 'awaiting_deposit'::text, 'confirmed'::text, 'arrived'::text, 'no_show'::text, 'cancelled'::text, 'expired'::text])))`
- PRIMARY KEY `reservations_pkey`: `PRIMARY KEY (reservation_id)`

Индексы:

- `CREATE INDEX reservations_booked_idx ON reporting.reservations USING btree (booked_date, branch_id)`
- `CREATE INDEX reservations_start_idx ON reporting.reservations USING btree (start_date, branch_id)`
- `CREATE INDEX reservations_venue_idx ON reporting.reservations USING btree (venue_id, start_at)`

Триггеры:

- `CREATE TRIGGER reservations_forbid_delete BEFORE DELETE ON reporting.reservations FOR EACH ROW EXECUTE FUNCTION platform.forbid_delete()`
- `CREATE TRIGGER reservations_touch BEFORE UPDATE ON reporting.reservations FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at()`

### `reporting.sales_facts`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| source_type | text | нет |  |
| source_id | text | нет |  |
| kind | text | нет |  |
| channel | text | нет |  |
| branch_id | uuid | да |  |
| order_channel | text | да |  |
| reference_id | text | нет |  |
| occurred_at | timestamp with time zone | нет |  |
| local_date | date | нет |  |
| revenue_amount | bigint | нет |  |
| revenue_currency | character(3) | нет | `'KZT'::bpchar` |
| created_at | timestamp with time zone | нет | `now()` |

Ограничения:

- CHECK `sales_facts_channel_check`: `CHECK ((channel = ANY (ARRAY['delivery'::text, 'pickup'::text, 'banquet'::text, 'certificate'::text])))`
- CHECK `sales_facts_kind_check`: `CHECK ((kind = ANY (ARRAY['sale'::text, 'refund'::text])))`
- CHECK `sales_facts_order_channel_check`: `CHECK ((order_channel = ANY (ARRAY['web'::text, 'admin'::text])))`
- CHECK `sales_facts_sign`: `CHECK ((((kind = 'sale'::text) AND (revenue_amount >= 0)) OR ((kind = 'refund'::text) AND (revenue_amount <= 0))))`
- CHECK `sales_facts_source_type_check`: `CHECK ((source_type = ANY (ARRAY['order'::text, 'banquet'::text, 'certificate'::text, 'refund'::text])))`
- PRIMARY KEY `sales_facts_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE INDEX sales_facts_branch_idx ON reporting.sales_facts USING btree (branch_id, local_date)`
- `CREATE INDEX sales_facts_date_idx ON reporting.sales_facts USING btree (local_date, channel)`
- `CREATE UNIQUE INDEX sales_facts_source_uq ON reporting.sales_facts USING btree (source_type, source_id)`

### `reporting.storefront_events`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| session_id | uuid | нет |  |
| type | text | нет |  |
| branch_id | uuid | да |  |
| path | text | нет |  |
| occurred_at | timestamp with time zone | нет |  |
| local_date | date | нет |  |

Ограничения:

- CHECK `storefront_events_type_check`: `CHECK ((type = ANY (ARRAY['page_view'::text, 'menu_view'::text, 'dish_view'::text, 'add_to_cart'::text, 'checkout_start'::text])))`
- PRIMARY KEY `storefront_events_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE INDEX storefront_events_branch_idx ON reporting.storefront_events USING btree (branch_id, local_date)`
- `CREATE INDEX storefront_events_date_idx ON reporting.storefront_events USING btree (local_date, session_id)`

## Схема `pos` — POS — выгрузки заказов, сопоставления, синхронизация стоп-листа

### `pos.order_exports`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| order_id | uuid | нет |  |
| order_number | text | нет |  |
| branch_id | uuid | нет |  |
| provider | text | нет |  |
| status | text | нет |  |
| pos_order_id | text | да |  |
| attempts | integer | нет | `0` |
| manual_retries | integer | нет | `0` |
| last_error | text | да |  |
| failure_reason | text | да |  |
| skip_reason | text | да |  |
| details | jsonb | нет | `'{}'::jsonb` |
| last_attempt_at | timestamp with time zone | да |  |
| sent_at | timestamp with time zone | да |  |
| failed_at | timestamp with time zone | да |  |
| created_at | timestamp with time zone | нет | `now()` |
| updated_at | timestamp with time zone | нет | `now()` |
| confirmed_at | timestamp with time zone | да |  |
| confirm_checks | integer | нет | `0` |

Ограничения:

- CHECK `order_exports_attempts_check`: `CHECK ((attempts >= 0))`
- CHECK `order_exports_confirm_checks_check`: `CHECK ((confirm_checks >= 0))`
- CHECK `order_exports_failed_has_reason`: `CHECK (((status <> 'failed'::text) OR (failure_reason IS NOT NULL)))`
- CHECK `order_exports_failure_reason_check`: `CHECK (((failure_reason IS NULL) OR (failure_reason = ANY (ARRAY['missing_mapping'::text, 'not_configured'::text, 'rejected'::text, 'retries_exhausted'::text, 'order_unavailable'::text]))))`
- CHECK `order_exports_manual_retries_check`: `CHECK ((manual_retries >= 0))`
- CHECK `order_exports_provider_check`: `CHECK ((provider ~ '^[a-z0-9_]+$'::text))`
- CHECK `order_exports_sent_has_pos_id`: `CHECK (((status <> 'sent'::text) OR (pos_order_id IS NOT NULL)))`
- CHECK `order_exports_skip_reason_check`: `CHECK (((skip_reason IS NULL) OR (skip_reason = ANY (ARRAY['manual_provider'::text, 'order_cancelled'::text, 'order_not_accepted'::text]))))`
- CHECK `order_exports_skipped_has_reason`: `CHECK (((status <> 'skipped'::text) OR (skip_reason IS NOT NULL)))`
- CHECK `order_exports_status_check`: `CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text, 'skipped'::text])))`
- PRIMARY KEY `order_exports_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE INDEX order_exports_branch_idx ON pos.order_exports USING btree (branch_id, status, created_at DESC)`
- `CREATE INDEX order_exports_created_idx ON pos.order_exports USING btree (created_at DESC)`
- `CREATE UNIQUE INDEX order_exports_order_uq ON pos.order_exports USING btree (order_id)`
- `CREATE INDEX order_exports_unconfirmed_idx ON pos.order_exports USING btree (created_at) WHERE ((status = 'sent'::text) AND (confirmed_at IS NULL))`

Триггеры:

- `CREATE TRIGGER order_exports_forbid_delete BEFORE DELETE ON pos.order_exports FOR EACH ROW EXECUTE FUNCTION platform.forbid_delete()`
- `CREATE TRIGGER order_exports_touch BEFORE UPDATE ON pos.order_exports FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at()`

### `pos.product_mappings`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| branch_id | uuid | нет |  |
| dish_id | uuid | нет |  |
| provider | text | нет |  |
| external_product_id | text | нет |  |
| external_name | text | да |  |
| modifier_mappings | jsonb | нет | `'{}'::jsonb` |
| created_at | timestamp with time zone | нет | `now()` |
| updated_at | timestamp with time zone | нет | `now()` |
| deleted_at | timestamp with time zone | да |  |

Ограничения:

- CHECK `product_mappings_external_name_check`: `CHECK (((external_name IS NULL) OR (length(external_name) <= 300)))`
- CHECK `product_mappings_external_product_id_check`: `CHECK (((length(btrim(external_product_id)) >= 1) AND (length(btrim(external_product_id)) <= 200)))`
- CHECK `product_mappings_modifier_mappings_check`: `CHECK ((jsonb_typeof(modifier_mappings) = 'object'::text))`
- CHECK `product_mappings_provider_check`: `CHECK ((provider ~ '^[a-z0-9_]+$'::text))`
- PRIMARY KEY `product_mappings_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE UNIQUE INDEX product_mappings_dish_uq ON pos.product_mappings USING btree (branch_id, provider, dish_id) WHERE (deleted_at IS NULL)`
- `CREATE INDEX product_mappings_external_idx ON pos.product_mappings USING btree (branch_id, provider, external_product_id) WHERE (deleted_at IS NULL)`

Триггеры:

- `CREATE TRIGGER product_mappings_touch BEFORE UPDATE ON pos.product_mappings FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at()`

### `pos.products`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| id | uuid | нет |  |
| branch_id | uuid | нет |  |
| provider | text | нет |  |
| external_product_id | text | нет |  |
| name | text | нет |  |
| name_normalized | text | нет |  |
| sku | text | да |  |
| kind | text | нет |  |
| group_name | text | да |  |
| imported_at | timestamp with time zone | нет |  |
| removed_at | timestamp with time zone | да |  |
| created_at | timestamp with time zone | нет | `now()` |
| updated_at | timestamp with time zone | нет | `now()` |

Ограничения:

- CHECK `products_kind_check`: `CHECK ((kind = ANY (ARRAY['dish'::text, 'good'::text, 'modifier'::text, 'service'::text, 'other'::text])))`
- CHECK `products_provider_check`: `CHECK ((provider ~ '^[a-z0-9_]+$'::text))`
- PRIMARY KEY `products_pkey`: `PRIMARY KEY (id)`

Индексы:

- `CREATE INDEX products_branch_idx ON pos.products USING btree (branch_id, provider, name_normalized) WHERE (removed_at IS NULL)`
- `CREATE UNIQUE INDEX products_external_uq ON pos.products USING btree (branch_id, provider, external_product_id)`

Триггеры:

- `CREATE TRIGGER products_touch BEFORE UPDATE ON pos.products FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at()`

### `pos.stop_list_snapshots`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| branch_id | uuid | нет |  |
| dish_id | uuid | нет |  |
| provider | text | нет |  |
| external_product_id | text | нет |  |
| available | boolean | нет |  |
| updated_at | timestamp with time zone | нет | `now()` |

Ограничения:

- CHECK `stop_list_snapshots_provider_check`: `CHECK ((provider ~ '^[a-z0-9_]+$'::text))`
- PRIMARY KEY `stop_list_snapshots_pkey`: `PRIMARY KEY (branch_id, dish_id)`

Триггеры:

- `CREATE TRIGGER stop_list_snapshots_touch BEFORE UPDATE ON pos.stop_list_snapshots FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at()`

### `pos.sync_state`

| Столбец | Тип | NULL | По умолчанию |
| --- | --- | --- | --- |
| branch_id | uuid | нет |  |
| stop_list_provider | text | да |  |
| stop_list_enqueued_at | timestamp with time zone | да |  |
| stop_list_attempted_at | timestamp with time zone | да |  |
| stop_list_synced_at | timestamp with time zone | да |  |
| stop_list_failures | integer | нет | `0` |
| stop_list_error | text | да |  |
| stop_list_alerted_at | timestamp with time zone | да |  |
| stop_list_changes | integer | нет | `0` |
| products_provider | text | да |  |
| products_requested_at | timestamp with time zone | да |  |
| products_imported_at | timestamp with time zone | да |  |
| products_count | integer | да |  |
| products_error | text | да |  |
| created_at | timestamp with time zone | нет | `now()` |
| updated_at | timestamp with time zone | нет | `now()` |

Ограничения:

- CHECK `sync_state_products_count_check`: `CHECK (((products_count IS NULL) OR (products_count >= 0)))`
- CHECK `sync_state_stop_list_changes_check`: `CHECK ((stop_list_changes >= 0))`
- CHECK `sync_state_stop_list_failures_check`: `CHECK ((stop_list_failures >= 0))`
- PRIMARY KEY `sync_state_pkey`: `PRIMARY KEY (branch_id)`

Триггеры:

- `CREATE TRIGGER sync_state_touch BEFORE UPDATE ON pos.sync_state FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at()`

