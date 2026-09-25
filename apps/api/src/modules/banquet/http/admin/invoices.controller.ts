import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentActor, RequirePermissions } from '../../../../shared/infrastructure/http/decorators';
import { MoneyInputDto } from '../../../../shared/infrastructure/http/api-types';
import { Actor } from '../../../../shared/kernel/actor';
import { Page, pageRequest } from '../../../../shared/kernel/pagination';
import { Permission } from '../../../../shared/kernel/permissions';
import { InvoiceListItemView, InvoiceQueries } from '../../application/admin.queries';
import { SignedLink } from '../../application/document-files';
import { CancelBanquetInvoice, IssueBanquetInvoice, RegisterInvoiceBankTransfer, ResendInvoicePaymentLink } from '../../application/invoice.actions';
import {
  BanquetBankTransferDto,
  BanquetCancelInvoiceDto,
  BanquetInvoicesQueryDto,
  BanquetIssueInvoiceDto,
  BanquetResendPaymentLinkDto,
  parseInvoiceStatuses,
} from '../dto';
import { BanquetBankTransferResultDto, BanquetInvoiceListItemDto, BanquetInvoicesPageDto, BanquetSignedLinkDto } from '../responses.dto';

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
    private readonly resendLink: ResendInvoicePaymentLink,
  ) {}

  @Get('invoices')
  @RequirePermissions(Permission.BanquetsView)
  @ApiOkResponse({ type: BanquetInvoicesPageDto })
  list(@CurrentActor() actor: Actor, @Query() q: BanquetInvoicesQueryDto): Promise<Page<InvoiceListItemView>> {
    return this.queries.list(actor, { branchId: q.branchId, status: parseInvoiceStatuses(q.status), overdue: q.overdue }, pageRequest(q.page, q.perPage));
  }

  /** Счёт: физлицу — онлайн-оплата по ссылке, юрлицу — счёт на оплату с реквизитами (PDF). */
  @Post('requests/:id/invoices')
  @RequirePermissions(Permission.BanquetsInvoice)
  @ApiCreatedResponse({ type: BanquetInvoiceListItemDto })
  async create(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BanquetIssueInvoiceDto): Promise<InvoiceListItemView> {
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
  @ApiOkResponse({ type: BanquetInvoiceListItemDto })
  get(@CurrentActor() actor: Actor, @Param('invoiceId', ParseUUIDPipe) invoiceId: string): Promise<InvoiceListItemView> {
    return this.queries.get(actor, invoiceId);
  }

  @Get('invoices/:invoiceId/pdf')
  @RequirePermissions(Permission.BanquetsView)
  @ApiOkResponse({ type: BanquetSignedLinkDto })
  pdf(@CurrentActor() actor: Actor, @Param('invoiceId', ParseUUIDPipe) invoiceId: string): Promise<SignedLink> {
    return this.queries.pdfLink(actor, invoiceId);
  }

  /** Поступление по банковскому переводу. Сумма оплат не может превысить сумму счёта (409). Идемпотентно по документу. */
  @Post('invoices/:invoiceId/payments')
  @RequirePermissions(Permission.BanquetsInvoice)
  @ApiCreatedResponse({ type: BanquetBankTransferResultDto })
  async payment(
    @CurrentActor() actor: Actor,
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @Body() dto: BanquetBankTransferDto,
  ): Promise<{ invoice: InvoiceListItemView; paymentId: string; duplicate: boolean }> {
    const result = await this.bankTransfer.execute(actor, invoiceId, {
      amount: MoneyInputDto.toMoney(dto.amount),
      paidAt: new Date(dto.paidAt),
      documentNumber: dto.documentNumber,
    });
    return { invoice: await this.queries.get(actor, invoiceId), paymentId: result.paymentId, duplicate: result.duplicate };
  }

  /**
   * Отправить гостю ссылку на оплату счёта физлица ещё раз. Если прежний платёж не прошёл / отменён —
   * создаётся новый на остаток; regenerate — принудительно новая ссылка (прежний неоплаченный платёж отменяется).
   */
  @Post('invoices/:invoiceId/payment-link')
  @HttpCode(200)
  @RequirePermissions(Permission.BanquetsInvoice)
  @ApiOkResponse({ type: BanquetInvoiceListItemDto })
  async paymentLink(
    @CurrentActor() actor: Actor,
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @Body() dto: BanquetResendPaymentLinkDto,
  ): Promise<InvoiceListItemView> {
    await this.resendLink.execute(actor, invoiceId, { regenerate: dto.regenerate ?? false });
    return this.queries.get(actor, invoiceId);
  }

  @Post('invoices/:invoiceId/cancel')
  @HttpCode(200)
  @RequirePermissions(Permission.BanquetsInvoice)
  @ApiOkResponse({ type: BanquetInvoiceListItemDto })
  async cancelInvoice(
    @CurrentActor() actor: Actor,
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @Body() dto: BanquetCancelInvoiceDto,
  ): Promise<InvoiceListItemView> {
    await this.cancel.execute(actor, invoiceId, dto.reason ?? null);
    return this.queries.get(actor, invoiceId);
  }
}
