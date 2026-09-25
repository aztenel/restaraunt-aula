import ExcelJS from 'exceljs';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createFakes, fakeProviders, Fakes } from '../../../test/fakes';
import { createBranch, tokenFor } from '../../../test/support/fixtures';
import { createTestApp, TestApp } from '../../../test/support/test-app';
import { EventBus } from '../../shared/infrastructure/events/event-bus';
import { newId } from '../../shared/kernel/ids';
import { ReportingModule } from './reporting.module';
import { globalProviders } from './testing/global-providers';
import { seedReporting } from './infrastructure/seed';
import { local, ReportingEvents, testOrder } from './testing/events';

function binary(res: any, cb: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}

async function workbook(body: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(body as unknown as ArrayBuffer);
  return wb;
}

const PLOV = newId();
const TEA = newId();

/** Сейчас: 01.10.2026 11:00 (Asia/Almaty). */
const NOW = new Date('2026-10-01T06:00:00.000Z');

describe('Reporting (integration)', () => {
  let t: TestApp;
  let fakes: Fakes;
  let ev: ReportingEvents;
  let branchA: string;
  let branchB: string;
  let owner: string;

  beforeAll(async () => {
    fakes = createFakes();
    const providers = fakeProviders(fakes);
    t = await createTestApp({ imports: [globalProviders(providers), ReportingModule], migrateModules: ['reporting'], providers });
    ev = new ReportingEvents(t.get(EventBus));
  });
  afterAll(async () => t.close());
  beforeEach(async () => {
    await t.reset();
    t.clock.set(NOW);
    fakes.notifier.clear();
    branchA = await createBranch(t, { code: 'GL' });
    branchB = await createBranch(t, { code: 'GV' });
    owner = (await tokenFor(t, [{ role: 'owner' }])).auth;
  });

  const get = (path: string, auth: string) => t.http().get(`/api/v1/admin/reports/${path}`).set('authorization', auth);

  /** Базовый сценарий: заказы на границе суток, возвраты, банкет, сертификат. */
  async function seedSales() {
    const order1 = testOrder(branchA, [{ dishId: PLOV, name: 'Плов', quantity: 2, unitPrice: 250_000 }], { type: 'delivery' });
    const order2 = testOrder(branchA, [{ dishId: TEA, name: 'Чай', quantity: 6, unitPrice: 50_000 }], { type: 'pickup', channel: 'admin' });
    const order3 = testOrder(branchB, [{ dishId: PLOV, name: 'Плов', quantity: 1, unitPrice: 200_000 }]);
    // Выполнен в 23:30 30.09 (местное) — выручка 30.09; второй в 00:30 01.10 — выручка 01.10.
    await ev.orderPlaced(order1, local('2026-09-30', '22:50'));
    const pay1 = await ev.paymentSucceeded({
      purpose: 'order',
      referenceId: order1.orderId,
      branchId: branchA,
      method: 'online',
      amount: 500_000,
      at: local('2026-09-30', '22:51'),
    });
    await ev.orderCompleted(order1, local('2026-09-30', '22:50'), local('2026-09-30', '23:30'));
    await ev.orderPlaced(order2, local('2026-10-01', '00:05'), 'paid');
    await ev.orderCompleted(order2, local('2026-10-01', '00:05'), local('2026-10-01', '00:30'));
    // Частичный возврат по выполненному заказу — уменьшает выручку дня возврата.
    await ev.refundSucceeded({
      paymentId: pay1,
      purpose: 'order',
      referenceId: order1.orderId,
      branchId: branchA,
      amount: 100_000,
      at: local('2026-10-01', '10:00'),
    });
    // Отменённый оплаченный заказ и его возврат — выручку не меняют.
    await ev.orderPlaced(order3, local('2026-10-01', '01:00'));
    const pay3 = await ev.paymentSucceeded({
      purpose: 'order',
      referenceId: order3.orderId,
      branchId: branchB,
      method: 'online',
      amount: 200_000,
      at: local('2026-10-01', '01:05'),
    });
    await ev.orderCancelled(order3, local('2026-10-01', '01:30'), 'guest_request', true);
    await ev.refundSucceeded({
      paymentId: pay3,
      purpose: 'order',
      referenceId: order3.orderId,
      branchId: branchB,
      amount: 200_000,
      at: local('2026-10-01', '01:40'),
    });
    // Банкет проведён в филиале B, сертификат продан онлайн.
    const banquet = await ev.banquetCreated({ branchId: branchB, at: local('2026-09-20', '12:00') });
    await ev.banquetStatus({ requestId: banquet, branchId: branchB, from: 'new', to: 'in_progress', at: local('2026-09-20', '12:10') });
    await ev.banquetStatus({ requestId: banquet, branchId: branchB, from: 'prepaid', to: 'held', at: local('2026-10-01', '10:30'), quoteTotal: 10_000_000 });
    await ev.certificateIssued({ nominal: 2_500_000, price: 2_000_000, at: local('2026-10-01', '09:00') });
    await t.drain();
    return { order1, order2, order3, banquet };
  }

  describe('revenue by day and channel', () => {
    it('recognizes revenue per decisions: order at completion (local day boundaries), banquet at held, certificate at sale, refunds on refund day', async () => {
      await seedSales();
      const res = await get('revenue?from=2026-09-30&to=2026-10-01', owner);
      expect(res.status).toBe(200);
      expect(res.body.branchId).toBeNull();
      const [d30, d01] = res.body.days;
      expect(d30).toMatchObject({ date: '2026-09-30', delivery: { amount: 500_000 }, pickup: { amount: 0 }, total: { amount: 500_000 } });
      expect(d01).toMatchObject({
        date: '2026-10-01',
        delivery: { amount: -100_000, currency: 'KZT' },
        pickup: { amount: 300_000 },
        banquet: { amount: 10_000_000 },
        certificate: { amount: 2_000_000 },
        refunds: { amount: -100_000 },
        total: { amount: 12_200_000 },
      });
      expect(res.body.totals.total.amount).toBe(12_700_000);
      expect(res.body.counts).toEqual({ delivery: 1, pickup: 1, banquet: 1, certificate: 1 });
      const byBranch = Object.fromEntries(res.body.byBranch.map((b: any) => [b.branchId ?? 'none', b.total.amount]));
      expect(byBranch).toEqual({ [branchA]: 700_000, [branchB]: 10_000_000, none: 2_000_000 });

      const branch = await get(`revenue?from=2026-09-30&to=2026-10-01&branchId=${branchA}`, owner);
      expect(branch.status).toBe(200);
      expect(branch.body.days[1]).toMatchObject({ delivery: { amount: -100_000 }, pickup: { amount: 300_000 }, certificate: { amount: 0 }, total: { amount: 200_000 } });
      expect(branch.body.totals.total.amount).toBe(700_000);
    });

    it('average check per channel', async () => {
      await seedSales();
      const res = await get('average-check?from=2026-09-30&to=2026-10-01', owner);
      expect(res.status).toBe(200);
      const byChannel = Object.fromEntries(res.body.channels.map((c: any) => [c.channel, c]));
      expect(byChannel.delivery).toMatchObject({ count: 1, average: { amount: 500_000 } });
      expect(byChannel.pickup).toMatchObject({ count: 1, average: { amount: 300_000 } });
      expect(byChannel.banquet).toMatchObject({ count: 1, average: { amount: 10_000_000 } });
      expect(byChannel.certificate).toMatchObject({ count: 1, average: { amount: 2_000_000 } });
      expect(res.body.orders).toMatchObject({ count: 2, revenue: { amount: 800_000 }, average: { amount: 400_000 } });
    });

    it('exports revenue to XLSX (tenge in cells)', async () => {
      await seedSales();
      const res = await get('revenue/export?from=2026-09-30&to=2026-10-01', owner).buffer(true).parse(binary);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');
      expect(res.headers['content-disposition']).toContain('aula_revenue_2026-09-30_2026-10-01_all.xlsx');
      const wb = await workbook(res.body);
      const sheet = wb.getWorksheet('Выручка по дням')!;
      expect(sheet.getRow(1).getCell(2).value).toBe('Доставка, ₸');
      expect(sheet.getRow(2).getCell(2).value).toBe(5000);
      expect(sheet.getRow(3).getCell(4).value).toBe(100_000);
      expect(sheet.getRow(4).getCell(7).value).toBe(127_000);
      expect(wb.getWorksheet('Параметры')).toBeDefined();
    });
  });

  describe('projection robustness', () => {
    it('handles out-of-order events, duplicates and a refund arriving before completion', async () => {
      const order = testOrder(branchA, [{ dishId: PLOV, name: 'Плов', quantity: 1, unitPrice: 400_000 }], { type: 'delivery' });
      const paymentId = newId();
      // Возврат пришёл раньше события о выполнении (но произошёл после выполнения).
      await ev.refundSucceeded({ paymentId, purpose: 'order', referenceId: order.orderId, branchId: branchA, amount: 50_000, at: local('2026-10-01', '09:00') });
      await t.drain();
      await ev.orderCompleted(order, local('2026-09-30', '19:00'), local('2026-09-30', '20:00'));
      await t.drain();
      // Старое событие OrderPlaced и дубликат OrderCompleted не меняют итог.
      await ev.orderPlaced(order, local('2026-09-30', '19:00'));
      await ev.orderStatus(order, 'cooking', 'ready', local('2026-09-30', '19:40'));
      await ev.orderCompleted(order, local('2026-09-30', '19:00'), local('2026-09-30', '20:00'));
      await t.drain();

      const row = await sql<{ status: string; placed_date: string; completed_date: string }>`
        select status, placed_date, completed_date from reporting.orders where order_id = ${order.orderId}`.execute(t.database.rootConnection());
      expect(row.rows[0]).toEqual({ status: 'completed', placed_date: '2026-09-30', completed_date: '2026-09-30' });
      const facts = await sql<{ kind: string; n: number }>`
        select kind, count(*)::int as n from reporting.sales_facts where reference_id = ${order.orderId} group by kind order by kind`.execute(
        t.database.rootConnection(),
      );
      expect(facts.rows).toEqual([
        { kind: 'refund', n: 1 },
        { kind: 'sale', n: 1 },
      ]);
      const res = await get('revenue?from=2026-09-30&to=2026-10-01', owner);
      expect(res.body.days.map((d: any) => d.delivery.amount)).toEqual([400_000, -50_000]);
    });
  });

  describe('access', () => {
    it('branch manager sees only own branch; consolidated needs reports.consolidated', async () => {
      await seedSales();
      const manager = (await tokenFor(t, [{ role: 'branch_manager', branchId: branchA }])).auth;
      expect((await get(`revenue?branchId=${branchA}`, manager)).status).toBe(200);
      const other = await get(`revenue?branchId=${branchB}`, manager);
      expect(other.status).toBe(403);
      expect(other.body.error.code).toBe('access.forbidden_branch');
      const consolidated = await get('revenue', manager);
      expect(consolidated.status).toBe(403);
      expect(consolidated.body.error.code).toBe('access.forbidden');
      expect((await get('hall-load', manager)).status).toBe(403);
      expect((await get(`revenue/export?branchId=${branchB}`, manager)).status).toBe(403);

      const finance = (await tokenFor(t, [{ role: 'finance' }])).auth;
      expect((await get('revenue', finance)).status).toBe(200);

      const operator = (await tokenFor(t, [{ role: 'branch_operator', branchId: branchA }])).auth;
      expect((await get(`revenue?branchId=${branchA}`, operator)).status).toBe(403);
      expect((await t.http().get('/api/v1/admin/reports/revenue')).status).toBe(401);
    });

    it('validates periods and branches', async () => {
      expect((await get('revenue?from=2026-10-01T00:00', owner)).status).toBe(400);
      const reversed = await get('revenue?from=2026-10-02&to=2026-10-01', owner);
      expect(reversed.status).toBe(422);
      expect(reversed.body.error.code).toBe('report.invalid_period');
      const tooLong = await get('revenue?from=2025-01-01&to=2026-10-01', owner);
      expect(tooLong.body.error.code).toBe('report.period_too_long');
      const unknown = await get(`revenue?branchId=${newId()}`, owner);
      expect(unknown.status).toBe(404);
      expect(unknown.body.error.code).toBe('branch.not_found');
    });
  });

  describe('storefront conversion, top dishes, cancelled orders', () => {
    it('conversion = sessions with an order / storefront sessions (anonymous, no personal data)', async () => {
      const s1 = newId();
      const s2 = newId();
      const s3 = newId();
      const track = (sessionId: string, type: string, branchId?: string, path = '/menu') =>
        t.http().post('/api/v1/public/analytics/events').send({ sessionId, type, branchId, path });
      for (const type of ['page_view', 'menu_view', 'add_to_cart', 'checkout_start']) expect((await track(s1, type, branchA)).status).toBe(204);
      await track(s2, 'page_view', branchA, '/order/Xk3fQ9zLm2Pq8Rt7Vw1Ab?phone=77010000000');
      await track(s3, 'menu_view');
      expect((await track('not-a-uuid', 'page_view')).status).toBe(400);
      expect((await track(s1, 'purchase')).status).toBe(400);

      const paths = await sql<{ path: string }>`select path from reporting.storefront_events where session_id = ${s2}`.execute(
        t.database.rootConnection(),
      );
      expect(paths.rows[0]!.path).toBe('/order/:id');

      const order = testOrder(branchA, [{ dishId: PLOV, name: 'Плов', quantity: 1, unitPrice: 100_000 }], { analyticsSessionId: s1 });
      await ev.orderPlaced(order, local('2026-10-01', '10:00'));
      await ev.orderPlaced(testOrder(branchB, [{ dishId: PLOV, name: 'Плов', quantity: 1, unitPrice: 100_000 }], { channel: 'admin' }), local('2026-10-01', '10:05'));
      await t.drain();

      const all = await get('conversion?from=2026-10-01&to=2026-10-01', owner);
      expect(all.status).toBe(200);
      expect(all.body).toMatchObject({
        sessions: 3,
        menuViewSessions: 2,
        addToCartSessions: 1,
        checkoutSessions: 1,
        orderedSessions: 1,
        webOrders: 1,
        conversion: 0.3333,
      });
      expect(all.body.days).toEqual([{ date: '2026-10-01', sessions: 3, orderedSessions: 1, conversion: 0.3333 }]);
      const branch = await get(`conversion?from=2026-10-01&to=2026-10-01&branchId=${branchA}`, owner);
      expect(branch.body).toMatchObject({ sessions: 2, orderedSessions: 1, conversion: 0.5 });
    });

    it('purges raw storefront events after the retention period', async () => {
      const sessionId = newId();
      await t.http().post('/api/v1/public/analytics/events').send({ sessionId, type: 'page_view', path: '/' });
      const count = async () =>
        (await sql<{ n: number }>`select count(*)::int as n from reporting.storefront_events`.execute(t.database.rootConnection())).rows[0]!.n;
      await t.runSchedule('reporting.purge_storefront_events');
      expect(await count()).toBe(1);
      t.clock.advance(401 * 86_400_000);
      await t.runSchedule('reporting.purge_storefront_events');
      expect(await count()).toBe(0);
    });

    it('rate-limits storefront tracking', async () => {
      const sessionId = newId();
      let last = 0;
      for (let i = 0; i < 121; i++) {
        last = (await t.http().post('/api/v1/public/analytics/events').send({ sessionId, type: 'page_view', path: '/' })).status;
      }
      expect(last).toBe(429);
    });

    it('top dishes by revenue and by quantity', async () => {
      await seedSales();
      const byRevenue = await get('top-dishes?from=2026-09-30&to=2026-10-01', owner);
      expect(byRevenue.status).toBe(200);
      expect(byRevenue.body.items.map((i: any) => [i.name.ru, i.quantity, i.revenue.amount])).toEqual([
        ['Плов', 2, 500_000],
        ['Чай', 6, 300_000],
      ]);
      expect(byRevenue.body.items[0]).toMatchObject({ rank: 1, orders: 1, revenueShare: 0.625 });
      expect(byRevenue.body.totalRevenue.amount).toBe(800_000);
      const byQuantity = await get('top-dishes?from=2026-09-30&to=2026-10-01&sort=quantity&limit=1', owner);
      expect(byQuantity.body.items.map((i: any) => i.name.ru)).toEqual(['Чай']);
      expect((await get('top-dishes?sort=price', owner)).status).toBe(400);
    });

    it('cancelled orders with reasons, list and XLSX', async () => {
      await seedSales();
      const unpaid = testOrder(branchA, [{ dishId: TEA, name: 'Чай', quantity: 1, unitPrice: 50_000 }]);
      await ev.orderPlaced(unpaid, local('2026-10-01', '08:00'));
      await ev.orderCancelled(unpaid, local('2026-10-01', '08:20'), 'not_paid_in_time', false);
      await t.drain();
      const res = await get('cancelled-orders?from=2026-10-01&to=2026-10-01&perPage=1', owner);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ placed: 3, cancelled: 2, cancelledShare: 0.6667, cancelledTotal: { amount: 250_000 } });
      expect(res.body.reasons).toEqual(
        expect.arrayContaining([
          { reasonCode: 'guest_request', count: 1, paidCount: 1, total: { amount: 200_000, currency: 'KZT' } },
          { reasonCode: 'not_paid_in_time', count: 1, paidCount: 0, total: { amount: 50_000, currency: 'KZT' } },
        ]),
      );
      expect(res.body.orders).toMatchObject({ total: 2, page: 1, perPage: 1 });
      expect(res.body.orders.items[0]).toMatchObject({ number: unpaid.number, reasonCode: 'not_paid_in_time', wasPaid: false });

      const file = await get('cancelled-orders/export?from=2026-10-01&to=2026-10-01', owner).buffer(true).parse(binary);
      const wb = await workbook(file.body);
      expect(wb.getWorksheet('Заказы')!.rowCount).toBe(3);
    });
  });

  describe('halls, banquets', () => {
    it('hall load by weekday and venue type, overbookings', async () => {
      const v1 = fakes.venues.addVenue(branchA, { typeCode: 'vip', typeName: { ru: 'VIP-зал' } });
      const v2 = fakes.venues.addVenue(branchA, { typeCode: 'vip', typeName: { ru: 'VIP-зал' } });
      const t1 = fakes.venues.addVenue(branchA, { typeCode: 'table', typeName: { ru: 'Стол' } });
      const booked = local('2026-09-28', '12:00');
      await ev.reservationCreated({ branchId: branchA, venueId: v1.id, start: local('2026-10-01', '18:00'), end: local('2026-10-01', '21:00'), guests: 10, at: booked });
      // Накладка: пересекается с предыдущей бронью того же места.
      await ev.reservationCreated({ branchId: branchA, venueId: v1.id, start: local('2026-10-01', '20:00'), end: local('2026-10-01', '22:00'), guests: 6, at: booked });
      const cancelled = await ev.reservationCreated({
        branchId: branchA,
        venueId: v2.id,
        status: 'pending',
        start: local('2026-10-01', '12:00'),
        end: local('2026-10-01', '14:00'),
        guests: 4,
        at: booked,
      });
      await ev.reservationStatus({
        reservationId: cancelled,
        branchId: branchA,
        venueId: v2.id,
        from: 'pending',
        to: 'cancelled',
        start: local('2026-10-01', '12:00'),
        end: local('2026-10-01', '14:00'),
        guests: 4,
        at: local('2026-09-29', '10:00'),
      });
      // Перенос брони с v1 на v2 (другое время) — снимает вторую накладку.
      const moved = await ev.reservationCreated({ branchId: branchA, venueId: v1.id, start: local('2026-10-01', '19:00'), end: local('2026-10-01', '20:00'), guests: 2, at: booked });
      await ev.reservationRescheduled({
        reservationId: moved,
        branchId: branchA,
        from: { venueId: v1.id, start: local('2026-10-01', '19:00'), end: local('2026-10-01', '20:00'), guests: 2 },
        to: { venueId: v2.id, start: local('2026-10-01', '15:00'), end: local('2026-10-01', '16:00'), guests: 3 },
        at: local('2026-09-29', '12:00'),
      });
      await ev.reservationCreated({
        branchId: branchA,
        venueId: t1.id,
        venueTypeCode: 'table',
        start: local('2026-10-02', '13:00'),
        end: local('2026-10-02', '14:00'),
        guests: 2,
        at: booked,
      });
      await t.drain();

      const res = await get(`hall-load?from=2026-10-01&to=2026-10-02&branchId=${branchA}`, owner);
      expect(res.status).toBe(200);
      const row = (weekday: string, type: string) => res.body.rows.find((r: any) => r.weekday === weekday && r.venueTypeCode === type);
      expect(row('thu', 'vip')).toMatchObject({ venues: 2, openMinutes: 1680, bookedMinutes: 360, openHours: 28, bookedHours: 6, load: 0.2143, reservations: 3, guests: 19 });
      expect(row('thu', 'vip').venueTypeName).toEqual({ ru: 'VIP-зал' });
      expect(row('fri', 'table')).toMatchObject({ venues: 1, openMinutes: 840, bookedMinutes: 60, load: 0.0714 });
      expect(res.body.weekdays.map((w: any) => w.weekday)).toEqual(['thu', 'fri']);
      expect(res.body.overbookingCount).toBe(1);
      expect(res.body.overbookings[0]).toMatchObject({ venueId: v1.id, venueTypeCode: 'vip' });

      const file = await get(`hall-load/export?from=2026-10-01&to=2026-10-02&branchId=${branchA}`, owner).buffer(true).parse(binary);
      const wb = await workbook(file.body);
      expect(wb.getWorksheet('Накладки')!.rowCount).toBe(2);
    });

    it('banquet funnel: stages, conversion, 30-minute answer share, lost requests; refunds after held reduce revenue', async () => {
      // Сейчас 11:00 01.10 (местное).
      const held = await ev.banquetCreated({ branchId: branchA, at: local('2026-10-01', '09:00') });
      await ev.banquetStatus({ requestId: held, branchId: branchA, from: 'new', to: 'in_progress', at: local('2026-10-01', '09:10') });
      await ev.banquetStatus({ requestId: held, branchId: branchA, from: 'in_progress', to: 'quote_sent', at: local('2026-10-01', '09:30') });
      await ev.banquetStatus({ requestId: held, branchId: branchA, from: 'quote_sent', to: 'agreed', at: local('2026-10-01', '09:40'), quoteTotal: 8_000_000 });
      await ev.banquetStatus({ requestId: held, branchId: branchA, from: 'agreed', to: 'prepaid', at: local('2026-10-01', '09:50'), quoteTotal: 8_000_000 });
      await ev.banquetStatus({ requestId: held, branchId: branchA, from: 'prepaid', to: 'held', at: local('2026-10-01', '10:30'), quoteTotal: 8_000_000 });
      const late = await ev.banquetCreated({ branchId: branchA, at: local('2026-10-01', '09:00') });
      await ev.banquetStatus({ requestId: late, branchId: branchA, from: 'new', to: 'in_progress', at: local('2026-10-01', '09:45') });
      await ev.banquetStatus({ requestId: late, branchId: branchA, from: 'in_progress', to: 'cancelled', at: local('2026-10-01', '10:00'), reason: 'Дорого' });
      await ev.banquetCreated({ branchId: branchA, at: local('2026-10-01', '09:00') });
      // Счёт по проведённому банкету, оплата и возврат на следующий день.
      const invoiceId = await ev.invoiceIssued({ number: 'GL-2026-000001', requestId: held, branchId: branchA, company: null, amount: 4_000_000, at: local('2026-10-01', '09:45') });
      const paymentId = await ev.paymentSucceeded({ purpose: 'banquet_invoice', referenceId: invoiceId, branchId: branchA, method: 'online', amount: 4_000_000, at: local('2026-10-01', '09:48') });
      await ev.refundSucceeded({ paymentId, purpose: 'banquet_invoice', referenceId: invoiceId, branchId: branchA, amount: 500_000, at: local('2026-10-02', '12:00') });
      await t.drain();

      const res = await get(`banquet-funnel?from=2026-10-01&to=2026-10-01&branchId=${branchA}`, owner);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        total: 3,
        held: 1,
        heldTotal: { amount: 8_000_000 },
        conversion: 0.3333,
        answerDue: 3,
        answeredWithinSla: 1,
        answeredWithinSlaShare: 0.3333,
        unansweredOverdue: 1,
        cancelled: 1,
        cancelledBeforeAgreement: 1,
        lost: 2,
        slaMinutes: 30,
      });
      const stage = (s: string) => res.body.stages.find((x: any) => x.status === s);
      expect(stage('in_progress').reached).toBe(2);
      expect(stage('quote_sent').reached).toBe(1);
      expect(stage('held')).toEqual({ status: 'held', reached: 1, current: 1 });
      expect(res.body.cancelReasons).toEqual([{ reason: 'Дорого', count: 1 }]);

      const revenue = await get(`revenue?from=2026-10-01&to=2026-10-02&branchId=${branchA}`, owner);
      expect(revenue.body.days.map((d: any) => d.banquet.amount)).toEqual([8_000_000, -500_000]);
    });
  });

  describe('payments and certificates', () => {
    it('cash flow by method/provider and purpose, separate from revenue', async () => {
      const orderId = newId();
      const p1 = await ev.paymentSucceeded({ purpose: 'order', referenceId: orderId, branchId: branchA, method: 'online', provider: 'sandbox', amount: 500_000, at: local('2026-10-01', '10:00') });
      await ev.paymentSucceeded({ purpose: 'order', referenceId: newId(), branchId: branchA, method: 'on_receipt', amount: 300_000, at: local('2026-10-01', '11:00') });
      await ev.paymentSucceeded({ purpose: 'order', referenceId: newId(), branchId: branchA, method: 'gift_certificate', amount: 100_000, at: local('2026-10-01', '11:30') });
      await ev.paymentSucceeded({ purpose: 'banquet_invoice', referenceId: newId(), branchId: branchB, method: 'bank_transfer', amount: 5_000_000, at: local('2026-10-01', '12:00') });
      await ev.paymentSucceeded({ purpose: 'gift_certificate', referenceId: newId(), branchId: null, method: 'online', provider: 'sandbox', amount: 2_000_000, at: local('2026-10-01', '12:30') });
      await ev.refundSucceeded({ paymentId: p1, purpose: 'order', referenceId: orderId, branchId: branchA, amount: 100_000, at: local('2026-10-02', '09:00') });
      await t.drain();

      const res = await get('payments?from=2026-10-01&to=2026-10-02', owner);
      expect(res.status).toBe(200);
      const online = res.body.methods.find((m: any) => m.method === 'online');
      expect(online).toMatchObject({ provider: 'sandbox', receivedCount: 2, refundedCount: 1, received: { amount: 2_500_000 }, refunded: { amount: 100_000 }, net: { amount: 2_400_000 } });
      expect(res.body.totals).toMatchObject({
        received: { amount: 7_900_000 },
        refunded: { amount: 100_000 },
        net: { amount: 7_800_000 },
        certificateRedemptions: { amount: 100_000 },
        moneyReceived: { amount: 7_800_000 },
      });
      expect(res.body.purposes.find((p: any) => p.purpose === 'banquet_invoice').received.amount).toBe(5_000_000);
      expect(res.body.days.map((d: any) => d.net.amount)).toEqual([7_900_000, -100_000]);

      const branch = await get(`payments?from=2026-10-01&to=2026-10-02&branchId=${branchA}`, owner);
      expect(branch.body.totals.received.amount).toBe(900_000);
      // Поступления — не выручка: отчёт о выручке пуст (заказы не выполнены).
      const revenue = await get('revenue?from=2026-10-01&to=2026-10-02', owner);
      expect(revenue.body.totals.total.amount).toBe(0);
    });

    it('certificates: issued, redeemed, expired, outstanding liability', async () => {
      const c1 = await ev.certificateIssued({ nominal: 2_500_000, price: 2_000_000, at: local('2026-10-01', '09:00') });
      const c2 = await ev.certificateIssued({ nominal: 1_000_000, price: 1_000_000, at: local('2026-09-15', '09:00'), kind: 'set' });
      await ev.certificateRedeemed({ certificateId: c1, amount: 1_000_000, balanceAfter: 1_500_000, branchId: branchA, at: local('2026-10-01', '13:00') });
      await ev.certificateExpired({ certificateId: c2, nominal: 1_000_000, balance: 1_000_000, at: local('2026-09-30', '00:00') });
      await t.drain();

      const res = await get('certificates?from=2026-09-01&to=2026-10-01', owner);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        issued: { count: 2, nominal: { amount: 3_500_000 }, price: { amount: 3_000_000 } },
        redeemed: { count: 1, amount: { amount: 1_000_000 } },
        expired: { count: 1, balance: { amount: 1_000_000 } },
        outstanding: { count: 1, balance: { amount: 1_500_000 }, asOf: '2026-10-01' },
      });
      expect(res.body.issuedByKind.map((k: any) => k.kind)).toEqual(['amount', 'set']);
      const beforeRedeem = await get('certificates?from=2026-09-01&to=2026-09-30', owner);
      expect(beforeRedeem.body.outstanding).toMatchObject({ count: 0, balance: { amount: 0 } });

      const branch = await get(`certificates?from=2026-09-01&to=2026-10-01&branchId=${branchA}`, owner);
      expect(branch.body).toMatchObject({ issued: { count: 0 }, redeemed: { count: 1 }, expired: null, outstanding: null });
      const file = await get('certificates/export?from=2026-09-01&to=2026-10-01', owner).buffer(true).parse(binary);
      const wb = await workbook(file.body);
      expect(wb.getWorksheet('Сертификаты')!.getRow(2).getCell(3).value).toBe(35_000);
    });
    it('certificates: a sum credited back to a certificate (cancelled order) restores the outstanding liability', async () => {
      const c1 = await ev.certificateIssued({ nominal: 2_000_000, price: 2_000_000, at: local('2026-10-01', '09:00') });
      await ev.certificateRedeemed({ certificateId: c1, amount: 2_000_000, balanceAfter: 0, branchId: branchA, at: local('2026-10-01', '12:00') });
      await ev.certificateCredited({ certificateId: c1, amount: 2_000_000, balanceAfter: 2_000_000, branchId: branchA, at: local('2026-10-01', '12:30') });
      await ev.certificateRedeemed({ certificateId: c1, amount: 500_000, balanceAfter: 1_500_000, branchId: branchA, at: local('2026-10-02', '12:00') });
      await t.drain();

      const day1 = await get('certificates?from=2026-10-01&to=2026-10-01', owner);
      expect(day1.body).toMatchObject({
        redeemed: { count: 1, amount: { amount: 2_000_000 } },
        returned: { count: 1, amount: { amount: 2_000_000 } },
        outstanding: { count: 1, balance: { amount: 2_000_000 } },
      });
      const both = await get('certificates?from=2026-10-01&to=2026-10-02', owner);
      expect(both.body).toMatchObject({
        redeemed: { count: 2, amount: { amount: 2_500_000 } },
        returned: { count: 1, amount: { amount: 2_000_000 } },
        outstanding: { count: 1, balance: { amount: 1_500_000 } },
      });
      const branch = await get(`certificates?from=2026-10-01&to=2026-10-02&branchId=${branchA}`, owner);
      expect(branch.body.returned).toEqual({ count: 1, amount: { amount: 2_000_000, currency: 'KZT' } });
    });

    it('certificates: an expired certificate reinstated by extension is back in the outstanding liability', async () => {
      const c1 = await ev.certificateIssued({ nominal: 1_000_000, price: 1_000_000, at: local('2026-09-01', '09:00') });
      await ev.certificateExpired({ certificateId: c1, nominal: 1_000_000, balance: 1_000_000, at: local('2026-09-30', '00:00') });
      await t.drain();
      const expired = await get('certificates?from=2026-09-01&to=2026-09-30', owner);
      expect(expired.body).toMatchObject({ expired: { count: 1, balance: { amount: 1_000_000 } }, outstanding: { count: 0, balance: { amount: 0 } } });
      await ev.certificateReinstated({ certificateId: c1, balance: 1_000_000, expiresAt: local('2027-03-31', '23:59'), at: local('2026-10-01', '10:00') });
      await t.drain();
      const after = await get('certificates?from=2026-09-01&to=2026-10-01', owner);
      expect(after.body).toMatchObject({ expired: { count: 0, balance: { amount: 0 } }, outstanding: { count: 1, balance: { amount: 1_000_000 } } });
    });
  });

  describe('dashboard, own channel, goals', () => {
    it('own channel share with manual aggregator volumes (audited), goals and dashboard KPIs', async () => {
      await seedSales();
      const manager = (await tokenFor(t, [{ role: 'branch_manager', branchId: branchA }])).auth;
      const put = (auth: string, body: Record<string, unknown>) =>
        t.http().put('/api/v1/admin/reports/aggregator-volumes').set('authorization', auth).send(body);
      const saved = await put(manager, { branchId: branchA, month: '2026-09', source: 'agg_a', sourceName: 'Агрегатор A', orders: 3, revenue: { amount: 900_000 } });
      expect(saved.status).toBe(200);
      expect(saved.body).toMatchObject({ month: '2026-09', source: 'agg_a', orders: 3, revenue: { amount: 900_000 } });
      // Повторный ввод — обновление той же записи.
      const updated = await put(manager, { branchId: branchA, month: '2026-09', source: 'AGG_A', sourceName: 'Агрегатор A', orders: 3 });
      expect(updated.body.id).toBe(saved.body.id);
      expect((await put(manager, { branchId: branchB, month: '2026-09', source: 'agg_a', sourceName: 'A', orders: 1 })).status).toBe(403);
      expect((await put(manager, { branchId: branchA, month: '2026-9', source: 'agg_a', sourceName: 'A', orders: 1 })).status).toBe(400);
      const audit = await sql<{ action: string }>`select action from platform.audit_log where entity_type = 'aggregator_volume'`.execute(
        t.database.rootConnection(),
      );
      expect(audit.rows).toHaveLength(2);
      const list = await t.http().get(`/api/v1/admin/reports/aggregator-volumes?fromMonth=2026-09&toMonth=2026-10&branchId=${branchA}`).set('authorization', manager);
      expect(list.body).toHaveLength(1);

      const own = await get(`own-channel?from=2026-09-01&to=2026-10-31&branchId=${branchA}`, manager);
      expect(own.status).toBe(200);
      expect(own.body.months).toHaveLength(2);
      expect(own.body.months[0]).toMatchObject({ month: '2026-09', webOrders: 1, adminOrders: 0, ownOrders: 1, aggregatorOrders: 3, ownShare: 0.25 });
      expect(own.body.months[1]).toMatchObject({ month: '2026-10', adminOrders: 1, aggregatorOrders: null, ownShare: null });
      expect(own.body.totals).toMatchObject({ ownOrders: 2, aggregatorOrders: 3, ownShare: 0.4 });

      const goals = await get(`goals?from=2026-09-01&to=2026-09-30&branchId=${branchA}`, manager);
      expect(goals.status).toBe(200);
      expect(goals.body).toMatchObject({ ownChannelShare: 0.25, ownOrders: 1, aggregatorOrders: 3, overbookings: 0, dailyReportsExpected: 30, dailyReportsGenerated: 0 });

      const dashboard = await get('dashboard', owner);
      expect(dashboard.status).toBe(200);
      expect(dashboard.body.today).toMatchObject({
        from: '2026-10-01',
        revenue: { amount: 12_200_000 },
        completedOrders: 1,
        averageCheck: { amount: 300_000 },
        placedOrders: 2,
        cancelledOrders: 1,
      });
      expect(dashboard.body.yesterday).toMatchObject({ from: '2026-09-30', revenue: { amount: 500_000 }, completedOrders: 1 });
      expect(dashboard.body.last7Days).toMatchObject({ from: '2026-09-25', to: '2026-10-01', revenue: { amount: 12_700_000 }, banquetRequests: 0 });
      const file = await get('dashboard/export', owner).buffer(true).parse(binary);
      expect((await workbook(file.body)).getWorksheet('Показатели')!.rowCount).toBe(34);
    });
  });

  describe('seed', () => {
    it('is idempotent: demo aggregator volumes only in demo mode', async () => {
      const logs: string[] = [];
      const ctx = {
        app: t.app,
        branches: { greenline: branchA, 'garden-view': branchB },
        legalEntityId: newId(),
        ownerUserId: newId(),
        demo: false,
        log: (m: string) => logs.push(m),
      };
      await seedReporting(ctx);
      const count = async () =>
        (await sql<{ n: number }>`select count(*)::int as n from reporting.aggregator_volumes`.execute(t.database.rootConnection())).rows[0]!.n;
      expect(await count()).toBe(0);
      await seedReporting({ ...ctx, demo: true });
      expect(await count()).toBe(12);
      await seedReporting({ ...ctx, demo: true });
      expect(await count()).toBe(12);
      const own = await get(`own-channel?from=2026-07-01&to=2026-09-30&branchId=${branchA}`, owner);
      expect(own.body.months.map((m: any) => m.aggregatorOrders)).toEqual([680, 625, 571]);
    });
  });
});
