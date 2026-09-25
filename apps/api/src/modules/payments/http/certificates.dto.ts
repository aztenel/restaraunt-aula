import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MoneyDto, MoneyInputDto, PageQueryDto, TranslatableDto } from '../../../shared/infrastructure/http/api-types';
import { Locale, LOCALES, translate } from '../../../shared/kernel/translatable';
import { CertificateDetails, CertificateOrderStatusView, CertificateReport } from '../application/certificates/certificate.queries';
import { maskCertificateCode } from '../domain/certificate-code';
import { lastValidDate } from '../domain/gift-certificate';
import { CertificateOrder } from '../infrastructure/certificate-order.repository';
import { CertificateProduct } from '../infrastructure/certificate-product.repository';
import { CertificateRecord, LedgerEntry } from '../infrastructure/certificate.repository';
import { CertificateBalanceView, PaymentView } from '../public';

export const CERTIFICATE_KINDS = ['amount', 'set'] as const;
export const CERTIFICATE_STATUSES = ['active', 'redeemed', 'expired', 'blocked'] as const;
export const DELIVERY_CHANNELS = ['email', 'whatsapp'] as const;
export const MANUAL_DELIVERY_CHANNELS = ['email', 'whatsapp', 'none'] as const;
export const ORDER_STATUSES = ['awaiting_payment', 'issued', 'payment_failed'] as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------- Общие

export class CertificateDesignDto {
  @ApiProperty({ example: '#7a4b2a' }) color: string;
  @ApiProperty({ example: 'classic' }) theme: string;
  @ApiPropertyOptional({ type: String, nullable: true }) imageUrl: string | null;
}

export class CertificateDesignInputDto {
  @ApiPropertyOptional({ example: '#7a4b2a' }) @IsOptional() @Matches(/^#[0-9a-fA-F]{6}$/) color?: string;
  @ApiPropertyOptional({ example: 'festive' }) @IsOptional() @IsString() @MaxLength(40) theme?: string;
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsString() @MaxLength(1000) imageUrl?: string | null;
}

/** Статус платежа для витрины: витрина опрашивает и перенаправляет гостя по paymentUrl. */
export class PaymentLinkDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: ['created', 'pending', 'succeeded', 'failed', 'cancelled', 'partially_refunded', 'refunded'] }) status: string;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Появляется после инициирования у провайдера' }) paymentUrl: string | null;
  @ApiProperty({ type: MoneyDto }) amount: MoneyDto;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) expiresAt: Date | null;

  static from(p: PaymentView): PaymentLinkDto {
    return { id: p.id, status: p.status, paymentUrl: p.paymentUrl, amount: MoneyDto.from(p.amount), expiresAt: p.expiresAt };
  }
}

// ---------------------------------------------------------------- Витрина

export class PublicCertificateProductDto {
  @ApiProperty() id: string;
  @ApiProperty() slug: string;
  @ApiProperty({ enum: CERTIFICATE_KINDS }) kind: string;
  @ApiProperty({ description: 'Название на языке запроса' }) name: string;
  @ApiProperty({ description: 'Описание; для набора — состав' }) description: string;
  @ApiProperty({ type: MoneyDto }) nominal: MoneyDto;
  @ApiProperty({ type: MoneyDto }) price: MoneyDto;
  @ApiProperty() validityMonths: number;
  @ApiProperty({ type: CertificateDesignDto }) design: CertificateDesignDto;

  static from(p: CertificateProduct, locale: Locale): PublicCertificateProductDto {
    return {
      id: p.id,
      slug: p.slug,
      kind: p.kind,
      name: translate(p.name, locale),
      description: translate(p.description, locale),
      nominal: MoneyDto.from(p.nominal),
      price: MoneyDto.from(p.price),
      validityMonths: p.validityMonths,
      design: p.design,
    };
  }
}

export class PurchaseBuyerDto {
  @ApiProperty({ example: 'Айгерим' }) @IsString() @Length(2, 120) name: string;
  @ApiProperty({ example: '+77771234567' }) @IsString() @MaxLength(32) phone: string;
  @ApiProperty({ example: 'buyer@example.kz', description: 'Для чека и связи по заказу' }) @IsEmail() @MaxLength(200) email: string;
}

export class PurchaseRecipientDto {
  @ApiProperty({ example: 'Данияр' }) @IsString() @Length(1, 120) name: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() @MaxLength(200) email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) phone?: string;
}

export class PurchaseConsentDto {
  @ApiProperty({ description: 'Согласие на обработку персональных данных (обязательно true)' }) @IsBoolean() personalData: boolean;
  @ApiPropertyOptional({ description: 'Согласие на рекламные рассылки (необязательно)' }) @IsOptional() @IsBoolean() marketing?: boolean;
}

export class PurchaseCertificateDto {
  @ApiProperty() @IsUUID() productId: string;
  @ApiProperty({ minimum: 1, maximum: 10 }) @IsInt() @Min(1) @Max(10) quantity: number;
  @ApiProperty({ type: PurchaseBuyerDto }) @ValidateNested() @Type(() => PurchaseBuyerDto) buyer: PurchaseBuyerDto;
  @ApiProperty({ type: PurchaseRecipientDto }) @ValidateNested() @Type(() => PurchaseRecipientDto) recipient: PurchaseRecipientDto;
  @ApiPropertyOptional({ description: 'Пожелание получателю (печатается в сертификате)' }) @IsOptional() @IsString() @MaxLength(500) message?: string;
  @ApiProperty({ enum: DELIVERY_CHANNELS }) @IsIn(DELIVERY_CHANNELS as unknown as string[]) deliveryChannel: 'email' | 'whatsapp';
  @ApiProperty({ type: PurchaseConsentDto }) @ValidateNested() @Type(() => PurchaseConsentDto) consent: PurchaseConsentDto;
  @ApiProperty({ enum: LOCALES }) @IsIn(LOCALES as unknown as string[]) locale: Locale;
  @ApiProperty({ description: 'Ключ идемпотентности (генерирует витрина на одну попытку оформления)' })
  @IsString()
  @Length(8, 100)
  idempotencyKey: string;
}

export class PurchaseResultDto {
  @ApiProperty({ description: 'Токен заказа для страницы статуса' }) orderToken: string;
  @ApiProperty() orderId: string;
  @ApiProperty({ enum: ORDER_STATUSES }) status: string;
  @ApiProperty({ type: MoneyDto }) total: MoneyDto;
  @ApiProperty({ type: PaymentLinkDto }) payment: PaymentLinkDto;

  static from(order: CertificateOrder, payment: PaymentView): PurchaseResultDto {
    return { orderToken: order.token, orderId: order.id, status: order.status, total: MoneyDto.from(order.total), payment: PaymentLinkDto.from(payment) };
  }
}

export class MaskedCertificateDto {
  @ApiProperty({ example: '****-****-AB12' }) maskedCode: string;
  @ApiProperty({ enum: CERTIFICATE_STATUSES }) status: string;
  @ApiProperty() expiresAt: Date;
}

export class CertificateOrderStatusDto {
  @ApiProperty({ enum: ORDER_STATUSES }) status: string;
  @ApiProperty() productName: string;
  @ApiProperty({ enum: CERTIFICATE_KINDS }) kind: string;
  @ApiProperty() quantity: number;
  @ApiProperty({ type: MoneyDto }) total: MoneyDto;
  @ApiProperty() recipientName: string;
  @ApiProperty({ enum: MANUAL_DELIVERY_CHANNELS }) deliveryChannel: string;
  @ApiPropertyOptional({ type: PaymentLinkDto, nullable: true }) payment: PaymentLinkDto | null;
  @ApiProperty({ type: [MaskedCertificateDto], description: 'Выпущенные сертификаты (коды — только в PDF и сообщении)' })
  certificates: MaskedCertificateDto[];
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) issuedAt: Date | null;
  @ApiProperty({ description: 'Можно повторить оплату (POST /public/certificates/orders/:token/pay)' }) canPay: boolean;

  static from(v: CertificateOrderStatusView, locale: Locale): CertificateOrderStatusDto {
    return {
      status: v.order.status,
      productName: translate(v.order.product.name, locale),
      kind: v.order.product.kind,
      quantity: v.order.quantity,
      total: MoneyDto.from(v.order.total),
      recipientName: v.order.recipient.name,
      deliveryChannel: v.order.deliveryChannel,
      payment: v.payment ? PaymentLinkDto.from(v.payment) : null,
      certificates: v.certificates.map((c) => {
        const s = c.certificate.snapshot();
        return { maskedCode: maskCertificateCode(s.last4), status: s.status, expiresAt: s.expiresAt };
      }),
      issuedAt: v.order.issuedAt,
      canPay: v.canPay,
    };
  }
}

export class CheckCertificateDto {
  @ApiProperty({ example: 'ABCD-EFGH-JKMN' }) @IsString() @Length(4, 40) code: string;
}

export class CertificateBalanceDto {
  @ApiProperty({ example: '****-****-AB12' }) maskedCode: string;
  @ApiProperty({ enum: CERTIFICATE_KINDS }) kind: string;
  @ApiProperty({ enum: CERTIFICATE_STATUSES }) status: string;
  @ApiProperty({ type: MoneyDto }) nominal: MoneyDto;
  @ApiProperty({ type: MoneyDto }) balance: MoneyDto;
  @ApiProperty() expiresAt: Date;
  @ApiProperty({ description: 'Последний день действия (Asia/Almaty), YYYY-MM-DD' }) validUntil: string;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Состав набора' }) setDescription: string | null;

  static from(v: CertificateBalanceView): CertificateBalanceDto {
    return {
      maskedCode: v.maskedCode,
      kind: v.kind,
      status: v.status,
      nominal: MoneyDto.from(v.nominal),
      balance: MoneyDto.from(v.balance),
      expiresAt: v.expiresAt,
      validUntil: lastValidDate(v.expiresAt),
      setDescription: v.setDescription,
    };
  }
}

// ---------------------------------------------------------------- Админка: продукты

export class CertificateProductInputDto {
  @ApiProperty({ example: 'nominal-10000' }) @IsString() @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/) @MaxLength(80) slug: string;
  @ApiProperty({ enum: CERTIFICATE_KINDS }) @IsIn(CERTIFICATE_KINDS as unknown as string[]) kind: 'amount' | 'set';
  @ApiProperty({ type: TranslatableDto }) @ValidateNested() @Type(() => TranslatableDto) name: TranslatableDto;
  @ApiPropertyOptional({ type: TranslatableDto, description: 'Описание; для набора обязательно (состав набора)' })
  @IsOptional()
  @ValidateNested()
  @Type(() => TranslatableDto)
  description?: TranslatableDto;
  @ApiProperty({ type: MoneyInputDto, description: 'Номинал (для набора — для учёта)' }) @ValidateNested() @Type(() => MoneyInputDto) nominal: MoneyInputDto;
  @ApiProperty({ type: MoneyInputDto, description: 'Цена продажи' }) @ValidateNested() @Type(() => MoneyInputDto) price: MoneyInputDto;
  @ApiPropertyOptional({ default: 12, minimum: 1, maximum: 60 }) @IsOptional() @IsInt() @Min(1) @Max(60) validityMonths?: number;
  @ApiPropertyOptional({ type: CertificateDesignInputDto }) @IsOptional() @ValidateNested() @Type(() => CertificateDesignInputDto)
  design?: CertificateDesignInputDto;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(-10000) @Max(10000) sortOrder?: number;
}

export class CertificateProductDto {
  @ApiProperty() id: string;
  @ApiProperty() slug: string;
  @ApiProperty({ enum: CERTIFICATE_KINDS }) kind: string;
  @ApiProperty({ type: TranslatableDto }) name: TranslatableDto;
  @ApiProperty({ type: TranslatableDto }) description: TranslatableDto;
  @ApiProperty({ type: MoneyDto }) nominal: MoneyDto;
  @ApiProperty({ type: MoneyDto }) price: MoneyDto;
  @ApiProperty() validityMonths: number;
  @ApiProperty({ type: CertificateDesignDto }) design: CertificateDesignDto;
  @ApiProperty() isActive: boolean;
  @ApiProperty() sortOrder: number;
  @ApiProperty({ type: [String], enum: ['kk', 'ru'], description: 'Непереведённые поля подсвечиваются в админке' }) missingLocales: string[];
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;

  static from(p: CertificateProduct): CertificateProductDto {
    return {
      id: p.id,
      slug: p.slug,
      kind: p.kind,
      name: p.name,
      description: p.description,
      nominal: MoneyDto.from(p.nominal),
      price: MoneyDto.from(p.price),
      validityMonths: p.validityMonths,
      design: p.design,
      isActive: p.isActive,
      sortOrder: p.sortOrder,
      missingLocales: (['kk', 'ru'] as const).filter((l) => !p.name[l]),
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }
}

// ---------------------------------------------------------------- Админка: сертификаты

export class CertificatePersonDto {
  @ApiPropertyOptional({ type: String, nullable: true }) name: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) phone: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) email: string | null;
}

export class CertificateDto {
  @ApiProperty() id: string;
  @ApiProperty({ example: '****-****-AB12' }) maskedCode: string;
  @ApiProperty({ enum: CERTIFICATE_KINDS }) kind: string;
  @ApiProperty({ enum: CERTIFICATE_STATUSES }) status: string;
  @ApiPropertyOptional({ type: String, nullable: true }) statusReason: string | null;
  @ApiProperty({ type: TranslatableDto }) name: TranslatableDto;
  @ApiPropertyOptional({ type: TranslatableDto, nullable: true }) setDescription: TranslatableDto | null;
  @ApiProperty({ type: MoneyDto }) nominal: MoneyDto;
  @ApiProperty({ type: MoneyDto }) balance: MoneyDto;
  @ApiProperty({ type: MoneyDto, description: 'Цена продажи' }) price: MoneyDto;
  @ApiProperty() issuedAt: Date;
  @ApiProperty() expiresAt: Date;
  @ApiProperty({ description: 'Последний день действия (Asia/Almaty)' }) validUntil: string;
  @ApiProperty({ type: CertificatePersonDto }) buyer: CertificatePersonDto;
  @ApiProperty({ type: CertificatePersonDto }) recipient: CertificatePersonDto;
  @ApiPropertyOptional({ type: String, nullable: true }) message: string | null;
  @ApiProperty({ enum: MANUAL_DELIVERY_CHANNELS }) deliveryChannel: string;
  @ApiProperty({ enum: LOCALES }) locale: string;
  @ApiProperty() orderId: string;
  @ApiProperty() deliveryCount: number;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) lastDeliveredAt: Date | null;
  @ApiProperty() hasPdf: boolean;

  static from(r: CertificateRecord): CertificateDto {
    const s = r.certificate.snapshot();
    return {
      id: s.id,
      maskedCode: maskCertificateCode(s.last4),
      kind: s.kind,
      status: s.status,
      statusReason: s.statusReason,
      name: s.name,
      setDescription: s.setDescription,
      nominal: MoneyDto.from(s.nominal),
      balance: MoneyDto.from(s.balance),
      price: MoneyDto.from(s.price),
      issuedAt: s.issuedAt,
      expiresAt: s.expiresAt,
      validUntil: lastValidDate(s.expiresAt),
      buyer: { name: r.buyerName, phone: r.buyerPhone, email: r.buyerEmail },
      recipient: { name: r.recipientName, phone: r.recipientPhone, email: r.recipientEmail },
      message: r.message,
      deliveryChannel: r.deliveryChannel,
      locale: r.locale,
      orderId: s.orderId,
      deliveryCount: r.deliveryCount,
      lastDeliveredAt: r.lastDeliveredAt,
      hasPdf: !!r.pdfFileKey,
    };
  }
}

export class CertificatesPageDto {
  @ApiProperty({ type: [CertificateDto] }) items: CertificateDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() perPage: number;
}

export class CertificateLedgerEntryDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: ['issue', 'debit', 'credit', 'expire', 'reinstate'] }) kind: string;
  @ApiProperty({ type: MoneyDto }) amount: MoneyDto;
  @ApiProperty({ type: MoneyDto }) balanceAfter: MoneyDto;
  @ApiProperty({ enum: ['order', 'point', 'refund', 'sale', 'system', 'admin'] }) channel: string;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) paymentId: string | null;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) refundId: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) referenceType: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) referenceId: string | null;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) branchId: string | null;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) actorUserId: string | null;
  @ApiProperty() actorName: string;
  @ApiPropertyOptional({ type: String, nullable: true }) comment: string | null;
  @ApiProperty() occurredAt: Date;

  static from(e: LedgerEntry): CertificateLedgerEntryDto {
    return { ...e, amount: MoneyDto.from(e.amount), balanceAfter: MoneyDto.from(e.balanceAfter) };
  }
}

export class CertificateOrderSummaryDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: ['online', 'manual'] }) source: string;
  @ApiProperty({ enum: ORDER_STATUSES }) status: string;
  @ApiProperty() quantity: number;
  @ApiProperty({ type: MoneyDto }) total: MoneyDto;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) paymentId: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) buyerCompany: string | null;
  @ApiProperty() createdAt: Date;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) issuedAt: Date | null;

  static from(o: CertificateOrder): CertificateOrderSummaryDto {
    return {
      id: o.id,
      source: o.source,
      status: o.status,
      quantity: o.quantity,
      total: MoneyDto.from(o.total),
      paymentId: o.paymentId,
      buyerCompany: o.buyer.company,
      createdAt: o.createdAt,
      issuedAt: o.issuedAt,
    };
  }
}

export class CertificateDetailsDto {
  @ApiProperty({ type: CertificateDto }) certificate: CertificateDto;
  @ApiProperty({ type: [CertificateLedgerEntryDto], description: 'Движения: выпуск, списания, возвраты, сгорание' })
  ledger: CertificateLedgerEntryDto[];
  @ApiPropertyOptional({ type: CertificateOrderSummaryDto, nullable: true }) order: CertificateOrderSummaryDto | null;

  static from(d: CertificateDetails): CertificateDetailsDto {
    return {
      certificate: CertificateDto.from(d.record),
      ledger: d.ledger.map(CertificateLedgerEntryDto.from),
      order: d.order ? CertificateOrderSummaryDto.from(d.order) : null,
    };
  }
}

export class CertificateListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: 'Последние 4 символа кода' }) @IsOptional() @IsString() @MaxLength(20) q?: string;
  @ApiPropertyOptional({ description: 'Телефон покупателя или получателя' }) @IsOptional() @IsString() @MaxLength(32) phone?: string;
  @ApiPropertyOptional({ enum: CERTIFICATE_STATUSES }) @IsOptional() @IsIn(CERTIFICATE_STATUSES as unknown as string[])
  status?: 'active' | 'redeemed' | 'expired' | 'blocked';
  @ApiPropertyOptional() @IsOptional() @IsUUID() orderId?: string;
}

export class AdminCertificateBalanceDto extends CertificateBalanceDto {
  @ApiProperty() id: string;
}

export class RedeemCertificateDto {
  @ApiProperty({ example: 'ABCD-EFGH-JKMN' }) @IsString() @Length(4, 40) code: string;
  @ApiPropertyOptional({ type: MoneyInputDto, description: 'Сумма списания; для набора не задаётся (погашается целиком)' })
  @IsOptional()
  @ValidateNested()
  @Type(() => MoneyInputDto)
  amount?: MoneyInputDto;
  @ApiProperty({ description: 'Филиал, где погашается сертификат' }) @IsUUID() branchId: string;
  @ApiPropertyOptional({ description: 'Комментарий (номер чека POS)' }) @IsOptional() @IsString() @MaxLength(500) comment?: string;
}

export class RedeemResultDto {
  @ApiProperty({ type: AdminCertificateBalanceDto }) certificate: AdminCertificateBalanceDto;
  @ApiProperty({ type: CertificateLedgerEntryDto }) transaction: CertificateLedgerEntryDto;
}

export class BlockCertificateDto {
  @ApiProperty({ example: 'Утерян владельцем' }) @IsString() @Length(2, 500) reason: string;
}

export class UnblockCertificateDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class ExtendCertificateDto {
  @ApiProperty({ description: 'Новый последний день действия (включительно), YYYY-MM-DD', example: '2027-12-31' })
  @Matches(DATE_RE)
  validUntil: string;
  @ApiProperty() @IsString() @Length(2, 500) reason: string;
}

export class ResendCertificateDto {
  @ApiPropertyOptional({ enum: DELIVERY_CHANNELS }) @IsOptional() @IsIn(DELIVERY_CHANNELS as unknown as string[]) channel?: 'email' | 'whatsapp';
  @ApiPropertyOptional({ description: 'Другой email получателя' }) @IsOptional() @IsEmail() email?: string;
  @ApiPropertyOptional({ description: 'Другой телефон получателя' }) @IsOptional() @IsString() @MaxLength(32) phone?: string;
}

export class ManualBuyerDto {
  @ApiProperty({ description: 'Контактное лицо' }) @IsString() @Length(2, 120) name: string;
  @ApiPropertyOptional({ description: 'Компания-покупатель' }) @IsOptional() @IsString() @MaxLength(300) company?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;
}

export class ManualIssueDto {
  @ApiProperty() @IsUUID() productId: string;
  @ApiProperty({ minimum: 1, maximum: 100 }) @IsInt() @Min(1) @Max(100) quantity: number;
  @ApiPropertyOptional({ type: MoneyInputDto, description: 'Итог по договору; по умолчанию цена × количество' })
  @IsOptional()
  @ValidateNested()
  @Type(() => MoneyInputDto)
  total?: MoneyInputDto;
  @ApiProperty({ type: ManualBuyerDto }) @ValidateNested() @Type(() => ManualBuyerDto) buyer: ManualBuyerDto;
  @ApiPropertyOptional({ type: PurchaseRecipientDto, description: 'По умолчанию — покупатель' })
  @IsOptional()
  @ValidateNested()
  @Type(() => PurchaseRecipientDto)
  recipient?: PurchaseRecipientDto;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) message?: string;
  @ApiProperty({ enum: MANUAL_DELIVERY_CHANNELS, description: 'none — PDF скачиваются из админки' })
  @IsIn(MANUAL_DELIVERY_CHANNELS as unknown as string[])
  deliveryChannel: 'email' | 'whatsapp' | 'none';
  @ApiProperty({ enum: LOCALES }) @IsIn(LOCALES as unknown as string[]) locale: Locale;
  @ApiProperty({ description: 'Номер платёжного поручения' }) @IsString() @Length(1, 60) documentNumber: string;
  @ApiProperty({ description: 'Дата поступления (ISO 8601)' }) @IsISO8601() paidAt: string;
  @ApiProperty() @IsString() @Length(8, 100) idempotencyKey: string;
}

export class ManualIssueResultDto {
  @ApiProperty({ type: CertificateOrderSummaryDto }) order: CertificateOrderSummaryDto;
  @ApiProperty({ type: PaymentLinkDto }) payment: PaymentLinkDto;
  @ApiProperty({ type: [CertificateDto] }) certificates: CertificateDto[];
}

export class PdfLinkDto {
  @ApiProperty({ description: 'Подписанная ссылка на PDF (содержит полный код)' }) url: string;
  @ApiProperty() expiresInSeconds: number;
}

export class CertificateReportQueryDto {
  @ApiProperty({ example: '2026-10-01' }) @Matches(DATE_RE) from: string;
  @ApiProperty({ example: '2026-10-31' }) @Matches(DATE_RE) to: string;
}

export class ReportCountAmountDto {
  @ApiProperty() count: number;
  @ApiProperty({ type: MoneyDto }) amount: MoneyDto;
}

export class ReportIssuedDto {
  @ApiProperty() count: number;
  @ApiProperty({ type: MoneyDto, description: 'Сумма номиналов' }) nominal: MoneyDto;
  @ApiProperty({ type: MoneyDto, description: 'Выручка от продажи' }) price: MoneyDto;
}

export class ReportRedeemedDto {
  @ApiProperty({ description: 'Операций списания' }) operations: number;
  @ApiProperty({ description: 'Сертификатов, по которым были списания' }) certificates: number;
  @ApiProperty({ type: MoneyDto }) amount: MoneyDto;
}

export class ReportLiabilityDto {
  @ApiProperty({ type: ReportCountAmountDto, description: 'Активные сертификаты: остаток обязательств' }) active: ReportCountAmountDto;
  @ApiProperty({ type: ReportCountAmountDto, description: 'Заблокированные (остаток, не доступный к списанию)' }) blocked: ReportCountAmountDto;
}

export class CertificateReportDto {
  @ApiProperty() from: string;
  @ApiProperty() to: string;
  @ApiProperty({ type: ReportIssuedDto }) issued: ReportIssuedDto;
  @ApiProperty({ type: ReportRedeemedDto }) redeemed: ReportRedeemedDto;
  @ApiProperty({ type: ReportCountAmountDto, description: 'Возвращено на сертификаты (отмена заказов)' }) returned: ReportCountAmountDto;
  @ApiProperty({ type: ReportCountAmountDto, description: 'Просрочено (сгоревший остаток)' }) expired: ReportCountAmountDto;
  @ApiProperty({ type: ReportCountAmountDto, description: 'Восстановлено продлением срока' }) reinstated: ReportCountAmountDto;
  @ApiProperty({ type: ReportLiabilityDto, description: 'Остаток обязательств на момент запроса' }) liability: ReportLiabilityDto;

  static from(r: CertificateReport): CertificateReportDto {
    const m = (amount: number) => ({ amount, currency: 'KZT' as const });
    const t = r.totals;
    return {
      from: r.from,
      to: r.to,
      issued: { count: t.issued.count, nominal: m(t.issued.nominal), price: m(t.issued.price) },
      redeemed: { operations: t.redeemed.operations, certificates: t.redeemed.certificates, amount: m(t.redeemed.amount) },
      returned: { count: t.returned.operations, amount: m(t.returned.amount) },
      expired: { count: t.expired.count, amount: m(t.expired.amount) },
      reinstated: { count: t.reinstated.count, amount: m(t.reinstated.amount) },
      liability: {
        active: { count: t.liability.active.count, amount: m(t.liability.active.amount) },
        blocked: { count: t.liability.blocked.count, amount: m(t.liability.blocked.amount) },
      },
    };
  }
}
