import { Injectable } from '@nestjs/common';
import { AuditLog } from '../../../../shared/infrastructure/audit/audit-log';
import { Database } from '../../../../shared/infrastructure/database/database';
import { EventBus } from '../../../../shared/infrastructure/events/event-bus';
import { FileStorage } from '../../../../shared/infrastructure/storage/file-storage';
import { Actor } from '../../../../shared/kernel/actor';
import { Clock } from '../../../../shared/kernel/clock';
import { ForbiddenError, NotFoundError, ValidationError } from '../../../../shared/kernel/errors';
import { Money } from '../../../../shared/kernel/money';
import { Permission } from '../../../../shared/kernel/permissions';
import { normalizePhone } from '../../../../shared/kernel/phone';
import { isIsoDate } from '../../../../shared/kernel/time';
import { BranchDirectory } from '../../../identity/public';
import { expiresAtForLastDay } from '../../domain/gift-certificate';
import { CertificateRecord, CertificateRepository, LedgerEntry } from '../../infrastructure/certificate.repository';
import { CertificateExpiredPayload, PaymentsEvents } from '../../public';
import { DebitCertificate } from './certificate-ledger.actions';
import { certificateAuditState } from './certificate-views';
import { DeliverCertificate } from './deliver-certificate.action';
import { FindCertificateByCode } from './find-certificate-by-code.action';

async function lockCertificate(repo: CertificateRepository, id: string): Promise<CertificateRecord> {
  const record = await repo.findById(id, { forUpdate: true });
  if (!record) throw new NotFoundError('certificate', id);
  return record;
}

/**
 * Погашение на точке (кассир/оператор, право certificates.redeem в филиале): частичное списание
 * для сертификата на сумму, полное — для набора. Блокировка строки сертификата, остаток не уходит
 * в минус (проверка в домене + CHECK в БД), движение в журнале, событие CertificateRedeemed, аудит.
 */
@Injectable()
export class RedeemCertificate {
  constructor(
    private readonly find: FindCertificateByCode,
    private readonly debit: DebitCertificate,
    private readonly branches: BranchDirectory,
    private readonly database: Database,
  ) {}

  async execute(
    actor: Actor,
    input: { code: string; amount: Money | null; branchId: string; comment: string | null },
  ): Promise<{ record: CertificateRecord; ledger: LedgerEntry }> {
    actor.assertCan(Permission.CertificatesRedeem, input.branchId);
    await this.branches.get(input.branchId);
    return this.database.transaction(async () => {
      const record = await this.find.execute(input.code, { forUpdate: true });
      const { ledger } = await this.debit.execute({
        record,
        amount: input.amount,
        channel: 'point',
        branchId: input.branchId,
        paymentId: null,
        referenceType: null,
        referenceId: null,
        comment: input.comment,
      });
      return { record, ledger };
    });
  }
}

/** Блокировка (утерян, подозрение на мошенничество). Право certificates.manage. */
@Injectable()
export class BlockCertificate {
  constructor(
    private readonly certificates: CertificateRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
  ) {}

  async execute(actor: Actor, id: string, reason: string): Promise<CertificateRecord> {
    actor.assertCan(Permission.CertificatesManage);
    return this.database.transaction(async () => {
      const record = await lockCertificate(this.certificates, id);
      const before = certificateAuditState(record);
      record.certificate.block(reason);
      await this.certificates.save(record.certificate);
      await this.audit.record({
        action: 'certificate.blocked',
        entityType: 'gift_certificate',
        entityId: id,
        before,
        after: certificateAuditState(record),
        meta: { reason },
      });
      return record;
    });
  }
}

@Injectable()
export class UnblockCertificate {
  constructor(
    private readonly certificates: CertificateRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, id: string, reason: string | null): Promise<CertificateRecord> {
    actor.assertCan(Permission.CertificatesManage);
    return this.database.transaction(async () => {
      const record = await lockCertificate(this.certificates, id);
      const before = certificateAuditState(record);
      record.certificate.unblock(this.clock.now());
      await this.certificates.save(record.certificate);
      await this.audit.record({
        action: 'certificate.unblocked',
        entityType: 'gift_certificate',
        entityId: id,
        before,
        after: certificateAuditState(record),
        meta: { reason },
      });
      return record;
    });
  }
}

/**
 * Продление срока действия (последний день действия включительно). Истёкший сертификат с остатком
 * снова активен — в журнале движений запись «восстановление» (для отчёта по обязательствам).
 */
@Injectable()
export class ExtendCertificate {
  constructor(
    private readonly certificates: CertificateRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, id: string, input: { validUntil: string; reason: string }): Promise<CertificateRecord> {
    actor.assertCan(Permission.CertificatesManage);
    if (!input.reason?.trim()) throw new ValidationError('certificate.reason_required', 'Reason is required');
    if (!isIsoDate(input.validUntil)) throw new ValidationError('certificate.valid_until_invalid', 'validUntil must be YYYY-MM-DD');
    return this.database.transaction(async () => {
      const now = this.clock.now();
      const record = await lockCertificate(this.certificates, id);
      const before = certificateAuditState(record);
      const { reinstated } = record.certificate.extend(expiresAtForLastDay(input.validUntil), now);
      await this.certificates.save(record.certificate);
      if (reinstated) {
        await this.certificates.addLedger({
          certificateId: id,
          kind: 'reinstate',
          amount: record.certificate.balance,
          balanceAfter: record.certificate.balance,
          channel: 'admin',
          paymentId: null,
          refundId: null,
          referenceType: null,
          referenceId: null,
          branchId: null,
          actorUserId: actor.userId,
          actorName: actor.name,
          comment: input.reason,
          occurredAt: now,
        });
      }
      await this.audit.record({
        action: 'certificate.extended',
        entityType: 'gift_certificate',
        entityId: id,
        before,
        after: certificateAuditState(record),
        meta: { reason: input.reason, reinstated },
      });
      return record;
    });
  }
}

/** Переотправка сертификата (PDF с кодом) — тому же или другому адресату. Право certificates.manage. */
@Injectable()
export class ResendCertificate {
  constructor(
    private readonly certificates: CertificateRepository,
    private readonly deliver: DeliverCertificate,
    private readonly database: Database,
    private readonly audit: AuditLog,
  ) {}

  async execute(
    actor: Actor,
    id: string,
    input: { channel?: 'email' | 'whatsapp'; email?: string | null; phone?: string | null },
  ): Promise<CertificateRecord> {
    actor.assertCan(Permission.CertificatesManage);
    return this.database.transaction(async () => {
      const record = await lockCertificate(this.certificates, id);
      const channel = input.channel ?? (record.deliveryChannel === 'none' ? undefined : record.deliveryChannel);
      if (!channel) throw new ValidationError('certificate.delivery_channel_required', 'Delivery channel is required');
      const target =
        input.email || input.phone ? { email: input.email?.trim() || null, phone: input.phone ? normalizePhone(input.phone) : null } : undefined;
      await this.deliver.execute({ record, code: null, channel, target, dedupeKey: `certificate:${id}:resend:${record.deliveryCount + 1}` });
      await this.audit.record({
        action: 'certificate.resent',
        entityType: 'gift_certificate',
        entityId: id,
        meta: { channel, email: target?.email ?? null, phone: target?.phone ?? null },
      });
      return (await this.certificates.findById(id))!;
    });
  }
}

/**
 * Ссылка на PDF сертификата (с полным кодом) — для корпоративных продаж без рассылки.
 * Только для прав certificates.manage / payments.manual; каждое открытие — в журнале действий.
 */
@Injectable()
export class GetCertificatePdfLink {
  constructor(
    private readonly certificates: CertificateRepository,
    private readonly storage: FileStorage,
    private readonly audit: AuditLog,
  ) {}

  async execute(actor: Actor, id: string): Promise<{ url: string; expiresInSeconds: number }> {
    if (!actor.can(Permission.CertificatesManage) && !actor.can(Permission.PaymentsManual)) {
      throw new ForbiddenError('access.forbidden', 'Permission certificates.manage or payments.manual required');
    }
    const record = await this.certificates.findById(id);
    if (!record) throw new NotFoundError('certificate', id);
    if (!record.pdfFileKey) throw new NotFoundError('certificate_pdf', id);
    const ttl = 600;
    const url = await this.storage.signedUrl(record.pdfFileKey, ttl, `AULA-certificate-${record.certificate.snapshot().last4}.pdf`);
    await this.audit.record({ action: 'certificate.pdf_accessed', entityType: 'gift_certificate', entityId: id });
    return { url, expiresInSeconds: ttl };
  }
}

/**
 * Ежедневная задача: активные сертификаты с истёкшим сроком -> expired, движение «сгорание»
 * (остаток уходит из обязательств), событие CertificateExpired.
 */
@Injectable()
export class ExpireCertificates {
  constructor(
    private readonly certificates: CertificateRepository,
    private readonly database: Database,
    private readonly events: EventBus,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(): Promise<number> {
    const now = this.clock.now();
    let expired = 0;
    for (;;) {
      const ids = await this.certificates.findExpiredActiveIds(now, 200);
      if (ids.length === 0) break;
      let progressed = 0;
      for (const id of ids) {
        const done = await this.database.transaction(async () => {
          const record = await lockCertificate(this.certificates, id);
          const before = certificateAuditState(record);
          if (!record.certificate.expire(now)) return false;
          const s = record.certificate.snapshot();
          await this.certificates.save(record.certificate);
          await this.certificates.addLedger({
            certificateId: id,
            kind: 'expire',
            amount: s.balance,
            balanceAfter: s.balance,
            channel: 'system',
            paymentId: null,
            refundId: null,
            referenceType: null,
            referenceId: null,
            branchId: null,
            actorUserId: null,
            actorName: 'system',
            comment: null,
            occurredAt: now,
          });
          await this.audit.record({
            action: 'certificate.expired',
            entityType: 'gift_certificate',
            entityId: id,
            before,
            after: certificateAuditState(record),
          });
          await this.events.publish(
            PaymentsEvents.CertificateExpired,
            {
              certificateId: id,
              kind: s.kind,
              nominal: s.nominal.toJSON(),
              balance: s.balance.toJSON(),
              expiresAt: s.expiresAt.toISOString(),
              occurredAt: now.toISOString(),
            } satisfies CertificateExpiredPayload,
            { aggregateId: id },
          );
          return true;
        });
        if (done) progressed++;
      }
      expired += progressed;
      if (progressed === 0) break;
    }
    return expired;
  }
}
