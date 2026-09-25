import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentActor, RequirePermissions } from '../../../../shared/infrastructure/http/decorators';
import { Actor } from '../../../../shared/kernel/actor';
import { Permission } from '../../../../shared/kernel/permissions';
import { DocumentQueries } from '../../application/admin.queries';
import { GenerateContract, IssueBanquetAct } from '../../application/document.actions';
import { SignedLink } from '../../application/document-files';
import { RetryEsf } from '../../application/esf.actions';
import { ActView, actView, DocumentView, documentView } from '../../application/views';
import { BanquetGenerateContractDto } from '../dto';
import { BanquetActDto, BanquetDocumentDto, BanquetSignedLinkDto } from '../responses.dto';

/**
 * Документы для юрлиц: договор по шаблону, акт выполненных работ (после проведения), ЭСФ по акту;
 * список документов заявки и подписанные ссылки на скачивание (файлы приватные).
 */
@ApiTags('admin')
@ApiBearerAuth('staff')
@Controller('admin/banquets')
export class AdminBanquetDocumentsController {
  constructor(
    private readonly queries: DocumentQueries,
    private readonly generateContract: GenerateContract,
    private readonly issueAct: IssueBanquetAct,
    private readonly retryEsf: RetryEsf,
  ) {}

  @Get('requests/:id/documents')
  @RequirePermissions(Permission.BanquetsView)
  @ApiOkResponse({ type: [BanquetDocumentDto] })
  list(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<DocumentView[]> {
    return this.queries.list(actor, id);
  }

  @Get('documents/:documentId/link')
  @RequirePermissions(Permission.BanquetsView)
  @ApiOkResponse({ type: BanquetSignedLinkDto })
  link(@CurrentActor() actor: Actor, @Param('documentId', ParseUUIDPipe) documentId: string): Promise<SignedLink> {
    return this.queries.link(actor, documentId);
  }

  /** Договор по шаблону с подстановкой реквизитов (номер — один на заявку, повтор — новая редакция). */
  @Post('requests/:id/contract')
  @RequirePermissions(Permission.BanquetsManage, Permission.BanquetsInvoice)
  @ApiCreatedResponse({ type: BanquetDocumentDto })
  async contract(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BanquetGenerateContractDto): Promise<DocumentView> {
    return documentView(await this.generateContract.execute(actor, id, { templateId: dto.templateId ?? null }));
  }

  /** Акт выполненных работ (после held); для юрлица при продавце — плательщике НДС ставится ЭСФ. */
  @Post('requests/:id/act')
  @RequirePermissions(Permission.BanquetsManage, Permission.BanquetsInvoice)
  @ApiCreatedResponse({ type: BanquetActDto })
  async act(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<ActView> {
    return actView(await this.issueAct.execute(actor, id));
  }

  /** Повторить формирование / отправку ЭСФ по акту. */
  @Post('acts/:actId/esf/retry')
  @RequirePermissions(Permission.BanquetsManage, Permission.BanquetsInvoice)
  @ApiCreatedResponse({ type: BanquetActDto })
  async esfRetry(@CurrentActor() actor: Actor, @Param('actId', ParseUUIDPipe) actId: string): Promise<ActView> {
    return actView(await this.retryEsf.execute(actor, actId));
  }
}
