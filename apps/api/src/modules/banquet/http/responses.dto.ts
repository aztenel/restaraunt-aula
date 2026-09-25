import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MoneyDto, PageDtoOf, TranslatableDto } from '../../../shared/infrastructure/http/api-types';
import { Translatable } from '../../../shared/kernel/translatable';
import { ALL_BANQUET_STATUSES } from '../domain/banquet-status';
import { ESF_STATUSES, EsfStatus } from '../domain/esf';
import { INVOICE_PURPOSES, InvoicePurpose, InvoiceStatus, PAYER_TYPES, PayerType } from '../domain/invoice';
import { BANQUET_EVENT_TYPES, QUOTE_LINE_KINDS, QuoteLineKind } from '../domain/texts';
import { ACTIVITY_KINDS, ActivityKind } from '../infrastructure/activity.repository';
import { DOCUMENT_KINDS, DocumentKind } from '../infrastructure/document.repository';
import { BanquetStatus } from '../public';

/** Ответы API модуля Banquet (полностью описаны для генерации клиента по OpenAPI). */
const DATE_TIME = { type: String, format: 'date-time' } as const;
const INVOICE_STATUSES: InvoiceStatus[] = ['issued', 'partially_paid', 'paid', 'cancelled'];

export class ContactDto {
  @ApiProperty({ nullable: true, type: String, description: 'Гость в базе гостей' }) customerId: string | null;
  @ApiProperty() name: string;
  @ApiProperty({ example: '+77011234567' }) phone: string;
  @ApiProperty({ nullable: true, type: String }) email: string | null;
}

export class RequestSummaryDto {
  @ApiProperty() id: string;
  @ApiProperty({ example: 'GL-B-2026-000001' }) number: string;
  @ApiProperty({ enum: ALL_BANQUET_STATUSES }) status: BanquetStatus;
  @ApiProperty({ enum: ['web', 'admin'] }) source: 'web' | 'admin';
  @ApiProperty({ nullable: true, type: String }) branchId: string | null;
  @ApiProperty({ nullable: true, type: TranslatableDto }) branchName: Translatable | null;
  @ApiProperty() isOffsite: boolean;
  @ApiProperty({ nullable: true, type: String }) offsiteAddress: string | null;
  @ApiProperty({ example: '2026-11-14' }) eventDate: string;
  @ApiProperty({ nullable: true, type: String, example: '18:00' }) eventTime: string | null;
  @ApiProperty({ enum: BANQUET_EVENT_TYPES }) eventType: string;
  @ApiProperty() guests: number;
  @ApiProperty({ nullable: true, type: MoneyDto }) budget: MoneyDto | null;
  @ApiProperty({ type: ContactDto }) contact: ContactDto;
  @ApiProperty() managerId: string;
  @ApiProperty() managerName: string;
  @ApiProperty({ nullable: true, type: Number }) quoteVersion: number | null;
  @ApiProperty({ nullable: true, type: MoneyDto, description: 'Итог последней версии сметы' }) quoteTotal: MoneyDto | null;
  @ApiProperty({ ...DATE_TIME, description: 'Срок первого ответа (30 минут)' }) slaDeadline: Date;
  @ApiProperty() slaBreached: boolean;
  @ApiProperty({ ...DATE_TIME, nullable: true }) firstResponseAt: Date | null;
  @ApiProperty(DATE_TIME) createdAt: Date;
  @ApiProperty(DATE_TIME) updatedAt: Date;
}

export class RequestsPageDto extends PageDtoOf(RequestSummaryDto) {}

export class PipelineColumnDto {
  @ApiProperty({ enum: ALL_BANQUET_STATUSES }) status: BanquetStatus;
  @ApiProperty() count: number;
  @ApiProperty({ type: [RequestSummaryDto] }) items: RequestSummaryDto[];
}

export class DiscountDto {
  @ApiProperty({ enum: ['percent', 'amount'] }) type: 'percent' | 'amount';
  @ApiProperty({ nullable: true, type: Number, description: 'Процент, базисные пункты' }) bp: number | null;
  @ApiProperty({ nullable: true, type: MoneyDto }) amount: MoneyDto | null;
}

export class QuoteLineDto {
  @ApiProperty() position: number;
  @ApiProperty({ enum: QUOTE_LINE_KINDS }) kind: QuoteLineKind;
  @ApiProperty({ nullable: true, type: String }) dishId: string | null;
  @ApiProperty({ type: TranslatableDto }) title: Translatable;
  @ApiProperty() unit: string;
  @ApiProperty() quantity: number;
  @ApiProperty({ type: MoneyDto }) unitPrice: MoneyDto;
  @ApiProperty({ nullable: true, type: DiscountDto }) discount: DiscountDto | null;
  @ApiProperty({ type: MoneyDto, description: 'Цена × количество' }) gross: MoneyDto;
  @ApiProperty({ type: MoneyDto }) discountAmount: MoneyDto;
  @ApiProperty({ type: MoneyDto }) total: MoneyDto;
}

export class QuoteTotalsDto {
  @ApiProperty({ type: MoneyDto }) subtotal: MoneyDto;
  @ApiProperty({ type: MoneyDto }) linesDiscount: MoneyDto;
  @ApiProperty({ type: MoneyDto }) overallDiscount: MoneyDto;
  @ApiProperty({ type: MoneyDto }) discount: MoneyDto;
  @ApiProperty({ type: MoneyDto }) service: MoneyDto;
  @ApiProperty({ type: MoneyDto }) total: MoneyDto;
  @ApiProperty({ type: MoneyDto, description: 'НДС, включённый в итог' }) vat: MoneyDto;
  @ApiProperty({ type: MoneyDto }) perGuest: MoneyDto;
}

export class PartyShortDto {
  @ApiProperty() name: string;
  @ApiProperty({ nullable: true, type: String }) bin: string | null;
}

export class QuoteSummaryDto {
  @ApiProperty() id: string;
  @ApiProperty() requestId: string;
  @ApiProperty() version: number;
  @ApiProperty() guests: number;
  @ApiProperty({ type: MoneyDto }) total: MoneyDto;
  @ApiProperty({ type: MoneyDto }) vat: MoneyDto;
  @ApiProperty() linesCount: number;
  @ApiProperty({ nullable: true, type: String }) validUntil: string | null;
  @ApiProperty() createdByName: string;
  @ApiProperty(DATE_TIME) createdAt: Date;
  @ApiProperty({ ...DATE_TIME, nullable: true }) sentAt: Date | null;
  @ApiProperty({ ...DATE_TIME, nullable: true }) acceptedAt: Date | null;
  @ApiProperty() isLatest: boolean;
}

export class QuoteDto {
  @ApiProperty() id: string;
  @ApiProperty() requestId: string;
  @ApiProperty() version: number;
  @ApiProperty({ nullable: true, type: String }) branchId: string | null;
  @ApiProperty() guests: number;
  @ApiProperty({ nullable: true, type: DiscountDto }) discount: DiscountDto | null;
  @ApiProperty() serviceChargeBp: number;
  @ApiProperty() vatPayer: boolean;
  @ApiProperty() vatRateBp: number;
  @ApiProperty({ type: [QuoteLineDto] }) lines: QuoteLineDto[];
  @ApiProperty({ type: QuoteTotalsDto }) totals: QuoteTotalsDto;
  @ApiProperty({ nullable: true, type: String }) validUntil: string | null;
  @ApiProperty({ nullable: true, type: String }) notes: string | null;
  @ApiProperty({ type: PartyShortDto }) seller: { name: string; bin: string };
  @ApiProperty() pdfReady: boolean;
  @ApiProperty() createdByName: string;
  @ApiProperty(DATE_TIME) createdAt: Date;
  @ApiProperty({ ...DATE_TIME, nullable: true }) sentAt: Date | null;
  @ApiProperty({ ...DATE_TIME, nullable: true }) acceptedAt: Date | null;
  @ApiProperty() isLatest: boolean;
}

export class InvoicePaymentDto {
  @ApiProperty() paymentId: string;
  @ApiProperty({ example: 'bank_transfer' }) method: string;
  @ApiProperty({ type: MoneyDto }) amount: MoneyDto;
  @ApiProperty({ type: MoneyDto }) refunded: MoneyDto;
  @ApiProperty({ nullable: true, type: String }) documentNumber: string | null;
  @ApiProperty(DATE_TIME) paidAt: Date;
  @ApiProperty() recordedByName: string;
}

export class InvoiceDto {
  @ApiProperty() id: string;
  @ApiProperty() requestId: string;
  @ApiProperty({ example: 'GL-S-2026-000001' }) number: string;
  @ApiProperty({ nullable: true, type: String }) branchId: string | null;
  @ApiProperty({ enum: PAYER_TYPES }) payerType: PayerType;
  @ApiProperty({ nullable: true, type: String }) companyId: string | null;
  @ApiProperty({ type: PartyShortDto }) buyer: PartyShortDto;
  @ApiProperty({ enum: INVOICE_PURPOSES }) purpose: InvoicePurpose;
  @ApiProperty() description: string;
  @ApiProperty({ type: MoneyDto }) amount: MoneyDto;
  @ApiProperty({ type: MoneyDto }) vat: MoneyDto;
  @ApiProperty() vatRateBp: number;
  @ApiProperty({ type: MoneyDto }) paid: MoneyDto;
  @ApiProperty({ type: MoneyDto }) refunded: MoneyDto;
  @ApiProperty({ type: MoneyDto }) remaining: MoneyDto;
  @ApiProperty() dueDate: string;
  @ApiProperty({ enum: INVOICE_STATUSES }) status: InvoiceStatus;
  @ApiProperty({ description: 'Срок оплаты прошёл, счёт оплачен не полностью' }) overdue: boolean;
  @ApiProperty({ nullable: true, type: String, description: 'Онлайн-платёж (физлицо)' }) paymentId: string | null;
  @ApiProperty({ description: 'Страница счёта для клиента' }) publicUrl: string;
  @ApiProperty() pdfReady: boolean;
  @ApiProperty(DATE_TIME) issuedAt: Date;
  @ApiProperty({ ...DATE_TIME, nullable: true }) paidAt: Date | null;
  @ApiProperty({ ...DATE_TIME, nullable: true }) cancelledAt: Date | null;
  @ApiProperty({ nullable: true, type: String }) cancelReason: string | null;
  @ApiProperty({ type: [InvoicePaymentDto] }) payments: InvoicePaymentDto[];
}

export class InvoiceListItemDto extends InvoiceDto {
  @ApiProperty() requestNumber: string;
}

export class InvoicesPageDto extends PageDtoOf(InvoiceListItemDto) {}

export class BankTransferResultDto {
  @ApiProperty({ type: InvoiceDto }) invoice: InvoiceDto;
  @ApiProperty() paymentId: string;
  @ApiProperty({ description: 'Этот документ уже был зарегистрирован (повтор)' }) duplicate: boolean;
}

export class EsfDto {
  @ApiProperty({ enum: ESF_STATUSES }) status: EsfStatus;
  @ApiProperty({ nullable: true, type: String }) provider: string | null;
  @ApiProperty({ nullable: true, type: String }) esfId: string | null;
  @ApiProperty({ nullable: true, type: String }) registrationNumber: string | null;
  @ApiProperty({ nullable: true, type: String }) error: string | null;
  @ApiProperty({ ...DATE_TIME, nullable: true }) updatedAt: Date | null;
}

export class ActDto {
  @ApiProperty() id: string;
  @ApiProperty({ example: 'GL-A-2026-000001' }) number: string;
  @ApiProperty() actDate: string;
  @ApiProperty({ enum: PAYER_TYPES }) payerType: PayerType;
  @ApiProperty({ type: PartyShortDto }) buyer: PartyShortDto;
  @ApiProperty({ type: MoneyDto }) amount: MoneyDto;
  @ApiProperty({ type: MoneyDto }) vat: MoneyDto;
  @ApiProperty({ type: EsfDto }) esf: EsfDto;
  @ApiProperty(DATE_TIME) createdAt: Date;
}

export class DocumentDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: DOCUMENT_KINDS }) kind: DocumentKind;
  @ApiProperty({ nullable: true, type: String }) number: string | null;
  @ApiProperty() title: string;
  @ApiProperty() filename: string;
  @ApiProperty() contentType: string;
  @ApiProperty() createdByName: string;
  @ApiProperty(DATE_TIME) createdAt: Date;
}

export class ActivityDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: ACTIVITY_KINDS }) kind: ActivityKind;
  @ApiProperty({ nullable: true, type: String }) text: string | null;
  @ApiProperty({ type: 'object', additionalProperties: true }) data: Record<string, unknown>;
  @ApiProperty({ enum: ['staff', 'system', 'guest'] }) authorKind: 'staff' | 'system' | 'guest';
  @ApiProperty() authorName: string;
  @ApiProperty(DATE_TIME) occurredAt: Date;
}

export class CompanyDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() bin: string;
  @ApiProperty() legalAddress: string;
  @ApiProperty({ nullable: true, type: String }) bankName: string | null;
  @ApiProperty({ nullable: true, type: String }) iban: string | null;
  @ApiProperty({ nullable: true, type: String }) bik: string | null;
  @ApiProperty({ nullable: true, type: String }) kbe: string | null;
  @ApiProperty({ nullable: true, type: String }) directorName: string | null;
  @ApiProperty({ nullable: true, type: String }) directorPosition: string | null;
  @ApiProperty({ nullable: true, type: String }) actingBasis: string | null;
  @ApiProperty({ nullable: true, type: String }) contactName: string | null;
  @ApiProperty({ nullable: true, type: String }) contactPhone: string | null;
  @ApiProperty({ nullable: true, type: String }) contactEmail: string | null;
  @ApiProperty(DATE_TIME) createdAt: Date;
  @ApiProperty(DATE_TIME) updatedAt: Date;
}

export class CompaniesPageDto extends PageDtoOf(CompanyDto) {}

export class VenueHoldDto {
  @ApiProperty() venueId: string;
  @ApiProperty({ nullable: true, type: TranslatableDto }) venueName: Translatable | null;
  @ApiProperty({ description: 'Занятость в модуле бронирования' }) reservationId: string;
  @ApiProperty(DATE_TIME) start: Date;
  @ApiProperty(DATE_TIME) end: Date;
}

export class PrepaymentStateDto {
  @ApiProperty({ nullable: true, type: MoneyDto, description: 'Требуемая предоплата (по умолчанию 50% сметы)' }) required: MoneyDto | null;
  @ApiProperty({ type: MoneyDto }) paid: MoneyDto;
  @ApiProperty({ nullable: true, type: MoneyDto }) remaining: MoneyDto | null;
  @ApiProperty() covered: boolean;
  @ApiProperty({ description: 'Сумму задал менеджер' }) isCustom: boolean;
}

export class BalanceDto {
  @ApiProperty({ nullable: true, type: MoneyDto }) quoteTotal: MoneyDto | null;
  @ApiProperty({ type: MoneyDto }) invoiced: MoneyDto;
  @ApiProperty({ type: MoneyDto }) paid: MoneyDto;
  @ApiProperty({ nullable: true, type: MoneyDto }) remaining: MoneyDto | null;
}

export class RequestDetailDto extends RequestSummaryDto {
  @ApiProperty({ nullable: true, type: String }) wishes: string | null;
  @ApiProperty() locale: string;
  @ApiProperty({ nullable: true, type: CompanyDto }) company: CompanyDto | null;
  @ApiProperty({ enum: ALL_BANQUET_STATUSES, isArray: true, description: 'Переходы, доступные сейчас' }) allowedTransitions: BanquetStatus[];
  @ApiProperty({ nullable: true, type: VenueHoldDto }) venue: VenueHoldDto | null;
  @ApiProperty({ type: PrepaymentStateDto }) prepayment: PrepaymentStateDto;
  @ApiProperty({ type: BalanceDto }) balance: BalanceDto;
  @ApiProperty({ nullable: true, type: String }) contractNumber: string | null;
  @ApiProperty({ nullable: true, type: String }) contractDate: string | null;
  @ApiProperty({ nullable: true, type: String }) cancelReason: string | null;
  @ApiProperty({ ...DATE_TIME, nullable: true }) heldAt: Date | null;
  @ApiProperty({ ...DATE_TIME, nullable: true }) cancelledAt: Date | null;
  @ApiProperty({ description: 'Ссылка на страницу сметы для клиента' }) publicQuoteUrl: string;
  @ApiProperty({ type: [QuoteSummaryDto] }) quotes: QuoteSummaryDto[];
  @ApiProperty({ type: [InvoiceDto] }) invoices: InvoiceDto[];
  @ApiProperty({ nullable: true, type: ActDto }) act: ActDto | null;
  @ApiProperty({ type: [DocumentDto] }) documents: DocumentDto[];
  @ApiProperty({ type: [ActivityDto] }) timeline: ActivityDto[];
}

export class SignedLinkDto {
  @ApiProperty() url: string;
  @ApiProperty(DATE_TIME) expiresAt: Date;
  @ApiProperty() filename: string;
}

export class IdDto {
  @ApiProperty() id: string;
}

export class RefundResultDto {
  @ApiProperty() id: string;
  @ApiProperty() paymentId: string;
  @ApiProperty({ type: MoneyDto }) amount: MoneyDto;
  @ApiProperty({ enum: ['pending', 'succeeded', 'failed'] }) status: 'pending' | 'succeeded' | 'failed';
  @ApiProperty() reason: string;
  @ApiProperty(DATE_TIME) createdAt: Date;
}

export class ManagerDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ nullable: true, type: String }) phone: string | null;
  @ApiProperty() email: string;
  @ApiProperty({ description: 'Открытых заявок' }) openRequests: number;
}

export class SlaFiguresDto {
  @ApiProperty() total: number;
  @ApiProperty() answered: number;
  @ApiProperty() answeredWithinSla: number;
  @ApiProperty({ nullable: true, type: Number, description: 'Доля ответов за 30 минут, bp (9500 = 95%)' }) withinSlaShareBp: number | null;
  @ApiProperty() breached: number;
  @ApiProperty() unanswered: number;
  @ApiProperty({ description: 'Отменены без ответа менеджера' }) lost: number;
  @ApiProperty({ nullable: true, type: Number }) averageFirstResponseMinutes: number | null;
}

export class ManagerSlaDto extends SlaFiguresDto {
  @ApiProperty() managerId: string;
  @ApiProperty() managerName: string;
}

export class SlaStatsDto extends SlaFiguresDto {
  @ApiProperty() from: string;
  @ApiProperty() to: string;
  @ApiProperty({ description: 'Целевая доля (ТЗ: 95%)' }) targetShareBp: number;
  @ApiProperty({ type: [ManagerSlaDto] }) byManager: ManagerSlaDto[];
}

export class CalendarVenueDto {
  @ApiProperty() id: string;
  @ApiProperty() branchId: string;
  @ApiProperty() hallId: string;
  @ApiProperty({ type: TranslatableDto }) hallName: Translatable;
  @ApiProperty({ type: TranslatableDto }) name: Translatable;
  @ApiProperty() typeId: string;
  @ApiProperty() typeCode: string;
  @ApiProperty({ type: TranslatableDto }) typeName: Translatable;
  @ApiProperty() capacityMin: number;
  @ApiProperty() capacityMax: number;
  @ApiProperty({ nullable: true, type: MoneyDto }) deposit: MoneyDto | null;
  @ApiProperty() isActive: boolean;
}

export class OccupancyDto {
  @ApiProperty() reservationId: string;
  @ApiProperty() venueId: string;
  @ApiProperty({ enum: ['regular', 'banquet'] }) kind: string;
  @ApiProperty() status: string;
  @ApiProperty() start: string;
  @ApiProperty() end: string;
  @ApiProperty() guests: number;
  @ApiProperty({ nullable: true, type: String }) banquetRequestId: string | null;
}

export class CalendarDto {
  @ApiProperty() branchId: string;
  @ApiProperty() from: string;
  @ApiProperty() to: string;
  @ApiProperty({ type: [CalendarVenueDto] }) venues: CalendarVenueDto[];
  @ApiProperty({ type: [OccupancyDto], description: 'Занятость залов: брони и банкеты' }) occupancy: OccupancyDto[];
  @ApiProperty({ type: [RequestSummaryDto] }) banquets: RequestSummaryDto[];
}

export class DishOptionDto {
  @ApiProperty() dishId: string;
  @ApiProperty({ type: TranslatableDto }) name: Translatable;
  @ApiProperty({ type: MoneyDto, description: 'Цена в филиале сейчас' }) price: MoneyDto;
  @ApiProperty({ enum: ['available', 'stopped_shown', 'stopped_hidden'] }) availability: string;
  @ApiProperty({ nullable: true, type: String }) photoUrl: string | null;
  @ApiProperty({ nullable: true, type: Number }) weightGrams: number | null;
}

export class ContractTemplateDto {
  @ApiProperty() id: string;
  @ApiProperty() code: string;
  @ApiProperty() name: string;
  @ApiProperty() body: string;
  @ApiProperty() isDefault: boolean;
  @ApiProperty(DATE_TIME) createdAt: Date;
  @ApiProperty(DATE_TIME) updatedAt: Date;
}

export class PlaceholderDto {
  @ApiProperty({ example: 'seller.name' }) key: string;
  @ApiProperty() description: string;
}

// ---------------------------------------------------------------- витрина

export class PublicRequestCreatedDto {
  @ApiProperty({ example: 'GL-B-2026-000001' }) number: string;
  @ApiProperty({ enum: ALL_BANQUET_STATUSES }) status: BanquetStatus;
  @ApiProperty({ description: 'Ваш менеджер' }) managerName: string;
  @ApiProperty({ nullable: true, type: String }) managerPhone: string | null;
}

export class EventTypeDto {
  @ApiProperty({ enum: BANQUET_EVENT_TYPES }) code: string;
  @ApiProperty() label: string;
}

export class PublicQuoteLineDto {
  @ApiProperty() title: string;
  @ApiProperty() unit: string;
  @ApiProperty() quantity: number;
  @ApiProperty({ type: MoneyDto }) unitPrice: MoneyDto;
  @ApiProperty({ nullable: true, type: DiscountDto }) discount: DiscountDto | null;
  @ApiProperty({ type: MoneyDto }) total: MoneyDto;
}

export class PublicManagerDto {
  @ApiProperty() name: string;
  @ApiProperty({ nullable: true, type: String }) phone: string | null;
}

export class PublicQuoteDto {
  @ApiProperty() requestNumber: string;
  @ApiProperty({ enum: ALL_BANQUET_STATUSES }) status: BanquetStatus;
  @ApiProperty() statusLabel: string;
  @ApiProperty() eventDate: string;
  @ApiProperty({ nullable: true, type: String }) eventTime: string | null;
  @ApiProperty({ enum: BANQUET_EVENT_TYPES }) eventType: string;
  @ApiProperty() eventTypeLabel: string;
  @ApiProperty() guests: number;
  @ApiProperty() place: string;
  @ApiProperty() version: number;
  @ApiProperty({ type: [PublicQuoteLineDto] }) lines: PublicQuoteLineDto[];
  @ApiProperty({ type: MoneyDto }) subtotal: MoneyDto;
  @ApiProperty({ type: MoneyDto }) discount: MoneyDto;
  @ApiProperty() serviceChargeBp: number;
  @ApiProperty({ type: MoneyDto }) service: MoneyDto;
  @ApiProperty({ type: MoneyDto }) total: MoneyDto;
  @ApiProperty() vatPayer: boolean;
  @ApiProperty() vatRateBp: number;
  @ApiProperty({ type: MoneyDto, description: 'в т.ч. НДС' }) vat: MoneyDto;
  @ApiProperty({ type: MoneyDto }) perGuest: MoneyDto;
  @ApiProperty({ nullable: true, type: String }) validUntil: string | null;
  @ApiProperty({ nullable: true, type: String }) notes: string | null;
  @ApiProperty({ description: 'Можно согласовать сейчас' }) canAccept: boolean;
  @ApiProperty() accepted: boolean;
  @ApiProperty({ description: 'PDF сметы (подписанная ссылка)' }) pdfUrl: string;
  @ApiProperty({ type: PublicManagerDto }) manager: PublicManagerDto;
}

export class PublicAcceptResultDto {
  @ApiProperty({ enum: ALL_BANQUET_STATUSES }) status: BanquetStatus;
  @ApiProperty() version: number;
  @ApiProperty({ nullable: true, type: MoneyDto, description: 'Требуемая предоплата' }) prepayment: MoneyDto | null;
}

export class PublicSellerDto {
  @ApiProperty() name: string;
  @ApiProperty() bin: string;
  @ApiProperty() iban: string;
  @ApiProperty() bik: string;
  @ApiProperty() bankName: string;
  @ApiProperty() kbe: string;
}

export class PublicInvoiceDto {
  @ApiProperty() number: string;
  @ApiProperty() requestNumber: string;
  @ApiProperty({ enum: INVOICE_STATUSES }) status: InvoiceStatus;
  @ApiProperty({ enum: PAYER_TYPES }) payerType: PayerType;
  @ApiProperty() description: string;
  @ApiProperty({ type: MoneyDto }) amount: MoneyDto;
  @ApiProperty({ type: MoneyDto }) paid: MoneyDto;
  @ApiProperty({ type: MoneyDto }) remaining: MoneyDto;
  @ApiProperty() vatRateBp: number;
  @ApiProperty({ type: MoneyDto }) vat: MoneyDto;
  @ApiProperty() dueDate: string;
  @ApiProperty() overdue: boolean;
  @ApiProperty({ nullable: true, type: String, description: 'Ссылка на оплату (появляется асинхронно)' }) paymentUrl: string | null;
  @ApiProperty({ nullable: true, type: String }) paymentStatus: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'PDF счёта на оплату (юрлицо)' }) pdfUrl: string | null;
  @ApiPropertyOptional({ nullable: true, type: PublicSellerDto }) seller: PublicSellerDto | null;
}
