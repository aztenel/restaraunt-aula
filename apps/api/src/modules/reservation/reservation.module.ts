import { Global, Module } from '@nestjs/common';
import { AvailabilityQueries } from './application/availability.queries';
import { HoldVenueForBanquet, MoveBanquetHold, ReleaseBanquetHold } from './application/banquet-holds.actions';
import { BookReservation } from './application/book-reservation.action';
import { BookingContext } from './application/booking-context';
import { CreateStaffReservation } from './application/create-staff-reservation.action';
import { ApplyDepositPayment, RecordDepositRefund } from './application/deposit-events.actions';
import { DepositPayments } from './application/deposit-payments';
import { CancelReservationByGuest, RetryDepositPayment } from './application/guest-reservation.actions';
import { CreateHall, DeleteHall, UpdateHall } from './application/hall.actions';
import { AddVenuePhoto, DeleteVenuePhoto, SetHallBackground } from './application/image.actions';
import { AnonymizeReservationGuest, ExpireReservationHolds, SendReservationReminder } from './application/maintenance.actions';
import { MoveReservationSlot } from './application/move-reservation-slot';
import { ReservationAccess } from './application/reservation-access';
import { ReservationLinks } from './application/reservation-links';
import { ReservationNumbers } from './application/reservation-numbers';
import { ReservationRecorder } from './application/reservation-recorder';
import { ReservationReminders } from './application/reservation-reminders';
import {
  CancelReservation,
  ConfirmReservation,
  MarkReservationArrived,
  MarkReservationNoShow,
} from './application/reservation-status.actions';
import { ReservationViewMapper } from './application/reservation-views';
import { ReservationQueries } from './application/reservation.queries';
import { RescheduleReservation } from './application/reschedule-reservation.action';
import { UpdateReservationSettings } from './application/settings.actions';
import { SlotGuard } from './application/slot-guard';
import { VenueAvailabilityService } from './application/venue-availability.service';
import { VenueConfigQueries } from './application/venue-config.queries';
import { CreateVenueType, DeleteVenueType, UpdateVenueType } from './application/venue-type.actions';
import { CreateVenue, DeleteVenue, UpdateVenue } from './application/venue.actions';
import { ReservationCustomerHandlers } from './handlers/reservation-customer.handlers';
import { ReservationPaymentHandlers } from './handlers/reservation-payment.handlers';
import { ReservationJobHandlers, ReservationSchedules } from './handlers/reservation.jobs';
import { AdminReservationsController } from './http/admin/reservations.controller';
import {
  AdminHallsController,
  AdminReservationSettingsController,
  AdminVenuesController,
  AdminVenueTypesController,
} from './http/admin/venues.controller';
import { PublicAvailabilityController, PublicReservationsController } from './http/public/reservations.controller';
import { HallRepository } from './infrastructure/hall.repository';
import { ReservationImageStorage } from './infrastructure/image-storage';
import { ReservationRepository } from './infrastructure/reservation.repository';
import { ReservationSettingsRepository } from './infrastructure/settings.repository';
import { VenueTypeRepository } from './infrastructure/venue-type.repository';
import { VenueRepository } from './infrastructure/venue.repository';
import { VenueAvailability } from './public';

/**
 * Reservation: залы и места (типы мест — справочник), бронирование столов и залов с транзакционной
 * защитой от двойной брони (блокировка места + exclusion constraint), депозиты (онлайн-оплата через
 * Payments, возврат / удержание по правилам отмены), напоминания, самообслуживание гостя, календарь
 * занятости. Банкеты занимают залы тем же механизмом (контракт VenueAvailability).
 * Внешних интеграций нет: оплата — модуль Payments, уведомления — Notifications.
 */
@Global()
@Module({
  controllers: [
    AdminVenueTypesController,
    AdminHallsController,
    AdminVenuesController,
    AdminReservationSettingsController,
    AdminReservationsController,
    PublicAvailabilityController,
    PublicReservationsController,
  ],
  providers: [
    VenueTypeRepository,
    HallRepository,
    VenueRepository,
    ReservationRepository,
    ReservationSettingsRepository,
    ReservationImageStorage,
    ReservationLinks,
    ReservationNumbers,
    ReservationViewMapper,
    ReservationReminders,
    ReservationRecorder,
    ReservationAccess,
    BookingContext,
    SlotGuard,
    DepositPayments,
    MoveReservationSlot,
    CreateVenueType,
    UpdateVenueType,
    DeleteVenueType,
    CreateHall,
    UpdateHall,
    DeleteHall,
    CreateVenue,
    UpdateVenue,
    DeleteVenue,
    AddVenuePhoto,
    DeleteVenuePhoto,
    SetHallBackground,
    UpdateReservationSettings,
    BookReservation,
    CreateStaffReservation,
    ConfirmReservation,
    CancelReservation,
    MarkReservationArrived,
    MarkReservationNoShow,
    RescheduleReservation,
    CancelReservationByGuest,
    RetryDepositPayment,
    ApplyDepositPayment,
    RecordDepositRefund,
    ExpireReservationHolds,
    SendReservationReminder,
    AnonymizeReservationGuest,
    HoldVenueForBanquet,
    MoveBanquetHold,
    ReleaseBanquetHold,
    AvailabilityQueries,
    ReservationQueries,
    VenueConfigQueries,
    ReservationPaymentHandlers,
    ReservationCustomerHandlers,
    ReservationJobHandlers,
    ReservationSchedules,
    { provide: VenueAvailability, useClass: VenueAvailabilityService },
  ],
  exports: [VenueAvailability],
})
export class ReservationModule {}
