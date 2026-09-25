import { Injectable } from '@nestjs/common';
import { invariant } from '../../../shared/kernel/errors';
import { Locale } from '../../../shared/kernel/translatable';
import { PaymentsService, PaymentView } from '../../payments/public';
import { Reservation } from '../domain/reservation';
import { ReservationLinks } from './reservation-links';

const DESCRIPTIONS: Record<Locale, (number: string) => string> = {
  ru: (n) => `Депозит брони ${n}`,
  kk: (n) => `${n} брондау депозиті`,
  en: (n) => `Reservation deposit ${n}`,
};

/**
 * Онлайн-платёж депозита брони (PaymentsService, purpose reservation_deposit). Страница оплаты у провайдера
 * создаётся задачей платёжного модуля; ссылка появляется в статусе платежа (витрина опрашивает бронь).
 * Каждая попытка оплаты — свой ключ идемпотентности, срок платежа — до конца удержания брони.
 */
@Injectable()
export class DepositPayments {
  constructor(
    private readonly payments: PaymentsService,
    private readonly links: ReservationLinks,
  ) {}

  /** Создать платёж новой попытки и привязать к брони (бронь нужно сохранить). */
  async createFor(r: Reservation): Promise<PaymentView> {
    const p = r.snapshot();
    invariant(p.deposit !== null, 'reservation.deposit_missing', 'Reservation has no deposit to pay');
    const payment = await this.payments.createPayment({
      purpose: 'reservation_deposit',
      referenceId: p.id,
      branchId: p.branchId,
      method: 'online',
      amount: p.deposit,
      description: DESCRIPTIONS[p.locale](p.number),
      customer: { phone: p.customer.phone, name: p.customer.name, email: p.customer.email },
      returnUrl: this.links.manage(p.publicToken, p.locale),
      idempotencyKey: `reservation:${p.id}:deposit:${p.depositAttempts + 1}`,
      expiresAt: p.holdExpiresAt,
    });
    r.attachDepositPayment(payment.id);
    return payment;
  }
}
