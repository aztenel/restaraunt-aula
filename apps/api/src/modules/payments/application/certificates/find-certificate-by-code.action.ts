import { Injectable, Logger } from '@nestjs/common';
import { RequestContext } from '../../../../shared/infrastructure/context/request-context';
import { SecretBox } from '../../../../shared/infrastructure/crypto/secret-box';
import { Clock } from '../../../../shared/kernel/clock';
import { NotFoundError, TooManyRequestsError } from '../../../../shared/kernel/errors';
import { blockedUntil, CERTIFICATE_CHECK_POLICY, isUserLimitReached, retryAfterSeconds, shouldBlockIp, windowStart } from '../../domain/brute-force';
import { certificateHashInput, normalizeCertificateCode } from '../../domain/certificate-code';
import { CertificateCheckRepository } from '../../infrastructure/certificate-check.repository';
import { CertificateRecord, CertificateRepository } from '../../infrastructure/certificate.repository';

/** HMAC кода с ключом приложения: по хэшу из БД код не восстановить и не подобрать офлайн. */
@Injectable()
export class CertificateCodeHasher {
  constructor(private readonly box: SecretBox) {}

  hash(normalizedCode: string): string {
    return this.box.hmac(certificateHashInput(normalizedCode));
  }
}

/**
 * Поиск сертификата по коду с защитой от подбора. Гость (витрина): проверка блокировки IP, учёт неудач,
 * блокировка IP на час после 20 неудач за час. Сотрудник (админка, касса на точке, телефонный заказ):
 * публичный счётчик IP не используется — лимит 60 неудачных проверок за час на сотрудника
 * (общий планшет кассы не блокируется из-за чужих ошибок). Используется проверкой кода,
 * погашением на точке и оплатой заказа сертификатом.
 */
@Injectable()
export class FindCertificateByCode {
  private readonly logger = new Logger(FindCertificateByCode.name);

  constructor(
    private readonly certificates: CertificateRepository,
    private readonly checks: CertificateCheckRepository,
    private readonly hasher: CertificateCodeHasher,
    private readonly clock: Clock,
  ) {}

  async execute(code: string, options: { forUpdate?: boolean } = {}): Promise<CertificateRecord> {
    const now = this.clock.now();
    const ip = RequestContext.current()?.ip ?? null;
    const actor = RequestContext.actor();
    const staffUserId = actor?.isStaff() && actor.userId ? actor.userId : null;
    if (staffUserId) return this.findForStaff(staffUserId, ip, code, now, options);
    if (ip) {
      const until = await this.checks.findBlock(ip, now);
      if (until) {
        throw new TooManyRequestsError('certificate.check_blocked', 'Too many failed certificate checks, try again later', {
          retryAfterSeconds: retryAfterSeconds(until, now),
        });
      }
    }
    const normalized = normalizeCertificateCode(code);
    const record = normalized ? await this.certificates.findByCodeHash(this.hasher.hash(normalized), options) : null;
    if (!record) {
      await this.registerFailure(ip, now);
      throw new NotFoundError('certificate');
    }
    return record;
  }

  private async findForStaff(userId: string, ip: string | null, code: string, now: Date, options: { forUpdate?: boolean }): Promise<CertificateRecord> {
    const { count, oldest } = await this.checks.userFailuresSince(userId, windowStart(now));
    if (isUserLimitReached(count)) {
      const until = new Date((oldest ?? now).getTime() + CERTIFICATE_CHECK_POLICY.windowMs);
      throw new TooManyRequestsError('certificate.check_limit_user', 'Too many failed certificate checks by this user, try again later', {
        retryAfterSeconds: retryAfterSeconds(until, now),
        limit: CERTIFICATE_CHECK_POLICY.maxFailuresPerUser,
      });
    }
    const normalized = normalizeCertificateCode(code);
    const record = normalized ? await this.certificates.findByCodeHash(this.hasher.hash(normalized), options) : null;
    if (!record) {
      await this.checks.recordUserFailure(userId, ip, now);
      if (count + 1 >= CERTIFICATE_CHECK_POLICY.maxFailuresPerUser) {
        this.logger.warn({ userId, failures: count + 1 }, 'Staff user reached the certificate check limit');
      }
      throw new NotFoundError('certificate');
    }
    return record;
  }

  private async registerFailure(ip: string | null, now: Date): Promise<void> {
    // Без IP (системный контекст) неудача учитывается только в глобальном счётчике.
    const failures = await this.checks.recordFailure(ip ?? 'n/a', now, windowStart(now));
    if (ip && shouldBlockIp(failures)) {
      await this.checks.block(ip, blockedUntil(now), failures);
      this.logger.warn({ ip, failures }, 'IP blocked for certificate code brute-force');
    }
  }
}
