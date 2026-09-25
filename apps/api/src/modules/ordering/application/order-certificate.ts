import { Injectable } from '@nestjs/common';
import { Clock } from '../../../shared/kernel/clock';
import { NotFoundError, ValidationError } from '../../../shared/kernel/errors';
import { CertificateBalanceView, GiftCertificates } from '../../payments/public';

export type CertificateCheck =
  | { ok: true; certificate: CertificateBalanceView }
  | { ok: false; code: string; certificate: CertificateBalanceView | null };

/**
 * Подарочный сертификат при оформлении: проверка кода через модуль Payments (защита от подбора — там же
 * и на уровне HTTP). Годен — активен, не просрочен, остаток больше нуля.
 */
@Injectable()
export class OrderCertificateCheck {
  constructor(
    private readonly certificates: GiftCertificates,
    private readonly clock: Clock,
  ) {}

  /** Мягкая проверка (расчёт корзины): причина вместо исключения. Ошибки частоты (429) пробрасываются. */
  async check(code: string): Promise<CertificateCheck> {
    let certificate: CertificateBalanceView;
    try {
      certificate = await this.certificates.check(code.trim());
    } catch (err) {
      if (err instanceof NotFoundError) return { ok: false, code: 'order.certificate_not_found', certificate: null };
      if (err instanceof ValidationError) return { ok: false, code: err.code, certificate: null };
      throw err;
    }
    if (certificate.status !== 'active' || certificate.expiresAt.getTime() <= this.clock.now().getTime()) {
      return { ok: false, code: 'order.certificate_unusable', certificate };
    }
    if (!certificate.balance.isPositive()) return { ok: false, code: 'order.certificate_empty', certificate };
    return { ok: true, certificate };
  }

  /** Строгая проверка (оформление): негодный сертификат — ValidationError. */
  async require(code: string): Promise<CertificateBalanceView> {
    const result = await this.check(code);
    if (!result.ok) {
      throw new ValidationError(result.code, 'The gift certificate cannot be used', {
        status: result.certificate?.status ?? null,
      });
    }
    return result.certificate;
  }
}
