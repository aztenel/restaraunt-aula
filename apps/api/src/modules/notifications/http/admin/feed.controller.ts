import { Controller, Get, Headers, HttpCode, Post, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiExtraModels, ApiHeader, ApiOkResponse, ApiOperation, ApiProduces, ApiTags, getSchemaPath } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CurrentActor, Public, RequirePermissions } from '../../../../shared/infrastructure/http/decorators';
import { Actor } from '../../../../shared/kernel/actor';
import { Permission } from '../../../../shared/kernel/permissions';
import { IssueFeedTicket, OpenFeedStream } from '../../application/feed.actions';
import { FeedQueries } from '../../application/feed.queries';
import { FeedItemDto, FeedRecentQueryDto, FeedStreamQueryDto, FeedTicketDto } from '../dto';
import { FeedSseConnections } from './feed-sse';

const FEED_PERMISSIONS = [Permission.OrdersView, Permission.ReservationsView, Permission.BanquetsView, Permission.SystemJobs];

/**
 * Лента админки: очереди новых заказов, броней, банкетных заявок (со звуком о новом) и системные оповещения.
 * Поток — Server-Sent Events: POST /admin/feed/ticket (JWT) -> GET /admin/feed/stream?ticket=...;
 * после переподключения — догрузка GET /admin/feed/recent?since=<id последнего события>.
 */
@ApiTags('admin')
@ApiExtraModels(FeedItemDto)
@Controller('admin/feed')
export class AdminFeedController {
  constructor(
    private readonly issueTicket: IssueFeedTicket,
    private readonly openStream: OpenFeedStream,
    private readonly queries: FeedQueries,
    private readonly connections: FeedSseConnections,
  ) {}

  @Post('ticket')
  @HttpCode(200)
  @ApiBearerAuth('staff')
  @RequirePermissions(...FEED_PERMISSIONS)
  @ApiOperation({ summary: 'Короткоживущий билет для подключения к потоку SSE (EventSource не передаёт Authorization)' })
  @ApiOkResponse({ type: FeedTicketDto })
  ticket(@CurrentActor() actor: Actor): FeedTicketDto {
    return this.issueTicket.execute(actor);
  }

  @Get('stream')
  @Public()
  @ApiOperation({
    summary: 'Поток событий ленты (text/event-stream)',
    description:
      "События: 'event: feed' — data: FeedItemDto (JSON), id — идентификатор события; 'event: ping' — каждые 25 секунд. " +
      'События фильтруются по правам сотрудника: orders -> orders.view, reservations -> reservations.view, ' +
      'banquets -> banquets.view, system -> system.jobs, с учётом филиала. Сервер закрывает поток раз в 30 минут — ' +
      'переподключитесь с новым билетом. Заголовок Last-Event-ID догружает пропущенные события.',
  })
  @ApiProduces('text/event-stream')
  @ApiHeader({ name: 'Last-Event-ID', required: false, description: 'Последнее полученное событие (догрузка при переподключении)' })
  @ApiOkResponse({ description: 'Поток SSE', schema: { type: 'string', description: `event: feed, data: ${getSchemaPath(FeedItemDto)}` } })
  async stream(
    @Query() query: FeedStreamQueryDto,
    @Headers('last-event-id') lastEventId: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const { actor, backlog } = await this.openStream.execute(query.ticket, lastEventId);
    this.connections.start(req, res, actor, backlog);
  }

  @Get('recent')
  @ApiBearerAuth('staff')
  @RequirePermissions(...FEED_PERMISSIONS)
  @ApiOperation({ summary: 'Недавние события ленты (догрузка после переподключения), по возрастанию времени' })
  @ApiOkResponse({ type: [FeedItemDto] })
  recent(@CurrentActor() actor: Actor, @Query() query: FeedRecentQueryDto): Promise<FeedItemDto[]> {
    return this.queries.recent(actor, { since: query.since, limit: query.limit });
  }
}
