import { Injectable } from '@nestjs/common';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { Database } from '../../../shared/infrastructure/database/database';
import { Actor } from '../../../shared/kernel/actor';
import { NotFoundError, ValidationError } from '../../../shared/kernel/errors';
import { Money } from '../../../shared/kernel/money';
import { Permission } from '../../../shared/kernel/permissions';
import { BranchDirectory } from '../../identity/public';
import { normalizeAggregatorVolume } from '../domain/aggregator';
import { isMonth, monthPeriod } from '../domain/period';
import { AggregatorVolumeRecord, AggregatorVolumeRepository } from '../infrastructure/aggregator-volume.repository';
import { ReportScopes } from './report-scope';

function auditState(r: AggregatorVolumeRecord | null) {
  return r ? { sourceName: r.sourceName, orders: r.orders, revenue: r.revenue.toJSON() } : null;
}

/**
 * Ввод помесячных итогов агрегатора по филиалу (заказы агрегаторов в систему не попадают).
 * Право — отчёты филиала (reports.branch) в этом филиале. Изменение пишется в журнал действий.
 */
@Injectable()
export class SaveAggregatorVolume {
  constructor(
    private readonly volumes: AggregatorVolumeRepository,
    private readonly branches: BranchDirectory,
    private readonly database: Database,
    private readonly audit: AuditLog,
  ) {}

  async execute(
    actor: Actor,
    input: { branchId: string; month: string; source: string; sourceName: string; orders: number; revenue?: Money | null },
  ): Promise<AggregatorVolumeRecord> {
    actor.assertCan(Permission.ReportsBranch, input.branchId);
    if (!(await this.branches.find(input.branchId))) throw new NotFoundError('branch', input.branchId);
    const data = normalizeAggregatorVolume({
      month: input.month,
      source: input.source,
      sourceName: input.sourceName,
      orders: input.orders,
      revenue: input.revenue ?? Money.zero(),
    });
    return this.database.transaction(async () => {
      const before = await this.volumes.find(input.branchId, data.month, data.source);
      const saved = await this.volumes.upsert({ branchId: input.branchId, ...data, updatedBy: actor.userId });
      await this.audit.record({
        action: 'reporting.aggregator_volume_saved',
        entityType: 'aggregator_volume',
        entityId: saved.id,
        branchId: input.branchId,
        before: auditState(before),
        after: auditState(saved),
        meta: { month: data.month, source: data.source },
      });
      return saved;
    });
  }
}

/** Список введённых итогов агрегаторов за месяцы (по филиалам, доступным сотруднику). */
@Injectable()
export class AggregatorVolumeQueries {
  constructor(
    private readonly scopes: ReportScopes,
    private readonly volumes: AggregatorVolumeRepository,
  ) {}

  async list(actor: Actor, query: { fromMonth?: string; toMonth?: string; branchId?: string }): Promise<AggregatorVolumeRecord[]> {
    const scope = await this.scopes.resolve(actor, query.branchId);
    const current = this.scopes.today().slice(0, 7);
    const toMonth = query.toMonth ?? current;
    const fromMonth = query.fromMonth ?? toMonth;
    if (!isMonth(fromMonth) || !isMonth(toMonth) || fromMonth > toMonth) {
      throw new ValidationError('report.invalid_month', 'fromMonth/toMonth must be YYYY-MM, fromMonth <= toMonth');
    }
    return this.volumes.list({ from: monthPeriod(fromMonth).from, to: monthPeriod(toMonth).to }, scope.branchIds);
  }
}
