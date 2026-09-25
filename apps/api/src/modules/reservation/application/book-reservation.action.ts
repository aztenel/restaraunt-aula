import { Injectable } from '@nestjs/common';
import { Database } from '../../../shared/infrastructure/database/database';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { ConflictError, ValidationError } from '../../../shared/kernel/errors';
import { newId } from '../../../shared/kernel/ids';
import { randomToken } from '../../../shared/kernel/random';
import { addMinutes } from '../../../shared/kernel/time';
import { Locale } from '../../../shared/kernel/translatable';
import { CustomerDirectory, PhoneVerification } from '../../customers/public';
import { slotRange } from '../domain/availability';
import { assertSameBookingRequest, assertSlotAllowed, assertVenueBookable } from '../domain/booking';
import { guestContact, normalizeFreeText } from '../domain/contact';
import { Reservation } from '../domain/reservation';
import { assertCapacity } from '../domain/venue';
import { ReservationRepository } from '../infrastructure/reservation.repository';
import { BookingContext, bookableOf } from './booking-context';
import { DepositPayments } from './deposit-payments';
import { ReservationNumbers } from './reservation-numbers';
import { ReservationRecorder } from './reservation-recorder';
import { SlotGuard } from './slot-guard';

export interface BookReservationInput {
  branchId: string;
  venueId: string;
  /** Локальные дата и время филиала: '2026-10-25', '19:30'. */
  date: string;
  time: string;
  guests: number;
  /** Длительность, минут; по умолчанию — правило места. */
  durationMinutes?: number | null;
  customer: { name: string; phone: string; email?: string | null };
  comment?: string | null;
  occasion?: string | null;
  phoneVerificationToken?: string | null;
  consent: { personalData: boolean; marketing?: boolean };
  locale: Locale;
  idempotencyKey: string;
}

export interface BookingResult {
  reservation: Reservation;
  /** Повтор запроса с тем же ключом идемпотентности — вернули ранее созданную бронь. */
  replayed: boolean;
}

/**
 * Бронь с витрины. Одна транзакция: гость (по телефону) + согласие, блокировка строки места
 * (select ... for update), проверка пересечения [начало, конец + уборка) и вставка; exclusion constraint
 * в БД — вторая линия защиты. Статус: депозит -> awaiting_deposit + онлайн-платёж; ручное подтверждение
 * места -> pending; иначе confirmed. Без депозита может требоваться подтверждение телефона (настройка филиала).
 */
@Injectable()
export class BookReservation {
  constructor(
    private readonly context: BookingContext,
    private readonly reservations: ReservationRepository,
    private readonly guard: SlotGuard,
    private readonly numbers: ReservationNumbers,
    private readonly deposits: DepositPayments,
    private readonly recorder: ReservationRecorder,
    private readonly customers: CustomerDirectory,
    private readonly phoneVerification: PhoneVerification,
    private readonly database: Database,
    private readonly clock: Clock,
  ) {}

  async execute(input: BookReservationInput, request: { ip: string | null }): Promise<BookingResult> {
    if (input.consent?.personalData !== true) {
      throw new ValidationError('consent.required', 'Consent to personal data processing is required');
    }
    const contact = guestContact(input.customer, { nameRequired: true });
    const existing = await this.reservations.findByIdempotencyKey(input.idempotencyKey);

    const branch = await this.context.branch(input.branchId);
    if (!branch.isActive || !branch.settings.acceptsReservations) {
      throw new ConflictError('reservation.branch_not_accepting', 'The branch does not accept online reservations');
    }
    const venue = await this.context.venue(input.venueId);
    const range = slotRange(input.date, input.time, branch.timezone, input.durationMinutes ?? venue.rules.durationMinutes);
    if (existing) {
      assertSameBookingRequest(
        { venueId: existing.venueId, start: existing.start, phone: existing.customer.phone },
        { venueId: venue.id, start: range.start, phone: contact.phone },
      );
      return { reservation: existing, replayed: true };
    }
    assertVenueBookable(bookableOf(venue), branch.id, 'web');
    assertCapacity(input.guests, venue.capacityMin, venue.capacityMax, { checkMinimum: true });
    assertSlotAllowed(range, await this.context.window(branch, 'web'));
    const comment = normalizeFreeText(input.comment, 'comment');
    const occasion = normalizeFreeText(input.occasion, 'occasion', 100);
    const deposit = venue.deposit;
    if (!deposit && branch.settings.requirePhoneVerificationForReservations) {
      await this.phoneVerification.assertVerified(contact.phone!, input.phoneVerificationToken);
    }
    const actor = Actor.guest();

    return this.database.transaction(async () => {
      const now = this.clock.now();
      const { customerId } = await this.customers.identify({
        phone: contact.phone!,
        name: contact.name,
        email: contact.email,
        locale: input.locale,
      });
      await this.customers.recordConsent({
        customerId,
        kind: 'personal_data',
        granted: true,
        textVersion: await this.customers.currentConsentVersion('personal_data'),
        source: 'web',
        ip: request.ip,
      });
      if (input.consent.marketing) {
        await this.customers.recordConsent({
          customerId,
          kind: 'marketing',
          granted: true,
          textVersion: await this.customers.currentConsentVersion('marketing'),
          source: 'web',
          ip: request.ip,
        });
      }

      // Конкурентная бронь: блокировка места -> проверка пересечения -> вставка, всё в этой транзакции.
      await this.guard.lock([venue.id]);
      const raced = await this.reservations.findByIdempotencyKey(input.idempotencyKey);
      if (raced) {
        assertSameBookingRequest(
          { venueId: raced.venueId, start: raced.start, phone: raced.customer.phone },
          { venueId: venue.id, start: range.start, phone: contact.phone },
        );
        return { reservation: raced, replayed: true };
      }
      await this.guard.assertFree(venue.id, range.start, addMinutes(range.end, venue.rules.cleanupMinutes));

      const reservation = Reservation.create(
        {
          id: newId(),
          number: await this.numbers.next(branch, now),
          branchId: branch.id,
          venueId: venue.id,
          kind: 'regular',
          source: 'web',
          start: range.start,
          end: range.end,
          rules: venue.rules,
          guests: input.guests,
          customer: { ...contact, id: customerId },
          comment,
          occasion,
          locale: input.locale,
          publicToken: randomToken(24),
          idempotencyKey: input.idempotencyKey,
          requiresConfirmation: venue.rules.requiresManualConfirmation,
          deposit,
          createdByUserId: null,
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
