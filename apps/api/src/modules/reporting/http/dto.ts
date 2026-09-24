import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { MoneyDto, MoneyInputDto, TranslatableDto } from '../../../shared/infrastructure/http/api-types';
import { WEEKDAYS } from '../../../shared/kernel/time';
import { TOP_DISHES_SORTS } from '../application/reports/orders.queries';
import { ACCOUNTING_EXPORT_FORMATS } from '../domain/accounting-export';
import { BANQUET_STAGES } from '../domain/banquet-funnel';
import { SALES_CHANNELS } from '../domain/revenue';
import { STOREFRONT_EVENT_TYPES } from '../domain/storefront';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const RATIO = 'Доля 0..1 с точностью 4 знака (0.1234 = 12.34%); null — не определена (знаменатель 0)';

// ---------------------------------------------------------------- запросы

export class ReportQueryDto {
  @ApiPropertyOptional({ example: '2026-09-01', description: 'Начало периода (локальная дата Asia/Almaty). По умолчанию — 30 дней до to' })
  @IsOptional()
  @Matches(DATE_RE)
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-30', description: 'Конец периода включительно. По умолчанию — сегодня' })
  @IsOptional()
  @Matches(DATE_RE)
  to?: string;

  @ApiPropertyOptional({ description: 'Филиал (право reports.branch). Без филиала — сводный отчёт (право reports.consolidated)' })
  @IsOptional()
  @IsUUID()
  branchId?: string;
}

export class BranchQueryDto {
  @ApiPropertyOptional({ description: 'Филиал (право reports.branch). Без филиала — сводный (reports.consolidated)' })
  @IsOptional()
  @IsUUID()
  branchId?: string;
}

export class TopDishesQueryDto extends ReportQueryDto {
  @ApiPropertyOptional({ enum: TOP_DISHES_SORTS, default: 'revenue' })
  @IsOptional()
  @IsIn(TOP_DISHES_SORTS as unknown as string[])
  sort?: 'revenue' | 'quantity';

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class PagedReportQueryDto extends ReportQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  perPage?: number;
}

export class DailyReportQueryDto {
  @ApiPropertyOptional({ example: '2026-09-30', description: 'Дата отчёта (Asia/Almaty). По умолчанию — сегодня' })
  @IsOptional()
  @Matches(DATE_RE)
  date?: string;

  @ApiPropertyOptional({ description: 'Филиал; без филиала — сводный отчёт по сети' })
  @IsOptional()
  @IsUUID()
  branchId?: string;
}

export class AggregatorVolumesQueryDto {
  @ApiPropertyOptional({ example: '2026-07', description: 'Месяц с (YYYY-MM). По умолчанию — toMonth' })
  @IsOptional()
  @Matches(MONTH_RE)
  fromMonth?: string;

  @ApiPropertyOptional({ example: '2026-09', description: 'Месяц по (YYYY-MM). По умолчанию — текущий' })
  @IsOptional()
  @Matches(MONTH_RE)
  toMonth?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  branchId?: string;
}

export class PageQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  perPage?: number;
}

// ---------------------------------------------------------------- общие части ответов

export class ReportHeaderDto {
  @ApiProperty({ example: '2026-09-01' }) from: string;
  @ApiProperty({ example: '2026-09-30' }) to: string;
  @ApiProperty({ nullable: true, type: String, description: 'null — сводный отчёт по сети' }) branchId: string | null;
}

export class ChannelAmountsDto {
  @ApiProperty({ type: MoneyDto, description: 'Доставка (нетто с возвратами)' }) delivery: MoneyDto;
  @ApiProperty({ type: MoneyDto, description: 'Самовывоз' }) pickup: MoneyDto;
  @ApiProperty({ type: MoneyDto, description: 'Банкеты (при проведении, итог сметы)' }) banquet: MoneyDto;
  @ApiProperty({ type: MoneyDto, description: 'Сертификаты (при продаже)' }) certificate: MoneyDto;
  @ApiProperty({ type: MoneyDto, description: 'Возвраты признанной выручки (≤ 0), уже учтены в каналах' }) refunds: MoneyDto;
  @ApiProperty({ type: MoneyDto, description: 'Итого нетто' }) total: MoneyDto;
}

// ---------------------------------------------------------------- выручка, средний чек, свой канал

export class RevenueDayDto extends ChannelAmountsDto {
  @ApiProperty({ example: '2026-09-15' }) date: string;
}

export class RevenueBranchDto extends ChannelAmountsDto {
  @ApiProperty({ nullable: true, type: String, description: 'null — без филиала (онлайн-сертификаты, выездные банкеты)' })
  branchId: string | null;
}

export class SalesCountsDto {
  @ApiProperty() delivery: number;
  @ApiProperty() pickup: number;
  @ApiProperty() banquet: number;
  @ApiProperty() certificate: number;
}

export class RevenueReportDto extends ReportHeaderDto {
  @ApiProperty({ type: [RevenueDayDto], description: 'Каждый день периода (нули, если продаж не было)' }) days: RevenueDayDto[];
  @ApiProperty({ type: ChannelAmountsDto }) totals: ChannelAmountsDto;
  @ApiProperty({ type: SalesCountsDto, description: 'Количество продаж по каналам' }) counts: SalesCountsDto;
  @ApiProperty({ type: [RevenueBranchDto] }) byBranch: RevenueBranchDto[];
}

export class AverageCheckRowDto {
  @ApiProperty({ enum: SALES_CHANNELS }) channel: string;
  @ApiProperty() count: number;
  @ApiProperty({ type: MoneyDto, description: 'Продажи без возвратов' }) revenue: MoneyDto;
  @ApiProperty({ type: MoneyDto }) average: MoneyDto;
}

export class AverageCheckTotalDto {
  @ApiProperty() count: number;
  @ApiProperty({ type: MoneyDto }) revenue: MoneyDto;
  @ApiProperty({ type: MoneyDto }) average: MoneyDto;
}

export class AverageCheckReportDto extends ReportHeaderDto {
  @ApiProperty({ type: [AverageCheckRowDto] }) channels: AverageCheckRowDto[];
  @ApiProperty({ type: AverageCheckTotalDto, description: 'Заказы (доставка + самовывоз)' }) orders: AverageCheckTotalDto;
}

export class OwnChannelTotalsDto {
  @ApiProperty({ description: 'Выполненные заказы с сайта' }) webOrders: number;
  @ApiProperty({ description: 'Выполненные заказы оператора (телефон)' }) adminOrders: number;
  @ApiProperty() ownOrders: number;
  @ApiProperty({ type: MoneyDto }) ownRevenue: MoneyDto;
  @ApiProperty({ nullable: true, type: Number, description: 'Заказы агрегаторов (ручной ввод); null — нет данных' })
  aggregatorOrders: number | null;
  @ApiProperty({ nullable: true, type: MoneyDto }) aggregatorRevenue: MoneyDto | null;
  @ApiProperty({ nullable: true, type: Number, description: `Доля заказов мимо агрегаторов. ${RATIO}` }) ownShare: number | null;
}

export class OwnChannelMonthDto extends OwnChannelTotalsDto {
  @ApiProperty({ example: '2026-09' }) month: string;
}

export class OwnChannelReportDto extends ReportHeaderDto {
  @ApiProperty({ type: [OwnChannelMonthDto] }) months: OwnChannelMonthDto[];
  @ApiProperty({ type: OwnChannelTotalsDto }) totals: OwnChannelTotalsDto;
}

export class AggregatorVolumeInputDto {
  @ApiProperty() @IsUUID() branchId: string;
  @ApiProperty({ example: '2026-09' }) @Matches(MONTH_RE) month: string;
  @ApiProperty({ example: 'aggregator_a', description: 'Код источника: латиница, цифры, _ (2-32)' })
  @IsString()
  @Matches(/^[A-Za-z0-9_]{2,32}$/)
  source: string;
  @ApiProperty({ example: 'Агрегатор A', description: 'Название для отчёта' }) @IsString() @Length(1, 120) sourceName: string;
  @ApiProperty({ minimum: 0 }) @IsInt() @Min(0) @Max(1_000_000) orders: number;
  @ApiPropertyOptional({ type: MoneyInputDto, description: 'Выручка агрегатора за месяц (если известна)' })
  @IsOptional()
  @ValidateNested()
  @Type(() => MoneyInputDto)
  revenue?: MoneyInputDto;
}

export class AggregatorVolumeDto {
  @ApiProperty() id: string;
  @ApiProperty() branchId: string;
  @ApiProperty({ example: '2026-09' }) month: string;
  @ApiProperty() source: string;
  @ApiProperty() sourceName: string;
  @ApiProperty() orders: number;
  @ApiProperty({ type: MoneyDto }) revenue: MoneyDto;
  @ApiProperty({ nullable: true, type: String }) updatedBy: string | null;
  @ApiProperty() updatedAt: Date;
}

// ---------------------------------------------------------------- витрина и заказы

export class ConversionDayDto {
  @ApiProperty() date: string;
  @ApiProperty() sessions: number;
  @ApiProperty() orderedSessions: number;
  @ApiProperty({ nullable: true, type: Number, description: RATIO }) conversion: number | null;
}

export class ConversionReportDto extends ReportHeaderDto {
  @ApiProperty({ description: 'Уникальные сессии витрины' }) sessions: number;
  @ApiProperty() menuViewSessions: number;
  @ApiProperty() dishViewSessions: number;
  @ApiProperty() addToCartSessions: number;
  @ApiProperty() checkoutSessions: number;
  @ApiProperty({ description: 'Сессии, из которых оформлен заказ' }) orderedSessions: number;
  @ApiProperty({ description: 'Заказы, оформленные на сайте' }) webOrders: number;
  @ApiProperty({ nullable: true, type: Number, description: `orderedSessions / sessions. ${RATIO}` }) conversion: number | null;
  @ApiProperty({ type: [ConversionDayDto] }) days: ConversionDayDto[];
}

export class TopDishDto {
  @ApiProperty() rank: number;
  @ApiProperty() dishId: string;
  @ApiProperty({ type: TranslatableDto, description: 'Название из последнего выполненного заказа' }) name: TranslatableDto;
  @ApiProperty() quantity: number;
  @ApiProperty() orders: number;
  @ApiProperty({ type: MoneyDto }) revenue: MoneyDto;
  @ApiProperty({ nullable: true, type: Number, description: RATIO }) revenueShare: number | null;
}

export class TopDishesReportDto extends ReportHeaderDto {
  @ApiProperty({ enum: TOP_DISHES_SORTS }) sort: string;
  @ApiProperty({ type: [TopDishDto] }) items: TopDishDto[];
  @ApiProperty() totalQuantity: number;
  @ApiProperty({ type: MoneyDto }) totalRevenue: MoneyDto;
}

export class CancelReasonDto {
  @ApiProperty({ example: 'guest_request', description: 'guest_request, not_paid_in_time, out_of_stock, cannot_deliver, duplicate, other' })
  reasonCode: string;
  @ApiProperty() count: number;
  @ApiProperty({ description: 'Из них были оплачены (потребовали возврата)' }) paidCount: number;
  @ApiProperty({ type: MoneyDto }) total: MoneyDto;
}

export class CancelledOrderDto {
  @ApiProperty() orderId: string;
  @ApiProperty() number: string;
  @ApiProperty() branchId: string;
  @ApiProperty({ enum: ['delivery', 'pickup'] }) type: string;
  @ApiProperty({ enum: ['web', 'admin'] }) channel: string;
  @ApiProperty({ type: MoneyDto }) total: MoneyDto;
  @ApiProperty() reasonCode: string;
  @ApiProperty({ nullable: true, type: String }) reason: string | null;
  @ApiProperty() wasPaid: boolean;
  @ApiProperty({ nullable: true, type: Date }) placedAt: Date | null;
  @ApiProperty() cancelledAt: Date;
}

export class CancelledOrdersPageDto {
  @ApiProperty({ type: [CancelledOrderDto] }) items: CancelledOrderDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() perPage: number;
}

export class CancelledOrdersReportDto extends ReportHeaderDto {
  @ApiProperty({ description: 'Оформлено заказов за период' }) placed: number;
  @ApiProperty() cancelled: number;
  @ApiProperty({ nullable: true, type: Number, description: `cancelled / placed. ${RATIO}` }) cancelledShare: number | null;
  @ApiProperty({ type: MoneyDto }) cancelledTotal: MoneyDto;
  @ApiProperty({ type: [CancelReasonDto] }) reasons: CancelReasonDto[];
  @ApiProperty({ type: CancelledOrdersPageDto }) orders: CancelledOrdersPageDto;
}

// ---------------------------------------------------------------- залы и банкеты

export class HallLoadRowDto {
  @ApiProperty({ enum: WEEKDAYS }) weekday: string;
  @ApiProperty({ example: 'vip' }) venueTypeCode: string;
  @ApiProperty({ type: TranslatableDto }) venueTypeName: TranslatableDto;
  @ApiProperty({ description: 'Активных мест этого типа' }) venues: number;
  @ApiProperty({ description: 'Доступно: часы работы × места, минут' }) openMinutes: number;
  @ApiProperty({ description: 'Занято бронями, минут' }) bookedMinutes: number;
  @ApiProperty({ description: 'Доступно, часов (1 знак после запятой)' }) openHours: number;
  @ApiProperty({ description: 'Занято, часов (1 знак после запятой)' }) bookedHours: number;
  @ApiProperty({ nullable: true, type: Number, description: `bookedMinutes / openMinutes. ${RATIO}` }) load: number | null;
  @ApiProperty() reservations: number;
  @ApiProperty() guests: number;
}

export class HallLoadWeekdayDto {
  @ApiProperty({ enum: WEEKDAYS }) weekday: string;
  @ApiProperty() openMinutes: number;
  @ApiProperty() bookedMinutes: number;
  @ApiProperty() openHours: number;
  @ApiProperty() bookedHours: number;
  @ApiProperty({ nullable: true, type: Number, description: RATIO }) load: number | null;
  @ApiProperty() reservations: number;
  @ApiProperty() guests: number;
}

export class OverbookingReservationDto {
  @ApiProperty() reservationId: string;
  @ApiProperty() number: string;
  @ApiProperty() status: string;
  @ApiProperty() start: Date;
  @ApiProperty() end: Date;
}

export class OverbookingDto {
  @ApiProperty() venueId: string;
  @ApiProperty() branchId: string;
  @ApiProperty() venueTypeCode: string;
  @ApiProperty({ type: OverbookingReservationDto }) first: OverbookingReservationDto;
  @ApiProperty({ type: OverbookingReservationDto }) second: OverbookingReservationDto;
}

export class HallLoadReportDto extends ReportHeaderDto {
  @ApiProperty({ type: [HallLoadRowDto] }) rows: HallLoadRowDto[];
  @ApiProperty({ type: [HallLoadWeekdayDto] }) weekdays: HallLoadWeekdayDto[];
  @ApiProperty({ description: 'Накладки: пересечения действующих броней одного места (цель — 0)' }) overbookingCount: number;
  @ApiProperty({ type: [OverbookingDto] }) overbookings: OverbookingDto[];
}

export class BanquetStageDto {
  @ApiProperty({ enum: BANQUET_STAGES }) status: string;
  @ApiProperty({ description: 'Заявок, дошедших до стадии' }) reached: number;
  @ApiProperty({ description: 'Заявок на стадии сейчас' }) current: number;
}

export class BanquetCancelReasonDto {
  @ApiProperty() reason: string;
  @ApiProperty() count: number;
}

export class BanquetFunnelReportDto extends ReportHeaderDto {
  @ApiProperty({ description: 'Заявок создано в периоде' }) total: number;
  @ApiProperty({ type: [BanquetStageDto] }) stages: BanquetStageDto[];
  @ApiProperty() held: number;
  @ApiProperty({ type: MoneyDto }) heldTotal: MoneyDto;
  @ApiProperty({ nullable: true, type: Number, description: `held / total. ${RATIO}` }) conversion: number | null;
  @ApiProperty({ description: 'Заявок, ответ на которые уже должен был быть' }) answerDue: number;
  @ApiProperty() answeredWithinSla: number;
  @ApiProperty({ nullable: true, type: Number, description: `Доля ответов за 30 минут (цель 95%). ${RATIO}` })
  answeredWithinSlaShare: number | null;
  @ApiProperty({ nullable: true, type: Number }) averageFirstResponseMinutes: number | null;
  @ApiProperty({ nullable: true, type: Number }) medianFirstResponseMinutes: number | null;
  @ApiProperty({ description: 'Без ответа дольше SLA' }) unansweredOverdue: number;
  @ApiProperty() cancelled: number;
  @ApiProperty() cancelledBeforeAgreement: number;
  @ApiProperty({ description: 'Потерянные: отменены до согласования + без ответа дольше SLA (цель — 0)' }) lost: number;
  @ApiProperty({ type: [BanquetCancelReasonDto] }) cancelReasons: BanquetCancelReasonDto[];
  @ApiProperty({ example: 30 }) slaMinutes: number;
}

// ---------------------------------------------------------------- деньги и сертификаты

export class CashFlowAmountsDto {
  @ApiProperty({ type: MoneyDto }) received: MoneyDto;
  @ApiProperty({ type: MoneyDto }) refunded: MoneyDto;
  @ApiProperty({ type: MoneyDto }) net: MoneyDto;
}

export class CashFlowMethodDto extends CashFlowAmountsDto {
  @ApiProperty({ enum: ['online', 'on_receipt', 'gift_certificate', 'bank_transfer', 'unknown'] }) method: string;
  @ApiProperty({ description: 'Провайдер (для online) или способ' }) provider: string;
  @ApiProperty() receivedCount: number;
  @ApiProperty() refundedCount: number;
}

export class CashFlowPurposeDto extends CashFlowAmountsDto {
  @ApiProperty({ enum: ['order', 'reservation_deposit', 'banquet_invoice', 'gift_certificate'] }) purpose: string;
}

export class CashFlowDayDto extends CashFlowAmountsDto {
  @ApiProperty() date: string;
}

export class CashFlowTotalsDto extends CashFlowAmountsDto {
  @ApiProperty({ type: MoneyDto, description: 'Оплаты сертификатами (погашение, не деньги)' }) certificateRedemptions: MoneyDto;
  @ApiProperty({ type: MoneyDto, description: 'Поступления деньгами' }) moneyReceived: MoneyDto;
}

export class CashFlowReportDto extends ReportHeaderDto {
  @ApiProperty({ type: [CashFlowMethodDto] }) methods: CashFlowMethodDto[];
  @ApiProperty({ type: [CashFlowPurposeDto] }) purposes: CashFlowPurposeDto[];
  @ApiProperty({ type: [CashFlowDayDto] }) days: CashFlowDayDto[];
  @ApiProperty({ type: CashFlowTotalsDto }) totals: CashFlowTotalsDto;
}

export class CertificateIssuedDto {
  @ApiProperty() count: number;
  @ApiProperty({ type: MoneyDto }) nominal: MoneyDto;
  @ApiProperty({ type: MoneyDto, description: 'Цена продажи' }) price: MoneyDto;
}

export class CertificateIssuedByKindDto extends CertificateIssuedDto {
  @ApiProperty({ enum: ['amount', 'set'] }) kind: string;
}

export class CertificateAmountDto {
  @ApiProperty() count: number;
  @ApiProperty({ type: MoneyDto }) amount: MoneyDto;
}

export class CertificateRedeemedByChannelDto extends CertificateAmountDto {
  @ApiProperty({ enum: ['order', 'point'] }) channel: string;
}

export class CertificateBalanceDto {
  @ApiProperty() count: number;
  @ApiProperty({ type: MoneyDto }) balance: MoneyDto;
}

export class CertificateOutstandingDto extends CertificateBalanceDto {
  @ApiProperty() asOf: string;
}

export class CertificatesReportDto extends ReportHeaderDto {
  @ApiProperty({ type: CertificateIssuedDto }) issued: CertificateIssuedDto;
  @ApiProperty({ type: [CertificateIssuedByKindDto] }) issuedByKind: CertificateIssuedByKindDto[];
  @ApiProperty({ type: CertificateAmountDto }) redeemed: CertificateAmountDto;
  @ApiProperty({ type: [CertificateRedeemedByChannelDto] }) redeemedByChannel: CertificateRedeemedByChannelDto[];
  @ApiProperty({ type: CertificateBalanceDto, nullable: true, description: 'Только сводный отчёт' }) expired: CertificateBalanceDto | null;
  @ApiProperty({ type: CertificateOutstandingDto, nullable: true, description: 'Остаток обязательств (только сводный)' })
  outstanding: CertificateOutstandingDto | null;
}

// ---------------------------------------------------------------- панель и цели

export class PeriodKpisDto {
  @ApiProperty() from: string;
  @ApiProperty() to: string;
  @ApiProperty({ type: MoneyDto, description: 'Выручка нетто по всем каналам' }) revenue: MoneyDto;
  @ApiProperty() completedOrders: number;
  @ApiProperty({ type: MoneyDto }) averageCheck: MoneyDto;
  @ApiProperty() placedOrders: number;
  @ApiProperty() cancelledOrders: number;
  @ApiProperty({ description: 'Новые брони гостей' }) reservations: number;
  @ApiProperty() guests: number;
  @ApiProperty() banquetRequests: number;
  @ApiProperty({ nullable: true, type: Number, description: RATIO }) banquetAnsweredWithinSlaShare: number | null;
  @ApiProperty() sessions: number;
  @ApiProperty({ nullable: true, type: Number, description: RATIO }) conversion: number | null;
}

export class DashboardDto {
  @ApiProperty({ nullable: true, type: String }) branchId: string | null;
  @ApiProperty() generatedAt: Date;
  @ApiProperty({ type: PeriodKpisDto }) today: PeriodKpisDto;
  @ApiProperty({ type: PeriodKpisDto }) yesterday: PeriodKpisDto;
  @ApiProperty({ type: PeriodKpisDto, description: 'Последние 7 дней, включая сегодня' }) last7Days: PeriodKpisDto;
}

export class GoalsReportDto extends ReportHeaderDto {
  @ApiProperty({ nullable: true, type: Number, description: `Доля заказов мимо агрегаторов. ${RATIO}` }) ownChannelShare: number | null;
  @ApiProperty() ownOrders: number;
  @ApiProperty({ nullable: true, type: Number }) aggregatorOrders: number | null;
  @ApiProperty({ nullable: true, type: Number, description: `Ответ на банкетную заявку за 30 минут. ${RATIO}` })
  banquetAnsweredWithinSlaShare: number | null;
  @ApiProperty() banquetRequests: number;
  @ApiProperty() lostBanquetRequests: number;
  @ApiProperty() overbookings: number;
  @ApiProperty() dailyReportsExpected: number;
  @ApiProperty() dailyReportsGenerated: number;
}

// ---------------------------------------------------------------- дневной отчёт

export class DailyOrdersDto {
  @ApiProperty() placed: number;
  @ApiProperty() completed: number;
  @ApiProperty() cancelled: number;
  @ApiProperty({ type: MoneyDto }) averageCheck: MoneyDto;
}

export class DailyReservationsDto {
  @ApiProperty() created: number;
  @ApiProperty() guests: number;
  @ApiProperty({ description: 'Броней с началом в этот день' }) starting: number;
}

export class DailyBanquetsDto {
  @ApiProperty() newRequests: number;
  @ApiProperty() answeredWithinSla: number;
  @ApiProperty() unansweredOverdue: number;
  @ApiProperty() held: number;
  @ApiProperty({ type: MoneyDto }) heldTotal: MoneyDto;
}

export class DailyPaymentsDto {
  @ApiProperty({ type: MoneyDto }) received: MoneyDto;
  @ApiProperty({ type: MoneyDto }) refunded: MoneyDto;
}

export class DailyStorefrontDto {
  @ApiProperty() sessions: number;
  @ApiProperty() orderedSessions: number;
  @ApiProperty({ nullable: true, type: Number, description: RATIO }) conversion: number | null;
}

export class DailyTopDishDto {
  @ApiProperty() dishId: string;
  @ApiProperty({ type: TranslatableDto }) name: TranslatableDto;
  @ApiProperty() quantity: number;
  @ApiProperty({ type: MoneyDto }) revenue: MoneyDto;
}

export class DailySummaryDto {
  @ApiProperty() date: string;
  @ApiProperty({ nullable: true, type: String }) branchId: string | null;
  @ApiProperty({ type: ChannelAmountsDto }) revenue: ChannelAmountsDto;
  @ApiProperty({ type: DailyOrdersDto }) orders: DailyOrdersDto;
  @ApiProperty({ type: DailyReservationsDto }) reservations: DailyReservationsDto;
  @ApiProperty({ type: DailyBanquetsDto }) banquets: DailyBanquetsDto;
  @ApiProperty({ type: DailyPaymentsDto }) payments: DailyPaymentsDto;
  @ApiProperty({ type: DailyStorefrontDto }) storefront: DailyStorefrontDto;
  @ApiProperty({ type: [DailyTopDishDto] }) topDishes: DailyTopDishDto[];
}

export class DailyReportDto {
  @ApiProperty({ nullable: true, type: String, description: 'null — отчёт ещё не сформирован (текущие данные)' }) id: string | null;
  @ApiProperty() date: string;
  @ApiProperty({ nullable: true, type: String }) branchId: string | null;
  @ApiProperty({ description: 'Сформирован автоматически и сохранён' }) isFinal: boolean;
  @ApiProperty({ nullable: true, type: Date }) generatedAt: Date | null;
  @ApiProperty({ nullable: true, type: Date }) notifiedAt: Date | null;
  @ApiProperty({ nullable: true, type: String, description: 'Подписанная ссылка на XLSX (1 час)' }) fileUrl: string | null;
  @ApiProperty({ type: DailySummaryDto }) summary: DailySummaryDto;
}

export class DailyReportsPageDto {
  @ApiProperty({ type: [DailyReportDto] }) items: DailyReportDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() perPage: number;
}

// ---------------------------------------------------------------- выгрузка в учёт

export class CreateAccountingExportDto {
  @ApiProperty({ example: '2026-09-01' }) @Matches(DATE_RE) from: string;
  @ApiProperty({ example: '2026-09-30' }) @Matches(DATE_RE) to: string;
  @ApiProperty({ enum: ACCOUNTING_EXPORT_FORMATS, description: 'onec_xml — XML, близкий к EnterpriseData (1С); xlsx — таблица' })
  @IsIn(ACCOUNTING_EXPORT_FORMATS as unknown as string[])
  format: string;
  @ApiPropertyOptional({ description: 'Филиал; без филиала — по всей сети (глобальное право reports.export)' })
  @IsOptional()
  @IsUUID()
  branchId?: string;
  @ApiPropertyOptional({ default: true, description: 'Отправить XML в HTTP-сервис 1С, если интеграция настроена' })
  @IsOptional()
  @IsBoolean()
  push?: boolean;
}

export class AccountingExportTotalsDto {
  @ApiProperty({ type: MoneyDto }) retailSales: MoneyDto;
  @ApiProperty({ type: MoneyDto }) refunds: MoneyDto;
  @ApiProperty({ type: MoneyDto }) certificateSales: MoneyDto;
  @ApiProperty({ type: MoneyDto }) invoices: MoneyDto;
  @ApiProperty({ type: MoneyDto }) acts: MoneyDto;
  @ApiProperty() retailDocuments: number;
  @ApiProperty() invoiceCount: number;
  @ApiProperty() actCount: number;
}

export class AccountingExportDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: ACCOUNTING_EXPORT_FORMATS }) format: string;
  @ApiProperty() from: string;
  @ApiProperty() to: string;
  @ApiProperty({ nullable: true, type: String }) branchId: string | null;
  @ApiProperty({ enum: ['pending', 'ready', 'failed'] }) status: string;
  @ApiProperty({ nullable: true, type: String }) error: string | null;
  @ApiProperty({ nullable: true, type: String }) fileName: string | null;
  @ApiProperty({ nullable: true, type: Number }) sizeBytes: number | null;
  @ApiProperty({ nullable: true, type: String, description: 'Подписанная ссылка на файл (1 час), когда status=ready' }) fileUrl: string | null;
  @ApiProperty({ nullable: true, type: AccountingExportTotalsDto }) totals: AccountingExportTotalsDto | null;
  @ApiProperty() pushRequested: boolean;
  @ApiProperty({ enum: ['not_required', 'pending', 'pushed', 'failed'] }) pushStatus: string;
  @ApiProperty() pushAttempts: number;
  @ApiProperty({ nullable: true, type: Date }) pushedAt: Date | null;
  @ApiProperty({ nullable: true, type: String }) pushError: string | null;
  @ApiProperty({ nullable: true, type: String }) requestedBy: string | null;
  @ApiProperty() requestedAt: Date;
  @ApiProperty({ nullable: true, type: Date }) completedAt: Date | null;
}

export class AccountingExportsPageDto {
  @ApiProperty({ type: [AccountingExportDto] }) items: AccountingExportDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() perPage: number;
}

// ---------------------------------------------------------------- аналитика витрины (публичная)

export class StorefrontEventDto {
  @ApiProperty({ description: 'Анонимный идентификатор сессии витрины (UUID, генерирует браузер)' }) @IsUUID() sessionId: string;
  @ApiProperty({ enum: STOREFRONT_EVENT_TYPES }) @IsIn(STOREFRONT_EVENT_TYPES) type: string;
  @ApiPropertyOptional({ description: 'Филиал, выбранный на витрине' }) @IsOptional() @IsUUID() branchId?: string;
  @ApiProperty({ example: '/greenline/menu', description: 'Путь страницы; параметры и идентификаторы отбрасываются' })
  @IsString()
  @MaxLength(2000)
  path: string;
}
