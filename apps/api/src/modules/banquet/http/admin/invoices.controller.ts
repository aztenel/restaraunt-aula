import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentActor, RequirePermissions } from '../../../../shared/infrastructure/http/decorators';
import { MoneyInputDto } from '../../../../shared/infrastructure/http/api-types';
import { Actor } from '../../../../shared/kernel/actor';
import { Page, pageRequest } from '../../../../shared/kernel/pagination';
import { Permission } from '../../../../shared/kernel/permissions';
import { InvoiceListItemView, InvoiceQueries } from '../../application/admin.queries';
import { SignedLink } from '../../application/document-files';
import { CancelBanquetInvoice, IssueBanquetInvoice, RegisterInvoiceBankTransfer } from '../../application/invoice.actions';
import { BankTransferDto, CancelInvoiceDto, InvoicesQueryDto, IssueInvoiceDto, parseInvoiceStatuses } from '../dto';
import { BankTransferResultDto, InvoiceListItemDto, InvoicesPageDto, SignedLinkDto } from '../responses.dto';

/**
 * Счета по банкетам: выставление (banquets.invoice: банкетный менеджер, финансы, собственник),
 * регистрация поступлений по безналу, отмена, PDF счёта на оплату.
 */
@ApiTags('admin')
@ApiBearerAuth('staff')
@Controller('admin/banquets')
export class AdminBanquetInvoicesController {
  constructor(
    private readonly queries: InvoiceQueries,
    private readonly issue: IssueBanquetInvoice,
    private readonly bankTransfer: RegisterInvoiceBankTransfer,
    private readonly cancel: CancelBanquetInvoice,
  ) {}

  @Get('invoices')
  @RequirePermissions(Permission.BanquetsView)
  @ApiOkResponse({ type: InvoicesPageDto })
  list(@CurrentActor() actor: Actor, @Query() q: InvoicesQueryDto): Promise<Page<InvoiceListItemView>> {
    return this.queries.list(actor, { branchId: q.branchId, status: parseInvoiceStatuses(q.status), overdue: q.overdue }, pageRequest(q.page, q.perPage));
  }

  /** Счёт: физлицу — онлайн-оплата по ссылке, юрлицу — счёт на оплату с реквизитами (PDF). */
  @Post('requests/:id/invoices')
  @RequirePermissions(Permission.BanquetsInvoice)
  @ApiCreatedResponse({ type: InvoiceListItemDto })
  async create(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: IssueInvoiceDto): Promise<InvoiceListItemView> {
    const invoice = await this.issue.execute(actor, id, {
      payerType: dto.payerType,
      companyId: dto.companyId ?? null,
      amount: dto.amount ? MoneyInputDto.toMoney(dto.amount) : null,
      dueDate: dto.dueDate ?? null,
      description: dto.description ?? null,
    });
    return this.queries.get(actor, invoice.id);
  }

  @Get('invoices/:invoiceId')
  @RequirePermissions(Permission.BanquetsView)
  @ApiOkResponse({ type: InvoiceListItemDto })
  get(@CurrentActor() actor: Actor, @Param('invoiceId', ParseUUIDPipe) invoiceId: string): Promise<InvoiceListItemView> {
    return this.queries.get(actor, invoiceId);
  }

  @Get('invoices/:invoiceId/pdf')
  @RequirePermissions(Permission.BanquetsView)
  @ApiOkResponse({ type: SignedLinkDto })
  pdf(@CurrentActor() actor: Actor, @Param('invoiceId', ParseUUIDPipe) invoiceId: string): Promise<SignedLink> {
    return this.queries.pdfLink(actor, invoiceId);
  }

  /** Поступление по банковскому переводу. Сумма оплат не может превысить сумму счёта (409). Идемпотентно по документу. */
  @Post('invoices/:invoiceId/payments')
  @RequirePermissions(Permission.BanquetsInvoice)
  @ApiCreatedResponse({ type: BankTransferResultDto })
  async payment(
    @CurrentActor() actor: Actor,
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @Body() dto: BankTransferDto,
  ): Promise<{ invoice: InvoiceListItemView; paymentId: string; duplicate: boolean }> {
    const result = await this.bankTransfer.execute(actor, invoiceId, {
      amount: MoneyInputDto.toMoney(dto.amount),
      paidAt: new Date(dto.paidAt),
      documentNumber: dto.documentNumber,
    });
    return { invoice: await this.queries.get(actor, invoiceId), paymentId: result.paymentId, duplicate: result.duplicate };
  }

  @Post('invoices/:invoiceId/cancel')
  @HttpCode(200)
  @RequirePermissions(Permission.BanquetsInvoice)
  @ApiOkResponse({ type: InvoiceListItemDto })
  async cancelInvoice(
    @CurrentActor() actor: Actor,
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @Body() dto: CancelInvoiceDto,
  ): Promise<InvoiceListItemView> {
    await this.cancel.execute(actor, invoiceId, dto.reason ?? null);
    return this.queries.get(actor, invoiceId);
  }
}
