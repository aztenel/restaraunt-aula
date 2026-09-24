import { Injectable } from '@nestjs/common';
import { FileStorage } from '../../../../shared/infrastructure/storage/file-storage';
import { XlsxBuilder } from '../../../../shared/infrastructure/xlsx/xlsx-builder';
import { Actor } from '../../../../shared/kernel/actor';
import { isIsoDate } from '../../../../shared/kernel/time';
import { ValidationError } from '../../../../shared/kernel/errors';
import { Page, pageOf, pageRequest } from '../../../../shared/kernel/pagination';
import { translate } from '../../../../shared/kernel/translatable';
import { BranchDirectory } from '../../../identity/public';
import { dailyScope } from '../../domain/daily-report';
import { DailyReportRecord, DailyReportRepository } from '../../infrastructure/daily-report.repository';
import { ReportScope, ReportScopes } from '../report-scope';
import { dailySheets, DailySummaryJson, toSummaryJson } from '../reports/report-sheets';
import { CONSOLIDATED_SCOPE_NAME, dailyReportFileName } from './generate-daily-reports.action';
import { DailySummaryBuilder } from './daily-summary.builder';

export interface DailyReportView {
  /** null — отчёт ещё не сформирован, показаны текущие данные. */
  id: string | null;
  date: string;
  branchId: string | null;
  /** Сформирован автоматически (23:30) и сохранён. */
  isFinal: boolean;
  generatedAt: Date | null;
  notifiedAt: Date | null;
  /** Подписанная ссылка на XLSX (сохранённый отчёт), действует 1 час. */
  fileUrl: string | null;
  summary: DailySummaryJson;
}

const URL_TTL_SECONDS = 3600;

/** Дневные отчёты: сохранённый за дату (или текущие данные, если ещё не сформирован) и история. */
@Injectable()
export class DailyReportQueries {
  constructor(
    private readonly scopes: ReportScopes,
    private readonly reports: DailyReportRepository,
    private readonly builder: DailySummaryBuilder,
    private readonly branches: BranchDirectory,
    private readonly storage: FileStorage,
    private readonly xlsx: XlsxBuilder,
  ) {}

  private async fileName(record: { date: string; branchId: string | null }): Promise<string> {
    const code = record.branchId ? ((await this.branches.find(record.branchId))?.code ?? record.branchId) : null;
    return dailyReportFileName(record.date, code);
  }

  private async view(record: DailyReportRecord): Promise<DailyReportView> {
    return {
      id: record.id,
      date: record.date,
      branchId: record.branchId,
      isFinal: true,
      generatedAt: record.generatedAt,
      notifiedAt: record.notifiedAt,
      fileUrl: record.fileKey ? await this.storage.signedUrl(record.fileKey, URL_TTL_SECONDS, await this.fileName(record)) : null,
      summary: record.summary as unknown as DailySummaryJson,
    };
  }

  private date(value: string | undefined): string {
    if (value === undefined) return this.scopes.today();
    if (!isIsoDate(value)) throw new ValidationError('report.invalid_date', 'date must be YYYY-MM-DD', { date: value });
    return value;
  }

  async get(actor: Actor, query: { date?: string; branchId?: string }): Promise<DailyReportView> {
    const scope = await this.scopes.resolve(actor, query.branchId);
    const date = this.date(query.date);
    const stored = await this.reports.find(date, dailyScope(scope.branchId));
    if (stored) return this.view(stored);
    const summary = toSummaryJson(await this.builder.build(date, scope));
    return { id: null, date, branchId: scope.branchId, isFinal: false, generatedAt: null, notifiedAt: null, fileUrl: null, summary };
  }

  async list(
    actor: Actor,
    query: { from?: string; to?: string; branchId?: string; page?: number; perPage?: number },
  ): Promise<Page<DailyReportView>> {
    const scope = await this.scopes.resolve(actor, query.branchId);
    const period = this.scopes.period(query);
    const req = pageRequest(query.page, query.perPage);
    const result = await this.reports.list(period, scope.branchId ? [dailyScope(scope.branchId)] : null, req);
    const items: DailyReportView[] = [];
    for (const record of result.items) items.push(await this.view(record));
    return pageOf(items, result.total, req);
  }

  /** XLSX дневного отчёта: сохранённый файл, если отчёт сформирован; иначе — по текущим данным. */
  async file(actor: Actor, query: { date?: string; branchId?: string }): Promise<{ body: Buffer; fileName: string }> {
    const scope = await this.scopes.resolve(actor, query.branchId);
    const date = this.date(query.date);
    const fileName = await this.fileName({ date, branchId: scope.branchId });
    const stored = await this.reports.find(date, dailyScope(scope.branchId));
    if (stored?.fileKey) {
      try {
        return { body: await this.storage.get(stored.fileKey, 'private'), fileName };
      } catch {
        // Файл недоступен в хранилище — строим заново по сохранённой сводке.
        return { body: await this.xlsx.build(dailySheets(stored.summary as unknown as DailySummaryJson, await this.scopeName(scope))), fileName };
      }
    }
    const summary = toSummaryJson(await this.builder.build(date, scope));
    return { body: await this.xlsx.build(dailySheets(summary, await this.scopeName(scope))), fileName };
  }

  private async scopeName(scope: ReportScope): Promise<string> {
    if (!scope.branchId) return CONSOLIDATED_SCOPE_NAME;
    const branch = await this.branches.find(scope.branchId);
    return branch ? translate(branch.name, 'ru') : scope.branchId;
  }
}
