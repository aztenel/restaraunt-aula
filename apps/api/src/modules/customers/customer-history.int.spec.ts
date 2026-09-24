import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { tokenFor } from '../../../test/support/fixtures';
import { TestApp } from '../../../test/support/test-app';
import { Database } from '../../shared/infrastructure/database/database';
import { EventBus } from '../../shared/infrastructure/events/event-bus';
import { newId } from '../../shared/kernel/ids';
import { BanquetEvents } from '../banquet/public';
import { OrderingEvents } from '../ordering/public';
import { PaymentsEvents } from '../payments/public';
import { ReservationEvents } from '../reservation/public';
import { RecordCustomerActivity } from './application/record-activity.action';
import { fromOrderCompleted } from './domain/history';
import { CustomerDirectory } from './public';
import {
  banquetInvoiceIssued,
  banquetRequestCreated,
  banquetStatusChanged,
  certificateIssued,
  createCustomersTestApp,
  orderCancelled,
  orderCompleted,
  orderPlaced,
  publishAndDrain,
  reservationCreated,
  reservationStatusChanged,
} from './testing/customers-test-kit';

describe('Customers: history projection from other modules events (integration)', () => {
  let t: TestApp;
  let directory: CustomerDirectory;
  let auth: string;

  beforeAll(async () => {
    ({ t } = await createCustomersTestApp());
    directory = t.get(CustomerDirectory);
  });
  afterAll(async () => t.close());
  beforeEach(async () => {
    await t.reset();
    ({ auth } = await tokenFor(t, [{ role: 'owner' }]));
  });

  async function customerByPhone(phone: string) {
    const c = await directory.findByPhone(phone);
    expect(c).not.toBeNull();
    const detail = await t.http().get(`/api/v1/admin/customers/${c!.id}`).set('authorization', auth);
    expect(detail.status).toBe(200);
    return detail.body;
  }

  it('orders: placed creates the guest by phone; completed adds spent; 3 completed -> regular tag', async () => {
    const branchId = newId();
    const placed = [1, 2, 3].map((i) =>
      orderPlaced({ branchId, total: { amount: i * 100_000, currency: 'KZT' }, occurredAt: `2026-09-2${i}T10:00:00.000Z` }),
    );
    await publishAndDrain(t, OrderingEvents.OrderPlaced, placed[0]);
    let d = await customerByPhone('+77011234567');
    expect(d.customer).toMatchObject({ name: 'Асель', ordersCount: 1, completedOrdersCount: 0, tags: [], totalSpent: { amount: 0 } });
    expect(d.customer.firstSeenAt).toBe('2026-09-21T10:00:00.000Z');

    await publishAndDrain(t, OrderingEvents.OrderCompleted, orderCompleted(placed[0]!));
    await publishAndDrain(t, OrderingEvents.OrderPlaced, placed[1]);
    await publishAndDrain(t, OrderingEvents.OrderCompleted, orderCompleted(placed[1]!));
    d = await customerByPhone('+77011234567');
    expect(d.customer).toMatchObject({ ordersCount: 2, completedOrdersCount: 2, tags: [], totalSpent: { amount: 300_000, currency: 'KZT' } });

    await publishAndDrain(t, OrderingEvents.OrderPlaced, placed[2]);
    await publishAndDrain(t, OrderingEvents.OrderCompleted, orderCompleted(placed[2]!));
    d = await customerByPhone('+77011234567');
    expect(d.customer).toMatchObject({ ordersCount: 3, completedOrdersCount: 3, tags: ['regular'], totalSpent: { amount: 600_000 } });
    expect(d.customer.lastActivityAt).toBe('2026-09-23T11:00:00.000Z');
    expect(d.activities.total).toBe(6);
    expect(d.activities.items[0]).toMatchObject({ type: 'order_completed', entityType: 'order', entityId: placed[2]!.orderId, branchId, countsAsSpent: true });

    // Отменённый заказ — только строка истории, сумма не меняется.
    const fourth = orderPlaced({ branchId, occurredAt: '2026-09-24T10:00:00.000Z' });
    await publishAndDrain(t, OrderingEvents.OrderPlaced, fourth);
    await publishAndDrain(t, OrderingEvents.OrderCancelled, orderCancelled(fourth));
    d = await customerByPhone('+77011234567');
    expect(d.customer).toMatchObject({ ordersCount: 4, completedOrdersCount: 3, totalSpent: { amount: 600_000 } });
    expect(d.activities.items[0]).toMatchObject({ type: 'order_cancelled', countsAsSpent: false });
  });

  it('identifies by customerId when the module already knows the guest', async () => {
    const { customerId } = await directory.identify({ phone: '+77019998877', name: 'Менеджер ввёл имя' });
    const placed = orderPlaced({ customer: { customerId, phone: '+77011234567', name: 'Другое имя' } });
    await publishAndDrain(t, OrderingEvents.OrderPlaced, placed);
    const profile = await directory.get(customerId);
    expect(profile.name).toBe('Менеджер ввёл имя');
    expect(await directory.findByPhone('+77011234567')).toBeNull();
    const d = await t.http().get(`/api/v1/admin/customers/${customerId}`).set('authorization', auth);
    expect(d.body.customer.ordersCount).toBe(1);
  });

  it('is idempotent: re-delivery of the same event does not duplicate history or aggregates', async () => {
    const placed = orderPlaced();
    const record = t.get(RecordCustomerActivity);
    const eventId = newId();
    const projection = fromOrderCompleted(orderCompleted(placed));
    await record.execute({ ...projection, sourceEventId: eventId });
    await record.execute({ ...projection, sourceEventId: eventId });
    const d = await customerByPhone('+77011234567');
    expect(d.customer).toMatchObject({ completedOrdersCount: 1, totalSpent: { amount: 500_000 } });
    expect(d.activities.total).toBe(1);
  });

  it('reservations: counter and no-show counter (with correction)', async () => {
    const created = reservationCreated({ deposit: { amount: 5_000_000, currency: 'KZT' } });
    await publishAndDrain(t, ReservationEvents.ReservationCreated, created);
    await publishAndDrain(t, ReservationEvents.ReservationStatusChanged, reservationStatusChanged(created, 'confirmed', 'no_show'));
    let d = await customerByPhone('+77011234567');
    expect(d.customer).toMatchObject({ reservationsCount: 1, noShowCount: 1 });
    expect(d.activities.items.map((a: { type: string }) => a.type)).toEqual(['reservation_no_show', 'reservation_created']);

    await publishAndDrain(t, ReservationEvents.ReservationStatusChanged, reservationStatusChanged(created, 'no_show', 'arrived'));
    d = await customerByPhone('+77011234567');
    expect(d.customer.noShowCount).toBe(0);

    // Бронь под банкет в историю гостя не пишется (её отражает заявка).
    await publishAndDrain(t, ReservationEvents.ReservationCreated, reservationCreated({ kind: 'banquet', source: 'banquet' }));
    d = await customerByPhone('+77011234567');
    expect(d.customer.reservationsCount).toBe(1);
  });

  it('banquets: request -> banquet tag; company invoice -> corporate tag; held -> spent', async () => {
    const request = banquetRequestCreated();
    await publishAndDrain(t, BanquetEvents.RequestCreated, request);
    let d = await customerByPhone('+77019998877');
    expect(d.customer).toMatchObject({ name: 'Ерлан', email: 'erlan@example.kz', banquetsCount: 1, tags: ['banquet'] });

    await publishAndDrain(t, BanquetEvents.InvoiceIssued, banquetInvoiceIssued(request, { payerType: 'individual', company: null }));
    d = await customerByPhone('+77019998877');
    expect(d.customer.tags).toEqual(['banquet']);

    await publishAndDrain(t, BanquetEvents.InvoiceIssued, banquetInvoiceIssued(request));
    d = await customerByPhone('+77019998877');
    expect(d.customer.tags).toEqual(['banquet', 'corporate']);

    await publishAndDrain(t, BanquetEvents.StatusChanged, banquetStatusChanged(request, 'prepaid', 'held', 120_000_000));
    d = await customerByPhone('+77019998877');
    expect(d.customer).toMatchObject({ banquetsCount: 1, totalSpent: { amount: 120_000_000 } });
    expect(d.activities.items[0]).toMatchObject({ type: 'banquet_held', countsAsSpent: true, amount: { amount: 120_000_000 } });
    expect(d.totals).toMatchObject({ banquetRequests: 1, banquetsHeld: 1, spent: { amount: 120_000_000, currency: 'KZT' } });
  });

  it('invoice event before the request is linked is retried later, not lost', async () => {
    const request = banquetRequestCreated();
    const invoice = banquetInvoiceIssued(request);
    await publishAndDrain(t, BanquetEvents.InvoiceIssued, invoice);
    expect(await directory.findByPhone('+77019998877')).toBeNull();
    const pending = await sql<{ last_error: string | null }>`
      select last_error from platform.outbox where dispatched_at is null and last_error is not null`.execute(t.database.rootConnection());
    expect(pending.rows[0]?.last_error).toMatch(/not linked/);

    await publishAndDrain(t, BanquetEvents.RequestCreated, request);
    t.clock.advance(60_000);
    await t.drain();
    const d = await customerByPhone('+77019998877');
    expect(d.customer.tags).toEqual(['banquet', 'corporate']);
  });

  it('refund of a completed order reduces spent on the refund day; other refunds are ignored', async () => {
    const placed = orderPlaced({ total: { amount: 800_000, currency: 'KZT' } });
    await publishAndDrain(t, OrderingEvents.OrderPlaced, placed);
    await publishAndDrain(t, OrderingEvents.OrderCompleted, orderCompleted(placed));
    const refund = (referenceId: string, purpose: string, amount: number) => ({
      refundId: newId(),
      paymentId: newId(),
      purpose,
      referenceId,
      branchId: placed.branchId,
      amount: { amount, currency: 'KZT' },
      paymentFullyRefunded: false,
      referenceFullyRefunded: false,
      reason: 'недовложение',
      occurredAt: '2026-10-03T06:00:00.000Z',
    });
    await publishAndDrain(t, PaymentsEvents.RefundSucceeded, refund(placed.orderId, 'order', 150_000));
    // Возврат по невыполненному заказу и по депозиту брони сумму покупок не меняют.
    await publishAndDrain(t, PaymentsEvents.RefundSucceeded, refund(newId(), 'order', 100_000));
    await publishAndDrain(t, PaymentsEvents.RefundSucceeded, refund(placed.orderId, 'reservation_deposit', 100_000));

    const d = await customerByPhone('+77011234567');
    expect(d.customer.totalSpent).toEqual({ amount: 650_000, currency: 'KZT' });
    expect(d.activities.items[0]).toMatchObject({ type: 'order_refunded', amount: { amount: -150_000 }, countsAsSpent: true });
    expect(d.activities.total).toBe(3);
    const october = await t.http().get(`/api/v1/admin/customers/${d.customer.id}?from=2026-10-03&to=2026-10-03`).set('authorization', auth);
    expect(october.body.totals).toMatchObject({ spent: { amount: -150_000 }, ordersRefunded: 1 });
  });

  it('certificate purchase by buyer phone counts as spent; without phone is skipped', async () => {
    await publishAndDrain(t, PaymentsEvents.CertificateIssued, certificateIssued());
    await publishAndDrain(t, PaymentsEvents.CertificateIssued, certificateIssued({ buyerPhone: null }));
    const d = await customerByPhone('+77011234567');
    expect(d.customer.totalSpent).toEqual({ amount: 2_000_000, currency: 'KZT' });
    expect(d.activities.total).toBe(1);
    const count = await sql<{ n: number }>`select count(*)::int as n from customers.customers`.execute(t.database.rootConnection());
    expect(count.rows[0]!.n).toBe(1);
  });

  it('period totals are computed from history (local dates, inclusive)', async () => {
    const branchId = newId();
    const sept = orderPlaced({ branchId, occurredAt: '2026-09-10T10:00:00.000Z', total: { amount: 100_000, currency: 'KZT' } });
    const oct = orderPlaced({ branchId, occurredAt: '2026-10-05T10:00:00.000Z', total: { amount: 250_000, currency: 'KZT' } });
    for (const p of [sept, oct]) {
      await publishAndDrain(t, OrderingEvents.OrderPlaced, p);
      await publishAndDrain(t, OrderingEvents.OrderCompleted, orderCompleted(p));
    }
    await publishAndDrain(t, PaymentsEvents.CertificateIssued, certificateIssued({ occurredAt: '2026-10-06T10:00:00.000Z' }));
    const c = (await directory.findByPhone('+77011234567'))!;

    const all = await t.http().get(`/api/v1/admin/customers/${c.id}`).set('authorization', auth);
    expect(all.body.totals).toMatchObject({ spent: { amount: 2_350_000 }, ordersPlaced: 2, ordersCompleted: 2, certificatesPurchased: 1 });

    const october = await t.http().get(`/api/v1/admin/customers/${c.id}?from=2026-10-01&to=2026-10-31`).set('authorization', auth);
    expect(october.status).toBe(200);
    expect(october.body.period).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(october.body.totals).toMatchObject({ spent: { amount: 2_250_000 }, ordersPlaced: 1, ordersCompleted: 1, certificatesPurchased: 1 });
    expect(october.body.activities.total).toBe(3);

    // Граница суток — по Asia/Almaty: 2026-09-30T19:30Z — это уже 1 октября по местному времени.
    const lateEvening = orderPlaced({ branchId, occurredAt: '2026-09-30T19:30:00.000Z' });
    await publishAndDrain(t, OrderingEvents.OrderPlaced, lateEvening);
    const firstOct = await t.http().get(`/api/v1/admin/customers/${c.id}?from=2026-10-01&to=2026-10-01`).set('authorization', auth);
    expect(firstOct.body.totals.ordersPlaced).toBe(1);

    const bad = await t.http().get(`/api/v1/admin/customers/${c.id}?from=2026-10-10&to=2026-10-01`).set('authorization', auth);
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('customer.period_invalid');
  });

  it('events are delivered through the real outbox (published inside a transaction)', async () => {
    await t.get(Database).transaction(async () => {
      await t.get(EventBus).publish(OrderingEvents.OrderPlaced, orderPlaced());
    });
    expect(await directory.findByPhone('+77011234567')).toBeNull();
    await t.drain();
    expect(await directory.findByPhone('+77011234567')).not.toBeNull();
  });
});
