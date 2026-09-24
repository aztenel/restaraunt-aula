import { DynamicModule, Module } from '@nestjs/common';
import { vi } from 'vitest';
import { createFakes, FakeHttpTransport, Fakes, fakeProviders } from '../../../../test/fakes';
import { createTestApp, TestApp } from '../../../../test/support/test-app';
import { EventBus } from '../../../shared/infrastructure/events/event-bus';
import { FetchTransport, HttpTransport } from '../../../shared/infrastructure/integrations/external-http';
import { IntegrationSettings } from '../../../shared/infrastructure/settings/integration-settings';
import { newId } from '../../../shared/kernel/ids';
import { KitchenOrder, OrderingEvents, OrderStatusChangedPayload } from '../../ordering/public';
import { PosModule } from '../pos.module';

/**
 * Тестовое приложение модуля POS: PosModule + заглушки соседних модулей (test/fakes) + подмена сети.
 * Заглушки подключаются глобальным модулем, чтобы их видели провайдеры PosModule; сеть адаптеров
 * подменяется FakeHttpTransport (все запросы ExternalHttp уходят в него, реальной сети нет).
 */
@Module({})
class PosTestFakesModule {}

export interface PosTestContext {
  t: TestApp;
  fakes: Fakes;
  /** Текущий FakeHttpTransport (новый на каждый тест после reset). */
  readonly http: FakeHttpTransport;
  reset(): Promise<void>;
}

export async function createPosTestApp(): Promise<PosTestContext> {
  const fakes = createFakes();
  const holder = { http: new FakeHttpTransport() };
  const transport: HttpTransport = { send: (input) => holder.http.send(input) };
  vi.spyOn(FetchTransport.prototype, 'send').mockImplementation((input) => holder.http.send(input));
  const fakeList = fakeProviders(fakes);
  const fakesModule: DynamicModule = {
    module: PosTestFakesModule,
    global: true,
    providers: fakeList,
    exports: fakeList.map((p) => (p as { provide: never }).provide),
  };
  const t = await createTestApp({
    imports: [fakesModule, PosModule],
    migrateModules: ['pos'],
    providers: [...fakeList, { provide: HttpTransport, useValue: transport }],
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
      holder.http = new FakeHttpTransport();
      fakes.notifier.clear();
      fakes.adminFeed.events = [];
      fakes.stopList.changes = [];
      fakes.stopList.skus.clear();
      fakes.orders.orders.clear();
      fakes.menu.dishes.clear();
    },
  };
}

export const ORG_ID = '7a0c1f7e-0000-4000-8000-00000000a001';
export const TERMINAL_GROUP_ID = '7a0c1f7e-0000-4000-8000-00000000b001';

/** Настроить iiko для филиалов и направить их в iiko (остальные — manual). */
export async function routeToIiko(
  t: TestApp,
  branches: Record<string, { organizationId?: string; terminalGroupId?: string | null }>,
  options: { apiLogin?: string; baseUrl?: string } = {},
): Promise<{ apiLogin: string }> {
  const settings = t.get(IntegrationSettings);
  const apiLogin = options.apiLogin ?? `api-login-${newId()}`;
  await settings.set(
    'pos.iiko',
    {
      enabled: true,
      config: {
        baseUrl: options.baseUrl ?? 'https://iiko.test',
        branches: Object.fromEntries(
          Object.entries(branches).map(([id, b]) => [id, { organizationId: b.organizationId ?? ORG_ID, terminalGroupId: b.terminalGroupId ?? TERMINAL_GROUP_ID }]),
        ),
      },
      secrets: { apiLogin },
    },
    null,
  );
  await settings.set('pos.routing', { enabled: true, config: { default: 'manual', branches: Object.fromEntries(Object.keys(branches).map((id) => [id, 'iiko'])) } }, null);
  return { apiLogin };
}

export function kitchenOrder(branchId: string, overrides: Partial<KitchenOrder> = {}): KitchenOrder {
  const orderId = overrides.orderId ?? newId();
  return {
    orderId,
    number: `GL-2026-${orderId.slice(-6)}`,
    branchId,
    type: 'delivery',
    status: 'accepted',
    items: [],
    comment: null,
    scheduledFor: null,
    customer: { name: 'Айгерим', phone: '+77011234567' },
    deliveryAddress: 'Астана, ул. Сарайшык, 5',
    total: { amount: 500_000, currency: 'KZT' },
    paymentMethod: 'online',
    isPaidOnline: true,
    placedAt: '2026-10-01T05:50:00.000Z',
    ...overrides,
  };
}

/** Опубликовать смену статуса заказа (как это делает Ordering) и обработать очередь. */
export async function publishAccepted(t: TestApp, order: KitchenOrder, options: { drain?: boolean } = {}): Promise<void> {
  const payload: OrderStatusChangedPayload = {
    orderId: order.orderId,
    number: order.number,
    branchId: order.branchId,
    type: order.type,
    channel: 'web',
    from: 'paid',
    to: 'accepted',
    reason: null,
    customer: { customerId: null, phone: order.customer.phone, name: order.customer.name },
    total: order.total,
    locale: 'ru',
    publicToken: 'token',
    occurredAt: new Date().toISOString(),
  };
  await t.database.transaction(() =>
    t.get(EventBus).publish(OrderingEvents.OrderStatusChanged, payload, { aggregateId: order.orderId, branchId: order.branchId }),
  );
  if (options.drain !== false) await t.drain();
}
