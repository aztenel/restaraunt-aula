# Руководство разработчика бэкенда AULA

Документ обязателен к прочтению перед изменениями в `apps/api`. Правила из раздела ТЗ
«Правила, чтобы код не стал спагетти» — условия приёмки кода, а не пожелания.

## Стек

- NestJS 11 (TypeScript), модульный монолит.
- PostgreSQL 16, доступ через Kysely (типизированный построитель запросов), сырой SQL — `sql` из kysely.
- Redis + BullMQ — очереди; transactional outbox в PostgreSQL.
- Vitest (unit + integration на реальном PostgreSQL), supertest.
- Валидация входа — class-validator DTO; описание API — @nestjs/swagger (OpenAPI).

## Структура модуля

```
src/modules/<module>/
  <module>.module.ts         @Global() Nest-модуль: controllers, providers, exports (только публичные контракты)
  public/                    ПУБЛИЧНЫЙ КОНТРАКТ: абстрактные классы-сервисы, типы, события (имена + payload)
    index.ts                 другие модули импортируют ТОЛЬКО отсюда
  domain/                    чистая бизнес-логика без Nest/Kysely: сущности, конечные автоматы, правила, расчёты
  application/               действия (один класс = одно действие = один публичный метод execute) и запросы (queries)
  infrastructure/
    <module>.tables.ts       типы таблиц своей схемы для Kysely
    *.repository.ts          доступ к своим таблицам
    adapters/                адаптеры внешних систем за интерфейсами (Kaspi, WhatsApp, iiko, ...)
    migrations/*.sql         миграции только вперёд
    seed.ts                  (опционально) демо/стартовые данные модуля
  http/
    admin/*.controller.ts    маршруты админки: /api/v1/admin/...
    public/*.controller.ts   маршруты витрины: /api/v1/public/...
    webhooks/*.controller.ts входящие вебхуки: /api/v1/webhooks/...
    dto.ts                   DTO запросов/ответов с декораторами class-validator и @ApiProperty
  handlers/                  подписчики на события (@OnEvent), фоновые задачи (@JobHandler), расписания (@Scheduled)
```

Эталон — модуль `identity`.

## 12 правил (из ТЗ) и как они реализованы

1. **Модуль не обращается к таблицам и моделям другого модуля.** Каждый модуль — своя схема PostgreSQL
   (`catalog.*`, `ordering.*` …). Импорт чужих файлов, кроме `modules/<m>/public`, валит `eslint`
   (eslint-plugin-boundaries). Обращение к чужой схеме в SQL валит `src/architecture.spec.ts`.
   Связь — через публичный сервис (абстрактный класс в `public/`) или событие.
   Внешние ключи на таблицы других модулей не ставим (модуль должен выноситься отдельно).
2. **Бизнес-логика — в сервисах уровня приложения и домене.** Контроллер: валидирует DTO,
   вызывает действие, отдаёт ответ. Никаких расчётов и ветвлений бизнес-правил в контроллере.
3. **Каждое действие — отдельный класс с одним публичным методом** `execute(...)`:
   `CreateOrder`, `ConfirmReservation`, `IssueBanquetInvoice`. Никаких «OrderService» на 3000 строк.
   Запросы на чтение для админки можно группировать в `*.queries.ts` (только чтение).
4. **Интеграции только за интерфейсом.** Интерфейс (абстрактный класс) — в `domain/` или `application/`
   модуля, реализация — в `infrastructure/adapters/<provider>/`. Имя провайдера (kaspi, halyk, iiko,
   yandex, mobizon…) не встречается нигде, кроме адаптера, `*.module.ts` и конфигурации
   (проверяется `architecture.spec.ts`). Адаптер регистрирует свои поля настроек в `IntegrationCatalog`,
   читает настройки из `IntegrationSettings` (ключ `<module>.<provider>`), ходит наружу через `ExternalHttp`
   (таймауты, классификация ошибок, полный лог с маскированием в `platform.integration_logs`).
5. **Статусы — перечисления и конечные автоматы.** `const XStatus = {...} as const` + `StateMachine`
   из `shared/kernel/state-machine`. Переход только через метод сущности (`order.accept()`),
   недопустимый переход бросает `InvalidStateTransitionError`. В БД — `text` + `CHECK (status in (...))`.
6. **Деньги — целые числа в тиынах.** Только `Money` из `shared/kernel/money`. В БД: `<name>_amount bigint`
   + `<name>_currency char(3) default 'KZT'` (каждая сумма — вместе с валютой). В API — `{ amount, currency }`.
   Итог всегда пересчитывается на сервере. Никаких float, `parseFloat`, `toFixed` в расчётах.
7. **Все внешние вызовы асинхронны.** `JobQueue.enqueue('<module>.<job>', payload)` внутри транзакции
   бизнес-операции; обработчик `@JobHandler('<module>.<job>', { attempts, backoffMs })`. Повторы с
   экспоненциальной задержкой, после исчерпания — `platform.failed_jobs` (очередь неудач) и алерт.
   Ошибка адаптера: `ExternalServiceError(retryable)`. Недоступность POS/мессенджера не блокирует бизнес-операцию.
8. **Никакой бизнес-логики во фронтенде.** API отдаёт посчитанные суммы, доступные переходы статусов
   (`allowedTransitions`), флаги доступности. Фронт только отображает.
9. **Миграции только вперёд.** Файлы `infrastructure/migrations/YYYYMMDDHHMM_<name>.sql`. Применённую миграцию
   менять нельзя (контрольная сумма) — только новая миграция. Первая миграция модуля создаёт схему модуля.
10. **Тесты.** Unit-тесты домена (`*.spec.ts` рядом с кодом) обязательны. Интеграционные (`*.int.spec.ts`)
    на реальном PostgreSQL — для заказа, оплаты, брони, банкетной заявки и каждого HTTP-сценария модуля.
11. **Мультифилиальность и мультиязычность в схеме с первого дня.** Всё, что принадлежит точке, имеет
    `branch_id uuid not null`. Переводимые поля — `jsonb` `{ "kk": "...", "ru": "...", "en": "..." }`
    (тип `Translatable`), не столбцы `name_ru/name_kk`.
12. **Код-ревью обязателен, прямые коммиты в main запрещены** (см. CONTRIBUTING.md).

## Общие правила схемы БД

- Время — `timestamptz` (UTC). Локальное время филиала (Asia/Almaty) — только через `shared/kernel/time`.
- Удаление логическое (`deleted_at timestamptz`). Для заказов, платежей и броней физическое удаление запрещено
  триггером: `create trigger ... before delete on <table> for each row execute function platform.forbid_delete();`
- `updated_at` — триггер `platform.touch_updated_at()`.
- Номера заказов и счетов — `DocumentNumbering.next(scope, branchId, year)` (последовательность в разрезе
  филиала и года), формат `DocumentNumbering.format(branchCode, year, n)` → `GL-2026-000123`.
- Первичные ключи — `uuid`, генерируются в приложении `newId()` (UUID v7).

## Платформа (shared) — что использовать

| Задача | Что использовать |
| --- | --- |
| Транзакция | `database.transaction(async () => {...})`; внутри любой `database.db<Tables>()` — та же транзакция |
| Блокировка объекта | `database.advisoryLock('reservation.venue', venueId)` или `select ... for update` |
| Событие | `eventBus.publish(ModuleEvents.X, payload, { aggregateId, branchId })` — внутри транзакции |
| Подписка | `@OnEvent(OtherEvents.X) async handle(e: EventEnvelope<Payload>)` — выполняется в транзакции, идемпотентно |
| Фоновая задача | `jobQueue.enqueue('module.job', payload, { delayMs / runAt })` + `@JobHandler('module.job')` |
| Периодическая задача | `@Scheduled('module.name', { cron: '*/5 * * * *' })` или `{ everyMs }` (часовой пояс Asia/Almaty) |
| Журнал действий | `auditLog.record({ action, entityType, entityId, branchId, before, after })` — в той же транзакции |
| Время | `Clock` (инжектится; в тестах `FixedClock`) — никогда `new Date()` в бизнес-логике |
| Права | `actor.assertCan(Permission.X, branchId)`; списки: `actor.scopeBranches(Permission.X, requestedBranchId)` |
| Доступ к маршруту | по умолчанию закрыт; `@Public()` — для витрины; `@RequirePermissions(...)` — право хотя бы в одном филиале |
| Ограничение частоты | `@RateLimit('forms' / 'otp' / 'certificate_check' / 'pricing' / 'auth')`, `@SkipRateLimit()` для вебхуков |
| Файлы | `FileStorage.put({ key, body, contentType, visibility })`, `publicUrl`, `signedUrl` |
| PDF | `PdfRenderer.render(docDefinition)` (pdfmake, шрифт DejaVu), `brandHeader`, `PDF_STYLES` |
| XLSX | `XlsxBuilder.build([{ name, columns, rows }])` |
| Внешний HTTP | `ExternalHttp.request({ integration, operation, method, url, body, correlationId })` |
| Настройки интеграций | `IntegrationSettings.get('module.provider', zodSchema)`; `IntegrationCatalog.register({...})` |
| Секреты/подписи | `SecretBox` (AES-GCM, HMAC), `sha256`, `hmacSha256`, `safeEqual` |
| Коды, токены | `randomCode`, `randomDigits`, `randomToken` из `shared/kernel/random` |
| Язык запроса | `@RequestLocale() locale: Locale` |
| Текущий сотрудник | `@CurrentActor() actor: Actor` |

## HTTP и DTO

- Префикс `/api/v1`. Витрина: `/public/...` (`@Public()`), админка: `/admin/...`, вебхуки: `/webhooks/<provider>`.
- Тег Swagger: `@ApiTags('public' | 'admin' | 'webhooks')`, для админки `@ApiBearerAuth('staff')`.
- Каждый ответ описан DTO-классом с `@ApiProperty` (для генерации клиента по OpenAPI).
  Деньги — `MoneyDto`, переводимые поля — `TranslatableDto`, страницы — `{ items, total, page, perPage }`.
- Ошибки — бросать доменные исключения (`ValidationError`, `NotFoundError`, `ConflictError`,
  `ForbiddenError`, `InvalidStateTransitionError`, `TooManyRequestsError`) с машинным кодом
  `<entity>.<reason>`. Фильтр превращает их в `{ error: { code, message, details }, requestId }`.
- Витрина получает переводимые поля целиком (`{ kk, ru }`) или уже переведённые по `?locale=` —
  выбирайте одно в рамках модуля и описывайте в DTO. Рекомендуется: публичные эндпоинты принимают
  `?locale=kk|ru|en` и отдают уже переведённые строки + `slug`; админка получает `Translatable` целиком.

## Проверка прав по филиалу

Роль привязана к филиалу. Проверка на уровне маршрута (`@RequirePermissions`) — только «есть ли право
хоть где-то». Проверка конкретного филиала — в действии: `actor.assertCan(Permission.OrdersManage, order.branchId)`.
Списки фильтруются: `const branches = actor.scopeBranches(Permission.OrdersView, query.branchId)` →
`'all' | string[]`.

## События и контракты

Имена событий и payload — в `public/index.ts` модуля-владельца. Payload — только JSON-совместимые
данные (деньги как `MoneyJson`, даты как ISO-строки). Подписчик не должен ходить в таблицы публикатора —
всё нужное должно быть в payload (или в публичном сервисе-запросе). Обработчики событий идемпотентны
(платформа гарантирует однократное применение к БД), но внешние вызовы из них — только через `JobQueue`.

## Тесты

```bash
# unit-тесты модуля
npx vitest run --project unit src/modules/<module>
# интеграционные (своя база на разработчика/агента)
TEST_DATABASE_NAME=aula_test_<module> npx vitest run --project integration src/modules/<module>
# линт (включая границы модулей)
npx eslint src/modules/<module>
# типы
npx tsc -p tsconfig.json --noEmit
```

Интеграционный тест поднимает Nest-приложение с платформой, Identity и модулем под тестом:

```ts
import { createTestApp, TestApp } from '../../../test/support/test-app';
import { createBranch, tokenFor } from '../../../test/support/fixtures';
import { FakeNotifier, fakeProviders } from '../../../test/fakes';

t = await createTestApp({
  imports: [OrderingModule],
  migrateModules: ['ordering'],
  providers: fakeProviders({ except: [] }), // заглушки публичных сервисов других модулей
});
```

- `t.reset()` — очистить все таблицы между тестами; `t.drain()` — обработать outbox (события и задачи);
- `t.clock` — `FixedClock` (`t.clock.advance(ms)`), `t.runSchedule(name)` — запустить `@Scheduled`;
- `tokenFor(t, [{ role: 'branch_operator', branchId }])` → `{ auth: 'Bearer ...' }`;
- заглушки других модулей — `test/fakes` (см. `test/fakes/index.ts`).

Интеграционный тест не должен ходить в сеть: адаптеры тестируются с подменённым `HttpTransport`
(`FakeHttpTransport` из `test/fakes`).
