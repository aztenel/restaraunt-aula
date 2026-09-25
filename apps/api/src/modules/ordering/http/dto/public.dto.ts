import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { GeoPointDto, MoneyDto } from '../../../../shared/infrastructure/http/api-types';
import { Locale, LOCALES } from '../../../../shared/kernel/translatable';
import { PaymentMethod, PaymentStatus, PaymentView } from '../../../payments/public';
import { OrderSlotsView, DeliveryOption, DeliveryResolution } from '../../application/delivery.queries';
import { OrderTrackingView } from '../../application/order.queries';
import { PlacedOrder, PlaceOrderInput } from '../../application/place-order.action';
import { QuoteOrderInput, QuoteResult } from '../../application/quote-order.action';
import { PricedLineRequest } from '../../../catalog/public';
import { COURIER_DISPATCH_STATUSES, CourierDispatchStatus } from '../../domain/courier-dispatch';
import { DeliveryZoneState } from '../../domain/delivery-zone';
import { OrderItemSnapshot } from '../../domain/order';
import { cancelReasonLabel } from '../../domain/order-texts';
import { CANCEL_REASON_CODES } from '../../domain/order-status';
import { OrderStatus, OrderType } from '../../public';
import { toLocalTime } from '../../../../shared/kernel/time';
import { BranchInfo } from '../../../identity/public';
import {
  OrderBranchDto,
  CHECKOUT_PAYMENT_METHODS,
  DATE_RE,
  OrderingLocaleQueryDto,
  money,
  moneyOrNull,
  ORDER_STATUSES,
  ORDER_TYPES,
  OrderModifierViewDto,
  point,
  text,
} from './common.dto';

// ---------------------------------------------------------------- Запросы

export class OrderLineInputDto {
  @ApiProperty({ description: 'Блюдо меню филиала' })
  @IsUUID()
  dishId: string;

  @ApiProperty({ minimum: 1, maximum: 99, example: 2 })
  @IsInt()
  @Min(1)
  @Max(99)
  quantity: number;

  @ApiPropertyOptional({ type: [String], description: 'Выбранные опции модификаторов (id опций)', default: [] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  modifierOptionIds?: string[];
}

export class QuoteOrderDto {
  @ApiProperty() @IsUUID() branchId: string;

  @ApiProperty({ enum: ORDER_TYPES }) @IsIn(ORDER_TYPES) type: OrderType;

  @ApiProperty({ type: [OrderLineInputDto] })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => OrderLineInputDto)
  items: OrderLineInputDto[];

  @ApiPropertyOptional({ type: GeoPointDto, nullable: true, description: 'Точка доставки (геокодирование — на витрине)' })
  @IsOptional()
  @ValidateNested()
  @Type(() => GeoPointDto)
  point?: GeoPointDto | null;

  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsString() @MaxLength(32) promoCode?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsString() @MaxLength(32) certificateCode?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Телефон гостя — для лимита промокода на один телефон' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string | null;
}

export class OrderCheckoutDeliveryDto {
  @ApiProperty({ type: GeoPointDto }) @ValidateNested() @Type(() => GeoPointDto) point: GeoPointDto;
  @ApiProperty({ example: 'Астана, пр. Кабанбай батыра, 56' }) @IsString() @MinLength(3) @MaxLength(500) addressText: string;
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsString() @MaxLength(50) apartment?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsString() @MaxLength(50) entrance?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsString() @MaxLength(50) floor?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsString() @MaxLength(50) intercom?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsString() @MaxLength(500) courierComment?: string | null;
}

export class OrderCheckoutCustomerDto {
  @ApiProperty({ example: 'Айгерим' }) @IsString() @MinLength(1) @MaxLength(100) name: string;
  @ApiProperty({ example: '+77771234567' }) @IsString() @MaxLength(32) phone: string;
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsEmail() @MaxLength(200) email?: string | null;
}

export class OrderCheckoutConsentDto {
  @ApiProperty({ description: 'Согласие на обработку персональных данных (обязательно true)' })
  @IsBoolean()
  personalData: boolean;

  @ApiPropertyOptional({ type: Boolean, nullable: true, description: 'Согласие на маркетинговые рассылки (необязательно)' })
  @IsOptional()
  @IsBoolean()
  marketing?: boolean | null;
}

export class OrderCheckoutDto {
  @ApiProperty() @IsUUID() branchId: string;
  @ApiProperty({ enum: ORDER_TYPES }) @IsIn(ORDER_TYPES) type: OrderType;

  @ApiProperty({ type: [OrderLineInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => OrderLineInputDto)
  items: OrderLineInputDto[];

  @ApiPropertyOptional({ type: OrderCheckoutDeliveryDto, nullable: true, description: 'Обязательно для доставки' })
  @IsOptional()
  @ValidateNested()
  @Type(() => OrderCheckoutDeliveryDto)
  delivery?: OrderCheckoutDeliveryDto | null;

  @ApiPropertyOptional({ default: false, description: 'Бесконтактная доставка' }) @IsOptional() @IsBoolean() contactless?: boolean;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true, description: 'К определённому времени (ISO); null — как можно скорее' })
  @IsOptional()
  @IsISO8601({ strict: true })
  scheduledFor?: string | null;

  @ApiProperty({ type: OrderCheckoutCustomerDto }) @ValidateNested() @Type(() => OrderCheckoutCustomerDto) customer: OrderCheckoutCustomerDto;
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsString() @MaxLength(1000) comment?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsString() @MaxLength(32) promoCode?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsString() @MaxLength(32) certificateCode?: string | null;
  @ApiProperty({ enum: CHECKOUT_PAYMENT_METHODS }) @IsIn(CHECKOUT_PAYMENT_METHODS) paymentMethod: 'online' | 'on_receipt';

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Токен подтверждения телефона (оплата при получении)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  phoneVerificationToken?: string | null;

  @ApiProperty({ type: OrderCheckoutConsentDto }) @ValidateNested() @Type(() => OrderCheckoutConsentDto) consent: OrderCheckoutConsentDto;
  @ApiProperty({ enum: LOCALES, description: 'Язык уведомлений гостю' }) @IsIn(LOCALES as unknown as string[]) locale: Locale;
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsString() @MaxLength(100) analyticsSessionId?: string | null;

  @ApiProperty({ description: 'Ключ идемпотентности (UUID, генерирует витрина): повтор возвращает тот же заказ' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  idempotencyKey: string;
}

export class ResolveDeliveryDto {
  @ApiProperty({ type: GeoPointDto, description: 'Точка на карте (геокодирование адреса — в браузере витрины)' })
  @ValidateNested()
  @Type(() => GeoPointDto)
  point: GeoPointDto;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Адрес текстом (для отображения)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string | null;
}

export class OrderSlotsQueryDto extends OrderingLocaleQueryDto {
  @ApiProperty({ enum: ORDER_TYPES }) @IsIn(ORDER_TYPES) type: OrderType;

  @ApiPropertyOptional({ description: 'Локальная дата филиала YYYY-MM-DD, по умолчанию — сегодня' })
  @IsOptional()
  @Matches(DATE_RE)
  date?: string;
}

// ---------------------------------------------------------------- Ответы: расчёт

export class OrderQuoteLineDto {
  @ApiProperty({ description: 'Номер позиции в запросе' }) index: number;
  @ApiProperty() dishId: string;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Название на языке запроса (null — блюдо не найдено)' }) name: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) photoUrl: string | null;
  @ApiProperty() quantity: number;
  @ApiPropertyOptional({ type: MoneyDto, nullable: true }) unitPrice: MoneyDto | null;
  @ApiPropertyOptional({ type: MoneyDto, nullable: true }) lineTotal: MoneyDto | null;
  @ApiProperty({ type: [OrderModifierViewDto] }) modifiers: OrderModifierViewDto[];
  @ApiProperty() available: boolean;
  @ApiPropertyOptional({ type: String, nullable: true, example: 'catalog.dish_unavailable', description: 'Машинный код проблемы позиции' })
  problem: string | null;
}

export class OrderQuotePromoDto {
  @ApiProperty() code: string;
  @ApiProperty() applied: boolean;
  @ApiPropertyOptional({ type: String, nullable: true, example: 'promo.min_subtotal' }) reason: string | null;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true, nullable: true }) details: Record<string, unknown> | null;
  @ApiProperty({ type: MoneyDto }) discount: MoneyDto;
  @ApiProperty() freeDelivery: boolean;
}

export class OrderQuoteDeliveryDto {
  @ApiProperty() pointProvided: boolean;
  @ApiProperty() deliverable: boolean;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) zoneId: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) zoneName: string | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) etaMinutes: number | null;
  @ApiPropertyOptional({ type: MoneyDto, nullable: true }) minOrderAmount: MoneyDto | null;
  @ApiProperty() minOrderReached: boolean;
  @ApiProperty({ type: MoneyDto, description: 'Сколько не хватает до минимальной суммы' }) minOrderShortfall: MoneyDto;
  @ApiProperty({ type: MoneyDto, description: 'Стоимость доставки зоны до льгот' }) baseDeliveryFee: MoneyDto;
  @ApiPropertyOptional({ type: MoneyDto, nullable: true }) freeDeliveryFrom: MoneyDto | null;
  @ApiPropertyOptional({ type: MoneyDto, nullable: true, description: 'Сколько добавить до бесплатной доставки' })
  amountToFreeDelivery: MoneyDto | null;
  @ApiPropertyOptional({ enum: ['threshold', 'promo'], nullable: true }) freeDeliveryReason: 'threshold' | 'promo' | null;
}

export class OrderQuoteCertificateDto {
  @ApiProperty() applied: boolean;
  @ApiPropertyOptional({ type: String, nullable: true, example: 'order.certificate_not_found' }) reason: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, example: '****-****-AB12' }) maskedCode: string | null;
  @ApiPropertyOptional({ type: MoneyDto, nullable: true }) balance: MoneyDto | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) expiresAt: Date | null;
  @ApiProperty({ type: MoneyDto, description: 'Будет списано с сертификата' }) amount: MoneyDto;
}

export class OrderQuoteDto {
  @ApiProperty() branchId: string;
  @ApiProperty({ enum: ORDER_TYPES }) type: OrderType;
  @ApiProperty({ type: [OrderQuoteLineDto] }) lines: OrderQuoteLineDto[];
  @ApiProperty({ type: MoneyDto }) subtotal: MoneyDto;
  @ApiProperty({ type: MoneyDto }) discount: MoneyDto;
  @ApiProperty({ type: MoneyDto }) deliveryFee: MoneyDto;
  @ApiProperty({ type: MoneyDto }) total: MoneyDto;
  @ApiProperty({ type: MoneyDto, description: 'К оплате (итог минус сертификат)' }) amountDue: MoneyDto;
  @ApiPropertyOptional({ type: OrderQuoteDeliveryDto, nullable: true }) delivery: OrderQuoteDeliveryDto | null;
  @ApiPropertyOptional({ type: OrderQuotePromoDto, nullable: true }) promo: OrderQuotePromoDto | null;
  @ApiPropertyOptional({ type: OrderQuoteCertificateDto, nullable: true }) certificate: OrderQuoteCertificateDto | null;
  @ApiProperty({ type: [String], description: 'Что мешает оформить (машинные коды)' }) problems: string[];
  @ApiProperty() canCheckout: boolean;

  static from(q: QuoteResult, locale: Locale): OrderQuoteDto {
    const b = q.breakdown;
    return {
      branchId: q.branch.id,
      type: q.type,
      lines: q.lines.map((l) => ({
        index: l.index,
        dishId: l.request.dishId,
        name: l.priced ? text(l.priced.dishName, locale) : null,
        photoUrl: l.priced?.photoUrl ?? null,
        quantity: l.request.quantity,
        unitPrice: moneyOrNull(l.priced?.unitPrice),
        lineTotal: moneyOrNull(l.priced?.lineTotal),
        modifiers: (l.priced?.modifiers ?? []).map((m) => ({
          groupId: m.groupId,
          groupName: text(m.groupName, locale),
          optionId: m.optionId,
          name: text(m.optionName, locale),
          price: money(m.price),
        })),
        available: l.priced !== null,
        problem: l.problem,
      })),
      subtotal: money(b.subtotal),
      discount: money(b.discount),
      deliveryFee: money(b.deliveryFee),
      total: money(b.total),
      amountDue: money(q.amountDue),
      delivery: q.delivery
        ? {
            pointProvided: q.delivery.pointProvided,
            deliverable: q.delivery.deliverable,
            zoneId: q.delivery.zone?.id ?? null,
            zoneName: q.delivery.zone ? text(q.delivery.zone.name, locale) : null,
            etaMinutes: q.delivery.zone?.etaMinutes ?? null,
            minOrderAmount: moneyOrNull(q.delivery.zone?.minOrderAmount),
            minOrderReached: q.delivery.minOrderReached,
            minOrderShortfall: money(b.minOrderShortfall),
            baseDeliveryFee: money(b.baseDeliveryFee),
            freeDeliveryFrom: moneyOrNull(q.delivery.zone?.freeDeliveryFrom),
            amountToFreeDelivery: moneyOrNull(b.amountToFreeDelivery),
            freeDeliveryReason: b.freeDeliveryReason,
          }
        : null,
      promo: q.promo
        ? {
            code: q.promo.code,
            applied: q.promo.applied,
            reason: q.promo.reason,
            details: q.promo.details,
            discount: money(q.promo.discount),
            freeDelivery: q.promo.freeDelivery,
          }
        : null,
      certificate: q.certificate
        ? {
            applied: q.certificate.applied,
            reason: q.certificate.reason,
            maskedCode: q.certificate.certificate?.maskedCode ?? null,
            balance: moneyOrNull(q.certificate.certificate?.balance),
            expiresAt: q.certificate.certificate?.expiresAt ?? null,
            amount: money(q.certificate.amount),
          }
        : null,
      problems: q.problems,
      canCheckout: q.problems.length === 0,
    };
  }
}

// ---------------------------------------------------------------- Ответы: оформление и статус

export class OrderPaymentStateDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: Object.values(PaymentMethod) }) method: PaymentMethod;
  @ApiProperty({ enum: Object.values(PaymentStatus) }) status: PaymentStatus;
  @ApiProperty({ type: MoneyDto }) amount: MoneyDto;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Ссылка на оплату (появляется асинхронно — опрашивайте статус заказа)' })
  paymentUrl: string | null;

  static from(p: PaymentView): OrderPaymentStateDto {
    return { id: p.id, method: p.method, status: p.status, amount: money(p.amount), paymentUrl: p.paymentUrl };
  }
}

export class OrderCheckoutResultDto {
  @ApiProperty() orderId: string;
  @ApiProperty({ example: 'GL-2026-000123' }) number: string;
  @ApiProperty({ description: 'Токен страницы статуса заказа' }) publicToken: string;
  @ApiProperty({ enum: ORDER_STATUSES }) status: OrderStatus;
  @ApiProperty({ type: MoneyDto }) total: MoneyDto;
  @ApiPropertyOptional({ type: OrderPaymentStateDto, nullable: true, description: 'Платёж остатка (null — оплачено сертификатом)' })
  payment: OrderPaymentStateDto | null;
  @ApiProperty({ description: 'Повтор запроса с тем же ключом идемпотентности' }) replayed: boolean;

  static from(r: PlacedOrder): OrderCheckoutResultDto {
    const s = r.order.snapshot();
    return {
      orderId: s.id,
      number: s.number,
      publicToken: s.publicToken,
      status: s.status,
      total: money(s.totals.total),
      payment: r.payment ? OrderPaymentStateDto.from(r.payment) : null,
      replayed: r.replayed,
    };
  }
}

export class OrderTimelineEntryDto {
  @ApiProperty({ enum: ORDER_STATUSES }) status: OrderStatus;
  @ApiProperty() at: Date;
}

export class OrderItemViewDto {
  @ApiProperty() dishId: string;
  @ApiProperty({ description: 'Название на языке запроса (снимок на момент заказа)' }) name: string;
  @ApiPropertyOptional({ type: String, nullable: true }) photoUrl: string | null;
  @ApiProperty() quantity: number;
  @ApiProperty({ type: MoneyDto }) unitPrice: MoneyDto;
  @ApiProperty({ type: MoneyDto }) lineTotal: MoneyDto;
  @ApiProperty({ type: [OrderModifierViewDto] }) modifiers: OrderModifierViewDto[];

  static from(i: OrderItemSnapshot, locale: Locale): OrderItemViewDto {
    return {
      dishId: i.dishId,
      name: text(i.name, locale),
      photoUrl: i.photoUrl,
      quantity: i.quantity,
      unitPrice: money(i.unitPrice),
      lineTotal: money(i.lineTotal),
      modifiers: i.modifiers.map((m) => ({
        groupId: m.groupId,
        groupName: text(m.groupName, locale),
        optionId: m.optionId,
        name: text(m.optionName, locale),
        price: money(m.price),
      })),
    };
  }
}

export class OrderTrackingDeliveryDto {
  @ApiProperty() addressText: string;
  @ApiPropertyOptional({ type: String, nullable: true }) apartment: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) entrance: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) floor: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) intercom: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) courierComment: string | null;
  @ApiProperty({ type: GeoPointDto }) point: GeoPointDto;
  @ApiProperty() contactless: boolean;
}

export class OrderTrackingPaymentDto {
  @ApiProperty({ enum: CHECKOUT_PAYMENT_METHODS }) method: 'online' | 'on_receipt';
  @ApiProperty({ description: 'Заказ оплачен (или оплата обеспечена — при получении)' }) isPaid: boolean;
  @ApiProperty({ type: MoneyDto, description: 'Списано с подарочного сертификата' }) certificateAmount: MoneyDto;
  @ApiProperty({ type: MoneyDto, description: 'К оплате онлайн или при получении' }) amountDue: MoneyDto;
  @ApiPropertyOptional({ type: OrderPaymentStateDto, nullable: true }) current: OrderPaymentStateDto | null;
  @ApiProperty({ description: 'Можно повторить онлайн-оплату (POST /public/orders/:token/pay)' }) canRetry: boolean;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true, description: 'Срок оплаты онлайн-заказа' }) payUntil: Date | null;
}

export class OrderTrackingCourierDto {
  @ApiProperty({ enum: COURIER_DISPATCH_STATUSES }) status: CourierDispatchStatus;
  @ApiPropertyOptional({ type: String, nullable: true }) trackingUrl: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) courierName: string | null;
}

export class OrderTrackingCancellationDto {
  @ApiProperty({ enum: CANCEL_REASON_CODES }) reasonCode: string;
  @ApiProperty({ description: 'Причина на языке запроса' }) reason: string;
}

export class OrderTrackingDto {
  @ApiProperty() orderId: string;
  @ApiProperty() number: string;
  @ApiProperty({ enum: ORDER_STATUSES }) status: OrderStatus;
  @ApiProperty({ enum: ORDER_TYPES }) type: OrderType;
  @ApiProperty() placedAt: Date;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true, description: 'Заказ ко времени' }) scheduledFor: Date | null;
  @ApiProperty({ description: 'Обещанное время выдачи/доставки' }) promisedAt: Date;
  @ApiProperty({ type: [OrderItemViewDto] }) items: OrderItemViewDto[];
  @ApiProperty({ type: MoneyDto }) subtotal: MoneyDto;
  @ApiProperty({ type: MoneyDto }) discount: MoneyDto;
  @ApiProperty({ type: MoneyDto }) deliveryFee: MoneyDto;
  @ApiProperty({ type: MoneyDto }) total: MoneyDto;
  @ApiPropertyOptional({ type: String, nullable: true }) promoCode: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) comment: string | null;
  @ApiProperty({ type: OrderBranchDto }) branch: OrderBranchDto;
  @ApiPropertyOptional({ type: OrderTrackingDeliveryDto, nullable: true }) delivery: OrderTrackingDeliveryDto | null;
  @ApiProperty({ type: OrderTrackingPaymentDto }) payment: OrderTrackingPaymentDto;
  @ApiPropertyOptional({ type: OrderTrackingCourierDto, nullable: true }) courier: OrderTrackingCourierDto | null;
  @ApiPropertyOptional({ type: OrderTrackingCancellationDto, nullable: true }) cancellation: OrderTrackingCancellationDto | null;
  @ApiProperty({ type: [OrderTimelineEntryDto] }) timeline: OrderTimelineEntryDto[];

  static from(v: OrderTrackingView, locale: Locale): OrderTrackingDto {
    const s = v.order;
    return {
      orderId: s.id,
      number: s.number,
      status: s.status,
      type: s.type,
      placedAt: s.timestamps.placedAt,
      scheduledFor: s.scheduledFor,
      promisedAt: s.promisedAt,
      items: s.items.map((i) => OrderItemViewDto.from(i, locale)),
      subtotal: money(s.totals.subtotal),
      discount: money(s.totals.discount),
      deliveryFee: money(s.totals.deliveryFee),
      total: money(s.totals.total),
      promoCode: s.promo?.code ?? null,
      comment: s.comment,
      branch: branchBrief(v.branch, locale),
      delivery: s.delivery
        ? {
            addressText: s.delivery.addressText,
            apartment: s.delivery.apartment,
            entrance: s.delivery.entrance,
            floor: s.delivery.floor,
            intercom: s.delivery.intercom,
            courierComment: s.delivery.courierComment,
            point: point(s.delivery.point),
            contactless: s.contactless,
          }
        : null,
      payment: {
        method: s.paymentMethod,
        isPaid: s.wasPaid,
        certificateAmount: money(v.payment.certificateAmount),
        amountDue: money(v.payment.amountDue),
        current: v.payment.current ? OrderPaymentStateDto.from(v.payment.current) : null,
        canRetry: v.payment.canRetry,
        payUntil: v.payment.payUntil,
      },
      courier: v.courier,
      cancellation: s.cancellation ? { reasonCode: s.cancellation.reasonCode, reason: cancelReasonLabel(s.cancellation.reasonCode, locale) } : null,
      timeline: v.history.map((h) => ({ status: h.to, at: h.at })),
    };
  }
}

export function branchBrief(b: BranchInfo, locale: Locale): OrderBranchDto {
  return { id: b.id, slug: b.slug, name: text(b.name, locale), address: text(b.address, locale), phone: b.phone, location: point(b.location) };
}

// ---------------------------------------------------------------- Ответы: доставка и время

export class PublicDeliveryZoneDto {
  @ApiProperty() id: string;
  @ApiProperty() branchId: string;
  @ApiProperty({ description: 'Название на языке запроса' }) name: string;
  @ApiProperty({ type: [GeoPointDto] }) polygon: GeoPointDto[];
  @ApiProperty({ type: MoneyDto }) minOrderAmount: MoneyDto;
  @ApiProperty({ type: MoneyDto }) deliveryFee: MoneyDto;
  @ApiPropertyOptional({ type: MoneyDto, nullable: true }) freeDeliveryFrom: MoneyDto | null;
  @ApiProperty() etaMinutes: number;

  static from(z: DeliveryZoneState, locale: Locale): PublicDeliveryZoneDto {
    return {
      id: z.id,
      branchId: z.branchId,
      name: text(z.name, locale),
      polygon: z.polygon.map(point),
      minOrderAmount: money(z.minOrderAmount),
      deliveryFee: money(z.deliveryFee),
      freeDeliveryFrom: moneyOrNull(z.freeDeliveryFrom),
      etaMinutes: z.etaMinutes,
    };
  }
}

export class DeliveryOptionDto {
  @ApiProperty({ type: OrderBranchDto }) branch: OrderBranchDto;
  @ApiProperty({ type: PublicDeliveryZoneDto }) zone: PublicDeliveryZoneDto;
  @ApiProperty({ description: 'Расстояние от филиала до точки, м' }) distanceMeters: number;

  static from(o: DeliveryOption, locale: Locale): DeliveryOptionDto {
    return { branch: branchBrief(o.branch, locale), zone: PublicDeliveryZoneDto.from(o.zone, locale), distanceMeters: o.distanceMeters };
  }
}

export class DeliveryResolutionDto {
  @ApiProperty({ description: 'Доставляем ли в эту точку' }) deliverable: boolean;
  @ApiPropertyOptional({ type: String, nullable: true }) address: string | null;
  @ApiPropertyOptional({ type: DeliveryOptionDto, nullable: true, description: 'Выбранный филиал: меньшая стоимость, затем ближайший' })
  best: DeliveryOptionDto | null;
  @ApiProperty({ type: [DeliveryOptionDto] }) alternatives: DeliveryOptionDto[];

  static from(r: DeliveryResolution, address: string | null, locale: Locale): DeliveryResolutionDto {
    return {
      deliverable: r.deliverable,
      address,
      best: r.best ? DeliveryOptionDto.from(r.best, locale) : null,
      alternatives: r.alternatives.map((o) => DeliveryOptionDto.from(o, locale)),
    };
  }
}

export class OrderAsapAvailabilityDto {
  @ApiProperty() available: boolean;
  @ApiPropertyOptional({ enum: ['closed', 'closing_soon'], nullable: true }) reason: 'closed' | 'closing_soon' | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true, description: 'Когда заказ будет готов при оформлении сейчас' }) readyAt: Date | null;
}

export class OrderSlotDto {
  @ApiProperty({ description: 'Момент (UTC, ISO) — передаётся в scheduledFor' }) at: Date;
  @ApiProperty({ example: '19:30', description: 'Локальное время филиала' }) time: string;
}

export class OrderSlotsDto {
  @ApiProperty() branchId: string;
  @ApiProperty({ enum: ORDER_TYPES }) type: OrderType;
  @ApiProperty({ example: '2026-10-01' }) date: string;
  @ApiProperty({ example: 'Asia/Almaty' }) timezone: string;
  @ApiProperty() leadMinutes: number;
  @ApiProperty({ type: OrderAsapAvailabilityDto }) asap: OrderAsapAvailabilityDto;
  @ApiProperty({ type: [OrderSlotDto], description: 'Слоты с шагом 15 минут в часы работы' }) slots: OrderSlotDto[];
  @ApiProperty({ type: [String], description: 'Даты, доступные для заказа ко времени' }) dates: string[];

  static from(v: OrderSlotsView): OrderSlotsDto {
    return {
      branchId: v.branch.id,
      type: v.type,
      date: v.date,
      timezone: v.branch.timezone,
      leadMinutes: v.leadMinutes,
      asap: v.asap,
      slots: v.slots.map((at) => ({ at, time: toLocalTime(at, v.branch.timezone) })),
      dates: v.dates,
    };
  }
}

// ---------------------------------------------------------------- Преобразование запросов

export function checkoutInput(dto: OrderCheckoutDto | Omit<OrderCheckoutDto, 'phoneVerificationToken' | 'analyticsSessionId'>): PlaceOrderInput {
  const full = dto as Partial<OrderCheckoutDto>;
  return {
    branchId: dto.branchId,
    type: dto.type,
    items: dto.items.map(lineInput),
    delivery: dto.delivery
      ? {
          point: { lat: dto.delivery.point.lat, lng: dto.delivery.point.lng },
          addressText: dto.delivery.addressText,
          apartment: dto.delivery.apartment ?? null,
          entrance: dto.delivery.entrance ?? null,
          floor: dto.delivery.floor ?? null,
          intercom: dto.delivery.intercom ?? null,
          courierComment: dto.delivery.courierComment ?? null,
        }
      : null,
    contactless: dto.contactless ?? false,
    scheduledFor: dto.scheduledFor ? new Date(dto.scheduledFor) : null,
    customer: { name: dto.customer.name, phone: dto.customer.phone, email: dto.customer.email ?? null },
    comment: dto.comment ?? null,
    promoCode: dto.promoCode ?? null,
    certificateCode: dto.certificateCode ?? null,
    paymentMethod: dto.paymentMethod,
    phoneVerificationToken: full.phoneVerificationToken ?? null,
    consent: { personalData: dto.consent.personalData, marketing: dto.consent.marketing ?? null },
    locale: dto.locale,
    analyticsSessionId: full.analyticsSessionId ?? null,
    idempotencyKey: dto.idempotencyKey,
  };
}

export function lineInput(l: OrderLineInputDto): PricedLineRequest {
  return { dishId: l.dishId, quantity: l.quantity, modifierOptionIds: l.modifierOptionIds ?? [] };
}

export function quoteInput(dto: QuoteOrderDto): QuoteOrderInput {
  return {
    branchId: dto.branchId,
    type: dto.type,
    items: dto.items.map(lineInput),
    point: dto.point ? { lat: dto.point.lat, lng: dto.point.lng } : null,
    promoCode: dto.promoCode ?? null,
    certificateCode: dto.certificateCode ?? null,
    phone: dto.phone ?? null,
  };
}
