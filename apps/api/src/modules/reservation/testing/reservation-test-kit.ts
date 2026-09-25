/**
 * Помощники интеграционных тестов модуля Reservation (не входят в сборку: src/**\/testing/** исключён).
 */
import { expect } from 'vitest';
import { createFakes, fakeProviders, Fakes } from '../../../../test/fakes';
import { createBranch } from '../../../../test/support/fixtures';
import { createTestApp, TestApp } from '../../../../test/support/test-app';
import { Database } from '../../../shared/infrastructure/database/database';
import { EventBus } from '../../../shared/infrastructure/events/event-bus';
import { Actor } from '../../../shared/kernel/actor';
import { newId } from '../../../shared/kernel/ids';
import { Money } from '../../../shared/kernel/money';
import { BranchSettings } from '../../identity/public';
import { PaymentEventPayload, PaymentsEvents, RefundEventPayload } from '../../payments/public';
import { CreateHall } from '../application/hall.actions';
import { CreateVenueType } from '../application/venue-type.actions';
import { CreateVenue, VenueInput } from '../application/venue.actions';
import { VenueRules } from '../domain/venue-rules';
import { DEFAULT_VENUE_TYPES } from '../infrastructure/seed';
import { VenueTypeRepository } from '../infrastructure/venue-type.repository';
import { ReservationModule } from '../reservation.module';
import { VenueAvailability } from '../public';

/** Приложение: Identity + Reservation по-настоящему, контракты остальных модулей — фейки. */
export async function createReservationTestApp(): Promise<{ t: TestApp; fakes: Fakes }> {
  const fakes = createFakes();
  const t = await createTestApp({
    imports: [ReservationModule],
    migrateModules: ['reservation'],
    providers: fakeProviders(fakes, { except: [VenueAvailability] }),
  });
  return { t, fakes };
}

export function resetFakes(fakes: Fakes): void {
  fakes.notifier.clear();
  fakes.adminFeed.events = [];
  fakes.payments.payments.clear();
  fakes.payments.refunds = [];
  fakes.payments.byKey.clear();
  fakes.customers.customers.clear();
  fakes.customers.consents = [];
  fakes.phoneVerification.started = [];
}

const SYSTEM = Actor.system('test');

/** Справочник типов мест как в сиде: table, vip_hall, yurt, terrace. */
export async function seedVenueTypes(t: TestApp, overrides: Partial<Record<string, Partial<VenueRules>>> = {}): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  const repo = t.get(VenueTypeRepository);
  for (const type of DEFAULT_VENUE_TYPES) {
    const existing = await repo.findByCode(type.code);
    ids[type.code] = existing
      ? existing.id
      : (await t.get(CreateVenueType).execute(SYSTEM, { ...type, rules: { ...type.rules, ...(overrides[type.code] ?? {}) } })).id;
  }
  return ids;
}

export interface VenueLayout {
  branchId: string;
  branchSlug: string;
  hallId: string;
  types: Record<string, string>;
  /** Стол на 2-4 гостя (уборка 15 минут, без депозита). */
  table4: string;
  /** Стол на 4-6 гостей. */
  table6: string;
  /** VIP-зал на 6-12 гостей с депозитом 50 000 ₸ (отмена за 24 часа). */
  vip: string;
  /** Юрта на 10-20 гостей с депозитом 100 000 ₸ и ручным подтверждением. */
  yurt: string;
  /** Стол только для брони по телефону. */
  phoneOnly: string;
}

export async function createVenue(t: TestApp, input: Partial<VenueInput> & { hallId: string; typeId: string; code: string }): Promise<string> {
  const venue = await t.get(CreateVenue).execute(SYSTEM, {
    name: { ru: `Место ${input.code}` },
    capacityMin: 1,
    capacityMax: 4,
    ...input,
  });
  return venue.id;
}

/** Филиал (10:00-00:00 каждый день, Asia/Almaty) с залом, столами, VIP-залом и юртой. */
export async function createLayout(
  t: TestApp,
  options: { settings?: Partial<BranchSettings>; slug?: string; types?: Record<string, string> } = {},
): Promise<VenueLayout> {
  const code = `R${Math.floor(Math.random() * 9000 + 1000)}`;
  const slug = options.slug ?? code.toLowerCase();
  const branchId = await createBranch(t, { code, slug, settings: options.settings });
  const types = options.types ?? (await seedVenueTypes(t));
  const hall = await t.get(CreateHall).execute(SYSTEM, { branchId, code: 'main', name: { ru: 'Основной зал', kk: 'Негізгі зал' } });
  return {
    branchId,
    branchSlug: slug,
    hallId: hall.id,
    types,
    table4: await createVenue(t, { hallId: hall.id, typeId: types.table!, code: 'T4', name: { ru: 'Стол 4', kk: '4-үстел' }, capacityMin: 2, capacityMax: 4 }),
    table6: await createVenue(t, {
      hallId: hall.id,
      typeId: types.table!,
      code: 'T6',
      capacityMin: 4,
      capacityMax: 6,
      position: { x: 200, y: 0 },
    }),
    vip: await createVenue(t, {
      hallId: hall.id,
      typeId: types.vip_hall!,
      code: 'VIP1',
      name: { ru: 'VIP-зал «Алтын»' },
      capacityMin: 6,
      capacityMax: 12,
      deposit: Money.tenge(50_000),
      position: { x: 400, y: 0, w: 200, h: 200 },
    }),
    yurt: await createVenue(t, {
      hallId: hall.id,
      typeId: types.yurt!,
      code: 'YURT',
      capacityMin: 10,
      capacityMax: 20,
      deposit: Money.tenge(100_000),
      position: { x: 700, y: 0, w: 200, h: 200, shape: 'circle' },
    }),
    phoneOnly: await createVenue(t, {
      hallId: hall.id,
      typeId: types.table!,
      code: 'T9',
      capacityMin: 1,
      capacityMax: 4,
      rules: { bookableOnline: false },
      position: { x: 0, y: 300 },
    }),
  };
}

let keySeq = 0;

/** Тело запроса брони с витрины (дата по умолчанию — завтра от часов теста, 19:00). */
export function bookingBody(layout: VenueLayout, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  keySeq += 1;
  return {
    branchId: layout.branchId,
    venueId: layout.table4,
    date: '2026-10-02',
    time: '19:00',
    guests: 3,
    customer: { name: 'Айгерим', phone: '+7 701 123 45 67', email: 'aigerim@mail.kz' },
    comment: 'У окна',
    consent: { personalData: true, marketing: true },
    locale: 'ru',
    idempotencyKey: `test-key-${keySeq}-${newId()}`,
    ...overrides,
  };
}

export async function book(t: TestApp, body: Record<string, unknown>, expectedStatus = 201) {
  const res = await t.http().post('/api/v1/public/reservations').send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(expectedStatus);
  return res.body;
}

/** Опубликовать событие другого модуля и обработать outbox. */
export async function publishAndDrain<T>(t: TestApp, type: string, payload: T, meta: { branchId?: string | null } = {}): Promise<void> {
  await t.get(Database).transaction(() => t.get(EventBus).publish(type, payload, meta));
  await t.drain();
}

/** Платёж депозита прошёл: фейк платёжного модуля + событие PaymentSucceeded. */
export async function payDeposit(t: TestApp, fakes: Fakes, paymentId: string, extra: Partial<PaymentEventPayload> = {}): Promise<void> {
  const payment = fakes.payments.succeed(paymentId);
  await publishAndDrain<PaymentEventPayload>(t, PaymentsEvents.PaymentSucceeded, {
    paymentId,
    purpose: 'reservation_deposit',
    referenceId: payment.referenceId,
    branchId: payment.branchId,
    method: 'online',
    provider: 'sandbox',
    amount: payment.amount.toJSON(),
    occurredAt: t.clock.now().toISOString(),
    ...extra,
  });
}

export async function refundResult(t: TestApp, refund: { paymentId: string; referenceId: string; amount: number }, succeeded: boolean): Promise<void> {
  await publishAndDrain<RefundEventPayload>(t, succeeded ? PaymentsEvents.RefundSucceeded : PaymentsEvents.RefundFailed, {
    refundId: newId(),
    paymentId: refund.paymentId,
    purpose: 'reservation_deposit',
    referenceId: refund.referenceId,
    branchId: null,
    amount: { amount: refund.amount, currency: 'KZT' },
    paymentFullyRefunded: succeeded,
    referenceFullyRefunded: succeeded,
    reason: 'test',
    occurredAt: t.clock.now().toISOString(),
  });
}

/** События outbox модуля (для проверки payload контракта). */
export async function outboxEvents(t: TestApp, type: string): Promise<Array<{ payload: any; meta: any }>> {
  const rows = await t.database
    .rootConnection()
    .selectFrom('platform.outbox')
    .select(['payload'])
    .where('kind', '=', 'event')
    .where('topic', '=', type)
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  return rows.map((r: any) => ({ payload: r.payload.payload, meta: r.payload.meta }));
}

export async function auditActions(t: TestApp, entityId: string): Promise<Array<{ action: string; before: any; after: any; meta: any; actor_kind: string }>> {
  const rows = await t.database
    .rootConnection()
    .selectFrom('platform.audit_log')
    .select(['action', 'before', 'after', 'meta', 'actor_kind'])
    .where('entity_id', '=', entityId)
    .orderBy('occurred_at')
    .orderBy('id')
    .execute();
  return rows as any;
}

export const minutes = (m: number) => m * 60_000;
export const hours = (h: number) => h * 3_600_000;
