import { Injectable, Logger } from '@nestjs/common';
import { AuditLog } from '../../../../shared/infrastructure/audit/audit-log';
import { Database } from '../../../../shared/infrastructure/database/database';
import { JobQueue } from '../../../../shared/infrastructure/events/event-bus';
import { FileStorage } from '../../../../shared/infrastructure/storage/file-storage';
import { Actor } from '../../../../shared/kernel/actor';
import { Clock } from '../../../../shared/kernel/clock';
import { ConflictError, DomainError, ForbiddenError, NotFoundError, ValidationError } from '../../../../shared/kernel/errors';
import { newId } from '../../../../shared/kernel/ids';
import { Page, pageOf, pageRequest } from '../../../../shared/kernel/pagination';
import { Permission } from '../../../../shared/kernel/permissions';
import { isEnumValue } from '../../../../shared/kernel/state-machine';
import { isIsoDate } from '../../../../shared/kernel/time';
import { BranchDirectory } from '../../../identity/public';
import {
  AccountingExport,
  AccountingExportFormat,
  AccountingExportState,
  AccountingPushStatus,
  accountingTotals,
  BUILD_MAX_ATTEMPTS,
  exportFileName,
  PUSH_MAX_ATTEMPTS,
} from '../../domain/accounting-export';
import { MAX_PERIOD_DAYS } from '../../domain/period';
import { AccountingExportRepository } from '../../infrastructure/accounting-export.repository';
import { ReportScopes } from '../report-scope';
import { AccountingDataCollector } from './accounting-data.collector';
import { AccountingExporterRegistry, AccountingPushGateway, errorMessage, isRetryable } from './accounting-exporter';

export const AccountingJobs = {
  Build: 'reporting.build_accounting_export',
  Push: 'reporting.push_accounting_export',
} as const;

export interface AccountingExportJobPayload {
  exportId: string;
}

export interface AccountingExportView extends Omit<AccountingExportState, 'file' | 'periodFrom' | 'periodTo' | 'buildAttempts'> {
  from: string;
  to: string;
  fileName: string | null;
  sizeBytes: number | null;
  /** Подписанная ссылка на файл (приватное хранилище), действует 1 час. */
  fileUrl: string | null;
}

const URL_TTL_SECONDS = 3600;

function auditState(e: AccountingExport) {
  const s = e.snapshot();
  return { format: s.format, from: s.periodFrom, to: s.periodTo, branchId: s.branchId, status: s.status, pushStatus: s.pushStatus };
}

/** Просмотр выгрузок: статус, итоги, подписанная ссылка на файл. */
@Injectable()
export class AccountingExportQueries {
  constructor(
    private readonly exports: AccountingExportRepository,
    private readonly storage: FileStorage,
  ) {}

  async view(e: AccountingExport): Promise<AccountingExportView> {
    const { file, periodFrom, periodTo, buildAttempts: _attempts, ...rest } = e.snapshot();
    return {
      ...rest,
      from: periodFrom,
      to: periodTo,
      fileName: file?.name ?? null,
      sizeBytes: file?.sizeBytes ?? null,
      fileUrl: file && rest.status === 'ready' ? await this.storage.signedUrl(file.key, URL_TTL_SECONDS, file.name) : null,
    };
  }

  async get(actor: Actor, exportId: string): Promise<AccountingExportView> {
    const e = await this.exports.findById(exportId);
    if (!e) throw new NotFoundError('accounting_export', exportId);
    actor.assertCan(Permission.ReportsExport, e.snapshot().branchId);
    return this.view(e);
  }

  async list(
    actor: Actor,
    query: { page?: number; perPage?: number; branchId?: string; from?: string; to?: string },
  ): Promise<Page<AccountingExportView>> {
    const branches = actor.branchesWith(Permission.ReportsExport);
    if (branches !== 'all' && branches.length === 0) {
      throw new ForbiddenError('access.forbidden', `Permission ${Permission.ReportsExport} required`, { permission: Permission.ReportsExport });
    }
    if (query.branchId) actor.assertCan(Permission.ReportsExport, query.branchId);
    for (const [field, value] of [
      ['from', query.from],
      ['to', query.to],
    ] as const) {
      if (value !== undefined && !isIsoDate(value)) throw new ValidationError('report.invalid_date', `${field} must be a date YYYY-MM-DD`, { field, value });
    }
    if (query.from && query.to && query.from > query.to) {
      throw new ValidationError('report.invalid_period', 'Period start must not be after its end', { from: query.from, to: query.to });
    }
    const req = pageRequest(query.page, query.perPage);
    const result = await this.exports.list(branches, req, { branchId: query.branchId, from: query.from, to: query.to });
    const items: AccountingExportView[] = [];
    for (const e of result.items) items.push(await this.view(e));
    return pageOf(items, result.total, req);
  }
}

/**
 * Запрос выгрузки в учёт за период: запись + задача построения файла в одной транзакции.
 * Право reports.export (для выгрузки по всем филиалам — глобальное).
 */
@Injectable()
export class RequestAccountingExport {
  constructor(
    private readonly exports: AccountingExportRepository,
    private readonly registry: AccountingExporterRegistry,
    private readonly scopes: ReportScopes,
    private readonly branches: BranchDirectory,
    private readonly jobs: JobQueue,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
    private readonly queries: AccountingExportQueries,
  ) {}

  async execute(
    actor: Actor,
    input: { from: string; to: string; format: string; branchId?: string | null; push?: boolean },
  ): Promise<AccountingExportView> {
    const branchId = input.branchId ?? null;
    actor.assertCan(Permission.ReportsExport, branchId);
    if (branchId && !(await this.branches.find(branchId))) throw new NotFoundError('branch', branchId);
    if (!isEnumValue(AccountingExportFormat, input.format)) {
      throw new ValidationError('accounting_export.unknown_format', 'Unknown export format', { format: input.format });
    }
    this.registry.get(input.format);
    const period = this.scopes.period({ from: input.from, to: input.to }, { maxDays: MAX_PERIOD_DAYS });
    const e = AccountingExport.request({
      id: newId(),
      format: input.format,
      periodFrom: period.from,
      periodTo: period.to,
      branchId,
      pushRequested: input.push ?? true,
      requestedBy: actor.userId,
      requestedAt: this.clock.now(),
    });
    await this.database.transaction(async () => {
      await this.exports.insert(e);
      await this.jobs.enqueue<AccountingExportJobPayload>(AccountingJobs.Build, { exportId: e.id }, { aggregateId: e.id, branchId });
      await this.audit.record({
        action: 'reporting.accounting_export_requested',
        entityType: 'accounting_export',
        entityId: e.id,
        branchId,
        after: auditState(e),
      });
    });
    return this.queries.view(e);
  }
}

/**
 * Задача reporting.build_accounting_export: собрать данные, построить файл адаптером формата,
 * сохранить приватно; при настроенном HTTP-сервисе 1С — поставить отправку.
 * Повторы (платформа) до BUILD_MAX_ATTEMPTS, затем выгрузка помечается failed.
 */
@Injectable()
export class BuildAccountingExport {
  private readonly logger = new Logger(BuildAccountingExport.name);

  constructor(
    private readonly exports: AccountingExportRepository,
    private readonly collector: AccountingDataCollector,
    private readonly registry: AccountingExporterRegistry,
    private readonly gateway: AccountingPushGateway,
    private readonly branches: BranchDirectory,
    private readonly storage: FileStorage,
    private readonly jobs: JobQueue,
    private readonly database: Database,
    private readonly clock: Clock,
  ) {}

  async execute(input: AccountingExportJobPayload): Promise<void> {
    const current = await this.exports.findById(input.exportId);
    if (!current || current.status !== 'pending') return;
    const attempt = await this.exports.incrementBuildAttempts(current.id);
    const s = current.snapshot();
    try {
      const data = await this.collector.collect(s);
      const artifact = await this.registry.get(s.format).build(data);
      const branchCode = s.branchId ? ((await this.branches.find(s.branchId))?.code ?? null) : null;
      const file = {
        key: `accounting-exports/${s.id}.${artifact.extension}`,
        name: exportFileName(s.format, s.periodFrom, s.periodTo, branchCode),
        contentType: artifact.contentType,
        sizeBytes: artifact.body.length,
      };
      await this.storage.put({ key: file.key, body: artifact.body, contentType: artifact.contentType, visibility: 'private' });
      const pushEnabled = await this.gateway.isEnabled();
      await this.database.transaction(async () => {
        const locked = await this.exports.findById(s.id, { forUpdate: true });
        if (!locked || locked.status !== 'pending') return;
        locked.markReady(file, accountingTotals(data), this.clock.now(), pushEnabled);
        await this.exports.save(locked);
        if (locked.pushStatus === AccountingPushStatus.Pending) {
          await this.jobs.enqueue<AccountingExportJobPayload>(AccountingJobs.Push, { exportId: s.id }, { aggregateId: s.id });
        }
      });
    } catch (error) {
      if (!(error instanceof DomainError) && attempt < BUILD_MAX_ATTEMPTS) {
        this.logger.warn({ exportId: s.id, attempt, err: errorMessage(error) }, 'Accounting export build failed, will retry');
        throw error;
      }
      this.logger.error({ exportId: s.id, attempt, err: errorMessage(error) }, 'Accounting export build failed');
      await this.database.transaction(async () => {
        const locked = await this.exports.findById(s.id, { forUpdate: true });
        if (!locked || locked.status !== 'pending') return;
        locked.markFailed(errorMessage(error), this.clock.now());
        await this.exports.save(locked);
      });
    }
  }
}

/**
 * Задача reporting.push_accounting_export: отправка XML в HTTP-сервис 1С (basic auth).
 * Повтор при сетевых ошибках и 5xx до PUSH_MAX_ATTEMPTS; 4xx и ошибки настроек — сразу failed.
 */
@Injectable()
export class PushAccountingExport {
  private readonly logger = new Logger(PushAccountingExport.name);

  constructor(
    private readonly exports: AccountingExportRepository,
    private readonly gateway: AccountingPushGateway,
    private readonly storage: FileStorage,
    private readonly database: Database,
    private readonly clock: Clock,
  ) {}

  async execute(input: AccountingExportJobPayload): Promise<void> {
    const current = await this.exports.findById(input.exportId);
    if (!current || current.pushStatus !== AccountingPushStatus.Pending) return;
    const s = current.snapshot();
    const attempt = await this.exports.incrementPushAttempts(s.id);
    try {
      if (!s.file) throw new ConflictError('accounting_export.file_missing', 'Export file is missing');
      const body = await this.storage.get(s.file.key, 'private');
      await this.gateway.push(
        { body, name: s.file.name, contentType: s.file.contentType },
        { exportId: s.id, periodFrom: s.periodFrom, periodTo: s.periodTo },
      );
      await this.database.transaction(async () => {
        const locked = await this.exports.findById(s.id, { forUpdate: true });
        if (!locked || locked.pushStatus !== AccountingPushStatus.Pending) return;
        locked.markPushed(this.clock.now());
        await this.exports.save(locked);
      });
    } catch (error) {
      if (isRetryable(error) && attempt < PUSH_MAX_ATTEMPTS) {
        this.logger.warn({ exportId: s.id, attempt, err: errorMessage(error) }, 'Accounting export push failed, will retry');
        throw error;
      }
      this.logger.error({ exportId: s.id, attempt, err: errorMessage(error) }, 'Accounting export push failed');
      await this.database.transaction(async () => {
        const locked = await this.exports.findById(s.id, { forUpdate: true });
        if (!locked || locked.pushStatus !== AccountingPushStatus.Pending) return;
        locked.markPushFailed(errorMessage(error));
        await this.exports.save(locked);
      });
    }
  }
}

/** Повторная отправка готовой XML-выгрузки в 1С (вручную из админки). */
@Injectable()
export class RetryAccountingExportPush {
  constructor(
    private readonly exports: AccountingExportRepository,
    private readonly gateway: AccountingPushGateway,
    private readonly jobs: JobQueue,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly queries: AccountingExportQueries,
  ) {}

  async execute(actor: Actor, exportId: string): Promise<AccountingExportView> {
    const current = await this.exports.findById(exportId);
    if (!current) throw new NotFoundError('accounting_export', exportId);
    actor.assertCan(Permission.ReportsExport, current.snapshot().branchId);
    if (!(await this.gateway.isEnabled())) {
      throw new ConflictError('accounting_export.push_not_configured', 'Accounting HTTP service is not configured');
    }
    const updated = await this.database.transaction(async () => {
      const locked = (await this.exports.findById(exportId, { forUpdate: true }))!;
      const before = auditState(locked);
      locked.requestPush();
      await this.exports.save(locked);
      await this.jobs.enqueue<AccountingExportJobPayload>(AccountingJobs.Push, { exportId }, { aggregateId: exportId });
      await this.audit.record({
        action: 'reporting.accounting_export_push_requested',
        entityType: 'accounting_export',
        entityId: exportId,
        branchId: locked.snapshot().branchId,
        before,
        after: auditState(locked),
      });
      return locked;
    });
    return this.queries.view(updated);
  }
}
