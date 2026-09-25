import { Injectable } from '@nestjs/common';
import { Database } from '../../../shared/infrastructure/database/database';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { ValidationError } from '../../../shared/kernel/errors';
import { newId } from '../../../shared/kernel/ids';
import { Permission } from '../../../shared/kernel/permissions';
import { randomToken } from '../../../shared/kernel/random';
import { addMinutes } from '../../../shared/kernel/time';
import { DEFAULT_LOCALE, Locale } from '../../../shared/kernel/translatable';
import { CustomerDirectory } from '../../customers/public';
import { slotRange } from '../domain/availability';
import { assertSameBookingRequest, assertSlotAllowed, assertVenueBookable } from '../domain/booking';
import { guestContact, normalizeFreeText } from '../domain/contact';
import { Reservation } from '../domain/reservation';
import { assertCapacity } from '../domain/venue';
import { ReservationRepository } from '../infrastructure/reservation.repository';
import { BookingContext, bookableOf } from './booking-context';
import { BookingResult } from './book-reservation.action';
import { DepositPayments } from './deposit-payments';
import { ReservationNumbers } from './reservation-numbers';
import { ReservationRecorder } from './reservation-recorder';
import { SlotGuard } from './slot-guard';

/** Депозит при брони оператором: отправить гостю ссылку на оплату или отказаться от депозита (с причиной). */
export type StaffDepositMode = 'payment_link' | 'waive';

export interface CreateStaffReservationInput {
  branchId: string;
  venueId: string;
  date: string;
  time: string;
  guests: number;
  durationMinutes?: number | null;
  customer: { name?: string | null; phone: string; email?: string | null };
  comment?: string | null;
  occasion?: string | null;
  /** Служебная заметка персонала (гость не видит). */
  note?: string | null;
  locale?: Locale;
  deposit?: { mode: StaffDepositMode; waiveReason?: string | null } | null;
  /** Согласие, полученное оператором по телефону (фиксируется в базе гостей с источником phone). */
  consent?: { personalData?: boolean; marketing?: boolean } | null;
  idempotencyKey?: string | null;
}

/**
 * Бронь оператором (звонок, мессенджер, гость у стойки). Можно бронировать места без онлайн-брони,
 * без ограничения по упреждению и горизонту (часы работы соблюдаются). Та же блокировка места
 * и проверка пересечений, что и на витрине. Бронь сразу подтверждена оператором; если у места депозит —
 * ссылка на оплату (awaiting_deposit) или отказ от депозита с причиной (журнал действий).
 */
@Injectable()
export class CreateStaffReservation {
  constructor(
    private readonly context: BookingContext,
    private readonly reservations: ReservationRepository,
    private readonly guard: SlotGuard,
    private readonly numbers: ReservationNumbers,
    private readonly deposits: DepositPayments,
    private readonly recorder: ReservationRecorder,
    private readonly customers: CustomerDirectory,
    private readonly database: Database,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, input: CreateStaffReservationInput): Promise<BookingResult> {
    actor.assertCan(Permission.ReservationsManage, input.branchId);
    const contact = guestContact(input.customer, { nameRequired: false });
    const branch = await this.context.branch(input.branchId);
    const venue = await this.context.venue(input.venueId);
    const range = slotRange(input.date, input.time, branch.timezone, input.durationMinutes ?? venue.rules.durationMinutes);
    const idempotencyKey = input.idempotencyKey?.trim() || null;
    if (idempotencyKey) {
      const existing = await this.reservations.findByIdempotencyKey(idempotencyKey);
      if (existing) {
        assertSameBookingRequest(
          { venueId: existing.venueId, start: existing.start, phone: existing.customer.phone },
          { venueId: venue.id, start: range.start, phone: contact.phone },
        );
        return { reservation: existing, replayed: true };
      }
    }
    assertVenueBookable(bookableOf(venue), branch.id, 'admin');
    assertCapacity(input.guests, venue.capacityMin, venue.capacityMax, { checkMinimum: false });
    assertSlotAllowed(range, await this.context.window(branch, 'admin'));
    const comment = normalizeFreeText(input.comment, 'comment');
    const occasion = normalizeFreeText(input.occasion, 'occasion', 100);
    const note = normalizeFreeText(input.note, 'note');
    let waiveReason: string | null = null;
    if (venue.deposit) {
      if (!input.deposit) {
        throw new ValidationError('reservation.deposit_decision_required', 'Venue requires a deposit: send a payment link or waive it with a reason');
      }
      if (input.deposit.mode === 'waive') {
        waiveReason = normalizeFreeText(input.deposit.waiveReason, 'waiveReason', 500);
        if (!waiveReason) throw new ValidationError('reservation.deposit_waive_reason_required', 'Waiving the deposit requires a reason');
      }
    }
    const locale = input.locale ?? DEFAULT_LOCALE;

    return this.database.transaction(async () => {
      const now = this.clock.now();
      const { customerId } = await this.customers.identify({ phone: contact.phone!, name: contact.name, email: contact.email, locale });
      for (const kind of ['personal_data', 'marketing'] as const) {
        const granted = kind === 'personal_data' ? input.consent?.personalData : input.consent?.marketing;
        if (granted !== true) continue;
        await this.customers.recordConsent({
          customerId,
          kind,
          granted: true,
          textVersion: await this.customers.currentConsentVersion(kind),
          source: 'phone',
        });
      }

      await this.guard.lock([venue.id]);
      if (idempotencyKey) {
        const raced = await this.reservations.findByIdempotencyKey(idempotencyKey);
        if (raced) return { reservation: raced, replayed: true };
      }
      await this.guard.assertFree(venue.id, range.start, addMinutes(range.end, venue.rules.cleanupMinutes));

      const reservation = Reservation.create(
        {
          id: newId(),
          number: await this.numbers.next(branch, now),
          branchId: branch.id,
          venueId: venue.id,
          kind: 'regular',
          source: 'admin',
          start: range.start,
          end: range.end,
          rules: venue.rules,
          guests: input.guests,
          customer: { ...contact, id: customerId },
          comment,
          occasion,
          note,
          locale,
          publicToken: randomToken(24),
          idempotencyKey,
          // Бронь оформил сотрудник — ручное подтверждение уже состоялось.
          requiresConfirmation: false,
          deposit: venue.deposit,
          depositWaiveReason: waiveReason,
          createdByUserId: actor.userId,
        },
        now,
      );
      await this.reservations.insert(reservation);
      if (reservation.status === 'awaiting_deposit') {
        await this.deposits.createFor(reservation);
        await this.reservations.update(reservation);
      }
      await this.recorder.created(reservation, { actor, branch, venue });
      return { reservation, replayed: false };
    });
  }
}
