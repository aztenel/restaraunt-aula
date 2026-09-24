import { Injectable, Logger } from '@nestjs/common';
import { Config } from '../../../../shared/infrastructure/config/config';
import { Database } from '../../../../shared/infrastructure/database/database';
import { FileStorage } from '../../../../shared/infrastructure/storage/file-storage';
import { XlsxBuilder } from '../../../../shared/infrastructure/xlsx/xlsx-builder';
import { Clock } from '../../../../shared/kernel/clock';
import { Permission } from '../../../../shared/kernel/permissions';
import { translate } from '../../../../shared/kernel/translatable';
import { BranchDirectory, StaffDirectory } from '../../../identity/public';
import { Notifier } from '../../../notifications/public';
import { dailyScope, dailySummaryText, formatDisplayDate } from '../../domain/daily-report';
import { DailyReportRepository } from '../../infrastructure/daily-report.repository';
import { dailySheets, toSummaryJson, XLSX_CONTENT_TYPE } from '../reports/report-sheets';
import { DailySummaryBuilder } from './daily-summary.builder';

export const CONSOLIDATED_SCOPE_NAME = 'Сеть AULA';

export function dailyReportFileKey(date: string, scope: string): string {
  return `reports/daily/${date}/${scope}.xlsx`;
}

export function dailyReportFileName(date: string, code: string | null): string {
  return `aula_daily_${date}_${code ?? 'all'}.xlsx`;
}

/**
 * Дневной отчёт за локальный день: по каждому активному филиалу и сводный по сети.
 * Сводка + XLSX (приватное хранилище) сохраняются (повтор за ту же дату перезаписывает),
 * уведомление персоналу — один раз: сводный — собственнику и финансам (reports.consolidated),
 * по филиалу — управляющему (reports.branch в филиале, без получателей сводного).
 */
@Injectable()
export class GenerateDailyReports {
  private readonly logger = new Logger(GenerateDailyReports.name);

  constructor(
    private readonly builder: DailySummaryBuilder,
    private readonly reports: DailyReportRepository,
    private readonly branches: BranchDirectory,
    private readonly staff: StaffDirectory,
    private readonly notifier: Notifier,
    private readonly storage: FileStorage,
    private readonly xlsx: XlsxBuilder,
    private readonly database: Database,
    private readonly config: Config,
    private readonly clock: Clock,
  ) {}

  async execute(date: string): Promise<{ generated: number; notified: number }> {
    const branches = await this.branches.list({ activeOnly: true });
    const consolidatedRecipients = new Set((await this.staff.withPermission(Permission.ReportsConsolidated, null)).map((s) => s.id));
    let generated = 0;
    let notified = 0;
    const scopes = [
      { branchId: null as string | null, name: CONSOLIDATED_SCOPE_NAME },
      ...branches.map((b) => ({ branchId: b.id as string | null, name: translate(b.name, 'ru') })),
    ];
    for (const scope of scopes) {
      let userIds: string[] | undefined;
      if (scope.branchId) {
        // Управляющие филиала; собственник и финансы получают сводный отчёт, а не каждый филиальный.
        userIds = (await this.staff.withPermission(Permission.ReportsBranch, scope.branchId))
          .filter((s) => !consolidatedRecipients.has(s.id))
          .map((s) => s.id);
      }
      const result = await this.generateOne(date, scope.branchId, scope.name, userIds);
      generated++;
      if (result.notified) notified++;
    }
    this.logger.log({ date, generated, notified }, 'Daily reports generated');
    return { generated, notified };
  }

  private async generateOne(
    date: string,
    branchId: string | null,
    scopeName: string,
    userIds: string[] | undefined,
  ): Promise<{ notified: boolean }> {
    const scope = dailyScope(branchId);
    const summary = await this.builder.build(date, { branchId, branchIds: branchId ? [branchId] : null });
    const json = toSummaryJson(summary);
    const fileKey = dailyReportFileKey(date, scope);
    const body = await this.xlsx.build(dailySheets(json, scopeName));
    await this.storage.put({ key: fileKey, body, contentType: XLSX_CONTENT_TYPE, visibility: 'private' });

    return this.database.transaction(async () => {
      const record = await this.reports.upsert({ date, scope, branchId, summary: json, fileKey, generatedAt: this.clock.now() });
      if (record.notifiedAt) return { notified: false };
      if (userIds && userIds.length === 0) return { notified: false };
      const query = new URLSearchParams({ date, ...(branchId ? { branchId } : {}) });
      await this.notifier.notifyStaff({
        audience: userIds ? { branchId, userIds } : { branchId: null, permission: Permission.ReportsConsolidated },
        template: 'staff.daily_report',
        params: {
          date: formatDisplayDate(date),
          summary: dailySummaryText(summary, scopeName),
          adminUrl: `${this.config.app.adminUrl}/reports/daily?${query.toString()}`,
        },
        dedupeKey: `reporting:daily_report:${date}:${scope}`,
        related: { type: 'daily_report', id: record.id },
      });
      await this.reports.markNotified(record.id, this.clock.now());
      return { notified: true };
    });
  }
}
