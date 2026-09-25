import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentActor, RequirePermissions } from '../../../../shared/infrastructure/http/decorators';
import { Actor } from '../../../../shared/kernel/actor';
import { pageRequest } from '../../../../shared/kernel/pagination';
import { Permission } from '../../../../shared/kernel/permissions';
import { AvailabilityQueries } from '../../application/availability.queries';
import { CreateStaffReservation } from '../../application/create-staff-reservation.action';
import { ReservationQueries } from '../../application/reservation.queries';
import {
  CancelReservation,
  ConfirmReservation,
  MarkReservationArrived,
  MarkReservationNoShow,
} from '../../application/reservation-status.actions';
import { RescheduleReservation } from '../../application/reschedule-reservation.action';
import { AdminAvailabilityDto, AdminAvailabilityQueryDto } from '../dto/admin-availability.dto';
import {
  AdminReservationsQueryDto,
  CancelReservationDto,
  ConfirmReservationDto,
  CreateStaffReservationDto,
  ReservationDetailDto,
  ReservationsPageDto,
  RescheduleReservationDto,
  TimelineDto,
  TimelineQueryDto,
} from '../dto/reservations.dto';

/**
 * Брони в админке: очередь и поиск, календарь / карта зала (включая банкеты), бронь по телефону,
 * подтверждение, отмена (решение по депозиту), отметки «пришли / не пришли», перенос.
 * Просмотр — reservations.view, действия — reservations.manage (в филиале брони).
 */
@ApiTags('admin')
@ApiBearerAuth('staff')
@Controller('admin/reservations')
export class AdminReservationsController {
  constructor(
    private readonly queries: ReservationQueries,
    private readonly createReservation: CreateStaffReservation,
    private readonly confirmReservation: ConfirmReservation,
    private readonly cancelReservation: CancelReservation,
    private readonly markArrived: MarkReservationArrived,
    private readonly markNoShow: MarkReservationNoShow,
    private readonly reschedule: RescheduleReservation,
    private readonly availability: AvailabilityQueries,
  ) {}

  @Get()
  @RequirePermissions(Permission.ReservationsView)
  @ApiOkResponse({ type: ReservationsPageDto })
  list(@CurrentActor() actor: Actor, @Query() query: AdminReservationsQueryDto): Promise<ReservationsPageDto> {
    return this.queries.list(
      actor,
      {
        branchId: query.branchId,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
        statuses: query.status,
        kind: query.kind,
        source: query.source,
        venueId: query.venueId,
        hallId: query.hallId,
        q: query.q,
        needsMark: query.needsMark,
      },
      pageRequest(query.page, query.perPage),
    );
  }

  /** Занятость мест филиала на локальную дату (брони и банкеты) — для календаря и карты зала. */
  @Get('timeline')
  @RequirePermissions(Permission.ReservationsView)
  @ApiOkResponse({ type: TimelineDto })
  timeline(@CurrentActor() actor: Actor, @Query() query: TimelineQueryDto): Promise<TimelineDto> {
    return this.queries.timeline(actor, query.branchId, query.date);
  }

  /**
   * Свободные места для оператора (бронь по телефону, перенос): включая места только для брони через
   * оператора, без ограничений витрины по упреждению и горизонту; часы работы соблюдаются.
   */
  @Get('availability')
  @RequirePermissions(Permission.ReservationsManage)
  @ApiOkResponse({ type: AdminAvailabilityDto })
  adminAvailability(@CurrentActor() actor: Actor, @Query() query: AdminAvailabilityQueryDto): Promise<AdminAvailabilityDto> {
    actor.assertCan(Permission.ReservationsManage, query.branchId);
    return this.availability.adminAvailability(query.branchId, {
      date: query.date,
      time: query.time,
      guests: query.guests,
      durationMinutes: query.durationMinutes,
      typeCode: query.typeCode,
      hallId: query.hallId,
      excludeReservationId: query.excludeReservationId,
    });
  }

  @Get(':id')
  @RequirePermissions(Permission.ReservationsView)
  @ApiOkResponse({ type: ReservationDetailDto })
  detail(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<ReservationDetailDto> {
    return this.queries.detail(actor, id);
  }

  /** Бронь оператором (по телефону): можно места без онлайн-брони; депозит — ссылка на оплату или отказ с причиной. */
  @Post()
  @RequirePermissions(Permission.ReservationsManage)
  @ApiCreatedResponse({ type: ReservationDetailDto })
  async create(@CurrentActor() actor: Actor, @Body() dto: CreateStaffReservationDto): Promise<ReservationDetailDto> {
    const { reservation } = await this.createReservation.execute(actor, dto);
    return this.queries.detail(actor, reservation.id);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @RequirePermissions(Permission.ReservationsManage)
  @ApiOkResponse({ type: ReservationDetailDto })
  async confirm(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ConfirmReservationDto): Promise<ReservationDetailDto> {
    await this.confirmReservation.execute(actor, id, dto);
    return this.queries.detail(actor, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions(Permission.ReservationsManage)
  @ApiOkResponse({ type: ReservationDetailDto })
  async cancel(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelReservationDto): Promise<ReservationDetailDto> {
    await this.cancelReservation.execute(actor, id, dto);
    return this.queries.detail(actor, id);
  }

  @Post(':id/arrived')
  @HttpCode(200)
  @RequirePermissions(Permission.ReservationsManage)
  @ApiOkResponse({ type: ReservationDetailDto })
  async arrived(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<ReservationDetailDto> {
    await this.markArrived.execute(actor, id);
    return this.queries.detail(actor, id);
  }

  @Post(':id/no-show')
  @HttpCode(200)
  @RequirePermissions(Permission.ReservationsManage)
  @ApiOkResponse({ type: ReservationDetailDto })
  async noShow(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<ReservationDetailDto> {
    await this.markNoShow.execute(actor, id);
    return this.queries.detail(actor, id);
  }

  /** Перенос / пересадка: другое место того же филиала, время, длительность, гости. */
  @Post(':id/reschedule')
  @HttpCode(200)
  @RequirePermissions(Permission.ReservationsManage)
  @ApiOkResponse({ type: ReservationDetailDto })
  async move(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RescheduleReservationDto,
  ): Promise<ReservationDetailDto> {
    await this.reschedule.execute(actor, id, dto);
    return this.queries.detail(actor, id);
  }
}
