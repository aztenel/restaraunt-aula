import { Injectable } from '@nestjs/common';
import { JobHandler, Scheduled } from '../../../shared/infrastructure/events/decorators';
import { JobEnvelope } from '../../../shared/infrastructure/events/types';
import { Clock } from '../../../shared/kernel/clock';
import {
  AccountingExportJobPayload,
  AccountingJobs,
  BuildAccountingExport,
  PushAccountingExport,
} from '../application/accounting/accounting-export.actions';
import { GenerateDailyReports } from '../application/daily-reports/generate-daily-reports.action';
import { PurgeStorefrontEvents } from '../application/storefront.actions';
import { BUILD_MAX_ATTEMPTS, PUSH_MAX_ATTEMPTS } from '../domain/accounting-export';
import { DAILY_REPORT_SCHEDULE, dailyReportDate } from '../domain/daily-report';

/** Фоновые задачи и расписания модуля Reporting. */
@Injectable()
export class ReportingJobs {
  constructor(
    private readonly generateDailyReports: GenerateDailyReports,
    private readonly buildExport: BuildAccountingExport,
    private readonly pushExport: PushAccountingExport,
    private readonly purgeStorefront: PurgeStorefrontEvents,
    private readonly clock: Clock,
  ) {}

  /** Дневной отчёт в 23:30 (Asia/Almaty): по филиалам и сводный, хранение и отправка персоналу. */
  @Scheduled('reporting.daily_report', { cron: DAILY_REPORT_SCHEDULE })
  async dailyReport(): Promise<void> {
    await this.generateDailyReports.execute(dailyReportDate(this.clock.now()));
  }

  /** Срок хранения сырых событий витрины. */
  @Scheduled('reporting.purge_storefront_events', { cron: '20 4 * * *' })
  async purgeStorefrontEvents(): Promise<void> {
    await this.purgeStorefront.execute();
  }

  @JobHandler(AccountingJobs.Build, { attempts: BUILD_MAX_ATTEMPTS, backoffMs: 30_000 })
  async buildAccountingExport(job: JobEnvelope<AccountingExportJobPayload>): Promise<void> {
    await this.buildExport.execute(job.payload);
  }

  /** Внешний вызов (HTTP-сервис 1С) — только из задачи, с повторами и экспоненциальной задержкой. */
  @JobHandler(AccountingJobs.Push, { attempts: PUSH_MAX_ATTEMPTS, backoffMs: 60_000, maxBackoffMs: 60 * 60_000 })
  async pushAccountingExport(job: JobEnvelope<AccountingExportJobPayload>): Promise<void> {
    await this.pushExport.execute(job.payload);
  }
}
