import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Fakes } from '../../../test/fakes';
import { TestApp } from '../../../test/support/test-app';
import { zonedTimeToUtc } from '../../shared/kernel/time';
import { ReservationSettingsRepository } from './infrastructure/settings.repository';
import { ReservationEvents } from './public';
import {
  auditActions,
  book,
  bookingBody,
  createLayout,
  createReservationTestApp,
  minutes,
  outboxEvents,
  payDeposit,
  refundResult,
  resetFakes,
  VenueLayout,
} from './testing/reservation-test-kit';

const API = '/api/v1/public/reservations';
const local = (date: string, time: string) => zonedTimeToUtc(date, time, 'Asia/Almaty');

describe('Reservation: deposit, holds, guest self-service, reminders (integration)', () => {
  let t: TestApp;
  let fakes: Fakes;
  let layout: VenueLayout;

  beforeAll(async () => {
    ({ t, fakes } = await createReservationTestApp());
  });
  afterAll(async () => t.close());
  beforeEach(async () => {
    await t.reset();
    resetFakes(fakes);
    t.clock.set(local('2026-10-01', '11:00'));
    layout = await createLayout(t);
  });

  /** VIP-зал на 03.10 19:00 (дедлайн бесплатной отмены — 02.10 19:00). */
  const vipBody = (overrides: Record<string, unknown> = {}) => bookingBody(layout, { venueId: layout.vip, guests: 8, date: '2026-10-03', ...overrides });
  const detail = async (token: string) => (await t.http().get(`${API}/${token}`)).body;
  const depositPayment = () => [...fakes.payments.payments.values()].find((p) => p.purpose === 'reservation_deposit')!;

  it('deposit flow: awaiting_deposit + online payment -> PaymentSucceeded -> confirmed', async () => {
    const res = await book(t, vipBody());
    expect(res).toMatchObject({
      status: 'awaiting_deposit',
      canPay: true,
      deposit: { amount: { amount: 5_000_000, currency: 'KZT' }, state: 'pending', outcome: 'none', paymentStatus: 'created' },
      policy: { cancellationDeadlineHours: 24, holdMinutes: 30 },
    });
    expect(res.holdExpiresAt).toBe(new Date(t.clock.now().getTime() + minutes(30)).toISOString());
    const payment = depositPayment();
    expect(payment).toMatchObject({ method: 'online', branchId: layout.branchId, expiresAt: new Date(res.holdExpiresAt) });
    expect(payment.amount.amount).toBe(5_000_000);
    expect(res.deposit.paymentUrl).toBe(payment.paymentUrl);
    expect(fakes.notifier.guest.map((g) => g.template)).toEqual(['reservation.awaiting_deposit']);
    expect(fakes.notifier.guest[0]!.params).toMatchObject({ deposit: '50 000 ₸', holdUntil: '11:30, 01.10.2026' });
    expect((fakes.notifier.guest[0]!.params as { paymentUrl: string }).paymentUrl).toContain(`/ru/reservations/${res.token}?pay=1`);
    const [created] = await outboxEvents(t, ReservationEvents.ReservationCreated);
    expect(created!.payload).toMatchObject({ status: 'awaiting_deposit', deposit: { amount: 5_000_000, currency: 'KZT' } });

    fakes.notifier.clear();
    await payDeposit(t, fakes, payment.id);
    const paid = await detail(res.token);
    expect(paid).toMatchObject({ status: 'confirmed', canPay: false, holdExpiresAt: null, deposit: { state: 'paid', paymentStatus: 'succeeded', paymentUrl: null } });
    expect(fakes.notifier.guest.map((g) => g.template)).toEqual(['reservation.confirmed']);
    const [changed] = await outboxEvents(t, ReservationEvents.ReservationStatusChanged);
    expect(changed!.payload).toMatchObject({ from: 'awaiting_deposit', to: 'confirmed', depositOutcome: 'none', reason: 'deposit_paid' });
    const actions = (await auditActions(t, await reservationId(res.token))).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['reservation.created', 'reservation.deposit_paid', 'reservation.status_changed']));

    // Повторная доставка того же платежа ничего не меняет; второй платёж возвращается полностью.
    await payDeposit(t, fakes, payment.id);
    expect(fakes.payments.refunds).toHaveLength(0);
    const second = await fakes.payments.createPayment({
      purpose: 'reservation_deposit',
      referenceId: payment.referenceId,
      branchId: layout.branchId,
      method: 'online',
      amount: payment.amount,
      description: 'dup',
      customer: { phone: null },
      returnUrl: null,
      idempotencyKey: 'duplicate-payment',
    });
    await payDeposit(t, fakes, second.id);
    expect(fakes.payments.refunds.map((r) => r.paymentId)).toEqual([second.id]);
    expect((await detail(res.token)).deposit.state).toBe('paid');
  });

  async function reservationId(token: string): Promise<string> {
    const row = await sql<{ id: string }>`select id from reservation.reservations where public_token = ${token}`.execute(t.database.rootConnection());
    return row.rows[0]!.id;
  }

  it('deposit + manual confirmation (yurt): paid -> pending with a new hold; staff has to confirm', async () => {
    const res = await book(t, bookingBody(layout, { venueId: layout.yurt, guests: 15, date: '2026-10-05' }));
    expect(res.status).toBe('awaiting_deposit');
    t.clock.advance(minutes(10));
    await payDeposit(t, fakes, depositPayment().id);
    const paid = await detail(res.token);
    expect(paid).toMatchObject({ status: 'pending', deposit: { state: 'paid' } });
    expect(paid.holdExpiresAt).toBe(new Date(t.clock.now().getTime() + minutes(60)).toISOString());
    expect(fakes.notifier.guest.map((g) => g.template)).toEqual(['reservation.awaiting_deposit', 'reservation.pending']);

    // Персонал не подтвердил вовремя — бронь снимается, оплаченный депозит возвращается.
    t.clock.advance(minutes(61));
    await t.runSchedule('reservation.expire_holds');
    const expired = await detail(res.token);
    expect(expired).toMatchObject({ status: 'expired', deposit: { state: 'refund_pending', outcome: 'refunded' } });
    expect(fakes.payments.refunds).toHaveLength(1);
  });

  it('hold expiry: unpaid reservation -> expired, payment cancelled, guest notified, venue freed; late payment is refunded', async () => {
    const res = await book(t, vipBody());
    const payment = depositPayment();
    t.clock.advance(minutes(29));
    await t.runSchedule('reservation.expire_holds');
    expect((await detail(res.token)).status).toBe('awaiting_deposit');

    t.clock.advance(minutes(2));
    await t.runSchedule('reservation.expire_holds');
    const expired = await detail(res.token);
    expect(expired).toMatchObject({ status: 'expired', canPay: false, canCancel: false, deposit: { state: 'unpaid', outcome: 'none' } });
    expect(fakes.payments.payments.get(payment.id)!.status).toBe('cancelled');
    expect(fakes.notifier.guest.map((g) => g.template)).toContain('reservation.expired');
    const [changed] = await outboxEvents(t, ReservationEvents.ReservationStatusChanged);
    expect(changed!.payload).toMatchObject({ from: 'awaiting_deposit', to: 'expired', reason: 'hold_expired' });

    // Место снова свободно.
    await book(t, vipBody({ customer: { name: 'Другой гость', phone: '+77019998877' } }));

    // Деньги пришли после снятия брони — полный возврат, бронь не меняется.
    await payDeposit(t, fakes, payment.id, { previousStatus: 'cancelled' });
    expect(fakes.payments.refunds.map((r) => r.paymentId)).toEqual([payment.id]);
    expect((await detail(res.token)).status).toBe('expired');
    const actions = (await auditActions(t, await reservationId(res.token))).map((a) => a.action);
    expect(actions).toContain('reservation.deposit_payment_refunded');
  });

  it('guest cancels before the deadline: cancelled, paid deposit refunded (RefundSucceeded -> refunded)', async () => {
    const res = await book(t, vipBody());
    const payment = depositPayment();
    await payDeposit(t, fakes, payment.id);
    fakes.notifier.clear();

    const before = await detail(res.token);
    expect(before).toMatchObject({ canCancel: true, depositOutcomeIfCancelled: 'refunded', cancellationDeadline: '2026-10-02T14:00:00.000Z' });

    const cancelled = await t.http().post(`${API}/${res.token}/cancel`).send({ reason: 'Планы изменились' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({
      status: 'cancelled',
      canCancel: false,
      cancelReason: 'Планы изменились',
      deposit: { state: 'refund_pending', outcome: 'refunded' },
    });
    expect(fakes.payments.refunds).toEqual([expect.objectContaining({ paymentId: payment.id })]);
    expect(fakes.notifier.guest.map((g) => g.template)).toEqual(['reservation.cancelled']);
    expect((fakes.notifier.guest[0]!.params as { depositNote: string }).depositNote).toContain('возвращён');
    expect(fakes.notifier.staff.map((s) => s.template)).toEqual(['staff.reservation_cancelled']);
    const [changed] = (await outboxEvents(t, ReservationEvents.ReservationStatusChanged)).slice(-1);
    expect(changed!.payload).toMatchObject({ from: 'confirmed', to: 'cancelled', depositOutcome: 'refunded', reason: 'Планы изменились' });

    await refundResult(t, { paymentId: payment.id, referenceId: await reservationId(res.token), amount: 5_000_000 }, true);
    expect((await detail(res.token)).deposit.state).toBe('refunded');
    const id = await reservationId(res.token);
    const audit = await auditActions(t, id);
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(['reservation.status_changed', 'reservation.deposit_refund_requested', 'reservation.deposit_refunded']),
    );
    expect(audit.find((a) => a.action === 'reservation.deposit_refund_requested')!.actor_kind).toBe('guest');

    // Повторная отмена — недопустимый переход.
    const again = await t.http().post(`${API}/${res.token}/cancel`).send({});
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('reservation.invalid_transition');
  });

  it('guest cancels after the deadline: cancelled, deposit retained (no refund)', async () => {
    const res = await book(t, vipBody());
    await payDeposit(t, fakes, depositPayment().id);
    // 03.10 10:00 — меньше 24 часов до начала (19:00).
    t.clock.set(local('2026-10-03', '10:00'));
    expect((await detail(res.token)).depositOutcomeIfCancelled).toBe('retained');
    const cancelled = await t.http().post(`${API}/${res.token}/cancel`).send({});
    expect(cancelled.body).toMatchObject({ status: 'cancelled', deposit: { state: 'retained', outcome: 'retained' } });
    expect(fakes.payments.refunds).toHaveLength(0);
    const [changed] = (await outboxEvents(t, ReservationEvents.ReservationStatusChanged)).slice(-1);
    expect(changed!.payload).toMatchObject({ to: 'cancelled', depositOutcome: 'retained' });
    expect((await auditActions(t, await reservationId(res.token))).map((a) => a.action)).toContain('reservation.deposit_retained');
  });

  it('guest cannot cancel after the start; unpaid deposit payment is cancelled on cancel', async () => {
    const table = await book(t, bookingBody(layout));
    t.clock.set(local('2026-10-02', '19:05'));
    const late = await t.http().post(`${API}/${table.token}/cancel`).send({});
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('reservation.cancel_after_start');

    t.clock.set(local('2026-10-01', '11:00'));
    const vip = await book(t, vipBody());
    const payment = depositPayment();
    const cancelled = await t.http().post(`${API}/${vip.token}/cancel`).send({});
    expect(cancelled.body).toMatchObject({ status: 'cancelled', deposit: { state: 'unpaid', outcome: 'none' } });
    expect(fakes.payments.payments.get(payment.id)!.status).toBe('cancelled');
    expect(fakes.payments.refunds).toHaveLength(0);
  });

  it('retry deposit payment: returns the pending payment, creates a new attempt after a failure', async () => {
    const res = await book(t, vipBody());
    const first = depositPayment();
    const same = await t.http().post(`${API}/${res.token}/pay`).send({});
    expect(same.status).toBe(200);
    expect(fakes.payments.payments.size).toBe(1);

    first.status = 'failed';
    const retry = await t.http().post(`${API}/${res.token}/pay`).send({});
    expect(retry.status).toBe(200);
    expect(fakes.payments.payments.size).toBe(2);
    const second = [...fakes.payments.payments.values()].find((p) => p.id !== first.id)!;
    expect(fakes.payments.byKey.get(`reservation:${await reservationId(res.token)}:deposit:2`)).toBe(second.id);
    expect(retry.body.deposit).toMatchObject({ paymentStatus: 'created', paymentUrl: second.paymentUrl });

    // Оплачена прежняя попытка (поздний колбэк) — новая попытка отменяется.
    await payDeposit(t, fakes, first.id, { previousStatus: 'failed' });
    expect((await detail(res.token)).status).toBe('confirmed');
    expect(fakes.payments.payments.get(second.id)!.status).toBe('cancelled');

    const notExpected = await t.http().post(`${API}/${res.token}/pay`).send({});
    expect(notExpected.status).toBe(409);
    expect(notExpected.body.error.code).toBe('reservation.payment_not_expected');
    expect((await t.http().post(`${API}/unknown/pay`).send({})).status).toBe(404);
  });

  it('reminder: job at start - reminderHoursBefore, sent only if the reservation is still confirmed', async () => {
    await t.get(ReservationSettingsRepository).upsert(layout.branchId, { reminderHoursBefore: 5, minLeadMinutes: 60, maxDaysAhead: 60, policyText: {} }, null);
    const kept = await book(t, bookingBody(layout));
    const dropped = await book(t, bookingBody(layout, { venueId: layout.table6, guests: 5, customer: { name: 'Ерлан', phone: '+77027654321' } }));
    await t.http().post(`${API}/${dropped.token}/cancel`).send({});
    fakes.notifier.clear();

    // 02.10 13:59 — ещё рано.
    t.clock.set(local('2026-10-02', '13:59'));
    await t.drain();
    expect(fakes.notifier.guest).toHaveLength(0);

    t.clock.set(local('2026-10-02', '14:00'));
    await t.drain();
    expect(fakes.notifier.guest.map((g) => g.template)).toEqual(['reservation.reminder']);
    expect(fakes.notifier.guest[0]!.params).toMatchObject({ number: kept.number, time: '19:00', date: '02.10.2026' });
    expect((fakes.notifier.guest[0]!.recipient as { phone: string }).phone).toBe('+77011234567');
    const sent = await sql<{ reminder_sent_at: Date | null }>`
      select reminder_sent_at from reservation.reservations where public_token = ${kept.token}`.execute(t.database.rootConnection());
    expect(sent.rows[0]!.reminder_sent_at).not.toBeNull();
  });

  it('no reminder when the reservation is made less than N hours before the start', async () => {
    t.clock.set(local('2026-10-02', '17:00'));
    await book(t, bookingBody(layout, { time: '19:00' }));
    const jobs = await sql<{ n: number }>`select count(*)::int as n from platform.outbox where topic = 'reservation.send_reminder'`.execute(
      t.database.rootConnection(),
    );
    expect(jobs.rows[0]!.n).toBe(0);
  });
});
