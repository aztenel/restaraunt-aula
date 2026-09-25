import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ClientIp, CurrentActor, RequirePermissions } from '../../../../shared/infrastructure/http/decorators';
import { MoneyInputDto } from '../../../../shared/infrastructure/http/api-types';
import { Actor } from '../../../../shared/kernel/actor';
import { pageRequest } from '../../../../shared/kernel/pagination';
import { Permission } from '../../../../shared/kernel/permissions';
import { BanquetQueries, PipelineColumn, RequestDetailView, SlaStatsView, CalendarView, ManagerView } from '../../application/banquet.queries';
import { CreateBanquetRequest } from '../../application/create-request.action';
import { RefundBanquetPayment } from '../../application/invoice.actions';
import {
  AddBanquetActivity,
  AssignBanquetManager,
  SetPrepaymentAmount,
  TransitionBanquetRequest,
  UpdateBanquetRequest,
} from '../../application/request.actions';
import { ReleaseBanquetVenue, SetBanquetVenue } from '../../application/venue.actions';
import { RequestSummaryView } from '../../application/views';
import { Page } from '../../../../shared/kernel/pagination';
import {
  BanquetActivityInputDto,
  BanquetAdminCreateRequestDto,
  BanquetAssignDto,
  BanquetCalendarQueryDto,
  moneyOrNull,
  parseStatuses,
  BanquetPipelineQueryDto,
  BanquetPrepaymentInputDto,
  BanquetRefundInputDto,
  BanquetRequestsQueryDto,
  BanquetSetVenueDto,
  BanquetSlaQueryDto,
  BanquetTransitionDto,
  BanquetUpdateRequestDto,
} from '../dto';
import {
  BanquetCalendarDto,
  BanquetIdDto,
  BanquetManagerDto,
  BanquetPipelineColumnDto,
  BanquetRefundResultDto,
  BanquetRequestDetailDto,
  BanquetRequestsPageDto,
  BanquetSlaStatsDto,
} from '../responses.dto';

/**
 * Банкетные заявки в админке. Банкетные менеджеры и глобальные роли видят все заявки,
 * управляющий филиалом — заявки своего филиала (banquets.view в филиале).
 */
@ApiTags('admin')
@ApiBearerAuth('staff')
@Controller('admin/banquets')
export class AdminBanquetRequestsController {
  constructor(
    private readonly queries: BanquetQueries,
    private readonly createRequest: CreateBanquetRequest,
    private readonly updateRequest: UpdateBanquetRequest,
    private readonly transition: TransitionBanquetRequest,
    private readonly assign: AssignBanquetManager,
    private readonly addActivity: AddBanquetActivity,
    private readonly setVenue: SetBanquetVenue,
    private readonly releaseVenue: ReleaseBanquetVenue,
    private readonly setPrepayment: SetPrepaymentAmount,
    private readonly refund: RefundBanquetPayment,
  ) {}

  @Get('requests')
  @RequirePermissions(Permission.BanquetsView)
  @ApiOkResponse({ type: BanquetRequestsPageDto })
  list(@CurrentActor() actor: Actor, @Query() q: BanquetRequestsQueryDto): Promise<Page<RequestSummaryView>> {
    return this.queries.list(
      actor,
      {
        status: parseStatuses(q.status),
        managerId: q.managerId,
        branchId: q.branchId,
        dateFrom: q.dateFrom,
        dateTo: q.dateTo,
        q: q.q,
        isOffsite: q.offsite,
        slaBreached: q.slaBreached,
      },
      pageRequest(q.page, q.perPage),
    );
  }

  /** Воронка: колонки по статусам. */
  @Get('pipeline')
  @RequirePermissions(Permission.BanquetsView)
  @ApiOkResponse({ type: [BanquetPipelineColumnDto] })
  pipeline(@CurrentActor() actor: Actor, @Query() q: BanquetPipelineQueryDto): Promise<PipelineColumn[]> {
    return this.queries.pipeline(actor, { branchId: q.branchId, managerId: q.managerId, dateFrom: q.dateFrom, dateTo: q.dateTo });
  }

  /** Менеджеры для назначения (с нагрузкой). */
  @Get('managers')
  @RequirePermissions(Permission.BanquetsView)
  @ApiOkResponse({ type: [BanquetManagerDto] })
  managers(@CurrentActor() actor: Actor): Promise<ManagerView[]> {
    return this.queries.managers(actor);
  }

  @Get('calendar')
  @RequirePermissions(Permission.BanquetsView)
  @ApiOkResponse({ type: BanquetCalendarDto })
  calendar(@CurrentActor() actor: Actor, @Query() q: BanquetCalendarQueryDto): Promise<CalendarView> {
    return this.queries.calendar(actor, q);
  }

  /** SLA первого ответа (цель — 95% за 30 минут) за период, всего и по менеджерам. */
  @Get('sla-stats')
  @RequirePermissions(Permission.BanquetsView)
  @ApiOkResponse({ type: BanquetSlaStatsDto })
  sla(@CurrentActor() actor: Actor, @Query() q: BanquetSlaQueryDto): Promise<SlaStatsView> {
    return this.queries.slaStats(actor, q);
  }

  /** Заявка из админки (звонок, визит): source=admin. */
  @Post('requests')
  @RequirePermissions(Permission.BanquetsManage)
  @ApiCreatedResponse({ type: BanquetRequestDetailDto })
  async create(@CurrentActor() actor: Actor, @Body() dto: BanquetAdminCreateRequestDto, @ClientIp() ip: string | null): Promise<RequestDetailView> {
    const request = await this.createRequest.execute(
      actor,
      {
        eventDate: dto.eventDate,
        eventTime: dto.eventTime ?? null,
        eventType: dto.eventType,
        guests: dto.guests,
        branchId: dto.branchId ?? null,
        isOffsite: dto.offsite ?? false,
        offsiteAddress: dto.address ?? null,
        budget: moneyOrNull(dto.budget),
        contact: dto.contact,
        wishes: dto.wishes ?? null,
        locale: dto.locale ?? 'ru',
        consent: dto.consent ?? null,
        managerId: dto.managerId ?? null,
        companyId: dto.companyId ?? null,
      },
      { source: 'admin', ip },
    );
    return this.queries.detail(actor, request.id);
  }

  @Get('requests/:id')
  @RequirePermissions(Permission.BanquetsView)
  @ApiOkResponse({ type: BanquetRequestDetailDto })
  detail(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<RequestDetailView> {
    return this.queries.detail(actor, id);
  }

  @Patch('requests/:id')
  @RequirePermissions(Permission.BanquetsManage)
  @ApiOkResponse({ type: BanquetRequestDetailDto })
  async update(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BanquetUpdateRequestDto): Promise<RequestDetailView> {
    await this.updateRequest.execute(actor, id, {
      eventDate: dto.eventDate,
      eventTime: dto.eventTime,
      eventType: dto.eventType,
      guests: dto.guests,
      budget: dto.budget === undefined ? undefined : moneyOrNull(dto.budget),
      branchId: dto.branchId,
      isOffsite: dto.offsite,
      offsiteAddress: dto.address,
      wishes: dto.wishes,
      contact: dto.contact,
      companyId: dto.companyId,
    });
    return this.queries.detail(actor, id);
  }

  /** Смена статуса по автомату воронки (quote_sent — отправка сметы, cancelled — отмена с причиной). */
  @Post('requests/:id/transition')
  @HttpCode(200)
  @RequirePermissions(Permission.BanquetsManage)
  @ApiOkResponse({ type: BanquetRequestDetailDto })
  async changeStatus(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BanquetTransitionDto): Promise<RequestDetailView> {
    await this.transition.execute(actor, id, { to: dto.to, reason: dto.reason ?? null });
    return this.queries.detail(actor, id);
  }

  @Post('requests/:id/assign')
  @HttpCode(200)
  @RequirePermissions(Permission.BanquetsManage)
  @ApiOkResponse({ type: BanquetRequestDetailDto })
  async reassign(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BanquetAssignDto): Promise<RequestDetailView> {
    await this.assign.execute(actor, id, dto.managerId);
    return this.queries.detail(actor, id);
  }

  /** Заметка, звонок, контакт, встреча (звонок/контакт/встреча — первый ответ по SLA). */
  @Post('requests/:id/activities')
  @RequirePermissions(Permission.BanquetsManage)
  @ApiCreatedResponse({ type: BanquetIdDto })
  async activity(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BanquetActivityInputDto): Promise<BanquetIdDto> {
    return { id: await this.addActivity.execute(actor, id, { kind: dto.kind, text: dto.text ?? null }) };
  }

  /** Зал и время: занятость ставится сразу в модуле бронирования (конфликт — 409). */
  @Put('requests/:id/venue')
  @RequirePermissions(Permission.BanquetsManage)
  @ApiOkResponse({ type: BanquetRequestDetailDto })
  async venue(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BanquetSetVenueDto): Promise<RequestDetailView> {
    await this.setVenue.execute(actor, id, { venueId: dto.venueId, date: dto.date ?? null, startTime: dto.startTime, endTime: dto.endTime });
    return this.queries.detail(actor, id);
  }

  @Delete('requests/:id/venue')
  @RequirePermissions(Permission.BanquetsManage)
  @ApiOkResponse({ type: BanquetRequestDetailDto })
  async release(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<RequestDetailView> {
    await this.releaseVenue.execute(actor, id);
    return this.queries.detail(actor, id);
  }

  @Put('requests/:id/prepayment')
  @RequirePermissions(Permission.BanquetsManage)
  @ApiOkResponse({ type: BanquetRequestDetailDto })
  async prepayment(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BanquetPrepaymentInputDto): Promise<RequestDetailView> {
    await this.setPrepayment.execute(actor, id, dto.amount ? MoneyInputDto.toMoney(dto.amount) : null);
    return this.queries.detail(actor, id);
  }

  /** Возврат полученной оплаты (финансы, собственник: payments.refund). */
  @Post('requests/:id/refunds')
  @RequirePermissions(Permission.PaymentsRefund)
  @ApiCreatedResponse({ type: BanquetRefundResultDto })
  async refundPayment(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BanquetRefundInputDto): Promise<BanquetRefundResultDto> {
    const refund = await this.refund.execute(actor, id, {
      paymentId: dto.paymentId,
      amount: dto.amount ? MoneyInputDto.toMoney(dto.amount) : null,
      reason: dto.reason,
      idempotencyKey: dto.idempotencyKey,
    });
    return { ...refund, amount: refund.amount.toJSON() };
  }
}
