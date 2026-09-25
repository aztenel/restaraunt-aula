import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { GeoPointDto, MoneyDto, MoneyInputDto, PageQueryDto, TranslatableDto } from '../../../../shared/infrastructure/http/api-types';
import { Locale, LOCALES } from '../../../../shared/kernel/translatable';
import { BranchOrderMenu, DishAvailability } from '../../../catalog/public';
import { PaymentMethod, PaymentStatus } from '../../../payments/public';
import { OrderDetailsView, OrderQueueCard, OrderQueueView } from '../../application/order.queries';
import { COURIER_DISPATCH_STATUSES, CourierDispatchStatus } from '../../domain/courier-dispatch';
import { OrderItemSnapshot, OrderState } from '../../domain/order';
import { CANCEL_REASON_CODES, CancelReasonCode, STAFF_TRANSITION_TARGETS, StaffTransitionTarget } from '../../domain/order-status';
import { CourierDispatchRecord } from '../../infrastructure/courier-dispatch.repository';
import { OrderRefundRecord } from '../../infrastructure/order-payments.repository';
import { StatusHistoryEntry } from '../../infrastructure/order.repository';
import { OrderChannel, OrderStatus, OrderType } from '../../public';
import { CHECKOUT_PAYMENT_METHODS, DATE_RE, money, moneyOrNull, ORDER_CHANNELS, ORDER_STATUSES, ORDER_TYPES, point, queryArray, translatable } from './common.dto';
import { OrderCheckoutDto } from './public.dto';

export const REFUND_KINDS = ['cancellation', 'partial', 'late_payment', 'duplicate_payment', 'external'] as const;

// ---------------------------------------------------------------- Запросы

export class AdminOrderListQueryDto extends PageQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;

  @ApiPropertyOptional({ enum: ORDER_STATUSES, isArray: true, description: '?status=paid&status=accepted или ?status=paid,accepted' })
  @IsOptional()
  @Transform(queryArray)
  @IsIn(ORDER_STATUSES, { each: true })
  status?: OrderStatus[];

  @ApiPropertyOptional({ enum: ORDER_TYPES }) @IsOptional() @IsIn(ORDER_TYPES) type?: OrderType;

  @ApiPropertyOptional({ description: 'С даты оформления (включительно), YYYY-MM-DD по времени Asia/Almaty' })
  @IsOptional()
  @Matches(DATE_RE)
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'По дату оформления (включительно), YYYY-MM-DD' })
  @IsOptional()
  @Matches(DATE_RE)
  dateTo?: string;

  @ApiPropertyOptional({ description: 'Поиск по номеру заказа или телефону гостя' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  q?: string;
}

export class AdminQueueQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
}

export class AdminOrderMenuQueryDto {
  @ApiProperty({ format: 'uuid', description: 'Филиал телефонного заказа (право orders.manage в филиале)' }) @IsUUID() branchId: string;
}

export class TransitionOrderDto {
  @ApiProperty({ enum: STAFF_TRANSITION_TARGETS, description: 'Новый статус (отмена — отдельными действиями cancel/reject)' })
  @IsIn(STAFF_TRANSITION_TARGETS)
  to: StaffTransitionTarget;
}

export class CancelOrderDto {
  @ApiProperty({ enum: CANCEL_REASON_CODES }) @IsIn(CANCEL_REASON_CODES) reasonCode: CancelReasonCode;
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsString() @MaxLength(500) reason?: string | null;

  @ApiPropertyOptional({
    type: MoneyInputDto,
    nullable: true,
    description: 'Сумма возврата оплаченного заказа (частичный возврат — право orders.refund). Не задана — полный возврат',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => MoneyInputDto)
  refundAmount?: MoneyInputDto | null;
}

export class RefundOrderDto {
  @ApiProperty({ type: MoneyInputDto }) @ValidateNested() @Type(() => MoneyInputDto) amount: MoneyInputDto;
  @ApiProperty({ example: 'Недовложение: не положили соус' }) @IsString() @MinLength(1) @MaxLength(500) reason: string;
}

/** Телефонный заказ оператора: как оформление на витрине, без SMS-кода (оператор говорит с гостем). */
export class AdminCreateOrderDto extends OmitType(OrderCheckoutDto, ['phoneVerificationToken', 'analyticsSessionId'] as const) {}

// ---------------------------------------------------------------- Ответы

export class OrderCustomerDto {
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) customerId: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) name: string | null;
  @ApiProperty({ example: '+77771234567' }) phone: string;
  @ApiPropertyOptional({ type: String, nullable: true }) email: string | null;
}

export class AdminOrderListItemDto {
  @ApiProperty() id: string;
  @ApiProperty() number: string;
  @ApiProperty() branchId: string;
  @ApiProperty({ enum: ORDER_TYPES }) type: OrderType;
  @ApiProperty({ enum: ORDER_CHANNELS }) channel: OrderChannel;
  @ApiProperty({ enum: ORDER_STATUSES }) status: OrderStatus;
  @ApiProperty({ type: OrderCustomerDto }) customer: OrderCustomerDto;
  @ApiProperty({ type: MoneyDto }) total: MoneyDto;
  @ApiProperty({ enum: CHECKOUT_PAYMENT_METHODS }) paymentMethod: 'online' | 'on_receipt';
  @ApiPropertyOptional({ type: String, nullable: true }) promoCode: string | null;
  @ApiProperty() placedAt: Date;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) scheduledFor: Date | null;
  @ApiProperty() promisedAt: Date;

  static from(s: OrderState): AdminOrderListItemDto {
    return {
      id: s.id,
      number: s.number,
      branchId: s.branchId,
      type: s.type,
      channel: s.channel,
      status: s.status,
      customer: { ...s.customer },
      total: money(s.totals.total),
      paymentMethod: s.paymentMethod,
      promoCode: s.promo?.code ?? null,
      placedAt: s.timestamps.placedAt,
      scheduledFor: s.scheduledFor,
      promisedAt: s.promisedAt,
    };
  }
}

export class AdminOrdersPageDto {
  @ApiProperty({ type: [AdminOrderListItemDto] }) items: AdminOrderListItemDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() perPage: number;
}

export class AdminOrderModifierDto {
  @ApiProperty() groupId: string;
  @ApiProperty({ type: TranslatableDto }) groupName: TranslatableDto;
  @ApiProperty() optionId: string;
  @ApiProperty({ type: TranslatableDto }) optionName: TranslatableDto;
  @ApiProperty({ type: MoneyDto }) price: MoneyDto;
}

export class AdminOrderItemDto {
  @ApiProperty() id: string;
  @ApiProperty() position: number;
  @ApiProperty() dishId: string;
  @ApiPropertyOptional({ type: String, nullable: true }) sku: string | null;
  @ApiProperty({ type: TranslatableDto, description: 'Снимок названия на момент заказа' }) name: TranslatableDto;
  @ApiPropertyOptional({ type: String, nullable: true }) photoUrl: string | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) weightGrams: number | null;
  @ApiProperty() quantity: number;
  @ApiProperty({ type: MoneyDto }) basePrice: MoneyDto;
  @ApiProperty({ type: MoneyDto }) unitPrice: MoneyDto;
  @ApiProperty({ type: MoneyDto }) lineTotal: MoneyDto;
  @ApiProperty({ type: [AdminOrderModifierDto] }) modifiers: AdminOrderModifierDto[];

  static from(i: OrderItemSnapshot): AdminOrderItemDto {
    return {
      id: i.id,
      position: i.position,
      dishId: i.dishId,
      sku: i.sku,
      name: translatable(i.name),
      photoUrl: i.photoUrl,
      weightGrams: i.weightGrams,
      quantity: i.quantity,
      basePrice: money(i.basePrice),
      unitPrice: money(i.unitPrice),
      lineTotal: money(i.lineTotal),
      modifiers: i.modifiers.map((m) => ({
        groupId: m.groupId,
        groupName: translatable(m.groupName),
        optionId: m.optionId,
        optionName: translatable(m.optionName),
        price: money(m.price),
      })),
    };
  }
}

export class AdminOrderDeliveryDto {
  @ApiProperty({ type: GeoPointDto }) point: GeoPointDto;
  @ApiProperty() addressText: string;
  @ApiPropertyOptional({ type: String, nullable: true }) apartment: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) entrance: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) floor: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) intercom: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) courierComment: string | null;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) zoneId: string | null;
  @ApiPropertyOptional({ type: TranslatableDto, nullable: true }) zoneName: TranslatableDto | null;
  @ApiProperty() contactless: boolean;
}

export class AdminQueueCourierDto {
  @ApiProperty({ enum: COURIER_DISPATCH_STATUSES }) status: CourierDispatchStatus;
  @ApiPropertyOptional({ type: String, nullable: true }) trackingUrl: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) courierName: string | null;
}

export class AdminQueueOrderDto extends AdminOrderListItemDto {
  @ApiProperty({ type: [AdminOrderItemDto] }) items: AdminOrderItemDto[];
  @ApiPropertyOptional({ type: String, nullable: true }) comment: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Адрес доставки одной строкой' }) deliveryAddress: string | null;
  @ApiProperty() contactless: boolean;
  @ApiProperty({ enum: ORDER_STATUSES, isArray: true, description: 'Доступные сотруднику переходы' }) allowedTransitions: OrderStatus[];
  @ApiProperty({ description: 'Обещанное время прошло' }) isLate: boolean;
  @ApiProperty({ description: 'Отмена доступна (awaiting_payment / accepted, право orders.manage)' }) canCancel: boolean;
  @ApiProperty({ description: 'Отказ от оплаченного заказа доступен (paid → accepted → cancelled)' }) canReject: boolean;
  @ApiPropertyOptional({ type: AdminQueueCourierDto, nullable: true, description: 'Заявка службы доставки (null — свои курьеры или заявки нет)' })
  courier: AdminQueueCourierDto | null;
  @ApiProperty({ type: MoneyDto, description: 'Получить с гостя при получении (0 — оплачено онлайн и/или сертификатом)' }) amountDue: MoneyDto;

  static fromCard(c: OrderQueueCard): AdminQueueOrderDto {
    const s = c.order;
    return {
      ...AdminOrderListItemDto.from(s),
      items: s.items.map(AdminOrderItemDto.from),
      comment: s.comment,
      deliveryAddress: s.delivery
        ? [s.delivery.addressText, s.delivery.apartment && `кв. ${s.delivery.apartment}`, s.delivery.entrance && `подъезд ${s.delivery.entrance}`]
            .filter(Boolean)
            .join(', ')
        : null,
      contactless: s.contactless,
      allowedTransitions: c.allowedTransitions,
      isLate: c.isLate,
      canCancel: c.canCancel,
      canReject: c.canReject,
      courier: c.courier ? { ...c.courier } : null,
      amountDue: money(c.amountDue),
    };
  }
}

export class AdminQueueGroupDto {
  @ApiProperty({ enum: ORDER_STATUSES }) status: OrderStatus;
  @ApiProperty() count: number;
  @ApiProperty({ type: [AdminQueueOrderDto] }) orders: AdminQueueOrderDto[];
}

export class AdminOrderQueueDto {
  @ApiProperty() generatedAt: Date;
  @ApiProperty({ type: [AdminQueueGroupDto] }) groups: AdminQueueGroupDto[];

  static from(v: OrderQueueView): AdminOrderQueueDto {
    return {
      generatedAt: v.generatedAt,
      groups: v.groups.map((g) => ({ status: g.status, count: g.orders.length, orders: g.orders.map(AdminQueueOrderDto.fromCard) })),
    };
  }
}

export class AdminOrderPaymentDto {
  @ApiProperty() id: string;
  @ApiPropertyOptional({ enum: ['certificate', 'online', 'on_receipt'], nullable: true, description: 'Назначение платежа в заказе' })
  kind: string | null;
  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Номер попытки онлайн-оплаты' }) attempt: number | null;
  @ApiProperty({ enum: Object.values(PaymentMethod) }) method: PaymentMethod;
  @ApiProperty() provider: string;
  @ApiProperty({ enum: Object.values(PaymentStatus) }) status: PaymentStatus;
  @ApiProperty({ type: MoneyDto }) amount: MoneyDto;
  @ApiProperty({ type: MoneyDto }) refundedAmount: MoneyDto;
  @ApiPropertyOptional({ type: String, nullable: true }) paymentUrl: string | null;
  @ApiProperty() createdAt: Date;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) paidAt: Date | null;
}

export class AdminOrderRefundDto {
  @ApiProperty() refundId: string;
  @ApiProperty() paymentId: string;
  @ApiProperty({ enum: REFUND_KINDS }) kind: string;
  @ApiProperty({ enum: ['pending', 'succeeded', 'failed'] }) status: string;
  @ApiProperty({ type: MoneyDto }) amount: MoneyDto;
  @ApiProperty() reason: string;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) requestedBy: string | null;
  @ApiProperty() createdAt: Date;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) completedAt: Date | null;

  static from(r: OrderRefundRecord): AdminOrderRefundDto {
    return {
      refundId: r.refundId,
      paymentId: r.paymentId,
      kind: r.kind,
      status: r.status,
      amount: money(r.amount),
      reason: r.reason,
      requestedBy: r.requestedBy,
      createdAt: r.createdAt,
      completedAt: r.completedAt,
    };
  }
}

export class AdminCourierDispatchDto {
  @ApiProperty() id: string;
  @ApiProperty({ description: 'Служба курьеров' }) provider: string;
  @ApiProperty({ enum: COURIER_DISPATCH_STATUSES }) status: CourierDispatchStatus;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Статус в терминах службы' }) providerStatus: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) externalId: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) trackingUrl: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) courierName: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) courierPhone: string | null;
  @ApiPropertyOptional({ type: MoneyDto, nullable: true }) price: MoneyDto | null;
  @ApiProperty() attempts: number;
  @ApiPropertyOptional({ type: String, nullable: true }) lastError: string | null;
  @ApiProperty() requestedAt: Date;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) finishedAt: Date | null;

  static from(d: CourierDispatchRecord): AdminCourierDispatchDto {
    return {
      id: d.id,
      provider: d.provider,
      status: d.status,
      providerStatus: d.providerStatus,
      externalId: d.externalId,
      trackingUrl: d.trackingUrl,
      courierName: d.courierName,
      courierPhone: d.courierPhone,
      price: moneyOrNull(d.price),
      attempts: d.attempts,
      lastError: d.lastError,
      requestedAt: d.requestedAt,
      finishedAt: d.finishedAt,
    };
  }
}

export class OrderStatusHistoryDto {
  @ApiPropertyOptional({ enum: ORDER_STATUSES, nullable: true }) from: OrderStatus | null;
  @ApiProperty({ enum: ORDER_STATUSES }) to: OrderStatus;
  @ApiProperty() at: Date;
  @ApiProperty({ enum: ['staff', 'system', 'guest'] }) actorKind: string;
  @ApiProperty() actorName: string;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) actorUserId: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) reasonCode: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) reason: string | null;

  static from(h: StatusHistoryEntry): OrderStatusHistoryDto {
    return { ...h };
  }
}

export class AdminOrderCancellationDto {
  @ApiProperty({ enum: CANCEL_REASON_CODES }) reasonCode: string;
  @ApiPropertyOptional({ type: String, nullable: true }) reason: string | null;
}

export class AdminOrderTimestampsDto {
  @ApiProperty() placedAt: Date;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) paidAt: Date | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) acceptedAt: Date | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) cookingAt: Date | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) readyAt: Date | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) deliveringAt: Date | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) completedAt: Date | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) cancelledAt: Date | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) refundedAt: Date | null;
}

export class AdminOrderDetailsDto extends AdminOrderListItemDto {
  @ApiProperty() publicToken: string;
  @ApiProperty({ enum: LOCALES }) locale: Locale;
  @ApiProperty({ type: [AdminOrderItemDto] }) items: AdminOrderItemDto[];
  @ApiProperty({ type: MoneyDto }) subtotal: MoneyDto;
  @ApiProperty({ type: MoneyDto }) discount: MoneyDto;
  @ApiProperty({ type: MoneyDto }) deliveryFee: MoneyDto;
  @ApiPropertyOptional({ enum: ['percent', 'fixed', 'free_delivery'], nullable: true }) promoKind: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) certificateMaskedCode: string | null;
  @ApiProperty({ type: MoneyDto }) certificateAmount: MoneyDto;
  @ApiProperty({ type: MoneyDto, description: 'К оплате онлайн/при получении' }) amountDue: MoneyDto;
  @ApiPropertyOptional({ type: AdminOrderDeliveryDto, nullable: true }) delivery: AdminOrderDeliveryDto | null;
  @ApiPropertyOptional({ type: String, nullable: true }) comment: string | null;
  @ApiProperty() etaMinutes: number;
  @ApiPropertyOptional({ type: String, nullable: true }) analyticsSessionId: string | null;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'Сотрудник, оформивший телефонный заказ' }) createdBy: string | null;
  @ApiProperty() wasPaid: boolean;
  @ApiPropertyOptional({ type: AdminOrderCancellationDto, nullable: true }) cancellation: AdminOrderCancellationDto | null;
  @ApiProperty({ type: AdminOrderTimestampsDto }) timestamps: AdminOrderTimestampsDto;
  @ApiProperty({ type: [AdminOrderPaymentDto] }) payments: AdminOrderPaymentDto[];
  @ApiProperty({ type: [AdminOrderRefundDto] }) refunds: AdminOrderRefundDto[];
  @ApiPropertyOptional({ type: AdminCourierDispatchDto, nullable: true }) courierDispatch: AdminCourierDispatchDto | null;
  @ApiProperty({ type: [OrderStatusHistoryDto] }) history: OrderStatusHistoryDto[];
  @ApiProperty({ enum: ORDER_STATUSES, isArray: true, description: 'Переходы, доступные сотруднику' }) allowedTransitions: OrderStatus[];
  @ApiProperty() canCancel: boolean;
  @ApiProperty({ description: 'Отказ от оплаченного заказа (paid → accepted → cancelled)' }) canReject: boolean;
  @ApiProperty({ description: 'Частичный возврат (право orders.refund, статус от принятия до выполнения)' }) canRefund: boolean;
  @ApiProperty({ type: MoneyDto, description: 'Сколько ещё можно вернуть' }) refundable: MoneyDto;
  @ApiProperty({ description: 'Ссылка на страницу статуса для гостя' }) trackingUrl: string;
  @ApiProperty({ description: 'Можно повторно вызвать курьера службы доставки (POST :id/courier/retry)' }) canRetryCourier: boolean;
  @ApiProperty({ description: 'Можно отменить активную заявку службы доставки (POST :id/courier/cancel)' }) canCancelCourier: boolean;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Имя сотрудника, оформившего телефонный заказ' }) createdByName: string | null;

  static fromView(v: OrderDetailsView, trackingUrl: string): AdminOrderDetailsDto {
    const s = v.order;
    return {
      ...AdminOrderListItemDto.from(s),
      publicToken: s.publicToken,
      locale: s.locale,
      items: s.items.map(AdminOrderItemDto.from),
      subtotal: money(s.totals.subtotal),
      discount: money(s.totals.discount),
      deliveryFee: money(s.totals.deliveryFee),
      promoKind: s.promo?.kind ?? null,
      certificateMaskedCode: s.certificateMaskedCode,
      certificateAmount: money(v.payment.certificateAmount),
      amountDue: money(v.payment.amountDue),
      delivery: s.delivery
        ? {
            point: point(s.delivery.point),
            addressText: s.delivery.addressText,
            apartment: s.delivery.apartment,
            entrance: s.delivery.entrance,
            floor: s.delivery.floor,
            intercom: s.delivery.intercom,
            courierComment: s.delivery.courierComment,
            zoneId: s.delivery.zoneId,
            zoneName: v.zone ? translatable(v.zone.name) : null,
            contactless: s.contactless,
          }
        : null,
      comment: s.comment,
      etaMinutes: s.etaMinutes,
      analyticsSessionId: s.analyticsSessionId,
      createdBy: s.createdBy,
      wasPaid: s.wasPaid,
      cancellation: s.cancellation,
      timestamps: { ...s.timestamps },
      payments: v.payments.map((p) => ({
        id: p.payment.id,
        kind: p.kind,
        attempt: p.attempt,
        method: p.payment.method,
        provider: p.payment.provider,
        status: p.payment.status,
        amount: money(p.payment.amount),
        refundedAmount: money(p.payment.refundedAmount),
        paymentUrl: p.payment.paymentUrl,
        createdAt: p.payment.createdAt,
        paidAt: p.payment.paidAt,
      })),
      refunds: v.refunds.map(AdminOrderRefundDto.from),
      courierDispatch: v.dispatch ? AdminCourierDispatchDto.from(v.dispatch) : null,
      history: v.history.map(OrderStatusHistoryDto.from),
      allowedTransitions: v.allowedTransitions,
      canCancel: v.canCancel,
      canReject: v.canReject,
      canRefund: v.canRefund,
      refundable: money(v.refundable),
      trackingUrl,
      canRetryCourier: v.canRetryCourier,
      canCancelCourier: v.canCancelCourier,
      createdByName: v.createdByName,
    };
  }
}

// ---------------------------------------------------------------- Меню филиала для телефонного заказа

export class AdminOrderMenuOptionDto {
  @ApiProperty() id: string;
  @ApiProperty({ type: TranslatableDto }) name: TranslatableDto;
  @ApiProperty({ type: MoneyDto }) price: MoneyDto;
  @ApiProperty() isDefault: boolean;
}

export class AdminOrderMenuModifierGroupDto {
  @ApiProperty() id: string;
  @ApiProperty({ type: TranslatableDto }) name: TranslatableDto;
  @ApiProperty() minSelect: number;
  @ApiProperty() maxSelect: number;
  @ApiProperty() isRequired: boolean;
  @ApiProperty({ type: [AdminOrderMenuOptionDto] }) options: AdminOrderMenuOptionDto[];
}

export class AdminOrderMenuCategoryDto {
  @ApiProperty() id: string;
  @ApiProperty() slug: string;
  @ApiProperty({ type: TranslatableDto }) name: TranslatableDto;
}

export class AdminOrderMenuDishDto {
  @ApiProperty() dishId: string;
  @ApiProperty() slug: string;
  @ApiProperty() categoryId: string;
  @ApiProperty({ type: TranslatableDto }) name: TranslatableDto;
  @ApiProperty({ type: MoneyDto, description: 'Цена в филиале без модификаторов' }) price: MoneyDto;
  @ApiProperty({ enum: Object.values(DishAvailability), description: 'Как блюдо видно на витрине (режим стоп-листа филиала)' })
  availability: DishAvailability;
  @ApiProperty({ description: 'В стоп-листе — к заказу недоступно' }) stopped: boolean;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true, description: 'Стоп до (null — до ручного возврата)' })
  stoppedUntil: Date | null;
  @ApiPropertyOptional({ type: String, nullable: true }) stopReason: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) photoUrl: string | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) weightGrams: number | null;
  @ApiPropertyOptional({ type: String, nullable: true }) sku: string | null;
  @ApiProperty({ type: [AdminOrderMenuModifierGroupDto] }) modifierGroups: AdminOrderMenuModifierGroupDto[];
}

export class AdminOrderMenuDto {
  @ApiProperty() branchId: string;
  @ApiProperty({ type: [AdminOrderMenuCategoryDto], description: 'Категории, в которых есть блюда меню филиала (в порядке меню)' })
  categories: AdminOrderMenuCategoryDto[];
  @ApiProperty({ type: [AdminOrderMenuDishDto], description: 'Все блюда меню филиала, включая стоп-лист (stopped = true)' })
  dishes: AdminOrderMenuDishDto[];

  static from(m: BranchOrderMenu): AdminOrderMenuDto {
    return {
      branchId: m.branchId,
      categories: m.categories.map((c) => ({ id: c.id, slug: c.slug, name: translatable(c.name) })),
      dishes: m.dishes.map((d) => ({
        dishId: d.dishId,
        slug: d.slug,
        categoryId: d.categoryId,
        name: translatable(d.name),
        price: money(d.price),
        availability: d.availability,
        stopped: d.stopped,
        stoppedUntil: d.stoppedUntil,
        stopReason: d.stopReason,
        photoUrl: d.photoUrl,
        weightGrams: d.weightGrams,
        sku: d.sku,
        modifierGroups: d.modifierGroups.map((g) => ({
          id: g.id,
          name: translatable(g.name),
          minSelect: g.minSelect,
          maxSelect: g.maxSelect,
          isRequired: g.isRequired,
          options: g.options.map((o) => ({ id: o.id, name: translatable(o.name), price: money(o.price), isDefault: o.isDefault })),
        })),
      })),
    };
  }
}
