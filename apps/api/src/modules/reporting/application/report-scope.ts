import { Injectable } from '@nestjs/common';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { NotFoundError } from '../../../shared/kernel/errors';
import { Permission } from '../../../shared/kernel/permissions';
import { BranchDirectory } from '../../identity/public';
import { localDateOf, reportPeriod, ReportPeriod } from '../domain/period';

/**
 * Область отчёта. Отчёт филиала — право reports.branch в этом филиале (управляющий — только свой);
 * сводный по сети (без фильтра филиала) — право reports.consolidated (собственник, финансы).
 * branchIds = null — все филиалы, включая строки без филиала (онлайн-сертификаты, выездные банкеты).
 */
export interface ReportScope {
  branchId: string | null;
  branchIds: string[] | null;
}

@Injectable()
export class ReportScopes {
  constructor(
    private readonly branches: BranchDirectory,
    private readonly clock: Clock,
  ) {}

  async resolve(actor: Actor, branchId?: string | null): Promise<ReportScope> {
    if (branchId) {
      const allowed = actor.scopeBranches(Permission.ReportsBranch, branchId);
      if (!(await this.branches.find(branchId))) throw new NotFoundError('branch', branchId);
      return { branchId, branchIds: allowed === 'all' ? [branchId] : allowed };
    }
    actor.assertCan(Permission.ReportsConsolidated);
    return { branchId: null, branchIds: null };
  }

  /** Сегодняшняя локальная дата (Asia/Almaty). */
  today(): string {
    return localDateOf(this.clock.now());
  }

  period(input: { from?: string | null; to?: string | null }, options: { defaultDays?: number; maxDays?: number } = {}): ReportPeriod {
    return reportPeriod(input, this.today(), options);
  }
}
