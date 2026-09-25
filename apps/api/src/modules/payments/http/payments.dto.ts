import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsISO8601, IsOptional, IsString, IsUUID, Length, MaxLength, ValidateNested } from 'class-validator';
import { MoneyDto, MoneyInputDto, PageQueryDto } from '../../../shared/infrastructure/http/api-types';
import { Money } from '../../../shared/kernel/money';
import { enumValues } from '../../../shared/kernel/state-machine';
import { PaymentAdminView, PaymentDetailsView, PaymentHistoryEvent, PaymentProviderLogEntry, RefundAdminRow } from '../application/payment.queries';
import { RefundMode } from '../domain/refund';
import { PaymentMethod, PaymentPurpose, PaymentStatus, PaymentView, RefundView } from '../public';

export const PAYMENT_PURPOSES = enumValues(PaymentPurpose);
export const PAYMENT_METHODS = enumValues(PaymentMethod);
export const PAYMENT_STATUSES = enumValues(PaymentStatus);
export const REFUND_STATUSES = ['pending', 'succeeded', 'failed'] as const;
export const REFUND_MODES: RefundMode[] = ['gateway', 'certificate', 'manual'];

function money(m: Money): MoneyDto {
  return MoneyDto.from(m);
}

// ---------------------------------------------------------------- Ответы

export class PaymentCustomerDto {
  @ApiPropertyOptional({ type: String, nullable: true }) name: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, example: '+77771234567' }) phone: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) email: string | null;
}

export class PaymentDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: PAYMENT_PURPOSES }) purpose: PaymentPurpose;
  @ApiProperty({ description: 'Объект оплаты: заказ, бронь, счёт банкета, заказ сертификатов' }) referenceId: string;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) branchId: string | null;
  @ApiProperty({ enum: PAYMENT_METHODS }) method: PaymentMethod;
  @ApiProperty({ description: 'Провайдер (для online) или способ оплаты' }) provider: string;
  @ApiProperty({ enum: PAYMENT_STATUSES }) status: PaymentStatus;
  @ApiProperty({ type: MoneyDto }) amount: MoneyDto;
  @ApiProperty({ type: MoneyDto }) refundedAmount: MoneyDto;
  @ApiProperty({ type: MoneyDto, description: 'Сколько ещё можно вернуть (с учётом ожидающих возвратов)' }) refundableAmount: MoneyDto;
  @ApiPropertyOptional({ type: String, nullable: true }) paymentUrl: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) externalId: string | null;
  @ApiProperty({ description: 'Номер счёта для провайдера' }) invoiceNo: number;
  @ApiProperty() description: string;
  @ApiProperty({ type: PaymentCustomerDto }) customer: PaymentCustomerDto;
  @ApiProperty() createdAt: Date;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) paidAt: Date | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) expiresAt: Date | null;
  @ApiPropertyOptional({ type: String, nullable: true }) failureReason: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) cancelReason: string | null;
  @ApiProperty({ description: 'Провайдер сообщил сумму, отличную от суммы платежа' }) amountMismatch: boolean;
  @ApiProperty({ description: 'Можно запросить возврат (есть остаток и право)' }) canRefund: boolean;
  @ApiProperty({ description: 'Можно отметить получение денег (оплата при получении)' }) canCollect: boolean;
  @ApiProperty({ enum: PAYMENT_STATUSES, isArray: true }) allowedTransitions: PaymentStatus[];

  static from(v: PaymentAdminView): PaymentDto {
    const view: PaymentView = v.payment.toView();
    return {
      id: view.id,
      purpose: view.purpose,
      referenceId: view.referenceId,
      branchId: view.branchId,
      method: view.method,
      provider: view.provider,
      status: view.status,
      amount: money(view.amount),
      refundedAmount: money(view.refundedAmount),
      refundableAmount: money(v.refundable),
      paymentUrl: view.paymentUrl,
      externalId: view.externalId,
      invoiceNo: v.invoiceNo,
      description: v.description,
      customer: v.customer,
      createdAt: view.createdAt,
      paidAt: view.paidAt,
      expiresAt: view.expiresAt,
      failureReason: v.failureReason,
      cancelReason: v.cancelReason,
      amountMismatch: v.amountMismatchAt !== null,
      canRefund: v.canRefund,
      canCollect: v.canCollect,
      allowedTransitions: [...v.allowedTransitions],
    };
  }
}

export class PaymentsPageDto {
  @ApiProperty({ type: [PaymentDto] }) items: PaymentDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() perPage: number;
}

export class RefundPaymentRefDto {
  @ApiProperty({ enum: PAYMENT_PURPOSES }) purpose: string;
  @ApiProperty() referenceId: string;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) branchId: string | null;
  @ApiProperty({ enum: PAYMENT_METHODS }) method: string;
}

export class RefundDto {
  @ApiProperty() id: string;
  @ApiProperty() paymentId: string;
  @ApiProperty({ type: MoneyDto }) amount: MoneyDto;
  @ApiProperty({ enum: REFUND_STATUSES }) status: string;
  @ApiProperty({ enum: REFUND_MODES, description: 'gateway — через провайдера, certificate — на сертификат, manual — подтверждает финансист' })
  mode: RefundMode;
  @ApiProperty() reason: string;
  @ApiProperty() attempts: number;
  @ApiPropertyOptional({ type: String, nullable: true }) failureReason: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) comment: string | null;
  @ApiProperty() createdAt: Date;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) completedAt: Date | null;
  @ApiProperty({ description: 'Ожидает ручного подтверждения финансистом' }) awaitingManualConfirmation: boolean;
  @ApiProperty({ type: RefundPaymentRefDto }) payment: RefundPaymentRefDto;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'Сотрудник, запросивший возврат (null — система)' })
  requestedBy: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) requestedByName: string | null;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'Сотрудник, подтвердивший (или отклонивший) ручной возврат' })
  confirmedBy: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) confirmedByName: string | null;

  static from(r: RefundAdminRow): RefundDto {
    const view = r.refund.toView();
    const snapshot = r.refund.snapshot();
    return {
      id: view.id,
      paymentId: view.paymentId,
      amount: money(view.amount),
      status: view.status,
      mode: r.mode,
      reason: view.reason,
      attempts: r.attempts,
      failureReason: r.failureReason,
      comment: r.comment,
      createdAt: view.createdAt,
      completedAt: r.completedAt,
      awaitingManualConfirmation: r.mode === 'manual' && view.status === 'pending',
      payment: { purpose: r.paymentPurpose, referenceId: r.paymentReferenceId, branchId: r.paymentBranchId, method: r.paymentMethod },
      requestedBy: snapshot.requestedBy,
      requestedByName: r.requestedByName,
      confirmedBy: snapshot.completedBy,
      confirmedByName: r.completedByName,
    };
  }
}

export const PAYMENT_HISTORY_TYPES = ['status', 'refund_requested', 'refund_succeeded', 'refund_failed'] as const;

export class PaymentHistoryEventDto {
  @ApiProperty() at: Date;
  @ApiProperty({ enum: PAYMENT_HISTORY_TYPES, description: 'status — переход статуса платежа; refund_* — события возврата' })
  type: (typeof PAYMENT_HISTORY_TYPES)[number];
  @ApiPropertyOptional({ enum: PAYMENT_STATUSES, nullable: true, description: 'Прежний статус (null — создание)' }) fromStatus: PaymentStatus | null;
  @ApiPropertyOptional({ enum: PAYMENT_STATUSES, nullable: true }) toStatus: PaymentStatus | null;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) refundId: string | null;
  @ApiPropertyOptional({ type: MoneyDto, nullable: true }) amount: MoneyDto | null;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Причина отказа/отмены, причина возврата, комментарий подтверждения' })
  reason: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Сотрудник (null — система, провайдер или гость)' }) actorName: string | null;

  static from(e: PaymentHistoryEvent): PaymentHistoryEventDto {
    return { ...e, amount: e.amount ? money(e.amount) : null };
  }
}

export class RefundsPageDto {
  @ApiProperty({ type: [RefundDto] }) items: RefundDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() perPage: number;
}

/** Короткий ответ на запрос возврата (контракт RefundView). */
export class RefundResultDto {
  @ApiProperty() id: string;
  @ApiProperty() paymentId: string;
  @ApiProperty({ type: MoneyDto }) amount: MoneyDto;
  @ApiProperty({ enum: REFUND_STATUSES }) status: string;
  @ApiProperty() reason: string;
  @ApiProperty() createdAt: Date;

  static from(v: RefundView): RefundResultDto {
    return { id: v.id, paymentId: v.paymentId, amount: money(v.amount), status: v.status, reason: v.reason, createdAt: v.createdAt };
  }
}

export class WebhookEventDto {
  @ApiProperty() id: string;
  @ApiProperty({ description: 'Идентификатор события у провайдера' }) eventId: string;
  @ApiProperty() status: string;
  @ApiProperty({ enum: ['applied', 'ignored', 'unknown_payment', 'amount_mismatch'] }) outcome: string;
  @ApiPropertyOptional({ type: MoneyDto, nullable: true }) reportedAmount: MoneyDto | null;
  @ApiProperty() receivedAt: Date;
}

export class ProviderLogEntryDto {
  @ApiProperty() id: string;
  @ApiProperty() occurredAt: Date;
  @ApiProperty() integration: string;
  @ApiProperty({ enum: ['outbound', 'inbound'] }) direction: string;
  @ApiProperty() operation: string;
  @ApiPropertyOptional({ type: Number, nullable: true }) statusCode: number | null;
  @ApiProperty() success: boolean;
  @ApiPropertyOptional({ type: Number, nullable: true }) durationMs: number | null;
  @ApiPropertyOptional({ type: String, nullable: true }) error: string | null;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true, nullable: true, description: 'Запрос (платёжные данные замаскированы)' })
  request: unknown;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true, nullable: true, description: 'Ответ (платёжные данные замаскированы)' })
  response: unknown;

  static from(e: PaymentProviderLogEntry): ProviderLogEntryDto {
    return { ...e };
  }
}

export class PaymentDetailsDto {
  @ApiProperty({ type: PaymentDto }) payment: PaymentDto;
  @ApiProperty({ type: [PaymentHistoryEventDto], description: 'История: создание, переходы статуса, возвраты — по времени' })
  history: PaymentHistoryEventDto[];
  @ApiProperty({ type: [RefundDto] }) refunds: RefundDto[];
  @ApiProperty({ type: [WebhookEventDto] }) webhookEvents: WebhookEventDto[];
  @ApiProperty({ type: [ProviderLogEntryDto], description: 'Обмен с провайдером (журнал интеграций, с маскированием)' })
  providerLog: ProviderLogEntryDto[];

  static from(d: PaymentDetailsView): PaymentDetailsDto {
    return {
      payment: PaymentDto.from(d.payment),
      history: d.history.map(PaymentHistoryEventDto.from),
      refunds: d.refunds.map(RefundDto.from),
      webhookEvents: d.webhookEvents.map((e) => ({ ...e, reportedAmount: e.reportedAmount ? money(e.reportedAmount) : null })),
      providerLog: d.providerLog.map(ProviderLogEntryDto.from),
    };
  }
}

// ---------------------------------------------------------------- Запросы

export class PaymentListQueryDto extends PageQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional({ enum: PAYMENT_PURPOSES }) @IsOptional() @IsIn(PAYMENT_PURPOSES) purpose?: PaymentPurpose;
  @ApiPropertyOptional({ enum: PAYMENT_METHODS }) @IsOptional() @IsIn(PAYMENT_METHODS) method?: PaymentMethod;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) provider?: string;
  @ApiPropertyOptional({ enum: PAYMENT_STATUSES }) @IsOptional() @IsIn(PAYMENT_STATUSES) status?: PaymentStatus;
  @ApiPropertyOptional({ description: 'Объект оплаты (id заказа, брони, счёта)' }) @IsOptional() @IsString() @MaxLength(100) referenceId?: string;
  @ApiPropertyOptional({ description: 'Создан не раньше (ISO 8601)' }) @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional({ description: 'Создан раньше (ISO 8601)' }) @IsOptional() @IsISO8601() to?: string;
  @ApiPropertyOptional({ description: 'Телефон гостя: полный номер или часть (от 4 цифр)', example: '7011234567' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;
}

export class RefundListQueryDto extends PageQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional({ enum: REFUND_STATUSES }) @IsOptional() @IsIn(REFUND_STATUSES as unknown as string[]) status?: 'pending' | 'succeeded' | 'failed';
  @ApiPropertyOptional({ enum: REFUND_MODES }) @IsOptional() @IsIn(REFUND_MODES) mode?: RefundMode;
  @ApiPropertyOptional({ description: 'Запрошен не раньше (ISO 8601)' }) @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional({ description: 'Запрошен раньше (ISO 8601)' }) @IsOptional() @IsISO8601() to?: string;
  @ApiPropertyOptional({
    description: 'Поиск: id возврата/платежа/объекта оплаты, сумма в тенге («1500», «1500.50») или текст описания платежа (номер заказа, брони, счёта)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class PaymentProviderInfoDto {
  @ApiProperty({ example: 'sandbox' }) provider: string;
  @ApiProperty({ example: 'Тестовый провайдер' }) title: string;
  @ApiProperty({ description: 'Включён и настроен (можно принимать новые платежи)' }) enabled: boolean;
  @ApiProperty({ description: 'Провайдер по умолчанию для онлайн-оплаты' }) isDefault: boolean;
  @ApiProperty({ description: 'Тестовый провайдер вне production, если маршрутизация не настроена' }) devFallback: boolean;
  @ApiProperty({ type: [String], description: 'Филиалы, переопределённые на этого провайдера' }) branchIds: string[];
}

export class PaymentMethodInfoDto {
  @ApiProperty({ enum: PAYMENT_METHODS }) method: PaymentMethod;
  @ApiProperty() title: string;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Провайдер: для online — провайдер по умолчанию; для остальных — сам способ' })
  provider: string | null;
  @ApiProperty({ description: 'Доступен сейчас' }) available: boolean;
}

export class PaymentProvidersDto {
  @ApiProperty({ description: 'Маршрутизация онлайн-оплаты настроена (payments.routing)' }) routingConfigured: boolean;
  @ApiPropertyOptional({ type: String, nullable: true }) defaultProvider: string | null;
  @ApiProperty({ type: [PaymentProviderInfoDto] }) providers: PaymentProviderInfoDto[];
  @ApiProperty({ type: [PaymentMethodInfoDto] }) methods: PaymentMethodInfoDto[];
}

export class CreateRefundDto {
  @ApiPropertyOptional({ type: MoneyInputDto, description: 'Сумма возврата; не задана — весь невозвращённый остаток' })
  @IsOptional()
  @ValidateNested()
  @Type(() => MoneyInputDto)
  amount?: MoneyInputDto;

  @ApiProperty({ example: 'Гость отказался от заказа' }) @IsString() @Length(2, 500) reason: string;

  @ApiProperty({ description: 'Ключ идемпотентности (повтор запроса не создаёт второй возврат)', example: 'refund-2026-10-01-001' })
  @IsString()
  @Length(8, 100)
  idempotencyKey: string;
}

export class ConfirmRefundDto {
  @ApiPropertyOptional({ description: 'Как вернули деньги: наличными на кассе, переводом №…' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}

export class RejectRefundDto {
  @ApiProperty() @IsString() @Length(2, 500) reason: string;
}

export class CollectedResultDto {
  @ApiProperty({ type: PaymentDto }) payment: PaymentDto;
}

/** Форма тестовой страницы оплаты (application/x-www-form-urlencoded). */
export class SandboxActionDto {
  @ApiProperty({ description: 'Подпись ссылки на страницу оплаты' }) @IsString() @MaxLength(64) sig: string;
  @ApiProperty({ enum: ['succeeded', 'failed'] }) @IsIn(['succeeded', 'failed']) result: 'succeeded' | 'failed';
}
