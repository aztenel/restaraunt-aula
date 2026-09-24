/**
 * Общая обвязка интеграционных тестов модуля Payments (в сборку не попадает: src/**\/testing/**).
 */
import { Global, Module, Provider } from '@nestjs/common';
import { createFakes, FakeHttpTransport, fakeProviders, Fakes } from '../../../../test/fakes';
import { createTestApp, TestApp } from '../../../../test/support/test-app';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { ExternalHttp, HttpTransport } from '../../../shared/infrastructure/integrations/external-http';
import { IntegrationSettings } from '../../../shared/infrastructure/settings/integration-settings';
import { Actor } from '../../../shared/kernel/actor';
import { Money } from '../../../shared/kernel/money';
import { pageRequest } from '../../../shared/kernel/pagination';
import { CertificateProductInput, CreateCertificateProduct } from '../application/certificates/certificate-product.actions';
import { IssueCorporateCertificates } from '../application/certificates/purchase-certificate.action';
import { SandboxGateway } from '../infrastructure/adapters/sandbox/sandbox.gateway';
import { SandboxStore } from '../infrastructure/adapters/sandbox/sandbox.store';
import { CertificateProduct } from '../infrastructure/certificate-product.repository';
import { GiftCertificates, PaymentsService } from '../public';
import { PaymentsModule } from '../payments.module';

export interface PaymentsTestContext {
  t: TestApp;
  fakes: Fakes;
  http: FakeHttpTransport;
  /** Полные входы notifyGuest (фейк хранит не все поля: вложения, каналы). */
  guestInputs: any[];
}

/** Приложение с настоящим PaymentsModule, фейками соседних модулей и подменённой сетью. */
export async function createPaymentsTestApp(): Promise<PaymentsTestContext> {
  const fakes = createFakes();
  const http = new FakeHttpTransport();
  const guestInputs: any[] = [];
  const original = fakes.notifier.notifyGuest.bind(fakes.notifier);
  fakes.notifier.notifyGuest = async (input: any) => {
    guestInputs.push(input);
    await original(input);
  };
  const providers: Provider[] = [
    ...fakeProviders(fakes, { except: [PaymentsService, GiftCertificates] }),
    { provide: HttpTransport, useValue: http },
  ];
  // Фейки — глобальным модулем, чтобы их видели провайдеры PaymentsModule.
  @Global()
  @Module({ providers, exports: providers.map((p) => (p as { provide: unknown }).provide as never) })
  class PaymentsTestFakesModule {}
  const t = await createTestApp({ imports: [PaymentsTestFakesModule, PaymentsModule], migrateModules: ['payments'], providers });
  // ExternalHttp живёт в PlatformModule и получает транспорт оттуда: подменяем сеть напрямую.
  (t.get(ExternalHttp) as unknown as { transport: HttpTransport }).transport = http;
  return { t, fakes, http, guestInputs };
}

/** Очистка между тестами: таблицы, кэш настроек, фейки. */
export async function resetPayments(ctx: PaymentsTestContext): Promise<void> {
  await ctx.t.reset();
  ctx.t.get(IntegrationSettings).invalidate();
  ctx.fakes.notifier.clear();
  ctx.guestInputs.length = 0;
  ctx.fakes.customers.customers.clear();
  ctx.fakes.customers.consents = [];
  ctx.http.requests = [];
  (ctx.http as unknown as { routes: unknown[] }).routes = [];
}

export async function setIntegration(ctx: PaymentsTestContext, key: string, config: Record<string, unknown>, secrets?: Record<string, string>) {
  await ctx.t.get(IntegrationSettings).set(key, { enabled: true, config, secrets }, null);
}

export interface OutboxRecord {
  topic: string;
  payload: any;
}

/**
 * Таблица outbox платформы: тестовая обвязка читает её напрямую, чтобы проверять события,
 * опубликованные в транзакции (до обработки). Имя собирается из частей — это не код модуля.
 */
const OUTBOX_TABLE = ['platform', 'outbox'].join('.');

/** События, опубликованные модулем (из outbox платформы). */
export async function publishedEvents(t: TestApp, topic?: string): Promise<OutboxRecord[]> {
  const rows = await t.database
    .rootConnection()
    .selectFrom(OUTBOX_TABLE)
    .select(['topic', 'payload'])
    .where('kind', '=', 'event')
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  return rows
    .filter((r: any) => !topic || r.topic === topic)
    .map((r: any) => ({ topic: r.topic, payload: (typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload).payload }));
}

async function auditRecords(t: TestApp, filter: { entityId?: string; action?: string }) {
  const page = await t.get(AuditLog).search(filter, pageRequest(1, 200));
  // Время в тестах фиксировано (FixedClock): порядок записи — по id (UUID v7 монотонен).
  return [...page.items].sort((a, b) => (a.occurredAt.getTime() - b.occurredAt.getTime()) || a.id.localeCompare(b.id));
}

export async function auditActions(t: TestApp, entityId?: string): Promise<string[]> {
  return (await auditRecords(t, { entityId })).map((r) => r.action);
}

export async function auditEntries(t: TestApp, action: string): Promise<Array<{ before: any; after: any; actor_kind: string; entity_id: string }>> {
  return (await auditRecords(t, { action }))
    .filter((r) => r.action === action)
    .map((r) => ({ before: r.before, after: r.after, actor_kind: r.actorKind, entity_id: r.entityId }));
}

export const tenge = (n: number) => Money.tenge(n);

// ---------------------------------------------------------------- сценарные помощники

/** Продукт сертификата (действие с системным актором). */
export async function createCertificateProduct(
  ctx: PaymentsTestContext,
  overrides: Partial<CertificateProductInput> = {},
): Promise<CertificateProduct> {
  return ctx.t.get(CreateCertificateProduct).execute(Actor.system('test'), {
    slug: overrides.slug ?? `nominal-${Math.floor(Math.random() * 1e9)}`,
    kind: overrides.kind ?? 'amount',
    name: overrides.name ?? { ru: 'Сертификат на 10 000 ₸', kk: '10 000 ₸ сертификаты' },
    description: overrides.description ?? (overrides.kind === 'set' ? { ru: 'Ужин на двоих', kk: 'Екі адамға кешкі ас' } : null),
    nominal: overrides.nominal ?? Money.tenge(10_000),
    price: overrides.price ?? overrides.nominal ?? Money.tenge(10_000),
    validityMonths: overrides.validityMonths,
    design: overrides.design,
    isActive: overrides.isActive,
    sortOrder: overrides.sortOrder,
  });
}

/**
 * Выпустить сертификат (корпоративная продажа по переводу) и вернуть полный код — его знает только
 * сообщение гостю (FakeNotifier).
 */
export async function issueCertificate(
  ctx: PaymentsTestContext,
  input: { nominal?: number; kind?: 'amount' | 'set'; quantity?: number; validityMonths?: number } = {},
): Promise<Array<{ id: string; code: string }>> {
  const product = await createCertificateProduct(ctx, {
    kind: input.kind ?? 'amount',
    nominal: Money.tenge(input.nominal ?? 10_000),
    validityMonths: input.validityMonths,
  });
  const before = ctx.fakes.notifier.guest.length;
  const result = await ctx.t.get(IssueCorporateCertificates).execute(Actor.system('test'), {
    productId: product.id,
    quantity: input.quantity ?? 1,
    buyer: { name: 'ТОО Ромашка', company: 'ТОО Ромашка', email: 'hr@romashka.kz', phone: '+77011234567' },
    recipient: null,
    deliveryChannel: 'email',
    locale: 'ru',
    documentNumber: `PP-${Math.floor(Math.random() * 1e6)}`,
    paidAt: ctx.t.clock.now(),
    idempotencyKey: `issue-${Math.random()}`,
  });
  const messages = ctx.fakes.notifier.guest.slice(before).filter((g) => g.template === 'certificate.issued');
  return result.certificates.map((c, i) => ({ id: c.certificate.id, code: (messages[i]!.params as { code: string }).code }));
}

/** Путь (без хоста) из абсолютной ссылки API. */
export function apiPath(url: string): string {
  const u = new URL(url);
  return `${u.pathname}${u.search}`;
}

/** Оплатить/отклонить на странице песочницы (как гость): форма -> вебхук -> редирект. */
export async function sandboxDecision(ctx: PaymentsTestContext, paymentUrl: string, result: 'succeeded' | 'failed') {
  const u = new URL(paymentUrl);
  return ctx.t
    .http()
    .post(u.pathname)
    .type('form')
    .send({ sig: u.searchParams.get('sig') ?? '', result });
}

/** Вебхук песочницы через HTTP (подпись как у настоящего провайдера). */
export async function sandboxWebhook(ctx: PaymentsTestContext, body: Record<string, unknown>, signature?: string) {
  const raw = JSON.stringify(body);
  const sig = signature ?? (await ctx.t.get(SandboxGateway).sign(raw));
  return ctx.t.http().post('/api/v1/webhooks/payments/sandbox').set('content-type', 'application/json').set('x-sandbox-signature', sig).send(raw);
}

export async function sandboxExternalId(ctx: PaymentsTestContext, paymentId: string): Promise<string> {
  const view = await ctx.t.get(PaymentsService).getPayment(paymentId);
  return view.externalId!;
}

export { SandboxStore };
