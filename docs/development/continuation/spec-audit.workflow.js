export const meta = {
  name: 'aula-spec-audit',
  description: 'Adversarial audit of the whole AULA system against every section of the spec (find + verify, read-only)',
  phases: [
    { title: 'Audit', detail: '8 independent auditors by spec area' },
    { title: 'Verify', detail: 'skeptic re-checks each blocker/major finding' },
  ],
}

const ROOT = '/home/user/restaraunt-aula'
const COMMON = `
You are an independent, skeptical AUDITOR of the AULA restaurant platform (repository ${ROOT}): NestJS modular monolith backend (apps/api), Next.js 15 storefront (apps/web), React+AntD admin SPA (apps/admin), devops (docker, .github, ops/), docs/. The customer demanded: implement the technical spec STRICTLY and COMPLETELY; for unconfirmed hypotheses the team chose logical business behaviour, recorded in docs/decisions.md (treat decisions.md as binding clarifications).
READ-ONLY: do not modify any files, do not run git commands that change state. You MAY run read-only commands and tests (use your own TEST_DATABASE_NAME=aula_audit_<your-area> for API integration tests; PostgreSQL/Redis run locally; if they're down run 'service postgresql start; service redis-server start').
Spec: ${ROOT}/docs/spec/ТЗ-AULA-уровень-3.md. Also read docs/decisions.md, docs/development/backend-guide.md, docs/development/frontend-guide.md as needed.
Method: extract EVERY requirement (explicit and implied) of your area from the spec, then for each find concrete evidence in code (file:line) and tests, and for UI requirements in the frontend code. Be adversarial: look for missing features, partially implemented flows, requirements satisfied only in the backend but not reachable from the UI (or vice versa), wrong business logic, violated invariants, security holes, missing tests for mandatory flows, docs gaps. Do not report style nits. Do not report things explicitly out of scope in the spec («Не входит»).
Severity: blocker = spec requirement missing or broken / data-integrity or security bug; major = requirement only partially met or important flow unreachable/buggy; minor = small gap.
Return structured output. Each finding must be specific and actionable with evidence.`

const AREAS = [
  { key: 'storefront-menu-seo', focus: 'Раздел «1. Витрина и меню» полностью (главная, страницы филиалов с адресом/часами/картой, каталог по категориям, карточка блюда: фото/состав/вес/цена/модификаторы/добавки, поиск и фильтры вегетарианское/острое/халал/до N тенге, стоп-лист по филиалу (скрыть или пометить), цена по филиалу, контент kk/ru каждое поле переводимое; SEO: SSR, уникальные title/description, микроразметка Restaurant и Menu, sitemap, человекочитаемые URL) + NFR «Нагрузка и отклик» (каталог ≤2 с на 4G, API p95 ≤300 мс — look for N+1, missing indexes, caching) + «Мобильные устройства» (mobile-first) + аналитика GA/Метрика цели. Code: apps/web, apps/api/src/modules/catalog, identity public branches, reporting analytics ingestion.' },
  { key: 'ordering-payments', focus: 'Раздел «2. Заказ доставки и самовывоза» полностью: корзина, промокоды, выбор филиала автоматически по адресу, зоны доставки (полигоны, мин. сумма, бесплатная от суммы; зоны не пересекаются внутри филиала), время ASAP/к времени, комментарий, бесконтактная доставка, оплата онлайн или при получении, заказ создаётся до оплаты в «ожидает оплаты» и подтверждается только по успешному платежу/колбэку, конечный автомат строго по схеме, отмена после оплаты → возврат, частичный возврат; модель данных Order/OrderItem/DeliveryZone/Payment инварианты (итог пересчитывается на сервере, снимок позиций, внешний id платежа уникален, идемпотентность); интеграции Kaspi Pay, Halyk epay, Яндекс.Доставка; NFR «оформление не больше 4 экранов», «данные карт не проходят через сервер». Code: apps/api ordering, payments; apps/web checkout/order status; apps/admin orders, delivery zones, promo codes, payments.' },
  { key: 'reservation', focus: 'Раздел «3. Бронирование столов и залов» полностью: карта залов по филиалам, типы мест конфигурируются, вместимость, минимальный депозит, правила удержания без подтверждения и отмены; только реально свободные места; транзакционная проверка занятости (два одновременных запроса не проходят оба) — абзац «Конкурентная бронь» (блокировка по venue_id и пересечению интервала в одной транзакции); подтверждение по SMS/WhatsApp, напоминание за N часов, отметка пришли/не пришли; депозит VIP онлайн, удерживается по правилам отмены; модель Venue/Reservation инварианты. Code: apps/api reservation; apps/web booking; apps/admin reservations, venues.' },
  { key: 'banquet', focus: 'Раздел «4. Банкеты и кейтеринг» полностью: заявка с формы/из админки (все поля), автоназначение банкетному менеджеру, воронка статусов, конструктор сметы (позиции меню + произвольные, количество, цена, скидка, итог, НДС), PDF под брендом по ссылке, предоплата физлицу (онлайн-ссылка) и юрлицу (счёт-фактура с реквизитами), фиксация оплат/остатка/срока, документы договор/счёт/акт, реквизиты заказчика переиспользуются, календарь синхронен с бронью; цели: 95% ответ за 30 минут, 0 потерянных заявок; модель BanquetRequest/Quote/Invoice инварианты; ЭСФ. Code: apps/api banquet (+ reservation VenueAvailability), apps/web banquets pages, apps/admin banquets.' },
  { key: 'certificates-customers', focus: 'Разделы «5. Подарочные сертификаты» (продажа на сумму/набор, уникальный код, PDF с дизайном, отправка на почту/WhatsApp, частичное списание, срок, блокировка, проверка кода из админки и с точки, отчёт выпущенные/погашенные/просроченные; защита от подбора кодов; инвариант остаток ≥ 0) и «6. База гостей» (идентификация по телефону +7XXXXXXXXXX, история заказов/броней/банкетов, сумма за период, предпочтения и аллергии, теги, сегменты для выгрузки, явное согласие на обработку ПД с датой и версией текста; закон РК о ПД). Code: apps/api payments (certificates), customers; apps/web certificates, consents; apps/admin certificates, customers.' },
  { key: 'admin-reports-roles', focus: 'Разделы «Роли и доступы» (8 ролей, роль привязана к филиалу, разные роли в разных филиалах, глобальные роли видят все филиалы; ОБЯЗАТЕЛЬНО: любое действие, меняющее деньги, статус заказа или состав меню, пишется в журнал с пользователем, временем и прежним значением — check EVERY such action across all modules) и «7. Админ-панель и отчётность» (один интерфейс на все филиалы с переключателем; очереди новых заказов/броней/банкетных заявок со звуком; управление меню, ценами, стоп-листом, зонами, промокодами, залами, пользователями; отчёты: выручка по дням и каналам, средний чек, конверсия витрины в заказ, топ блюд, загрузка залов по дням недели, воронка банкетов, отменённые заказы и причины; XLSX; журнал с фильтрами) + таблица целей (метрики). Code: apps/api identity, reporting, notifications (feed), audit usage in all modules; apps/admin shell + all sections.' },
  { key: 'architecture-integrations', focus: 'Разделы «Интеграции» (каждая за адаптером за интерфейсом; все обращения к внешним API только асинхронно через очередь с повторами и экспоненциальной задержкой; входящие вебхуки идемпотентны; ответы логируются целиком с маскированием; недоступность POS/мессенджера не блокирует приём заказа) и «Архитектура и стек» + ВСЕ 12 «Правил, чтобы код не стал спагетти» (check each rule across all modules: cross-module table access, business logic in controllers, one-action-per-class, provider names outside adapters, statuses as enums+FSM with methods, money in tiyn no float + no calc on frontend, async external calls with retry limit and failure queue, no business logic in frontend, forward-only migrations, tests on domain + integration tests for order/payment/booking/banquet, multibranch & multilanguage in schema, code review/no direct commits to main (CI/branch rules docs)), «Модель данных и инварианты» (every row of the invariants table + общие правила схемы: UTC/Asia/Almaty, deleted_at + запрет физического удаления заказов/платежей/броней, переводимые поля не в name_ru столбцах, каждая сумма с валютой, номера заказов и счетов последовательностью в разрезе филиала и года), единый REST API с OpenAPI. Code: whole apps/api; run the architecture spec and eslint.' },
  { key: 'nfr-ops-handover', focus: 'Раздел «Нефункциональные требования» (доступность 99.5%, плановые работы вне пика, падение POS/мессенджера/провайдера не роняет сайт; безопасность: HTTPS с редиректом, HSTS, bcrypt/argon2, ограничение частоты на формы заказа/брони/авторизации, защита от подбора кодов сертификатов, данные карт не хранятся, ПД по закону РК — согласие с датой и версией; бэкапы: ежедневный полный БД и файлов, 30 дней, копия в другом регионе/у другого провайдера, проверка восстановления раз в квартал, RPO 24 ч, RTO 4 ч; инфраструктура: Docker, три окружения, CI/CD по тегу, откат одной командой, Sentry, структурированные логи, мониторинг доступности и очередей с оповещением, хостинг в РК; передача проекта: README с развёртыванием, описание OpenAPI, схема базы, инструкция для администратора, видео по админке (script acceptable), доступы на юрлицо клиента; гарантия) + «Этапы» (three stages each ending in production-ready part — check that stage 1/2/3 scope is all present) + «Открытые вопросы» handled in decisions.md. Code: Dockerfiles, docker-compose*, ops/**, .github/**, apps/api shared infrastructure (security headers, rate limits, logging, sentry, health/metrics), docs/**.' },
]

const FINDINGS = {
  type: 'object',
  properties: {
    area: { type: 'string' },
    requirementsChecked: { type: 'number' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          component: { type: 'string', enum: ['api', 'web', 'admin', 'infra', 'docs'] },
          specRef: { type: 'string' },
          finding: { type: 'string' },
          evidence: { type: 'string' },
          suggestedFix: { type: 'string' },
        },
        required: ['id', 'severity', 'component', 'specRef', 'finding', 'evidence', 'suggestedFix'],
      },
    },
    summary: { type: 'string' },
  },
  required: ['area', 'requirementsChecked', 'findings', 'summary'],
}

const VERDICT = {
  type: 'object',
  properties: {
    confirmed: { type: 'boolean' },
    adjustedSeverity: { type: 'string', enum: ['blocker', 'major', 'minor', 'invalid'] },
    reasoning: { type: 'string' },
  },
  required: ['confirmed', 'adjustedSeverity', 'reasoning'],
}

const results = await pipeline(
  AREAS,
  (a) =>
    agent(`${COMMON}\n\nYOUR AREA: ${a.key}\n${a.focus}\n\nReturn findings (area='${a.key}', ids like '${a.key}-1').`, {
      label: `audit:${a.key}`,
      phase: 'Audit',
      schema: FINDINGS,
    }),
  (res) => {
    if (!res) return null
    const serious = res.findings.filter((f) => f.severity !== 'minor')
    return parallel(
      serious.map((f) => () =>
        agent(
          `You are a skeptical verifier. READ-ONLY (no file changes, no git state changes). Repository ${ROOT}. An auditor claims this finding about the AULA platform against its spec (docs/spec/ТЗ-AULA-уровень-3.md; binding clarifications in docs/decisions.md):\n${JSON.stringify(f, null, 2)}\nTry hard to REFUTE it: check the actual code/tests (search thoroughly — features often live in other files/modules than expected, e.g. shared infrastructure, public contracts, other frontends). Confirm only if the gap/bug really exists. Adjust severity if exaggerated; 'invalid' if false.`,
          { label: `verify:${f.id}`, phase: 'Verify', schema: VERDICT },
        ).then((v) => ({ ...f, verdict: v })),
      ),
    ).then((verified) => ({
      area: res.area,
      summary: res.summary,
      requirementsChecked: res.requirementsChecked,
      confirmed: verified.filter(Boolean).filter((f) => f.verdict?.confirmed && f.verdict.adjustedSeverity !== 'invalid').map((f) => ({ ...f, severity: f.verdict.adjustedSeverity })),
      rejected: verified.filter(Boolean).filter((f) => !f.verdict?.confirmed || f.verdict.adjustedSeverity === 'invalid').map((f) => ({ id: f.id, finding: f.finding, reason: f.verdict?.reasoning })),
      minor: res.findings.filter((f) => f.severity === 'minor'),
    }))
  },
)
return results.filter(Boolean)
