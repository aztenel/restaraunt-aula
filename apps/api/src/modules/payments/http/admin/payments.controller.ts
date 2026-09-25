import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { MoneyInputDto } from '../../../../shared/infrastructure/http/api-types';
import { CurrentActor, RequirePermissions } from '../../../../shared/infrastructure/http/decorators';
import { Actor } from '../../../../shared/kernel/actor';
import { pageRequest } from '../../../../shared/kernel/pagination';
import { Permission } from '../../../../shared/kernel/permissions';
import { PaymentProvidersQuery } from '../../application/payment-providers.query';
import { PaymentQueries } from '../../application/payment.queries';
import { MarkCollected } from '../../application/payment-status.actions';
import { ConfirmManualRefund, RejectManualRefund, RequestRefund } from '../../application/refund.actions';
import {
  ConfirmRefundDto,
  CreateRefundDto,
  PaymentDetailsDto,
  PaymentDto,
  PaymentListQueryDto,
  PaymentProvidersDto,
  PaymentsPageDto,
  RefundDto,
  RefundListQueryDto,
  RefundResultDto,
  RefundsPageDto,
  RejectRefundDto,
} from '../payments.dto';

/** Платежи и возвраты в админке. Список и карточка — в пределах филиалов с правом payments.view. */
@ApiTags('admin')
@ApiBearerAuth('staff')
@Controller('admin/payments')
export class AdminPaymentsController {
  constructor(
    private readonly queries: PaymentQueries,
    private readonly requestRefund: RequestRefund,
    private readonly confirmRefund: ConfirmManualRefund,
    private readonly rejectRefund: RejectManualRefund,
    private readonly markCollected: MarkCollected,
    private readonly providers: PaymentProvidersQuery,
  ) {}

  /** Платежи с фильтрами: филиал, назначение, способ, провайдер, статус, период, объект оплаты. */
  @RequirePermissions(Permission.PaymentsView)
  @Get()
  @ApiOkResponse({ type: PaymentsPageDto })
  async list(@CurrentActor() actor: Actor, @Query() q: PaymentListQueryDto): Promise<PaymentsPageDto> {
    const page = await this.queries.search(
      actor,
      {
        branchId: q.branchId,
        purpose: q.purpose,
        method: q.method,
        provider: q.provider,
        status: q.status,
        referenceId: q.referenceId,
        from: q.from ? new Date(q.from) : undefined,
        to: q.to ? new Date(q.to) : undefined,
        phone: q.phone,
      },
      pageRequest(q.page, q.perPage),
    );
    return { ...page, items: page.items.map(PaymentDto.from) };
  }

  /** Подключённые провайдеры и способы оплаты (без секретов): фильтры и подписи раздела «Платежи». */
  @RequirePermissions(Permission.PaymentsView)
  @Get('providers')
  @ApiOkResponse({ type: PaymentProvidersDto })
  providerList(@CurrentActor() actor: Actor): Promise<PaymentProvidersDto> {
    return this.providers.execute(actor);
  }

  /** Очередь возвратов (например, ожидающие ручного подтверждения финансистом: status=pending, mode=manual). */
  @RequirePermissions(Permission.PaymentsView)
  @Get('refunds')
  @ApiOkResponse({ type: RefundsPageDto })
  async refunds(@CurrentActor() actor: Actor, @Query() q: RefundListQueryDto): Promise<RefundsPageDto> {
    const page = await this.queries.refundQueue(
      actor,
      {
        branchId: q.branchId,
        status: q.status,
        mode: q.mode,
        from: q.from ? new Date(q.from) : undefined,
        to: q.to ? new Date(q.to) : undefined,
        q: q.q,
      },
      pageRequest(q.page, q.perPage),
    );
    return { ...page, items: page.items.map(RefundDto.from) };
  }

  /** Подтвердить ручной возврат (наличные/перевод): деньги вернули вне системы. */
  @RequirePermissions(Permission.PaymentsManual)
  @Post('refunds/:refundId/confirm')
  @HttpCode(200)
  @ApiOkResponse({ type: RefundResultDto })
  async confirm(
    @CurrentActor() actor: Actor,
    @Param('refundId', ParseUUIDPipe) refundId: string,
    @Body() dto: ConfirmRefundDto,
  ): Promise<RefundResultDto> {
    return RefundResultDto.from(await this.confirmRefund.execute(actor, refundId, dto.comment ?? null));
  }

  @RequirePermissions(Permission.PaymentsManual)
  @Post('refunds/:refundId/reject')
  @HttpCode(200)
  @ApiOkResponse({ type: RefundResultDto })
  async reject(
    @CurrentActor() actor: Actor,
    @Param('refundId', ParseUUIDPipe) refundId: string,
    @Body() dto: RejectRefundDto,
  ): Promise<RefundResultDto> {
    return RefundResultDto.from(await this.rejectRefund.execute(actor, refundId, dto.reason));
  }

  /** Карточка платежа: возвраты, входящие уведомления провайдера, журнал обмена (маскированный). */
  @RequirePermissions(Permission.PaymentsView)
  @Get(':id')
  @ApiOkResponse({ type: PaymentDetailsDto })
  async details(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<PaymentDetailsDto> {
    return PaymentDetailsDto.from(await this.queries.details(actor, id));
  }

  /** Возврат (полный — без суммы, или частичный). Право payments.refund в филиале платежа. */
  @RequirePermissions(Permission.PaymentsRefund)
  @Post(':id/refunds')
  @ApiCreatedResponse({ type: RefundResultDto })
  async refund(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateRefundDto): Promise<RefundResultDto> {
    const view = await this.requestRefund.execute(
      { paymentId: id, amount: dto.amount ? MoneyInputDto.toMoney(dto.amount) : undefined, reason: dto.reason, idempotencyKey: dto.idempotencyKey },
      actor,
    );
    return RefundResultDto.from(view);
  }

  /** Отметить получение денег по оплате при получении (если не отмечено автоматически). */
  @RequirePermissions(Permission.PaymentsManual)
  @Post(':id/collect')
  @HttpCode(200)
  @ApiOkResponse({ type: PaymentDto })
  async collect(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<PaymentDto> {
    await this.markCollected.execute(id, actor);
    return PaymentDto.from((await this.queries.details(actor, id)).payment);
  }
}
