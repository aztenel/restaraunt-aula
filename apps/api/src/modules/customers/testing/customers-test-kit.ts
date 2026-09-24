/**
 * Помощники интеграционных тестов модуля Customers (не входят в сборку: src/**\/testing/** исключён).
 */
import { Global, Module, Provider } from '@nestjs/common';
import { createFakes, fakeProviders, Fakes } from '../../../../test/fakes';
import { createTestApp, TestApp } from '../../../../test/support/test-app';
import { Database } from '../../../shared/infrastructure/database/database';
import { EventBus } from '../../../shared/infrastructure/events/event-bus';
import { newId } from '../../../shared/kernel/ids';
import type { BanquetInvoiceIssuedPayload, BanquetRequestCreatedPayload, BanquetStatusChangedPayload } from '../../banquet/public';
import type { OrderCancelledPayload, OrderCompletedPayload, OrderPlacedPayload } from '../../ordering/public';
import type { CertificateIssuedPayload } from '../../payments/public';
import type { ReservationCreatedPayload, ReservationStatusChangedPayload } from '../../reservation/public';
import { CustomersModule } from '../customers.module';
import { ConsentTextRepository } from '../infrastructure/consent.repository';
import { INITIAL_CONSENT_TEXTS, INITIAL_CONSENT_VERSION } from '../infrastructure/seed';
import { CustomerDirectory, PhoneVerification } from '../public';

/** Приложение: Identity + Customers по-настоящему, контракты остальных модулей — фейки. */
export async function createCustomersTestApp(): Promise<{ t: TestApp; fakes: Fakes }> {
  const fakes = createFakes();
  const providers: Provider[] = fakeProviders(fakes, { except: [CustomerDirectory, PhoneVerification] });
  // Фейки — глобальным модулем: провайдеры корневого тестового модуля не видны провайдерам CustomersModule.
  @Global()
  @Module({ providers, exports: providers.map((p) => (p as { provide: unknown }).provide as never) })
  class CustomersTestFakesModule {}
  const t = await createTestApp({ imports: [CustomersTestFakesModule, CustomersModule], migrateModules: ['customers'] });
  return { t, fakes };
}

/** Опубликовать тексты согласий первой редакции (как сид). */
export async function publishInitialConsentTexts(t: TestApp): Promise<string> {
  const texts = t.get(ConsentTextRepository);
  await t.get(Database).transaction(async () => {
    for (const item of INITIAL_CONSENT_TEXTS) {
      if (await texts.find(item.kind, INITIAL_CONSENT_VERSION)) continue;
      await texts.insert({
        id: newId(),
        kind: item.kind,
        version: INITIAL_CONSENT_VERSION,
        text: item.text,
        publishedAt: new Date(t.clock.now().getTime() - 60_000),
        publishedBy: null,
      });
    }
  });
  return INITIAL_CONSENT_VERSION;
}

/** Опубликовать событие другого модуля и обработать outbox. Возвращает id события. */
export async function publishAndDrain<T>(t: TestApp, type: string, payload: T, meta: { branchId?: string | null } = {}): Promise<string> {
  const id = await t.get(Database).transaction(() => t.get(EventBus).publish(type, payload, meta));
  await t.drain();
  return id;
}

const kzt = (amount: number) => ({ amount, currency: 'KZT' as const });

export function orderPlaced(overrides: Partial<OrderPlacedPayload> = {}): OrderPlacedPayload {
  const orderId = overrides.orderId ?? newId();
  return {
    orderId,
    number: `GL-2026-${orderId.slice(-6)}`,
    branchId: newId(),
    type: 'delivery',
    channel: 'web',
    status: 'paid',
    customer: { customerId: null, phone: '+77011234567', name: 'Асель' },
    items: [],
    subtotal: kzt(500_000),
    discount: kzt(0),
    deliveryFee: kzt(0),
    total: kzt(500_000),
    paymentMethod: 'online',
    promoCode: null,
    scheduledFor: null,
    analyticsSessionId: null,
    locale: 'ru',
    publicToken: 'token',
    occurredAt: new Date('2026-09-30T10:00:00Z').toISOString(),
    ...overrides,
  };
}

export function orderCompleted(placed: OrderPlacedPayload, overrides: Partial<OrderCompletedPayload> = {}): OrderCompletedPayload {
  return {
    orderId: placed.orderId,
    number: placed.number,
    branchId: placed.branchId,
    type: placed.type,
    channel: placed.channel,
    customer: placed.customer,
    items: placed.items,
    subtotal: placed.subtotal,
    discount: placed.discount,
    deliveryFee: placed.deliveryFee,
    total: placed.total,
    placedAt: placed.occurredAt,
    completedAt: new Date(new Date(placed.occurredAt).getTime() + 3_600_000).toISOString(),
    ...overrides,
  };
}

export function orderCancelled(placed: OrderPlacedPayload, overrides: Partial<OrderCancelledPayload> = {}): OrderCancelledPayload {
  return {
    orderId: placed.orderId,
    number: placed.number,
    branchId: placed.branchId,
    type: placed.type,
    channel: placed.channel,
    customer: placed.customer,
    total: placed.total,
    reasonCode: 'guest_request',
    reason: null,
    wasPaid: false,
    cancelledAt: new Date(new Date(placed.occurredAt).getTime() + 600_000).toISOString(),
    ...overrides,
  };
}

export function reservationCreated(overrides: Partial<ReservationCreatedPayload> = {}): ReservationCreatedPayload {
  return {
    reservationId: newId(),
    number: 'GL-R-2026-000001',
    branchId: newId(),
    venueId: newId(),
    venueName: { ru: 'VIP-зал' },
    venueTypeCode: 'vip',
    kind: 'regular',
    status: 'confirmed',
    start: '2026-10-02T14:00:00.000Z',
    end: '2026-10-02T16:00:00.000Z',
    guests: 4,
    customer: { customerId: null, phone: '+77011234567', name: 'Асель' },
    deposit: null,
    banquetRequestId: null,
    source: 'web',
    locale: 'ru',
    publicToken: null,
    occurredAt: '2026-09-30T11:00:00.000Z',
    ...overrides,
  };
}

export function reservationStatusChanged(
  created: ReservationCreatedPayload,
  from: ReservationStatusChangedPayload['from'],
  to: ReservationStatusChangedPayload['to'],
): ReservationStatusChangedPayload {
  return {
    reservationId: created.reservationId,
    number: created.number,
    branchId: created.branchId,
    venueId: created.venueId,
    venueTypeCode: created.venueTypeCode,
    kind: created.kind,
    from,
    to,
    start: created.start,
    end: created.end,
    guests: created.guests,
    customer: created.customer,
    deposit: created.deposit,
    depositOutcome: 'none',
    reason: null,
    locale: created.locale,
    publicToken: null,
    occurredAt: '2026-10-02T17:00:00.000Z',
  };
}

export function banquetRequestCreated(overrides: Partial<BanquetRequestCreatedPayload> = {}): BanquetRequestCreatedPayload {
  return {
    requestId: newId(),
    number: 'BQ-2026-000001',
    branchId: null,
    isOffsite: false,
    eventDate: '2026-12-20',
    eventType: 'корпоратив',
    guests: 40,
    budget: kzt(100_000_000),
    managerId: newId(),
    contact: { customerId: null, name: 'Ерлан', phone: '+77019998877', email: 'erlan@example.kz' },
    source: 'web',
    occurredAt: '2026-09-30T12:00:00.000Z',
    ...overrides,
  };
}

export function banquetStatusChanged(
  request: BanquetRequestCreatedPayload,
  from: BanquetStatusChangedPayload['from'],
  to: BanquetStatusChangedPayload['to'],
  quoteTotal: number | null,
): BanquetStatusChangedPayload {
  return {
    requestId: request.requestId,
    number: request.number,
    branchId: request.branchId,
    isOffsite: request.isOffsite,
    from,
    to,
    managerId: request.managerId,
    eventDate: request.eventDate,
    guests: request.guests,
    quoteTotal: quoteTotal === null ? null : kzt(quoteTotal),
    contact: request.contact,
    reason: null,
    occurredAt: '2026-12-21T06:00:00.000Z',
  };
}

export function banquetInvoiceIssued(
  request: BanquetRequestCreatedPayload,
  overrides: Partial<BanquetInvoiceIssuedPayload> = {},
): BanquetInvoiceIssuedPayload {
  return {
    invoiceId: newId(),
    number: 'GL-2026-000100',
    requestId: request.requestId,
    branchId: request.branchId,
    payerType: 'company',
    company: { name: 'ТОО «Ромашка»', bin: '123456789012' },
    amount: kzt(50_000_000),
    dueDate: '2026-10-10',
    occurredAt: '2026-10-01T06:00:00.000Z',
    ...overrides,
  };
}

export function certificateIssued(overrides: Partial<CertificateIssuedPayload> = {}): CertificateIssuedPayload {
  return {
    certificateId: newId(),
    productId: newId(),
    kind: 'amount',
    nominal: kzt(2_000_000),
    price: kzt(2_000_000),
    buyerPhone: '+77011234567',
    branchId: null,
    occurredAt: '2026-09-29T09:00:00.000Z',
    ...overrides,
  };
}
