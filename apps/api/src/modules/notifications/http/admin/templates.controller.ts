import { Body, Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentActor, RequirePermissions } from '../../../../shared/infrastructure/http/decorators';
import { Actor } from '../../../../shared/kernel/actor';
import { Permission } from '../../../../shared/kernel/permissions';
import { NotificationQueries } from '../../application/notification.queries';
import { PreviewTemplate, ResetTemplateText, UpdateTemplateText } from '../../application/template.actions';
import {
  NotificationTemplateDto,
  PreviewTemplateDto,
  ResolvedTemplateTextDto,
  TemplateKeyParamDto,
  TemplatePreviewDto,
  TemplateTextParamsDto,
  UpdateTemplateTextDto,
} from '../dto';

/** Шаблоны уведомлений: тексты по каналам и языкам, предпросмотр, проверка переменных. */
@ApiTags('admin')
@ApiBearerAuth('staff')
@RequirePermissions(Permission.IntegrationsManage, Permission.ContentManage)
@Controller('admin/notifications/templates')
export class NotificationTemplatesController {
  constructor(
    private readonly queries: NotificationQueries,
    private readonly updateText: UpdateTemplateText,
    private readonly resetText: ResetTemplateText,
    private readonly previewTemplate: PreviewTemplate,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Шаблоны уведомлений с текстами по каналам и языкам' })
  @ApiOkResponse({ type: [NotificationTemplateDto] })
  list(@CurrentActor() actor: Actor): Promise<NotificationTemplateDto[]> {
    return this.queries.listTemplates(actor);
  }

  @Get(':key')
  @ApiOkResponse({ type: NotificationTemplateDto })
  get(@CurrentActor() actor: Actor, @Param() params: TemplateKeyParamDto): Promise<NotificationTemplateDto> {
    return this.queries.getTemplate(actor, params.key);
  }

  @Put(':key/:channel/:locale')
  @ApiOperation({ summary: 'Изменить текст шаблона (переменные — только параметры шаблона)' })
  @ApiOkResponse({ type: ResolvedTemplateTextDto })
  update(
    @CurrentActor() actor: Actor,
    @Param() params: TemplateTextParamsDto,
    @Body() dto: UpdateTemplateTextDto,
  ): Promise<ResolvedTemplateTextDto> {
    return this.updateText.execute(actor, { ...params, subject: dto.subject ?? null, body: dto.body });
  }

  @Post(':key/:channel/:locale/reset')
  @HttpCode(200)
  @ApiOperation({ summary: 'Вернуть стартовый текст шаблона' })
  @ApiOkResponse({ type: ResolvedTemplateTextDto })
  reset(@CurrentActor() actor: Actor, @Param() params: TemplateTextParamsDto): Promise<ResolvedTemplateTextDto> {
    return this.resetText.execute(actor, params);
  }

  @Post(':key/preview')
  @HttpCode(200)
  @ApiOperation({ summary: 'Предпросмотр текста (сохранённого или черновика) с примером параметров' })
  @ApiOkResponse({ type: TemplatePreviewDto })
  preview(@CurrentActor() actor: Actor, @Param() params: TemplateKeyParamDto, @Body() dto: PreviewTemplateDto): Promise<TemplatePreviewDto> {
    return this.previewTemplate.execute(actor, { key: params.key, ...dto });
  }
}
