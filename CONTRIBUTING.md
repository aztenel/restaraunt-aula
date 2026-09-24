# Как вносить изменения в AULA

Правила из раздела ТЗ «Правила, чтобы код не стал спагетти» — **условия приёмки кода**, а не пожелания.
Перед изменениями в backend прочитайте [docs/development/backend-guide.md](docs/development/backend-guide.md).

## Ветки и pull request

- `main` защищена: **прямые коммиты и force-push в `main` запрещены** (ТЗ, правило 12). Всё — через pull request.
- Ветка от свежего `main`, имя — тип и суть: `feat/ordering-promo-codes`, `fix/reservation-overlap`,
  `chore/deps-nestjs`, `docs/operations-restore`. Одна задача — одна ветка.
- Перед PR: `git fetch && git rebase origin/main`, локально зелёные `pnpm lint`, `pnpm typecheck`, тесты.
- Заполните шаблон PR ([.github/pull_request_template.md](.github/pull_request_template.md)): что и зачем,
  как проверено, миграции, новые переменные окружения, влияние на API.
- Небольшие PR (до ~400 строк без сгенерированного кода) проверяются быстрее и качественнее.
- Слияние — **squash merge** с заголовком в формате Conventional Commits; ветка удаляется после слияния.

## Код-ревью (обязательно)

- Нужен **минимум 1 approve** и approve **владельца кода** из [.github/CODEOWNERS](.github/CODEOWNERS)
  (например, изменения в `ops/` и `.github/` — команда DevOps, миграции — backend + техлид).
- Новый push после approve сбрасывает одобрение — ревью смотрит финальную версию.
- Ревьюер проверяет: границы модулей и отсутствие бизнес-логики во фронтенде и контроллерах, одно действие —
  один класс, статусы через конечные автоматы, деньги в тиынах, внешние вызовы только через очередь,
  журнал действий для денег/статусов/меню, тесты, обратную совместимость миграций и API.
- Автор не мержит без зелёного CI, даже если ревью одобрено.

## Обязательные проверки CI

Workflow [.github/workflows/ci.yml](.github/workflows/ci.yml), итоговая проверка для защиты ветки — **«CI OK»**:

| Задача | Что проверяет | Правило ТЗ |
| --- | --- | --- |
| Lint + границы модулей | ESLint во всех пакетах; `boundaries/*` (eslint-plugin-boundaries) — импорт внутренностей чужого модуля валит сборку; отключать правило комментариями запрещено | 1 |
| Typecheck | `tsc --noEmit` во всех пакетах | — |
| Unit-тесты | домен модулей, `architecture.spec.ts` (обращение к чужой схеме БД, имена провайдеров вне адаптеров) | 1, 4, 10 |
| Интеграционные тесты | заказ, оплата, бронь, банкетная заявка, HTTP-сценарии на PostgreSQL 16 + Redis 7 | 10 |
| OpenAPI актуален | `pnpm openapi` не меняет `docs/openapi.json` и `packages/api-client` | — |
| Сборка | `pnpm build` (api, web, admin) | — |
| Docker-образы | сборка `aula-api`, `aula-web`, `aula-admin`, `aula-backup` без публикации | — |

### Настройка защиты `main` (администратор репозитория, один раз)

Settings → Rules → Rulesets (или Branch protection rules) для `main`:

- Require a pull request before merging; Required approvals: **1**; Require review from Code Owners;
  Dismiss stale pull request approvals when new commits are pushed.
- Require status checks to pass: **CI OK**; Require branches to be up to date before merging.
- Block force pushes; Restrict deletions; правила действуют и для администраторов (без bypass).
- Require linear history (squash merge).
- Отдельный ruleset для тегов `v*`: создавать теги могут только мейнтейнеры (тег = выкатка на staging/production).

## Коммиты: Conventional Commits

```
<тип>(<область>): <что сделано, в повелительном наклонении>

feat(ordering): бесплатная доставка от суммы в зоне
fix(reservation): пересечение броней при буфере уборки
refactor(payments): вынести расчёт возврата в домен
test(banquet): интеграционный тест предоплаты по счёту
docs(operations): процедура проверки восстановления
chore(deps): обновить NestJS до 11.2
ci: кэш pnpm в CI
feat(api)!: убрать поле price из DishDto        # «!» — ломающее изменение API
```

Типы: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `chore`, `ci`, `build`. Область — модуль (`identity`,
`catalog`, `ordering`, `reservation`, `banquet`, `payments`, `customers`, `notifications`, `reporting`, `pos`),
`platform`, `web`, `admin`, `api-client`, `ops`, `deps`.

## Миграции: только вперёд (ТЗ, правило 9)

- Файл `apps/api/src/modules/<m>/infrastructure/migrations/YYYYMMDDHHMM_<описание>.sql`; первая миграция модуля
  создаёт его схему. Применённую миграцию менять нельзя (сверяется контрольная сумма) — только новая миграция.
- Ручные правки базы на staging/production запрещены. Исправление данных — тоже миграцией (или действием в админке
  с записью в журнал действий).
- **Expand/contract**: каждая миграция совместима с кодом предыдущего релиза, потому что откат
  (`ops/deploy/rollback.sh`) запускает предыдущую версию приложения на новой схеме без отката миграций:
  - можно: новые таблицы, nullable-колонки или колонки с `default`, новые индексы и ограничения, которые старый код
    не нарушает (`not valid` + отдельный `validate constraint`), новые значения в `check (status in (...))`;
  - нельзя в одном релизе с изменением кода: удалить или переименовать таблицу/колонку, сменить тип, сделать колонку
    `not null` без default, сузить `check`. Это делается в 2–3 релиза: добавить новое → писать в оба и перенести
    данные → (следующий релиз) читать новое → (ещё релиз) удалить старое.
- Долгие операции на больших таблицах — в окно обслуживания; в начале миграции — `set local lock_timeout = '5s';`,
  чтобы миграция не блокировала приём заказов.
- Пример «переименовать колонку `phone` → `phone_e164`»: релиз N — `add column phone_e164`, код пишет в обе, миграция
  копирует данные; релиз N+1 — код читает только `phone_e164`; релиз N+2 — `drop column phone`.

## OpenAPI и клиент

После изменения контроллеров или DTO: `pnpm openapi` и закоммитить `docs/openapi.json` и
`packages/api-client/src/schema.d.ts`. CI проверяет, что сгенерированное совпадает с кодом. Ломающие изменения
публичного API (`/api/v1/public`) недопустимы без согласования: по нему работают витрина и будущие мобильное
приложение и портал франчайзи.

## Как добавить модуль

1. Структура по [backend-guide](docs/development/backend-guide.md) (эталон — `identity`):
   `apps/api/src/modules/<m>/{<m>.module.ts, public/, domain/, application/, infrastructure/, http/, handlers/}`.
2. Публичный контракт — только в `public/index.ts`; другие модули импортируют только его. Правило границ
   eslint подхватывает новый каталог автоматически.
3. Первая миграция создаёт схему `<m>`; внешние ключи на таблицы других модулей не ставятся.
4. Зарегистрировать модуль в `apps/api/src/modules/index.ts`, сиды — в `apps/api/src/modules/seeders.ts`.
5. Unit-тесты домена и интеграционные тесты HTTP-сценариев (`*.int.spec.ts`); заглушки других модулей — `test/fakes`.
6. Добавить владельцев в [.github/CODEOWNERS](.github/CODEOWNERS) и ключевые таблицы в `VERIFY_KEY_TABLES`
   (`ops/backup/verify-restore.sh`, проверка восстановления).
7. `pnpm openapi`, если модуль добавляет маршруты.

## Как добавить интеграцию (платёжный провайдер, мессенджер, POS, доставка, учёт)

1. Интерфейс (абстрактный класс) — в `domain/` или `application/` модуля; реализация — в
   `infrastructure/adapters/<provider>/`. Имя провайдера не встречается нигде, кроме адаптера, `*.module.ts` и
   конфигурации (проверяет `architecture.spec.ts`).
2. Поля настроек адаптер регистрирует в `IntegrationCatalog`, читает из `IntegrationSettings` (ключ
   `<модуль>.<провайдер>`). **Секреты провайдеров не хранятся в git и в env-файлах**: их вводит администратор
   системы в админке (шифруются `APP_ENCRYPTION_KEY`). Для staging/CI допустима начальная переменная
   `INTEGRATION__<МОДУЛЬ>__<ПРОВАЙДЕР>` (см. `apps/api/.env.example`).
3. Все вызовы наружу — через `ExternalHttp` (таймауты, классификация ошибок, полный лог с маскированием) и только
   из фоновых задач `JobQueue` с лимитом повторов и экспоненциальной задержкой; после исчерпания — очередь неудач.
4. Входящие вебхуки идемпотентны (повтор с тем же идентификатором не меняет состояние), маршрут
   `/api/v1/webhooks/<provider>`, `@SkipRateLimit()`.
5. Недоступность провайдера не блокирует бизнес-операцию (заказ принимается, действие ставится в очередь).
6. Тесты адаптера — с `FakeHttpTransport`, без сети. Обновить [docs/decisions.md](docs/decisions.md) и раздел
   «Инциденты» в [docs/operations.md](docs/operations.md), если у интеграции свой сценарий отказа.

## Переменные окружения

Новая переменная: схема в `apps/api/src/shared/infrastructure/config/config.ts` (валидация zod), описание в
`apps/api/.env.example` (или `apps/web/.env.example`, `apps/admin/.env.example`), для публичных параметров
фронтендов — `ops/build-env/*.env`, и строка в PR «новые переменные окружения» — чтобы администратор добавил её на
серверы до деплоя.

## Релизы

Версии — SemVer, тег `vMAJOR.MINOR.PATCH` на коммите в `main` (`git tag -a v1.4.0 -m "..." && git push origin v1.4.0`).
Тег запускает CI → образы → staging → production после подтверждения (см. [docs/operations.md](docs/operations.md)).
Release notes — «Generate release notes» в GitHub Releases по заголовкам PR.

## Безопасность

- Никаких секретов, паролей, токенов и персональных данных в коде, коммитах, issues и логах.
- Данные карт не проходят через сервер — только платёжный провайдер.
- Уязвимость — сообщить приватно владельцу репозитория, не в публичном issue.
