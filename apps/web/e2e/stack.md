# Браузерные e2e витрины: как поднять стек

Сценарии в `apps/web/e2e/*.spec.ts` проходят витрину в настоящем браузере (Playwright, Chromium) против
запущенных API и витрины с демо-данными сида. Конфиг `apps/web/playwright.config.ts` серверы **не запускает** —
стек поднимается заранее (локально — по шагам ниже, в CI — задача `e2e-web` в `.github/workflows/ci.yml`).

| Спецификация | Что проверяет |
| --- | --- |
| `order-delivery.spec.ts` | меню → раздел → блюдо → корзина → доставка (клик по карте в демо-зоне) → промокод → онлайн-оплата в песочнице → заказ оплачен, корзина очищена |
| `order-pickup.spec.ts` | самовывоз ко времени с оплатой при получении и подтверждением телефона SMS-кодом; отказ оплаты → «Оплатить снова» → оплачено |
| `booking.spec.ts` | бронь VIP-зала с депозитом: поиск, выбор на схеме зала, оплата депозита, подтверждение, отмена с возвратом |
| `banquet.spec.ts` | заявка на банкет → смета через админ-API → согласование по ссылке → счёт физлицу → оплата |
| `certificate.spec.ts` | покупка подарочного сертификата → оплата → сертификат выпущен |
| `seo.spec.ts` | уникальные title/description, canonical, hreflang kk/ru/en/x-default, JSON-LD, 404, noindex, sitemap (только desktop) |
| `i18n.spec.ts` | kk/ru/en: на страницах нет «сырых» ключей словаря, `lang` страницы верный (только desktop) |

Проекты: `desktop` (Desktop Chrome) и `mobile` (Pixel 7). Выполнение последовательное (`workers: 1`):
сценарии создают заказы, брони и платежи в общей БД стенда.

## 1. PostgreSQL 16 и Redis 7

```bash
docker compose up -d postgres redis          # из корня репозитория
psql postgres://aula:aula@localhost:5432/postgres -c 'create database aula_web_e2e'
```

## 2. API: миграции, демо-сид, запуск

Окружение (порты по умолчанию для e2e: API — 3400, витрина — 3401):

```bash
export NODE_ENV=development            # песочница оплат и канал SMS «log» работают только вне production
export PORT=3400
export DATABASE_URL=postgres://aula:aula@localhost:5432/aula_web_e2e
export REDIS_URL=redis://localhost:6379
export QUEUE_DRIVER=inline QUEUE_INLINE_AUTODRAIN=true QUEUE_PREFIX=aula_web_e2e
export JWT_SECRET=dev-only-jwt-secret-change-me-0123456789abcdef
export APP_ENCRYPTION_KEY=ZGV2LW9ubHktZW5jcnlwdGlvbi1rZXktMzJieXRlcyE=
export STORAGE_DRIVER=local LOCAL_STORAGE_DIR=/tmp/aula-e2e-storage
export API_PUBLIC_URL=http://localhost:3400 PUBLIC_WEB_URL=http://localhost:3401 CORS_ORIGINS=http://localhost:3401
export TRUST_PROXY=true LOG_LEVEL=info
export SEED_DEMO=true SEED_OWNER_EMAIL=owner@aula.kz SEED_OWNER_PASSWORD='E2e-Owner-Password-2026!'

pnpm --filter @aula/api migrate
pnpm --filter @aula/api seed
cd apps/api && node -r @swc-node/register src/main.ts > /tmp/aula-api.log 2>&1 &
curl -sf http://localhost:3400/api/v1/health/ready
```

- `SEED_DEMO=true` — филиалы GreenLine Aqua и Garden View, меню, зоны доставки, залы (VIP, юрта), сертификаты,
  промокод `WELCOME10` (1 раз на телефон), платёжная песочница.
- `SEED_OWNER_PASSWORD` — пароль собственника: тест банкета входит в админ-API (`POST /api/v1/admin/auth/login`)
  и от имени менеджера сохраняет и отправляет смету, выставляет счёт. Если собственник уже был создан с другим
  паролем, сид его не меняет — используйте новую БД.
- stdout API **обязательно в файл**: коды SMS берутся из него (см. ниже).

## 3. Витрина: сборка и запуск

`NEXT_PUBLIC_*` встраиваются при сборке — браузер ходит в API по `NEXT_PUBLIC_API_URL`:

```bash
cd apps/web
NEXT_PUBLIC_API_URL=http://localhost:3400 NEXT_PUBLIC_SITE_URL=http://localhost:3401 API_INTERNAL_URL=http://localhost:3400 pnpm build
API_INTERNAL_URL=http://localhost:3400 SITE_URL=http://localhost:3401 npx next start -p 3401 > /tmp/aula-web.log 2>&1 &
curl -sf http://localhost:3401/api/health
```

Не запускайте витрину из оболочки, где экспортирован `NODE_ENV=development` для API: `next start` должен
работать в production-режиме.

## 4. Прогон

```bash
cd apps/web
npx playwright install chromium        # один раз (локально браузеры могут уже лежать в PLAYWRIGHT_BROWSERS_PATH)
E2E_OWNER_PASSWORD='E2e-Owner-Password-2026!' E2E_API_LOG=/tmp/aula-api.log pnpm test:e2e
```

| Переменная | По умолчанию | Назначение |
| --- | --- | --- |
| `E2E_WEB_URL` | `http://localhost:3401` | витрина (`baseURL`) |
| `E2E_API_URL` | `http://localhost:3400` | API для подготовки данных и админ-действий |
| `E2E_OWNER_EMAIL` / `E2E_OWNER_PASSWORD` | `SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD` | собственник из сида (банкет); без пароля тест пропускается |
| `E2E_API_LOG` | — | файл stdout API; без него тест оплаты при получении пропускается |
| `E2E_WORKERS` | `1` | параллельность |

Полезное:

```bash
pnpm test:e2e -- --project=desktop e2e/booking.spec.ts   # один сценарий, один проект
pnpm test:e2e -- --headed --debug                        # по шагам в браузере
pnpm test:e2e:report                                     # HTML-отчёт последнего прогона
npx playwright show-trace test-results/<тест>/trace.zip  # трасса упавшего теста (сохраняется при падении)
```

## Как тесты обходятся без «чёрных ходов»

- **Код SMS.** В dev и на стендах без SMS-провайдера уведомления уходят в канал `log`
  (`NotificationsLogChannel`, в production не используется): текст пишется в stdout API целиком —
  `[sms -> log] AULA: код 1234 …` с маской получателя `+7 707 *** ** 34`. В БД и журнале доставок админки код
  замаскирован, поэтому тест читает новые строки файла `E2E_API_LOG` и сопоставляет маску номера.
- **Оплата.** Платёжная песочница API (`/api/v1/public/payments/sandbox/:id`, в production — 404): тест нажимает
  «Оплатить» или «Отказ», дальше всё как у настоящего провайдера (вебхук → возврат на витрину).
- **Лимиты частоты.** API ограничивает формы и коды по IP клиента (`forms` — 20 за 10 минут, `otp` — 5 за
  15 минут на маршрут). Каждый тест — отдельный «гость» со своим номером и своим IP в `X-Forwarded-For`
  (при `TRUST_PROXY=true` API берёт IP клиента из этого заголовка, как за reverse proxy). Если лимит всё же
  сработал при частых локальных прогонах: `redis-cli --scan --pattern 'aula_web_e2e:rl:*' | xargs -r redis-cli del`.
- **Данные.** Тесты ищут демо-данные через публичный API (блюдо без обязательных добавок, зоны, VIP-зал с
  депозитом, свободную дату) и создают свои заказы и брони, поэтому стенд можно прогонять повторно. Суммы
  тесты не считают — сравнивают показанное витриной с ответом API.

## CI

Задача `e2e-web` (после `build`): сервисы `postgres:16` и `redis:7`, миграции и демо-сид, API на порту 3000
(`QUEUE_DRIVER=inline`, stdout в файл), сборка и запуск витрины на 3401 с `API_INTERNAL_URL`/`NEXT_PUBLIC_API_URL`
на API, ожидание health, `npx playwright install --with-deps chromium`, прогон. При падении в артефакты уходят
`playwright-report`, `test-results` (трассы, скриншоты, видео) и журналы API и витрины.
