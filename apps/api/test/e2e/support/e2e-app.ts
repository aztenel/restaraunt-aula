/**
 * Сквозные (e2e) тесты: ВСЕ доменные модули подключены по-настоящему (DOMAIN_MODULES), заглушек
 * публичных контрактов нет. Подменяется только сеть внешних систем (HttpTransport → FakeHttpTransport)
 * и время (FixedClock). Данные — настоящие сиды модулей (демо: 2 филиала, меню, зоны, залы, сертификаты)
 * + сотрудники через tokenFor. Всё остальное — через HTTP API, outbox обрабатывается t.drain().
 */
import request from 'supertest';
import { FakeHttpTransport } from '../../fakes';
import { tokenFor } from '../../support/fixtures';
import { createTestApp, TestApp } from '../../support/test-app';
import { DOMAIN_MODULES } from '../../../src/modules';
import { MODULE_SEEDERS } from '../../../src/modules/seeders';
import { seedIdentity } from '../../../src/modules/identity/infrastructure/seed';
import { ActorResolver } from '../../../src/modules/identity/application/actor-resolver';
import { BranchDirectoryService } from '../../../src/modules/identity/application/directories';
import { StaffRole } from '../../../src/modules/identity/public';
import { HttpTransport } from '../../../src/shared/infrastructure/integrations/external-http';
import { IntegrationSettings } from '../../../src/shared/infrastructure/settings/integration-settings';
import { Database } from '../../../src/shared/infrastructure/database/database';
import { newId } from '../../../src/shared/kernel/ids';
import { sql } from 'kysely';
import { SandboxGateway } from '../../../src/modules/payments/infrastructure/adapters/sandbox/sandbox.gateway';
import { SandboxStore } from '../../../src/modules/payments/infrastructure/adapters/sandbox/sandbox.store';

/** 2026-10-01 (четверг) 11:00 по Астане (UTC+5): филиалы открыты 10:00–00:00. */
export const E2E_NOW = '2026-10-01T06:00:00.000Z';
export const E2E_TODAY = '2026-10-01';

/** Координаты демо-филиалов (identity seed). */
export const GL_LOCATION = { lat: 51.0762, lng: 71.4125 };
export const GV_LOCATION = { lat: 51.0906, lng: 71.4187 };
/**
 * Точка к югу от GreenLine: внутри ближней зоны GreenLine (500 ₸) и дальней зоны Garden View (1 000 ₸) —
 * выбор филиала по меньшей стоимости доставки должен дать GreenLine.
 */
export const POINT_NEAR_GL = { lat: 51.062, lng: 71.4125 };

export interface SeededData {
  branches: { greenline: string; gardenView: string };
  legalEntityId: string;
  ownerUserId: string;
}

export interface E2eContext {
  t: TestApp;
  /** Сеть внешних систем (новая на каждый тест). */
  readonly net: FakeHttpTransport;
  seed: SeededData;
  api(): ReturnType<typeof request>;
  reset(): Promise<void>;
  /** Сотрудник с ролями (tokenFor); phone — телефон в профиле (WhatsApp для уведомлений персоналу), задаётся через админ-API. */
  staff(
    roles: Array<{ role: StaffRole; branchId?: string | null }>,
    name?: string,
    options?: { phone?: string },
  ): Promise<{ userId: string; auth: string }>;
  /** Сотрудник с полным доступом (собственник) — для чтения журналов, отчётов, ленты. */
  owner(): Promise<string>;
  /** Администратор системы (журнал действий, очередь неудач, интеграции, журнал доставки). */
  sysadmin(): Promise<string>;
  /** Обработать outbox; с advanceMs — сначала сдвинуть часы. */
  drain(advanceMs?: number): Promise<void>;
  /** Настройка интеграции через админ-API (как это делает администратор системы). */
  configureIntegration(key: string, value: { enabled: boolean; config?: Record<string, unknown>; secrets?: Record<string, string> }): Promise<void>;
  close(): Promise<void>;
}

export async function createE2eApp(): Promise<E2eContext> {
  const holder = { net: new FakeHttpTransport() };
  const transport = { send: (input: Parameters<HttpTransport['send']>[0]) => holder.net.send(input) } as HttpTransport;
  const t = await createTestApp({
    imports: DOMAIN_MODULES,
    providers: [{ provide: HttpTransport, useValue: transport }],
    now: new Date(E2E_NOW),
  });
  let ownerAuth: string | null = null;
  let sysadminAuth: string | null = null;

  const ctx: E2eContext = {
    t,
    get net() {
      return holder.net;
    },
    seed: { branches: { greenline: '', gardenView: '' }, legalEntityId: '', ownerUserId: '' },
    api: () => request(t.app.getHttpServer()),
    async reset() {
      await t.reset();
      t.get(IntegrationSettings).invalidate();
      t.get(BranchDirectoryService).invalidate();
      t.get(ActorResolver).invalidate();
      t.clock.set(new Date(E2E_NOW));
      holder.net = new FakeHttpTransport();
      ownerAuth = null;
      sysadminAuth = null;
      ctx.seed = await seedAll(t);
    },
    async staff(roles, name, options) {
      const { userId, auth } = await tokenFor(t, roles, name);
      if (options?.phone) {
        await ctx
          .api()
          .patch(`/api/v1/admin/users/${userId}`)
          .set('Authorization', await ctx.sysadmin())
          .send({ phone: options.phone })
          .expect(200);
        t.get(ActorResolver).invalidate(userId);
      }
      return { userId, auth };
    },
    async owner() {
      ownerAuth ??= (await tokenFor(t, [{ role: 'owner' }], 'Собственник (тест)')).auth;
      return ownerAuth;
    },
    async sysadmin() {
      sysadminAuth ??= (await tokenFor(t, [{ role: 'sysadmin' }], 'Администратор (тест)')).auth;
      return sysadminAuth;
    },
    async drain(advanceMs) {
      if (advanceMs) t.clock.advance(advanceMs);
      await t.drain();
    },
    async configureIntegration(key, value) {
      await ctx
        .api()
        .put(`/api/v1/admin/system/integrations/${key}`)
        .set('Authorization', await ctx.sysadmin())
        .send({ enabled: value.enabled, config: value.config ?? {}, secrets: value.secrets ?? {} })
        .expect(204);
      t.get(IntegrationSettings).invalidate();
    },
    close: () => t.close(),
  };
  return ctx;
}

/** Все сиды модулей в демо-режиме (как `SEED_DEMO=true pnpm seed`), затем обработка порождённых событий. */
export async function seedAll(t: TestApp): Promise<SeededData> {
  const log = () => undefined;
  const identity = await seedIdentity(t.app, {
    demo: true,
    ownerEmail: 'owner@aula.kz',
    ownerPassword: 'Owner-Password-2026!',
    adminEmail: 'admin@aula.kz',
    adminPassword: 'Admin-Password-2026!',
    log,
  });
  t.get(BranchDirectoryService).invalidate();
  for (const seeder of MODULE_SEEDERS) {
    await seeder.seed({ app: t.app, ...identity, demo: true, log });
  }
  t.get(IntegrationSettings).invalidate();
  await t.drain();
  return {
    branches: { greenline: identity.branches.greenline!, gardenView: identity.branches['garden-view']! },
    legalEntityId: identity.legalEntityId,
    ownerUserId: identity.ownerUserId,
  };
}

// ---------------------------------------------------------------- помощники

export const money = (tenge: number) => ({ amount: tenge * 100, currency: 'KZT' });

export function idem(prefix = 'e2e'): string {
  return `${prefix}-${newId()}`;
}

/** Параметры страницы оплаты песочницы из paymentUrl: /public/payments/sandbox/:id?sig=... */
export function sandboxLink(paymentUrl: string): { paymentId: string; sig: string } {
  const url = new URL(paymentUrl);
  const m = /\/public\/payments\/sandbox\/([0-9a-f-]{36})$/.exec(url.pathname);
  if (!m) throw new Error(`Not a sandbox payment url: ${paymentUrl}`);
  return { paymentId: m[1]!, sig: url.searchParams.get('sig') ?? '' };
}

/** Гость нажимает «Оплатить» / «Отказ» на странице песочницы (вебхук через общий конвейер). */
export async function sandboxPay(ctx: E2eContext, paymentUrl: string, result: 'succeeded' | 'failed' = 'succeeded'): Promise<void> {
  const { paymentId, sig } = sandboxLink(paymentUrl);
  // Страница оплаты открывается.
  const page = await ctx.api().get(`/api/v1/public/payments/sandbox/${paymentId}`).query({ sig }).expect(200);
  if (!page.text.includes('Оплатить')) throw new Error(`Sandbox page has no pay button: ${page.text.slice(0, 500)}`);
  await ctx.api().post(`/api/v1/public/payments/sandbox/${paymentId}`).type('form').send({ sig, result }).expect(303);
}

export interface DeliveryLogItem {
  id: string;
  template: string;
  audience: string;
  channel: string;
  provider: string | null;
  recipient: string;
  recipientName: string | null;
  status: string;
  messageStatus: string;
  related: { type: string; id: string } | null;
  branchId: string | null;
}

/** Журнал доставки уведомлений (админ-API, право integrations.manage). */
export async function deliveries(
  ctx: E2eContext,
  filter: { template?: string; relatedId?: string; relatedType?: string; audience?: 'guest' | 'staff'; recipient?: string } = {},
): Promise<DeliveryLogItem[]> {
  const res = await ctx
    .api()
    .get('/api/v1/admin/notifications/deliveries')
    .query({ ...filter, perPage: 100 })
    .set('Authorization', await ctx.sysadmin())
    .expect(200);
  return res.body.items as DeliveryLogItem[];
}

export async function deliveryDetail(ctx: E2eContext, id: string): Promise<any> {
  const res = await ctx.api().get(`/api/v1/admin/notifications/deliveries/${id}`).set('Authorization', await ctx.sysadmin()).expect(200);
  return res.body;
}

export interface AuditItem {
  action: string;
  entityType: string;
  entityId: string;
  branchId: string | null;
  actorUserId: string | null;
  before: any;
  after: any;
  meta: any;
}

/** Журнал действий (админ-API, право audit.view), по возрастанию времени. */
export async function auditLog(ctx: E2eContext, filter: { entityId?: string; action?: string; entityType?: string } = {}): Promise<AuditItem[]> {
  const res = await ctx
    .api()
    .get('/api/v1/admin/system/audit-log')
    .query({ ...filter, perPage: 200 })
    .set('Authorization', await ctx.sysadmin())
    .expect(200);
  return [...(res.body.items as AuditItem[])].reverse();
}

export interface FeedItem {
  id: string;
  branchId: string | null;
  stream: string;
  kind: string;
  entityId: string;
  title: string;
  sound: boolean;
}

/** Лента админки (как её видит собственник). */
export async function feed(ctx: E2eContext, auth?: string): Promise<FeedItem[]> {
  const res = await ctx
    .api()
    .get('/api/v1/admin/feed/recent')
    .query({ limit: 500, since: '2000-01-01T00:00:00.000Z' })
    .set('Authorization', auth ?? (await ctx.owner()))
    .expect(200);
  return res.body as FeedItem[];
}

/** Событие из outbox (для проверки payload контрактов между модулями). */
export async function outboxEvents(ctx: E2eContext, type: string): Promise<Array<{ id: string; payload: any }>> {
  const rows = await sql<{ payload: any }>`
    select payload from platform.outbox where kind = 'event' and topic = ${type} order by created_at`.execute(ctx.t.get(Database).rootConnection());
  return rows.rows.map((r) => ({ id: r.payload.id, payload: r.payload.payload }));
}

/** Необработанные записи outbox (готовые к выполнению сейчас) — должно быть 0 после drain. */
export async function pendingOutbox(ctx: E2eContext): Promise<Array<{ topic: string; last_error: string | null }>> {
  const rows = await sql<{ topic: string; last_error: string | null }>`
    select topic, last_error from platform.outbox where dispatched_at is null and available_at <= ${ctx.t.clock.now()}`.execute(
    ctx.t.get(Database).rootConnection(),
  );
  return rows.rows;
}

export async function failedJobs(ctx: E2eContext): Promise<any[]> {
  const res = await ctx.api().get('/api/v1/admin/system/failed-jobs').set('Authorization', await ctx.sysadmin()).expect(200);
  return res.body.items;
}

/**
 * «Сторона провайдера»: гость оплатил на странице провайдера уже после того, как мы отменили платёж
 * (страница песочницы после отмены оплату не принимает, как и у настоящего провайдера с отозванной ссылкой;
 * но провайдер мог списать деньги раньше, чем узнал об отмене). Провайдер фиксирует списание и присылает
 * подписанный вебхук — через публичный маршрут вебхуков.
 */
export async function lateProviderCapture(ctx: E2eContext, payment: { externalId: string; amount: { amount: number } }): Promise<void> {
  await ctx.t.get(SandboxStore).setStatus(payment.externalId, 'succeeded');
  const body = JSON.stringify({ eventId: `late-${newId()}`, externalId: payment.externalId, status: 'succeeded', amount: { amount: payment.amount.amount, currency: 'KZT' } });
  const signature = await ctx.t.get(SandboxGateway).sign(body);
  await ctx
    .api()
    .post('/api/v1/webhooks/payments/sandbox')
    .set('content-type', 'application/json')
    .set('x-sandbox-signature', signature)
    .send(body)
    .expect(200);
}
