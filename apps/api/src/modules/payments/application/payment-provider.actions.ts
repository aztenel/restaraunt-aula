import { Injectable, Logger } from '@nestjs/common';
import { Database } from '../../../shared/infrastructure/database/database';
import { JobQueue } from '../../../shared/infrastructure/events/event-bus';
import { ExternalServiceError } from '../../../shared/infrastructure/integrations/external-http';
import { Clock } from '../../../shared/kernel/clock';
import { DomainError } from '../../../shared/kernel/errors';
import { PaymentRepository } from '../infrastructure/payment.repository';
import { InitiateJobPayload, PaymentJobs } from './create-payment.action';
import { PaymentGatewayRegistry, toGatewayPayment } from './payment-gateway.registry';
import { ApplyGatewayStatus, CancelPayment, FailPayment } from './payment-status.actions';

/** Лимит попыток инициирования у провайдера; после исчерпания платёж — failed + PaymentFailed. */
export const INITIATE_MAX_ATTEMPTS = 5;

export function isRetryable(error: unknown): boolean {
  if (error instanceof ExternalServiceError) return error.retryable;
  // Доменные ошибки (например, integration.misconfigured) повтором не лечатся.
  return !(error instanceof DomainError);
}

export function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

/**
 * Задача payments.initiate: создать платёж у провайдера и сохранить ссылку на оплату.
 * Повторы с экспоненциальной задержкой (платформа); счётчик попыток — в строке платежа,
 * после INITIATE_MAX_ATTEMPTS неудач платёж переводится в failed (событие PaymentFailed).
 */
@Injectable()
export class InitiatePayment {
  private readonly logger = new Logger(InitiatePayment.name);

  constructor(
    private readonly payments: PaymentRepository,
    private readonly registry: PaymentGatewayRegistry,
    private readonly database: Database,
    private readonly failPayment: FailPayment,
    private readonly cancelPayment: CancelPayment,
    private readonly clock: Clock,
  ) {}

  async execute(input: InitiateJobPayload): Promise<void> {
    const payment = await this.payments.findById(input.paymentId);
    if (!payment || payment.status !== 'created') return;
    if (payment.isExpired(this.clock.now())) {
      await this.cancelPayment.execute(payment.id, 'expired');
      return;
    }
    const attempt = await this.payments.incrementInitiateAttempts(payment.id);
    try {
      const gateway = this.registry.get(payment.provider);
      const result = await gateway.initiate(toGatewayPayment(payment));
      await this.database.transaction(async () => {
        const locked = await this.payments.findById(payment.id, { forUpdate: true });
        // Пока ходили к провайдеру, платёж могли отменить — ссылку не сохраняем.
        if (!locked || locked.status !== 'created') return;
        locked.markInitiated(result);
        await this.payments.save(locked);
      });
    } catch (error) {
      if (isRetryable(error) && attempt < INITIATE_MAX_ATTEMPTS) {
        this.logger.warn({ paymentId: payment.id, attempt, err: errorMessage(error) }, 'Payment initiation failed, will retry');
        throw error;
      }
      this.logger.error({ paymentId: payment.id, attempt, err: errorMessage(error) }, 'Payment initiation failed');
      await this.failPayment.execute(payment.id, `initiation failed: ${errorMessage(error)}`);
    }
  }
}

export interface CheckStatusJobPayload {
  paymentId: string;
  /** true — срок платежа истёк: после проверки неоплаченный платёж отменяется. */
  finalize: boolean;
}

/**
 * Задача payments.check_status: опрос статуса у провайдера (пропущенный вебхук) и финальная
 * проверка перед отменой по сроку. Ошибка провайдера при обычном опросе — повтор на следующем
 * опросе по расписанию; при финальной проверке неоплаченный платёж отменяется в любом случае
 * (поздний вебхук об оплате всё равно будет принят: cancelled -> succeeded).
 */
@Injectable()
export class CheckPaymentStatus {
  private readonly logger = new Logger(CheckPaymentStatus.name);

  constructor(
    private readonly payments: PaymentRepository,
    private readonly registry: PaymentGatewayRegistry,
    private readonly applyStatus: ApplyGatewayStatus,
    private readonly cancelPayment: CancelPayment,
  ) {}

  async execute(input: CheckStatusJobPayload): Promise<void> {
    const payment = await this.payments.findById(input.paymentId);
    if (!payment || !payment.isOpen()) return;
    if (payment.status === 'pending' && payment.method === 'online') {
      try {
        const status = await this.registry.get(payment.provider).fetchStatus(toGatewayPayment(payment));
        const outcome = await this.applyStatus.execute(payment.id, status, 'poll');
        if (outcome === 'applied' || status.status === 'succeeded') return;
      } catch (error) {
        this.logger.warn({ paymentId: payment.id, err: errorMessage(error) }, 'Payment status check failed');
        if (!input.finalize) return;
      }
    }
    if (input.finalize) {
      await this.cancelPayment.execute(payment.id, 'expired');
    }
  }
}

/**
 * Расписания платежей: опрос ожидающих онлайн-платежей и истечение срока.
 * Внешние вызовы — не здесь, а в задачах payments.check_status.
 */
@Injectable()
export class SchedulePaymentChecks {
  constructor(
    private readonly payments: PaymentRepository,
    private readonly jobs: JobQueue,
    private readonly database: Database,
    private readonly clock: Clock,
  ) {}

  /** mode=poll — ожидающие дольше 3 минут и не проверенные за 5 минут; mode=expire — истёкшие. */
  async execute(mode: 'poll' | 'expire'): Promise<number> {
    // Отметка «взят на проверку» и постановка задач — в одной транзакции: ничего не теряется при сбое.
    return this.database.transaction(() => this.claimAndEnqueue(mode));
  }

  private async claimAndEnqueue(mode: 'poll' | 'expire'): Promise<number> {
    const now = this.clock.now();
    const claimed =
      mode === 'poll'
        ? await this.payments.claimForPolling({
            now,
            createdBefore: new Date(now.getTime() - 3 * 60_000),
            checkedBefore: new Date(now.getTime() - 5 * 60_000),
            limit: 200,
          })
        : await this.payments.claimExpired({ now, limit: 200 });
    for (const p of claimed) {
      await this.jobs.enqueue(PaymentJobs.CheckStatus, { paymentId: p.id, finalize: mode === 'expire' } satisfies CheckStatusJobPayload, {
        aggregateId: p.id,
        branchId: p.branchId,
      });
    }
    return claimed.length;
  }
}
