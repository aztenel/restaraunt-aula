import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentActor, RequirePermissions } from '../../../../shared/infrastructure/http/decorators';
import { Actor } from '../../../../shared/kernel/actor';
import { pageRequest } from '../../../../shared/kernel/pagination';
import { Permission } from '../../../../shared/kernel/permissions';
import { ResendDelivery, SendTestNotification } from '../../application/delivery.actions';
import { NotificationQueries } from '../../application/notification.queries';
import {
  ChannelStatusDto,
  DeliveryDetailDto,
  DeliveryIdParamDto,
  DeliveryLogPageDto,
  DeliveryLogQueryDto,
  QueuedDeliveryDto,
  TestSendDto,
} from '../dto';

/** Журнал доставки уведомлений, повторная и тестовая отправка, состояние каналов. */
@ApiTags('admin')
@ApiBearerAuth('staff')
@RequirePermissions(Permission.IntegrationsManage)
@Controller('admin/notifications')
export class NotificationDeliveriesController {
  constructor(
    private readonly queries: NotificationQueries,
    private readonly resend: ResendDelivery,
    private readonly testSend: SendTestNotification,
  ) {}

  @Get('deliveries')
  @ApiOperation({ summary: 'Журнал доставки: фильтры по статусу, каналу, шаблону, дате и адресату (адресат — маской)' })
  @ApiOkResponse({ type: DeliveryLogPageDto })
  log(@CurrentActor() actor: Actor, @Query() query: DeliveryLogQueryDto): Promise<DeliveryLogPageDto> {
    return this.queries.deliveryLog(
      actor,
      {
        status: query.status,
        channel: query.channel,
        template: query.template,
        audience: query.audience,
        from: query.from ? new Date(query.from) : undefined,
        to: query.to ? new Date(query.to) : undefined,
        recipient: query.recipient,
        relatedType: query.relatedType,
        relatedId: query.relatedId,
      },
      pageRequest(query.page, query.perPage),
    );
  }

  @Get('deliveries/:id')
  @ApiOperation({ summary: 'Доставка: цепочка каналов, попытки, отправленный текст' })
  @ApiOkResponse({ type: DeliveryDetailDto })
  detail(@CurrentActor() actor: Actor, @Param() params: DeliveryIdParamDto): Promise<DeliveryDetailDto> {
    return this.queries.deliveryDetail(actor, params.id);
  }

  @Post('deliveries/:id/resend')
  @ApiOperation({ summary: 'Отправить повторно (новое сообщение тому же адресату)' })
  @ApiCreatedResponse({ type: QueuedDeliveryDto })
  resendDelivery(@CurrentActor() actor: Actor, @Param() params: DeliveryIdParamDto): Promise<QueuedDeliveryDto> {
    return this.resend.execute(actor, params.id);
  }

  @Post('test-send')
  @ApiOperation({ summary: 'Тестовая отправка в канал (проверка настроек интеграции)' })
  @ApiCreatedResponse({ type: QueuedDeliveryDto })
  send(@CurrentActor() actor: Actor, @Body() dto: TestSendDto): Promise<QueuedDeliveryDto> {
    return this.testSend.execute(actor, { channel: dto.channel, to: dto.to, template: dto.template ?? null, locale: dto.locale ?? null });
  }

  @Get('channels')
  @ApiOperation({ summary: 'Каналы уведомлений: настроены ли, какие провайдеры' })
  @ApiOkResponse({ type: [ChannelStatusDto] })
  channels(@CurrentActor() actor: Actor): Promise<ChannelStatusDto[]> {
    return this.queries.channelStatuses(actor);
  }
}
