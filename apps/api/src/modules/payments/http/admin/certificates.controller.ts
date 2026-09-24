import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { MoneyInputDto } from '../../../../shared/infrastructure/http/api-types';
import { CurrentActor, RequirePermissions } from '../../../../shared/infrastructure/http/decorators';
import { Actor } from '../../../../shared/kernel/actor';
import { pageRequest } from '../../../../shared/kernel/pagination';
import { Permission } from '../../../../shared/kernel/permissions';
import {
  BlockCertificate,
  ExtendCertificate,
  GetCertificatePdfLink,
  RedeemCertificate,
  ResendCertificate,
  UnblockCertificate,
} from '../../application/certificates/certificate-admin.actions';
import { CreateCertificateProduct, DeleteCertificateProduct, UpdateCertificateProduct } from '../../application/certificates/certificate-product.actions';
import { CertificateQueries } from '../../application/certificates/certificate.queries';
import { toBalanceView } from '../../application/certificates/certificate-views';
import { ExportCertificateReport } from '../../application/certificates/export-certificate-report';
import { IssueCorporateCertificates } from '../../application/certificates/purchase-certificate.action';
import { RequestContext } from '../../../../shared/infrastructure/context/request-context';
import { GiftCertificates } from '../../public';
import {
  AdminCertificateBalanceDto,
  BlockCertificateDto,
  CertificateBalanceDto,
  CertificateDetailsDto,
  CertificateDto,
  CertificateLedgerEntryDto,
  CertificateListQueryDto,
  CertificateOrderSummaryDto,
  CertificateProductDto,
  CertificateProductInputDto,
  CertificateReportDto,
  CertificateReportQueryDto,
  CertificatesPageDto,
  CheckCertificateDto,
  ExtendCertificateDto,
  ManualIssueDto,
  ManualIssueResultDto,
  PaymentLinkDto,
  PdfLinkDto,
  RedeemCertificateDto,
  RedeemResultDto,
  ResendCertificateDto,
  UnblockCertificateDto,
} from '../certificates.dto';

function productInput(dto: CertificateProductInputDto) {
  return {
    slug: dto.slug,
    kind: dto.kind,
    name: dto.name,
    description: dto.description ?? null,
    nominal: MoneyInputDto.toMoney(dto.nominal),
    price: MoneyInputDto.toMoney(dto.price),
    validityMonths: dto.validityMonths,
    design: dto.design ?? null,
    isActive: dto.isActive,
    sortOrder: dto.sortOrder,
  };
}

/** Подарочные сертификаты в админке: продукты, поиск, проверка и погашение на точке, отчёт. */
@ApiTags('admin')
@ApiBearerAuth('staff')
@Controller('admin/certificates')
export class AdminCertificatesController {
  constructor(
    private readonly queries: CertificateQueries,
    private readonly createProduct: CreateCertificateProduct,
    private readonly updateProduct: UpdateCertificateProduct,
    private readonly deleteProduct: DeleteCertificateProduct,
    private readonly giftCertificates: GiftCertificates,
    private readonly redeemCertificate: RedeemCertificate,
    private readonly blockCertificate: BlockCertificate,
    private readonly unblockCertificate: UnblockCertificate,
    private readonly extendCertificate: ExtendCertificate,
    private readonly resendCertificate: ResendCertificate,
    private readonly pdfLink: GetCertificatePdfLink,
    private readonly manualIssue: IssueCorporateCertificates,
    private readonly exportReport: ExportCertificateReport,
  ) {}

  // ------------------------------------------------------------ продукты

  @RequirePermissions(Permission.CertificatesView, Permission.CertificatesManage)
  @Get('products')
  @ApiOkResponse({ type: [CertificateProductDto] })
  async products(@CurrentActor() actor: Actor): Promise<CertificateProductDto[]> {
    return (await this.queries.adminProducts(actor)).map(CertificateProductDto.from);
  }

  @RequirePermissions(Permission.CertificatesManage)
  @Post('products')
  @ApiCreatedResponse({ type: CertificateProductDto })
  async create(@CurrentActor() actor: Actor, @Body() dto: CertificateProductInputDto): Promise<CertificateProductDto> {
    return CertificateProductDto.from(await this.createProduct.execute(actor, productInput(dto)));
  }

  @RequirePermissions(Permission.CertificatesManage)
  @Put('products/:id')
  @ApiOkResponse({ type: CertificateProductDto })
  async update(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CertificateProductInputDto,
  ): Promise<CertificateProductDto> {
    return CertificateProductDto.from(await this.updateProduct.execute(actor, id, productInput(dto)));
  }

  @RequirePermissions(Permission.CertificatesManage)
  @Delete('products/:id')
  @HttpCode(204)
  @ApiNoContentResponse()
  async remove(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.deleteProduct.execute(actor, id);
  }

  // ------------------------------------------------------------ сертификаты

  /** Поиск: последние 4 символа кода, телефон покупателя/получателя, статус. */
  @RequirePermissions(Permission.CertificatesView)
  @Get()
  @ApiOkResponse({ type: CertificatesPageDto })
  async list(@CurrentActor() actor: Actor, @Query() q: CertificateListQueryDto): Promise<CertificatesPageDto> {
    const page = await this.queries.search(actor, { q: q.q, phone: q.phone, status: q.status, orderId: q.orderId }, pageRequest(q.page, q.perPage));
    return { ...page, items: page.items.map(CertificateDto.from) };
  }

  /** Отчёт: выпущено, погашено, просрочено за период + остаток обязательств. */
  @RequirePermissions(Permission.CertificatesView, Permission.ReportsConsolidated)
  @Get('report')
  @ApiOkResponse({ type: CertificateReportDto })
  async report(@CurrentActor() actor: Actor, @Query() q: CertificateReportQueryDto): Promise<CertificateReportDto> {
    return CertificateReportDto.from(await this.queries.report(actor, q.from, q.to));
  }

  @RequirePermissions(Permission.CertificatesView, Permission.ReportsConsolidated)
  @Get('report/export')
  @ApiProduces('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @ApiOkResponse({ description: 'XLSX', schema: { type: 'string', format: 'binary' } })
  async export(@CurrentActor() actor: Actor, @Query() q: CertificateReportQueryDto, @Res() res: Response): Promise<void> {
    const body = await this.exportReport.execute(actor, q.from, q.to);
    res.setHeader('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('content-disposition', `attachment; filename="certificates-${q.from}-${q.to}.xlsx"`);
    res.send(body);
  }

  /** Проверка кода с точки/из админки (защита от подбора — учёт неудач по IP). */
  @RequirePermissions(Permission.CertificatesRedeem, Permission.CertificatesView)
  @Post('check')
  @HttpCode(200)
  @ApiOkResponse({ type: AdminCertificateBalanceDto })
  async check(@Body() dto: CheckCertificateDto): Promise<AdminCertificateBalanceDto> {
    const view = await this.giftCertificates.check(dto.code);
    return { id: view.id, ...CertificateBalanceDto.from(view) };
  }

  /** Погашение на точке: частичное для сертификата на сумму, целиком — для набора. */
  @RequirePermissions(Permission.CertificatesRedeem)
  @Post('redeem')
  @HttpCode(200)
  @ApiOkResponse({ type: RedeemResultDto })
  async redeem(@CurrentActor() actor: Actor, @Body() dto: RedeemCertificateDto): Promise<RedeemResultDto> {
    const { record, ledger } = await this.redeemCertificate.execute(actor, {
      code: dto.code,
      amount: dto.amount ? MoneyInputDto.toMoney(dto.amount) : null,
      branchId: dto.branchId,
      comment: dto.comment ?? null,
    });
    const view = toBalanceView(record, RequestContext.locale());
    return { certificate: { id: view.id, ...CertificateBalanceDto.from(view) }, transaction: CertificateLedgerEntryDto.from(ledger) };
  }

  /** Корпоративная продажа по счёту: регистрирует банковский перевод и сразу выпускает сертификаты. */
  @RequirePermissions(Permission.CertificatesManage, Permission.PaymentsManual)
  @Post('issue')
  @ApiCreatedResponse({ type: ManualIssueResultDto })
  async issue(@CurrentActor() actor: Actor, @Body() dto: ManualIssueDto): Promise<ManualIssueResultDto> {
    const result = await this.manualIssue.execute(actor, {
      productId: dto.productId,
      quantity: dto.quantity,
      total: dto.total ? MoneyInputDto.toMoney(dto.total) : null,
      buyer: dto.buyer,
      recipient: dto.recipient ?? null,
      message: dto.message ?? null,
      deliveryChannel: dto.deliveryChannel,
      locale: dto.locale,
      documentNumber: dto.documentNumber,
      paidAt: new Date(dto.paidAt),
      idempotencyKey: dto.idempotencyKey,
    });
    return {
      order: CertificateOrderSummaryDto.from(result.order),
      payment: PaymentLinkDto.from(result.payment),
      certificates: result.certificates.map(CertificateDto.from),
    };
  }

  @RequirePermissions(Permission.CertificatesView)
  @Get(':id')
  @ApiOkResponse({ type: CertificateDetailsDto })
  async details(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<CertificateDetailsDto> {
    return CertificateDetailsDto.from(await this.queries.details(actor, id));
  }

  /** Подписанная ссылка на PDF (с полным кодом) — корпоративные продажи без рассылки. */
  @RequirePermissions(Permission.CertificatesManage, Permission.PaymentsManual)
  @Get(':id/pdf-link')
  @ApiOkResponse({ type: PdfLinkDto })
  pdf(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<PdfLinkDto> {
    return this.pdfLink.execute(actor, id);
  }

  @RequirePermissions(Permission.CertificatesManage)
  @Post(':id/block')
  @HttpCode(200)
  @ApiOkResponse({ type: CertificateDto })
  async block(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BlockCertificateDto): Promise<CertificateDto> {
    return CertificateDto.from(await this.blockCertificate.execute(actor, id, dto.reason));
  }

  @RequirePermissions(Permission.CertificatesManage)
  @Post(':id/unblock')
  @HttpCode(200)
  @ApiOkResponse({ type: CertificateDto })
  async unblock(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UnblockCertificateDto): Promise<CertificateDto> {
    return CertificateDto.from(await this.unblockCertificate.execute(actor, id, dto.reason ?? null));
  }

  /** Продление срока (аудит: было/стало). */
  @RequirePermissions(Permission.CertificatesManage)
  @Post(':id/extend')
  @HttpCode(200)
  @ApiOkResponse({ type: CertificateDto })
  async extend(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ExtendCertificateDto): Promise<CertificateDto> {
    return CertificateDto.from(await this.extendCertificate.execute(actor, id, dto));
  }

  /** Переотправка сертификата (PDF) по email или WhatsApp. */
  @RequirePermissions(Permission.CertificatesManage)
  @Post(':id/resend')
  @HttpCode(200)
  @ApiOkResponse({ type: CertificateDto })
  async resend(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResendCertificateDto): Promise<CertificateDto> {
    return CertificateDto.from(await this.resendCertificate.execute(actor, id, dto));
  }
}
