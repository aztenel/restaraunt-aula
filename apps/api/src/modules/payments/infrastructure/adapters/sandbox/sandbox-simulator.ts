import { Injectable } from '@nestjs/common';
import { Config } from '../../../../../shared/infrastructure/config/config';
import { newId } from '../../../../../shared/kernel/ids';
import { NotFoundError } from '../../../../../shared/kernel/errors';
import { PaymentLinks } from '../../../application/payment-links';
import { ReceivePaymentWebhook } from '../../../application/receive-webhook.action';
import { Payment } from '../../../domain/payment';
import { formatTenge } from '../../../domain/money-format';
import { PaymentRepository } from '../../payment.repository';
import { escapeHtml } from '../html';
import { SANDBOX_PROVIDER, SANDBOX_SIGNATURE_HEADER, SandboxGateway, SandboxWebhookBody } from './sandbox.gateway';
import { SandboxStore } from './sandbox.store';

async function sandboxPayment(
  config: Config,
  links: PaymentLinks,
  payments: PaymentRepository,
  paymentId: string,
  signature: string | undefined,
): Promise<Payment> {
  // В production песочницы нет: страница отвечает 404.
  if (config.isProduction || !links.verify(paymentId, signature)) throw new NotFoundError('payment', paymentId);
  const payment = await payments.findById(paymentId);
  if (!payment || payment.provider !== SANDBOX_PROVIDER) throw new NotFoundError('payment', paymentId);
  return payment;
}

/** Страница тестовой оплаты: сумма, описание и две кнопки — «Оплатить» и «Отказ». */
@Injectable()
export class SandboxCheckoutPage {
  constructor(
    private readonly config: Config,
    private readonly links: PaymentLinks,
    private readonly payments: PaymentRepository,
  ) {}

  async execute(paymentId: string, signature: string | undefined): Promise<string> {
    const payment = await sandboxPayment(this.config, this.links, this.payments, paymentId, signature);
    const s = payment.snapshot();
    const action = escapeHtml(this.links.publicApiUrl(`/public/payments/sandbox/${paymentId}`));
    const sig = escapeHtml(signature ?? '');
    const open = payment.status === 'pending';
    const buttons = open
      ? `<form method="post" action="${action}"><input type="hidden" name="sig" value="${sig}"><input type="hidden" name="result" value="succeeded"><button type="submit" class="pay">Оплатить</button></form>
         <form method="post" action="${action}"><input type="hidden" name="sig" value="${sig}"><input type="hidden" name="result" value="failed"><button type="submit" class="fail">Отказ</button></form>`
      : `<p>Статус платежа: <b>${escapeHtml(payment.status)}</b></p>`;
    return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>AULA — тестовая оплата</title>
<style>body{font-family:system-ui,sans-serif;max-width:420px;margin:40px auto;padding:0 16px;color:#222}
.card{border:1px solid #ddd;border-radius:12px;padding:24px}.amount{font-size:32px;font-weight:700;margin:8px 0 16px}
.note{color:#a15c00;background:#fff6e5;border-radius:8px;padding:8px 12px;font-size:13px}
button{width:100%;padding:14px;border:0;border-radius:8px;font-size:16px;margin-top:12px;cursor:pointer}
.pay{background:#2e7d32;color:#fff}.fail{background:#eee;color:#b00020}</style></head>
<body><div class="card"><p class="note">Тестовая среда: деньги не списываются.</p>
<div>${escapeHtml(s.description)}</div><div class="amount">${escapeHtml(formatTenge(s.amount))}</div>${buttons}</div></body></html>`;
  }
}

/**
 * Имитация решения гостя на странице песочницы: состояние «на стороне провайдера» + вебхук,
 * подписанный так же, как настоящий, через общий конвейер ReceivePaymentWebhook.
 */
@Injectable()
export class SimulateSandboxPayment {
  constructor(
    private readonly config: Config,
    private readonly links: PaymentLinks,
    private readonly payments: PaymentRepository,
    private readonly store: SandboxStore,
    private readonly gateway: SandboxGateway,
    private readonly webhook: ReceivePaymentWebhook,
  ) {}

  async execute(paymentId: string, signature: string | undefined, result: 'succeeded' | 'failed'): Promise<{ redirectUrl: string }> {
    const payment = await sandboxPayment(this.config, this.links, this.payments, paymentId, signature);
    const s = payment.snapshot();
    if (payment.status === 'pending' && s.externalId) {
      await this.store.setStatus(s.externalId, result);
      const body: SandboxWebhookBody = {
        eventId: `sbx_evt_${newId()}`,
        externalId: s.externalId,
        status: result,
        amount: { amount: s.amount.amount, currency: 'KZT' },
        ...(result === 'failed' ? { reason: 'Отказ на тестовой странице оплаты' } : {}),
      };
      const rawBody = JSON.stringify(body);
      await this.webhook.execute(SANDBOX_PROVIDER, {
        headers: { 'content-type': 'application/json', [SANDBOX_SIGNATURE_HEADER]: await this.gateway.sign(rawBody) },
        rawBody,
        rawBodyIsExact: true,
        body,
        query: {},
      });
    }
    return { redirectUrl: this.links.returnUrl(s.returnUrl) };
  }
}
