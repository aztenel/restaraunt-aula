import { Money } from '../../../../shared/kernel/money';
import { Locale, translate } from '../../../../shared/kernel/translatable';
import { maskCertificateCode } from '../../domain/certificate-code';
import { lastValidDate } from '../../domain/gift-certificate';
import { formatTenge } from '../../domain/money-format';
import { CertificateRecord } from '../../infrastructure/certificate.repository';
import { CertificateBalanceView } from '../../public';

/** Маскированное представление сертификата (проверка кода на витрине, с точки, при оформлении). */
export function toBalanceView(record: CertificateRecord, locale: Locale): CertificateBalanceView {
  const s = record.certificate.snapshot();
  return {
    id: s.id,
    maskedCode: maskCertificateCode(s.last4),
    kind: s.kind,
    status: s.status,
    nominal: s.nominal,
    balance: s.balance,
    expiresAt: s.expiresAt,
    setDescription: s.setDescription ? translate(s.setDescription, locale) || null : null,
  };
}

/** Состояние сертификата для журнала действий. */
export function certificateAuditState(record: CertificateRecord): Record<string, unknown> {
  const s = record.certificate.snapshot();
  return {
    status: s.status,
    statusReason: s.statusReason,
    balance: s.balance.toJSON(),
    nominal: s.nominal.toJSON(),
    expiresAt: s.expiresAt.toISOString(),
    maskedCode: maskCertificateCode(s.last4),
  };
}

/** Строки «5 000 ₸» и «до 01.10.2027» для сообщений гостю. */
export function formatExpiry(expiresAt: Date): string {
  const [y, m, d] = lastValidDate(expiresAt).split('-');
  return `${d}.${m}.${y}`;
}

export function formatAmount(money: Money): string {
  return formatTenge(money);
}
