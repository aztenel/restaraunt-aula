import { Injectable } from '@nestjs/common';
import { Clock } from '../../../shared/kernel/clock';
import { ConflictError, NotFoundError } from '../../../shared/kernel/errors';
import { PaymentRepository } from '../infrastructure/payment.repository';
import { PaymentGatewayRegistry, toGatewayPayment } from './payment-gateway.registry';
import { PaymentLinks } from './payment-links';

/**
 * Страница оплаты на нашем домене для провайдеров с виджетом (paymentUrl = /public/payments/:id/checkout).
 * Ссылка подписана; открыть можно только ожидающий оплату и не истёкший платёж.
 */
@Injectable()
export class RenderCheckoutPage {
  constructor(
    private readonly payments: PaymentRepository,
    private readonly registry: PaymentGatewayRegistry,
    private readonly links: PaymentLinks,
    private readonly clock: Clock,
  ) {}

  async execute(paymentId: string, signature: string | undefined): Promise<string> {
    if (!this.links.verify(paymentId, signature)) throw new NotFoundError('payment', paymentId);
    const payment = await this.payments.findById(paymentId);
    if (!payment || payment.method !== 'online') throw new NotFoundError('payment', paymentId);
    if (payment.status !== 'pending' || payment.isExpired(this.clock.now())) {
      throw new ConflictError('payment.not_payable', 'Payment is not awaiting payment', { status: payment.status });
    }
    const html = await this.registry.get(payment.provider).checkoutPage(toGatewayPayment(payment));
    if (!html) throw new NotFoundError('payment_checkout', paymentId);
    return html;
  }
}
