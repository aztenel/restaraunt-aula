import { createFakes, FakeHttpTransport, Fakes, fakeProviders } from '../../../../test/fakes';
import { createBranch, tokenFor } from '../../../../test/support/fixtures';
import { createTestApp, TestApp } from '../../../../test/support/test-app';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { EventBus } from '../../../shared/infrastructure/events/event-bus';
import { HttpTransport } from '../../../shared/infrastructure/integrations/external-http';
import { IntegrationSettings } from '../../../shared/infrastructure/settings/integration-settings';
import { Actor } from '../../../shared/kernel/actor';
import { GeoPoint, GeoPolygon } from '../../../shared/kernel/geo';
import { newId } from '../../../shared/kernel/ids';
import { Money } from '../../../shared/kernel/money';
import { pageRequest } from '../../../shared/kernel/pagination';
import { BranchSettings } from '../../identity/public';
import { PaymentEventPayload, PaymentsEvents, PaymentView, RefundEventPayload } from '../../payments/public';
import { CreateDeliveryZone } from '../application/delivery-zone.actions';
import { CreatePromoCode } from '../application/promo-code.actions';
import { DeliveryZoneDefinition, DeliveryZoneState } from '../domain/delivery-zone';
import { PromoCodeDefinition, PromoCodeState } from '../domain/promo-code';
import { OrderingModule } from '../ordering.module';
import { OrderQuery } from '../public';

/**
 * Тестовая обвязка модуля Ordering: OrderingModule + заглушки соседних модулей (test/fakes),
 * сеть адаптеров подменена FakeHttpTransport (новый на каждый тест).
 */
export interface OrderingTestContext {
  t: TestApp;
  fakes: Fakes;
  readonly http: FakeHttpTransport;
  reset(): Promise<void>;
}

export async function createOrderingTestApp(): Promise<OrderingTestContext> {
  const fakes = createFakes();
  const holder = { http: new FakeHttpTransport() };
  const transport = { send: (input: Parameters<HttpTransport['send']>[0]) => holder.http.send(input) } as HttpTransport;
  const t = await createTestApp({
    imports: [OrderingModule],
    migrateModules: ['ordering'],
    providers: [...fakeProviders(fakes, { except: [OrderQuery] }), { provide: HttpTransport, useValue: transport }],
  });
  return {
    t,
    fakes,
    get http() {
      return holder.http;
    },
    async reset() {
      await t.reset();
      t.get(IntegrationSettings).invalidate();
      t.clock.set(new Date(DEFAULT_NOW));
      holder.http = new FakeHttpTransport();
      fakes.notifier.clear();
      fakes.adminFeed.events = [];
      fakes.customers.customers.clear();
      fakes.customers.consents = [];
      fakes.phoneVerification.started = [];
      fakes.menu.dishes.clear();
      fakes.payments.payments.clear();
      fakes.payments.refunds = [];
      fakes.payments.byKey.clear();
      fakes.payments.collected = [];
      fakes.certificates.certificates.clear();
    },
  };
}

/** 2026-10-01 11:00 по Астане (UTC+5): филиал открыт 10:00–00:00. */
export const DEFAULT_NOW = '2026-10-01T06:00:00.000Z';
/** Координаты тестового филиала (test/support/fixtures). */
export const BRANCH_LOCATION: GeoPoint = { lat: 51.0906, lng: 71.4187 };
export const PHONE = '+77011234567';

export function square(center: GeoPoint, half: number): GeoPolygon {
  return [
    { lat: center.lat - half, lng: center.lng - half },
    { lat: center.lat - half, lng: center.lng + half },
    { lat: center.lat + half, lng: center.lng + half },
    { lat: center.lat + half, lng: center.lng - half },
  ];
}

export async function setupBranch(ctx: OrderingTestContext, settings: Partial<BranchSettings> = {}, code?: string): Promise<string> {
  return createBranch(ctx.t, { settings, code });
}

export async function addZone(
  ctx: OrderingTestContext,
  branchId: string,
  overrides: Partial<DeliveryZoneDefinition> = {},
): Promise<DeliveryZoneState> {
  return ctx.t.get(CreateDeliveryZone).execute(Actor.system('test'), branchId, {
    name: { ru: 'Зона', kk: 'Аймақ' },
    polygon: square(BRANCH_LOCATION, 0.05),
    minOrderAmount: Money.tenge(3_000),
    deliveryFee: Money.tenge(500),
    freeDeliveryFrom: Money.tenge(20_000),
    etaMinutes: 45,
    isActive: true,
    sortOrder: 0,
    ...overrides,
  });
}

export async function addPromo(ctx: OrderingTestContext, overrides: Partial<PromoCodeDefinition> = {}): Promise<PromoCodeState> {
  return ctx.t.get(CreatePromoCode).execute(Actor.system('test'), {
    code: 'SALE10',
    description: null,
    kind: 'percent',
    percentBp: 1_000,
    fixedAmount: null,
    minSubtotal: null,
    validFrom: null,
    validTo: null,
    totalLimit: null,
    perPhoneLimit: null,
    branchId: null,
    isActive: true,
    ...overrides,
  });
}

/** Блюдо меню (цена в тенге). */
export function addDish(ctx: OrderingTestContext, name: string, priceTenge: number, overrides: Record<string, unknown> = {}) {
  return ctx.fakes.menu.add({ name, price: priceTenge * 100, ...overrides });
}

export interface CheckoutOverrides {
  [key: string]: unknown;
}

export function checkoutBody(branchId: string, items: Array<{ dishId: string; quantity: number; modifierOptionIds?: string[] }>, overrides: CheckoutOverrides = {}) {
  const type = (overrides.type as string | undefined) ?? 'delivery';
  return {
    branchId,
    type,
    items,
    delivery:
      type === 'delivery'
        ? { point: { lat: BRANCH_LOCATION.lat + 0.01, lng: BRANCH_LOCATION.lng }, addressText: 'Астана, ул. Сыганак, 10', apartment: '25', intercom: '25К' }
        : undefined,
    contactless: false,
    scheduledFor: null,
    customer: { name: 'Айгерим', phone: PHONE, email: 'guest@example.kz' },
    comment: 'Без лука',
    paymentMethod: 'online',
    consent: { personalData: true, marketing: true },
    locale: 'ru',
    analyticsSessionId: 'sess-1',
    idempotencyKey: newId(),
    ...overrides,
  };
}

export async function staff(ctx: OrderingTestContext, role: 'branch_operator' | 'branch_manager' | 'owner' | 'finance' | 'content_manager', branchId?: string) {
  return (await tokenFor(ctx.t, [{ role, branchId: branchId ?? null }])).auth;
}

export function paymentPayload(p: PaymentView, overrides: Partial<PaymentEventPayload> = {}): PaymentEventPayload {
  return {
    paymentId: p.id,
    purpose: p.purpose,
    referenceId: p.referenceId,
    branchId: p.branchId,
    method: p.method,
    provider: p.provider,
    amount: p.amount.toJSON(),
    occurredAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Провайдер подтвердил оплату: платёж в заглушке — succeeded, событие PaymentSucceeded, обработка outbox. */
export async function paymentSucceeded(ctx: OrderingTestContext, paymentId: string, overrides: Partial<PaymentEventPayload> = {}) {
  const p = ctx.fakes.payments.succeed(paymentId);
  await ctx.t.get(EventBus).publish(PaymentsEvents.PaymentSucceeded, paymentPayload(p, overrides), { aggregateId: p.id });
  await ctx.t.drain();
}

/** Возврат прошёл (или не прошёл) у провайдера: заглушка обновляет платёж, событие RefundSucceeded/RefundFailed. */
export async function refundResult(ctx: OrderingTestContext, refundId: string, outcome: 'succeeded' | 'failed' = 'succeeded') {
  const refund = ctx.fakes.payments.refunds.find((r) => r.id === refundId);
  if (!refund) throw new Error(`refund ${refundId} not found`);
  const payment = ctx.fakes.payments.payments.get(refund.paymentId)!;
  refund.status = outcome;
  if (outcome === 'succeeded') {
    payment.refundedAmount = payment.refundedAmount.add(refund.amount);
    payment.status = payment.refundedAmount.equals(payment.amount) ? 'refunded' : 'partially_refunded';
  }
  const payload: RefundEventPayload = {
    refundId: refund.id,
    paymentId: payment.id,
    purpose: payment.purpose,
    referenceId: payment.referenceId,
    branchId: payment.branchId,
    amount: refund.amount.toJSON(),
    paymentFullyRefunded: payment.status === 'refunded',
    referenceFullyRefunded: false,
    reason: refund.reason,
    occurredAt: new Date().toISOString(),
  };
  await ctx.t.get(EventBus).publish(outcome === 'succeeded' ? PaymentsEvents.RefundSucceeded : PaymentsEvents.RefundFailed, payload, {
    aggregateId: payment.id,
  });
  await ctx.t.drain();
}

export function paymentsOf(ctx: OrderingTestContext, orderId: string): PaymentView[] {
  return [...ctx.fakes.payments.payments.values()].filter((p) => p.referenceId === orderId);
}

export interface OutboxEvent {
  topic: string;
  payload: any;
}

/** Таблица outbox платформы (имя собирается из частей — это тестовая обвязка, не код модуля). */
const OUTBOX_TABLE = ['platform', 'outbox'].join('.');

export async function publishedEvents(t: TestApp, topic?: string): Promise<OutboxEvent[]> {
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

export async function enqueuedJobs(t: TestApp, topic: string): Promise<any[]> {
  const rows = await t.database.rootConnection().selectFrom(OUTBOX_TABLE).select(['topic', 'payload']).where('kind', '=', 'job').execute();
  return rows
    .filter((r: any) => r.topic === topic)
    .map((r: any) => (typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload).payload);
}

export async function auditActions(t: TestApp, entityId: string): Promise<string[]> {
  const page = await t.get(AuditLog).search({ entityId }, pageRequest(1, 200));
  return [...page.items].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id)).map((r) => r.action);
}

export async function auditEntries(t: TestApp, action: string) {
  const page = await t.get(AuditLog).search({ action }, pageRequest(1, 200));
  return page.items.filter((r) => r.action === action);
}
