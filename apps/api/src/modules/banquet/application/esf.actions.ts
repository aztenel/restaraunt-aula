import { Injectable, Logger } from '@nestjs/common';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { Database } from '../../../shared/infrastructure/database/database';
import { JobQueue } from '../../../shared/infrastructure/events/event-bus';
import { ExternalServiceError } from '../../../shared/infrastructure/integrations/external-http';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { ConflictError, NotFoundError } from '../../../shared/kernel/errors';
import { buildEsfInvoice, EsfStatus, EsfSubmitResult } from '../domain/esf';
import { ActivityRepository } from '../infrastructure/activity.repository';
import { ActRecord, DocumentRepository } from '../infrastructure/document.repository';
import { BanquetSupport } from './banquet-support';
import { assertCanIssueDocuments, BanquetJobs, EsfJobPayload } from './document.actions';
import { BanquetDocumentFiles } from './document-files';
import { EsfGatewayRegistry } from './esf-gateway.registry';

/** Интервал проверки регистрации ЭСФ в ИС ЭСФ после отправки. */
export const ESF_CHECK_DELAY_MS = 60_000;

function errorText(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 1000);
}

const SYSTEM = Actor.system('banquet.esf');

/**
 * Формирование / отправка ЭСФ по акту (фоновая задача banquet.esf_submit, с повторами).
 * Режим по умолчанию — черновик XML для загрузки бухгалтером; режим API — отправка в ИС ЭСФ.
 * Временная ошибка внешней системы — повтор задачи; постоянная — статус failed (повтор из админки).
 */
@Injectable()
export class SubmitEsf {
  private readonly logger = new Logger(SubmitEsf.name);

  constructor(
    private readonly documents: DocumentRepository,
    private readonly activities: ActivityRepository,
    private readonly support: BanquetSupport,
    private readonly files: BanquetDocumentFiles,
    private readonly registry: EsfGatewayRegistry,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly jobs: JobQueue,
    private readonly clock: Clock,
  ) {}

  async execute(payload: EsfJobPayload): Promise<void> {
    const act = await this.documents.findAct(payload.actId);
    if (!act) {
      this.logger.warn({ actId: payload.actId }, 'ESF job for an unknown act');
      return;
    }
    if (act.esf.status !== EsfStatus.Pending) return;
    const request = await this.support.load(act.requestId);
    const s = request.snapshot();
    const data = buildEsfInvoice({
      actNumber: act.number,
      actDate: act.actDate,
      eventDate: s.eventDate,
      requestNumber: s.number,
      amount: act.amount,
      vat: act.vat,
      vatRateBp: act.vatRateBp,
      seller: act.seller,
      buyer: act.buyer,
      contract: s.contractNumber && s.contractDate ? { number: s.contractNumber, date: s.contractDate } : null,
    });
    const gateway = await this.registry.resolve();
    let result: EsfSubmitResult;
    try {
      result = await gateway.submit(data, { correlationId: act.id });
    } catch (err) {
      const retryable = err instanceof ExternalServiceError && err.retryable;
      if (retryable) {
        await this.documents.updateEsf(act.id, { provider: gateway.provider, error: errorText(err), updatedAt: this.clock.now() });
        throw err;
      }
      await this.database.transaction(async () => {
        const now = this.clock.now();
        await this.documents.updateEsf(act.id, { status: EsfStatus.Failed, provider: gateway.provider, error: errorText(err), updatedAt: now });
        await this.record(act, EsfStatus.Failed, { provider: gateway.provider, error: errorText(err) }, now);
      });
      return;
    }
    await this.database.transaction(async () => {
      const locked = await this.documents.findAct(act.id, { forUpdate: true });
      if (!locked || locked.esf.status !== EsfStatus.Pending) return;
      const now = this.clock.now();
      const doc = await this.files.store({
        requestId: act.requestId,
        kind: 'esf_xml',
        number: `ESF-${act.number}`,
        title: `ЭСФ (XML) по акту № ${act.number}`,
        relatedId: act.id,
        body: Buffer.from(result.xml, 'utf8'),
        contentType: 'application/xml',
        extension: 'xml',
        actor: SYSTEM,
      });
      if (result.outcome === 'draft') {
        await this.documents.updateEsf(act.id, { status: EsfStatus.DraftReady, provider: gateway.provider, fileKey: doc.fileKey, error: null, updatedAt: now });
        await this.record(act, EsfStatus.DraftReady, { provider: gateway.provider, documentId: doc.id }, now);
        return;
      }
      const status = result.registrationNumber ? EsfStatus.Registered : EsfStatus.Sent;
      await this.documents.updateEsf(act.id, {
        status,
        provider: gateway.provider,
        esfId: result.esfId,
        registrationNumber: result.registrationNumber,
        fileKey: doc.fileKey,
        error: null,
        updatedAt: now,
      });
      await this.record(act, status, { provider: gateway.provider, esfId: result.esfId, registrationNumber: result.registrationNumber }, now);
      if (!result.registrationNumber) {
        await this.jobs.enqueue(BanquetJobs.EsfCheck, { actId: act.id } satisfies EsfJobPayload, { delayMs: ESF_CHECK_DELAY_MS, aggregateId: act.id });
      }
    });
  }

  private async record(act: ActRecord, status: EsfStatus, data: Record<string, unknown>, now: Date): Promise<void> {
    await this.activities.add({ requestId: act.requestId, kind: 'esf', data: { actId: act.id, status, ...data }, actor: SYSTEM, at: now });
    await this.audit.record({
      action: 'banquet.esf_updated',
      entityType: 'banquet_act',
      entityId: act.id,
      branchId: act.branchId,
      before: { esfStatus: act.esf.status },
      after: { esfStatus: status, ...data },
      meta: { actNumber: act.number },
      actor: SYSTEM,
    });
  }
}

/** Проверка регистрации отправленного ЭСФ (задача banquet.esf_check): пока номера нет — повтор задачи. */
@Injectable()
export class CheckEsfStatus {
  constructor(
    private readonly documents: DocumentRepository,
    private readonly activities: ActivityRepository,
    private readonly registry: EsfGatewayRegistry,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(payload: EsfJobPayload): Promise<void> {
    const act = await this.documents.findAct(payload.actId);
    if (!act || act.esf.status !== EsfStatus.Sent || !act.esf.esfId) return;
    const gateway = this.registry.get(act.esf.provider);
    if (!gateway) return;
    const result = await gateway.checkStatus(act.esf.esfId, { correlationId: act.id });
    if (result.status === 'sent') {
      throw new ExternalServiceError('banquet.esf', 'ESF is not registered yet', true);
    }
    await this.database.transaction(async () => {
      const now = this.clock.now();
      const status = result.status === 'registered' ? EsfStatus.Registered : EsfStatus.Failed;
      await this.documents.updateEsf(act.id, { status, registrationNumber: result.registrationNumber, error: result.error, updatedAt: now });
      await this.activities.add({
        requestId: act.requestId,
        kind: 'esf',
        data: { actId: act.id, status, registrationNumber: result.registrationNumber, error: result.error },
        actor: SYSTEM,
        at: now,
      });
      await this.audit.record({
        action: 'banquet.esf_updated',
        entityType: 'banquet_act',
        entityId: act.id,
        branchId: act.branchId,
        before: { esfStatus: act.esf.status },
        after: { esfStatus: status, registrationNumber: result.registrationNumber, error: result.error },
        meta: { actNumber: act.number },
        actor: SYSTEM,
      });
    });
  }
}

/** Повторное формирование / отправка ЭСФ из админки (после ошибки или смены режима на отправку через API). */
@Injectable()
export class RetryEsf {
  constructor(
    private readonly documents: DocumentRepository,
    private readonly support: BanquetSupport,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly jobs: JobQueue,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, actId: string): Promise<ActRecord> {
    const found = await this.documents.findAct(actId);
    if (!found) throw new NotFoundError('banquet_act', actId);
    return this.database.transaction(async () => {
      const request = await this.support.load(found.requestId, { forUpdate: true });
      assertCanIssueDocuments(actor, request);
      const act = (await this.documents.findAct(actId, { forUpdate: true }))!;
      if (act.esf.status !== EsfStatus.Failed && act.esf.status !== EsfStatus.DraftReady) {
        throw new ConflictError('banquet_esf.not_retryable', `ESF cannot be resubmitted in status ${act.esf.status}`, { status: act.esf.status });
      }
      const now = this.clock.now();
      await this.documents.updateEsf(actId, { status: EsfStatus.Pending, error: null, updatedAt: now });
      await this.jobs.enqueue(BanquetJobs.EsfSubmit, { actId } satisfies EsfJobPayload, { aggregateId: actId, branchId: act.branchId });
      await this.audit.record({
        action: 'banquet.esf_retry',
        entityType: 'banquet_act',
        entityId: actId,
        branchId: act.branchId,
        before: { esfStatus: act.esf.status },
        after: { esfStatus: EsfStatus.Pending },
        meta: { actNumber: act.number },
        actor,
      });
      return (await this.documents.findAct(actId))!;
    });
  }
}
