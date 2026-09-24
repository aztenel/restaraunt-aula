import { Injectable } from '@nestjs/common';
import { Config } from '../../../shared/infrastructure/config/config';
import { safeEqual, SecretBox } from '../../../shared/infrastructure/crypto/secret-box';

const API_PREFIX = '/api/v1';

/**
 * Ссылки модуля: страница оплаты на нашем домене (для провайдеров с виджетом и песочницы),
 * адрес вебхука провайдера, страница возврата гостя. Ссылки на страницы оплаты подписаны HMAC,
 * чтобы по id платежа нельзя было открыть чужую страницу.
 */
@Injectable()
export class PaymentLinks {
  constructor(
    private readonly config: Config,
    private readonly box: SecretBox,
  ) {}

  signature(paymentId: string): string {
    return this.box.hmac(`payment-page:${paymentId}`).slice(0, 32);
  }

  verify(paymentId: string, signature: string | null | undefined): boolean {
    return !!signature && safeEqual(this.signature(paymentId), signature);
  }

  /** Страница оплаты с виджетом провайдера: GET /public/payments/:id/checkout. */
  checkoutUrl(paymentId: string): string {
    return `${this.config.app.apiPublicUrl}${API_PREFIX}/public/payments/${paymentId}/checkout?sig=${this.signature(paymentId)}`;
  }

  /** Публичный адрес маршрута API: publicApiUrl('/public/payments/x') -> https://api.../api/v1/public/payments/x. */
  publicApiUrl(path: string): string {
    return `${this.config.app.apiPublicUrl}${API_PREFIX}${path}`;
  }

  /** Адрес вебхука провайдера (postLink / callbackUrl). */
  webhookUrl(provider: string): string {
    return `${this.config.app.apiPublicUrl}${API_PREFIX}/webhooks/payments/${provider}`;
  }

  /** Куда вернуть гостя после оплаты, если вызывающий модуль не задал адрес. */
  returnUrl(explicit: string | null): string {
    return explicit ?? this.config.app.publicWebUrl;
  }

  certificateOrderUrl(token: string): string {
    return `${this.config.app.publicWebUrl}/certificates/orders/${token}`;
  }
}
