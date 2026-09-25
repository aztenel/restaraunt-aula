# Руководство разработчика фронтенда AULA

Две клиентские части работают только через единый REST API (`/api/v1`, описание — `docs/openapi.json`).
Правило ТЗ №8: **никакой бизнес-логики во фронтенде** — суммы, доступность, разрешённые переходы
статусов считает сервер; фронт только отображает и отправляет намерения пользователя.

## Общее

- Типизированный клиент — `packages/api-client` (`createApiClient`, типы `paths` из `schema.d.ts`,
  `ApiError`, `formatMoney`, `parseFixed2`, `translate`, список прав `Permission`).
  После изменения API: `pnpm --filter @aula/api openapi && pnpm --filter @aula/api-client generate`.
- Деньги приходят в тиынах `{ amount, currency }`; вывод — `formatMoney(money, locale)` («2 500 ₸»);
  ввод суммы — строкой, перевод в тиыны `parseFixed2` (без float).
- Переводимые поля — `{ kk, ru, en }`; публичные эндпоинты принимают `?locale=` и отдают готовые строки.
- Время — ISO UTC; показывать в Asia/Almaty.
- Ошибки API: `{ error: { code, message, details }, requestId }` → `ApiError`; тексты по коду — словари i18n.

## Витрина (`apps/web`) — Next.js 15, SSR

- Маршруты `app/[locale]/...` (kk/ru/en через next-intl, строки — `messages/{kk,ru,en}.json`,
  все три словаря синхронны). Выбранный филиал — cookie (цены по филиалу).
- Данные на сервере: `lib/api.ts` / `lib/data.ts` (кэш `revalidate`), на клиенте — клиентский `createApiClient`.
- SEO: `lib/seo.ts` (`buildMetadata`: уникальные title/description, canonical, hreflang), `lib/jsonld.ts`
  (Restaurant, Menu/MenuSection/MenuItem, BreadcrumbList), `app/sitemap.ts` (+ `lib/sitemap.ts` —
  `GET /public/catalog/sitemap`), человекочитаемые URL со slug.
- Настоящий HTTP 404: `notFound()` вызывать в `layout.tsx` сегмента (под `loading.tsx` статус был бы 200).
- Корзина `lib/cart.ts`: только id блюд, id опций модификаторов, количества и филиал; итог — только из
  `POST /public/orders/quote`.
- Аналитика: `lib/goals.ts` (`reachGoal`: add_to_cart, begin_checkout, purchase, reservation_created,
  banquet_request, certificate_purchase), `lib/analytics-session.ts` + `components/storefront-tracker.tsx`
  (события витрины в `POST /public/analytics/events` для отчёта о конверсии).
- Mobile-first: проектирование с телефона, крупные зоны нажатия, оформление заказа — не больше 4 экранов.
- Проверки: `pnpm --filter @aula/web typecheck && pnpm --filter @aula/web lint && pnpm --filter @aula/web test && pnpm --filter @aula/web build`.

## Админка (`apps/admin`) — React 19 + Vite + Ant Design 5

- `src/app` — провайдеры, роутер (`router.tsx`), навигация (`navigation.tsx`), layout.
- `src/shared/api` — клиент, `hooks.ts` (`useApiQuery`/`useApiMutation`), `endpoints.ts`, `query-keys.ts`,
  тексты ошибок по кодам (ru/kk).
- `src/shared/auth` — сессия (токен в памяти, тихий refresh), `can(permission, branchId?)`, `useCan`,
  `RequirePermission` (семантика как у серверного Actor: глобальные права или права в филиале).
- `src/shared/branch` — переключатель филиала (текущий филиал для всех разделов; «Все филиалы» — только
  при глобальных правах).
- `src/shared/feed` — `useAdminFeed`/FeedProvider: SSE-лента очередей (новые заказы, брони, заявки) со звуком,
  инвалидация запросов TanStack Query.
- `src/shared/ui` — `TranslatableInput`, `MoneyInput`, `MoneyText`, `StatusTag`, `BranchSelect`,
  `DateRangeFilter`, `PaginatedTable`, `ConfirmAction`, `JsonDiff`.
- `src/features/<раздел>/` — страницы разделов. Доступные действия берутся из ответа сервера
  (`allowedTransitions` и т.п.), права — через `useCan`.
- i18n: `react-i18next`, ru и kk полностью (тест на совпадение ключей).
- Проверки: `pnpm --filter @aula/admin typecheck && pnpm --filter @aula/admin lint && pnpm --filter @aula/admin test && pnpm --filter @aula/admin build`.
