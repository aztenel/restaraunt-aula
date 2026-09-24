import { Injectable } from '@nestjs/common';
import { SecretBox, safeEqual } from '../../../shared/infrastructure/crypto/secret-box';
import { Database } from '../../../shared/infrastructure/database/database';
import { Clock } from '../../../shared/kernel/clock';
import { NotFoundError } from '../../../shared/kernel/errors';
import { newId } from '../../../shared/kernel/ids';
import { normalizePhone } from '../../../shared/kernel/phone';
import { randomDigits } from '../../../shared/kernel/random';
import { DEFAULT_LOCALE, isLocale, Locale } from '../../../shared/kernel/translatable';
import {
  assertCanSendCode,
  decideVerification,
  encodePhoneToken,
  OTP_POLICY,
  Signer,
  VerificationDecision,
  verificationError,
} from '../domain/otp';
import { PhoneVerificationRepository } from '../infrastructure/phone-verification.repository';
import { Notifier } from '../../notifications/public';

/** Подпись токена подтверждения и хэш кода — HMAC ключом приложения с разделением по назначению. */
@Injectable()
export class PhoneVerificationCrypto {
  constructor(private readonly secretBox: SecretBox) {}

  readonly sign: Signer = (data: string) => this.secretBox.hmac(`customers.phone_token:${data}`);

  codeHash(verificationId: string, code: string): string {
    return this.secretBox.hmac(`customers.otp:${verificationId}:${code}`);
  }
}

export interface VerificationStarted {
  verificationId: string;
  expiresAt: Date;
  resendAfterSeconds: number;
}

/**
 * Отправить SMS-код подтверждения. Лимиты на номер: не чаще раза в 60 с и не больше 5 кодов в час
 * (TooManyRequestsError). Код — 4 цифры, в БД только HMAC, живёт 5 минут; новый код отменяет прежние.
 * Уведомление ставится в очередь модуля Notifications в той же транзакции (канал — SMS).
 */
@Injectable()
export class StartPhoneVerification {
  constructor(
    private readonly verifications: PhoneVerificationRepository,
    private readonly crypto: PhoneVerificationCrypto,
    private readonly notifier: Notifier,
    private readonly database: Database,
    private readonly clock: Clock,
  ) {}

  async execute(rawPhone: string, rawLocale: Locale | string | null | undefined, ip: string | null = null): Promise<VerificationStarted> {
    const phone = normalizePhone(rawPhone);
    const locale: Locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;
    return this.database.transaction(async () => {
      // Сериализуем отправки на один номер: лимиты не обходятся параллельными запросами.
      await this.database.advisoryLock('customers.phone_verification', phone);
      const now = this.clock.now();
      const sent = await this.verifications.sentSince(phone, new Date(now.getTime() - OTP_POLICY.sendWindowMs));
      assertCanSendCode(sent, now);

      const id = newId();
      const code = randomDigits(OTP_POLICY.codeLength);
      const expiresAt = new Date(now.getTime() + OTP_POLICY.codeTtlMs);
      await this.verifications.supersedeActive(phone, now);
      await this.verifications.insert({
        id,
        phone,
        codeHash: this.crypto.codeHash(id, code),
        locale,
        expiresAt,
        ip: ip ? ip.slice(0, 64) : null,
        createdAt: now,
      });
      await this.notifier.notifyGuest({
        recipient: { phone },
        template: 'otp.code',
        params: { code },
        locale,
        channels: ['sms'],
        dedupeKey: `otp:${id}`,
        related: { type: 'phone_verification', id },
      });
      return { verificationId: id, expiresAt, resendAfterSeconds: Math.round(OTP_POLICY.resendIntervalMs / 1000) };
    });
  }
}

export interface PhoneVerified {
  token: string;
  phone: string;
  expiresAt: Date;
}

/**
 * Проверить код. Неверный код увеличивает счётчик попыток (сохраняется даже при ошибке);
 * после 5 неверных попыток проверка блокируется. Верный код -> подписанный токен на 30 минут
 * (повторный ввод верного кода возвращает тот же токен).
 */
@Injectable()
export class VerifyPhoneCode {
  constructor(
    private readonly verifications: PhoneVerificationRepository,
    private readonly crypto: PhoneVerificationCrypto,
    private readonly database: Database,
    private readonly clock: Clock,
  ) {}

  async execute(verificationId: string, rawCode: string): Promise<PhoneVerified> {
    const code = String(rawCode ?? '').trim();
    const outcome = await this.database.transaction(async () => {
      const v = await this.verifications.findForUpdate(verificationId);
      if (!v) throw new NotFoundError('phone_verification', verificationId);
      const now = this.clock.now();
      const matches = safeEqual(this.crypto.codeHash(v.id, code), v.codeHash);
      const decision: VerificationDecision = decideVerification(v, matches, now);
      if (decision.kind === 'invalid') await this.verifications.setAttempts(v.id, decision.attempts);
      if (decision.kind === 'verified' && decision.firstTime) await this.verifications.markVerified(v.id, decision.verifiedAt);
      return { decision, phone: v.phone, id: v.id };
    });
    // Ошибка бросается после коммита: счётчик неверных попыток должен сохраниться.
    if (outcome.decision.kind !== 'verified') throw verificationError(outcome.decision);
    const expiresAt = new Date(outcome.decision.verifiedAt.getTime() + OTP_POLICY.tokenTtlMs);
    const token = encodePhoneToken({ phone: outcome.phone, expiresAt: expiresAt.getTime(), verificationId: outcome.id }, this.crypto.sign);
    return { token, phone: outcome.phone, expiresAt };
  }
}

/** Удаление проверок старше суток (телефон — ПД; лимиты считаются за последний час). */
@Injectable()
export class PurgePhoneVerifications {
  static readonly RETENTION_MS = 24 * 60 * 60_000;

  constructor(
    private readonly verifications: PhoneVerificationRepository,
    private readonly clock: Clock,
  ) {}

  async execute(): Promise<number> {
    return this.verifications.deleteCreatedBefore(new Date(this.clock.now().getTime() - PurgePhoneVerifications.RETENTION_MS));
  }
}
