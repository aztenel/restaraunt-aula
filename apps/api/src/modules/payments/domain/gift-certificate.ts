import { ConflictError, ValidationError } from '../../../shared/kernel/errors';
import { Money } from '../../../shared/kernel/money';
import { StateMachine } from '../../../shared/kernel/state-machine';
import { addDays, startOfLocalDay, toLocalDate } from '../../../shared/kernel/time';
import { Translatable } from '../../../shared/kernel/translatable';
import { CertificateKind, CertificateStatus } from '../public';

/**
 * Подарочный сертификат.
 *
 *   active -> redeemed (остаток 0) | expired (истёк срок) | blocked (заблокирован вручную)
 *   redeemed -> active | expired   (возврат списания на сертификат: заказ отменён)
 *   expired -> active              (продление срока) | blocked
 *   blocked -> active | expired    (разблокировка; если срок уже прошёл — expired)
 *
 * Инварианты: 0 <= остаток <= номинал; сертификат на набор погашается только целиком.
 */
export const CertificateFsm = new StateMachine<CertificateStatus>('certificate', {
  active: ['redeemed', 'expired', 'blocked'],
  redeemed: ['active', 'expired'],
  expired: ['active', 'blocked'],
  blocked: ['active', 'expired'],
});

export const DEFAULT_VALIDITY_MONTHS = 12;

/** 'YYYY-MM-DD' + N месяцев; день обрезается до конца месяца (31.01 + 1 мес = 28/29.02). */
export function addMonthsToDate(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(d, daysInMonth);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Срок действия: сертификат действует до конца дня (Asia/Almaty), наступающего через validityMonths
 * месяцев после выпуска. Возвращает момент окончания — начало следующих суток.
 */
export function certificateExpiresAt(issuedAt: Date, validityMonths: number, timeZone?: string): Date {
  if (!Number.isInteger(validityMonths) || validityMonths < 1 || validityMonths > 60) {
    throw new ValidationError('certificate.validity_invalid', 'Validity must be 1..60 months');
  }
  const lastDay = addMonthsToDate(toLocalDate(issuedAt, timeZone), validityMonths);
  return startOfLocalDay(addDays(lastDay, 1), timeZone);
}

/** Момент окончания срока по последнему дню действия 'YYYY-MM-DD' (включительно). */
export function expiresAtForLastDay(lastValidDate: string, timeZone?: string): Date {
  return startOfLocalDay(addDays(lastValidDate, 1), timeZone);
}

/** Последний день действия (локальная дата) — для PDF, сообщений и админки. */
export function lastValidDate(expiresAt: Date, timeZone?: string): string {
  return toLocalDate(new Date(expiresAt.getTime() - 1), timeZone);
}

export interface GiftCertificateProps {
  id: string;
  orderId: string;
  productId: string;
  kind: CertificateKind;
  name: Translatable;
  setDescription: Translatable | null;
  nominal: Money;
  balance: Money;
  price: Money;
  status: CertificateStatus;
  statusReason: string | null;
  issuedAt: Date;
  expiresAt: Date;
  last4: string;
}

export class GiftCertificate {
  private constructor(private props: GiftCertificateProps) {}

  static issue(
    input: Omit<GiftCertificateProps, 'balance' | 'status' | 'statusReason' | 'issuedAt' | 'expiresAt'> & { validityMonths: number },
    now: Date,
  ): GiftCertificate {
    if (!input.nominal.isPositive()) throw new ValidationError('certificate.nominal_invalid', 'Nominal must be positive');
    if (input.price.isNegative()) throw new ValidationError('certificate.price_invalid', 'Price cannot be negative');
    const { validityMonths, ...rest } = input;
    return new GiftCertificate({
      ...rest,
      balance: input.nominal,
      status: 'active',
      statusReason: null,
      issuedAt: now,
      expiresAt: certificateExpiresAt(now, validityMonths),
    });
  }

  static restore(props: GiftCertificateProps): GiftCertificate {
    return new GiftCertificate({ ...props });
  }

  get id(): string {
    return this.props.id;
  }
  get kind(): CertificateKind {
    return this.props.kind;
  }
  get status(): CertificateStatus {
    return this.props.status;
  }
  get balance(): Money {
    return this.props.balance;
  }
  get nominal(): Money {
    return this.props.nominal;
  }
  get expiresAt(): Date {
    return this.props.expiresAt;
  }

  snapshot(): Readonly<GiftCertificateProps> {
    return { ...this.props };
  }

  isExpiredAt(now: Date): boolean {
    return this.props.expiresAt.getTime() <= now.getTime();
  }

  private transition(to: CertificateStatus, reason: string | null = null): void {
    CertificateFsm.assertTransition(this.props.status, to);
    this.props.status = to;
    this.props.statusReason = reason;
  }

  /** Можно ли списывать: активен и срок не истёк. Иначе — понятная ошибка для кассира и гостя. */
  assertUsable(now: Date): void {
    if (this.props.status === 'blocked') {
      throw new ConflictError('certificate.blocked', 'Certificate is blocked');
    }
    if (this.props.status === 'redeemed') {
      throw new ConflictError('certificate.fully_redeemed', 'Certificate is fully redeemed');
    }
    if (this.props.status === 'expired' || this.isExpiredAt(now)) {
      throw new ConflictError('certificate.expired', 'Certificate has expired', { expiresAt: this.props.expiresAt.toISOString() });
    }
  }

  /**
   * Списание. На сумму — частичное (не больше остатка); на набор — только целиком (сумма = остаток).
   * Остаток 0 -> статус redeemed. Возвращает остаток после списания.
   */
  debit(amount: Money | null, now: Date): { amount: Money; balanceAfter: Money } {
    this.assertUsable(now);
    const value = amount ?? (this.props.kind === 'set' ? this.props.balance : null);
    if (!value) throw new ValidationError('certificate.amount_required', 'Amount is required for amount certificates');
    if (!value.isPositive()) throw new ValidationError('certificate.amount_invalid', 'Amount must be positive');
    if (this.props.kind === 'set' && !value.equals(this.props.balance)) {
      throw new ValidationError('certificate.set_full_redemption_only', 'Set certificate is redeemed in full only', {
        balance: this.props.balance.toJSON(),
      });
    }
    if (value.greaterThan(this.props.balance)) {
      throw new ConflictError('certificate.insufficient_balance', 'Amount exceeds certificate balance', {
        balance: this.props.balance.toJSON(),
        requested: value.toJSON(),
      });
    }
    this.props.balance = this.props.balance.subtract(value);
    if (this.props.balance.isZero()) this.transition('redeemed');
    return { amount: value, balanceAfter: this.props.balance };
  }

  /**
   * Возврат списания (заказ отменён, возврат платежа сертификатом). Остаток не превышает номинал.
   * Погашенный сертификат снова активен; если срок уже истёк — expired (продлевается вручную).
   */
  credit(amount: Money, now: Date): { balanceAfter: Money } {
    if (!amount.isPositive()) throw new ValidationError('certificate.amount_invalid', 'Amount must be positive');
    const next = this.props.balance.add(amount);
    if (next.greaterThan(this.props.nominal)) {
      throw new ConflictError('certificate.credit_exceeds_nominal', 'Balance cannot exceed nominal');
    }
    this.props.balance = next;
    if (this.props.status === 'redeemed') {
      this.transition(this.isExpiredAt(now) ? 'expired' : 'active');
    }
    return { balanceAfter: this.props.balance };
  }

  block(reason: string): void {
    if (this.props.status === 'blocked') return;
    if (!reason.trim()) throw new ValidationError('certificate.reason_required', 'Reason is required');
    this.transition('blocked', reason.trim().slice(0, 500));
  }

  unblock(now: Date): void {
    if (this.props.status !== 'blocked') {
      throw new ConflictError('certificate.not_blocked', 'Certificate is not blocked');
    }
    this.transition(this.isExpiredAt(now) ? 'expired' : 'active');
  }

  /**
   * Продление срока (только вперёд). Истёкший сертификат с остатком снова становится активным.
   * Возвращает true, если сертификат восстановлен из expired.
   */
  extend(newExpiresAt: Date, now: Date): { reinstated: boolean } {
    if (this.props.status === 'redeemed') {
      throw new ConflictError('certificate.fully_redeemed', 'Certificate is fully redeemed');
    }
    if (newExpiresAt.getTime() <= now.getTime() || newExpiresAt.getTime() <= this.props.expiresAt.getTime()) {
      throw new ValidationError('certificate.extend_invalid', 'New expiry must be later than the current one and in the future');
    }
    this.props.expiresAt = newExpiresAt;
    if (this.props.status === 'expired' && this.props.balance.isPositive()) {
      this.transition('active');
      return { reinstated: true };
    }
    return { reinstated: false };
  }

  /** Истечение срока (ежедневная задача). Остаток сохраняется для отчёта, но им нельзя пользоваться. */
  expire(now: Date): boolean {
    if (this.props.status !== 'active' || !this.isExpiredAt(now)) return false;
    this.transition('expired', 'expired');
    return true;
  }
}
