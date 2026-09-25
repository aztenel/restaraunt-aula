import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ClientIp, Public, RequestLocale } from '../../../../shared/infrastructure/http/decorators';
import { RateLimit } from '../../../../shared/infrastructure/rate-limit/rate-limit.guard';
import { Locale, LOCALES } from '../../../../shared/kernel/translatable';
import { AvailabilityQueries } from '../../application/availability.queries';
import { BookReservation } from '../../application/book-reservation.action';
import { CancelReservationByGuest, RetryDepositPayment } from '../../application/guest-reservation.actions';
import { ReservationQueries } from '../../application/reservation.queries';
import {
  AvailabilityDto,
  AvailabilityQueryDto,
  BookReservationDto,
  GuestCancelReservationDto,
  HallMapQueryDto,
  PublicHallMapDto,
  PublicReservationDto,
} from '../dto/public.dto';

/** Витрина: свободные места и карта залов филиала. */
@ApiTags('public')
@Public()
@Controller('public/branches/:branchSlug')
export class PublicAvailabilityController {
  constructor(private readonly availability: AvailabilityQueries) {}

  /** Только реально свободные места на дату, время и число гостей (+ альтернативное время, если мест нет). */
  @RateLimit('pricing')
  @Get('reservation-availability')
  @ApiOkResponse({ type: AvailabilityDto })
  check(@Param('branchSlug') slug: string, @Query() query: AvailabilityQueryDto, @RequestLocale() locale: Locale): Promise<AvailabilityDto> {
    return this.availability.availability(
      slug,
      { date: query.date, time: query.time, guests: query.guests, durationMinutes: query.durationMinutes, typeCode: query.typeCode },
      locale,
    );
  }

  /** Карта залов с местами для визуального выбора; с date/time/guests — флаг свободности у каждого места. */
  @RateLimit('pricing')
  @Get('halls')
  @ApiOkResponse({ type: PublicHallMapDto })
  halls(@Param('branchSlug') slug: string, @Query() query: HallMapQueryDto, @RequestLocale() locale: Locale): Promise<PublicHallMapDto> {
    const slot = query.date && query.time && query.guests ? { date: query.date, time: query.time, guests: query.guests, durationMinutes: query.durationMinutes } : null;
    return this.availability.hallMap(slug, locale, slot);
  }
}

/** Витрина: бронь, страница брони по публичному токену, отмена гостем, повторная оплата депозита. */
@ApiTags('public')
@Public()
@Controller('public/reservations')
export class PublicReservationsController {
  constructor(
    private readonly book: BookReservation,
    private readonly queries: ReservationQueries,
    private readonly cancelByGuest: CancelReservationByGuest,
    private readonly retryPayment: RetryDepositPayment,
  ) {}

  /**
   * Бронь. Проверка занятости и вставка — в одной транзакции с блокировкой места; занято — 409
   * reservation.venue_occupied. С депозитом — статус awaiting_deposit, ссылка на оплату появляется
   * асинхронно (опрашивайте GET /public/reservations/:token). Повтор с тем же idempotencyKey возвращает ту же бронь.
   */
  @RateLimit('forms')
  @Post()
  @ApiCreatedResponse({ type: PublicReservationDto })
  async create(@Body() dto: BookReservationDto, @ClientIp() ip: string | null): Promise<PublicReservationDto> {
    const { reservation } = await this.book.execute(dto, { ip });
    return this.queries.publicDetail(reservation.publicToken!, dto.locale);
  }

  @RateLimit('tracking')
  @Get(':token')
  @ApiQuery({ name: 'locale', required: false, enum: LOCALES })
  @ApiOkResponse({ type: PublicReservationDto })
  get(@Param('token') token: string, @RequestLocale() locale: Locale): Promise<PublicReservationDto> {
    return this.queries.publicDetail(token, locale);
  }

  /** Отмена гостем: до дедлайна — депозит возвращается, после — удерживается (depositOutcome). */
  @RateLimit('forms')
  @Post(':token/cancel')
  @HttpCode(200)
  @ApiQuery({ name: 'locale', required: false, enum: LOCALES })
  @ApiOkResponse({ type: PublicReservationDto })
  async cancel(@Param('token') token: string, @Body() dto: GuestCancelReservationDto, @RequestLocale() locale: Locale): Promise<PublicReservationDto> {
    await this.cancelByGuest.execute(token, { reason: dto.reason });
    return this.queries.publicDetail(token, locale);
  }

  /** Повторная оплата депозита (предыдущая попытка не прошла). */
  @RateLimit('forms')
  @Post(':token/pay')
  @HttpCode(200)
  @ApiQuery({ name: 'locale', required: false, enum: LOCALES })
  @ApiOkResponse({ type: PublicReservationDto })
  async pay(@Param('token') token: string, @RequestLocale() locale: Locale): Promise<PublicReservationDto> {
    await this.retryPayment.execute(token);
    return this.queries.publicDetail(token, locale);
  }
}
