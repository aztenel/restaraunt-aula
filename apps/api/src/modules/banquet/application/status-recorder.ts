import { Injectable } from '@nestjs/common';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { EventBus } from '../../../shared/infrastructure/events/event-bus';
import { Actor } from '../../../shared/kernel/actor';
import { BanquetRequest, BanquetTransition } from '../domain/banquet-request';
import { statusLabel } from '../domain/texts';
import { ActivityRepository } from '../infrastructure/activity.repository';
import { AdminFeed } from '../../notifications/public';
import { BanquetEvents } from '../public';
import { statusChangedPayload } from './banquet-events';
import { BanquetSupport } from './banquet-support';

/**
 * Последствия переходов заявки — в транзакции действия: лента заявки, журнал действий (было/стало),
 * событие StatusChanged (с итогом актуальной сметы — выручка при held), лента админки.
 */
@Injectable()
export class BanquetStatusRecorder {
  constructor(
    private readonly activities: ActivityRepository,
    private readonly support: BanquetSupport,
    private readonly audit: AuditLog,
    private readonly events: EventBus,
    private readonly feed: AdminFeed,
  ) {}

  async record(request: BanquetRequest, options: { actor: Actor; before: Record<string, unknown> }): Promise<BanquetTransition[]> {
    const transitions = request.pullTransitions();
    if (transitions.length === 0) return transitions;
    const quote = await this.support.currentQuote(request.id);
    const after = request.auditView();
    let before = options.before;
    for (const t of transitions) {
      await this.activities.add({
        requestId: request.id,
        kind: 'status_changed',
        text: t.reason,
        data: { from: t.from, to: t.to },
        actor: options.actor,
        at: t.at,
      });
      await this.audit.record({
        action: 'banquet.status_changed',
        entityType: 'banquet_request',
        entityId: request.id,
        branchId: request.branchId,
        before: { ...before, status: t.from },
        after: { ...after, status: t.to },
        meta: { number: request.number, from: t.from, to: t.to, reason: t.reason },
        actor: options.actor,
      });
      before = { ...after, status: t.to };
      await this.events.publish(BanquetEvents.StatusChanged, statusChangedPayload(request, t, quote?.totals.total ?? null), {
        aggregateId: request.id,
        branchId: request.branchId,
      });
      await this.feed.push({
        branchId: request.branchId,
        stream: 'banquets',
        kind: 'updated',
        entityId: request.id,
        title: `Заявка ${request.number}: ${statusLabel(t.to, 'ru').toLowerCase()}`,
      });
    }
    return transitions;
  }
}
