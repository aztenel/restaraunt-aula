import { Injectable } from '@nestjs/common';
import { Actor } from '../../kernel/actor';
import { Clock } from '../../kernel/clock';
import { newId } from '../../kernel/ids';
import { offsetOf, Page, pageOf, PageRequest } from '../../kernel/pagination';
import { RequestContext } from '../context/request-context';
import { Database } from '../database/database';

/**
 * Журнал действий. Любое действие, меняющее деньги, статус заказа или состав меню,
 * пишется сюда с пользователем, временем и прежним значением. Запись в той же транзакции,
 * что и само изменение. Таблица только на добавление (триггер в БД).
 */
export interface AuditEntry {
  /** Машинное имя действия: 'order.status_changed', 'menu.price_changed', 'payment.refunded'. */
  action: string;
  entityType: string;
  entityId: string;
  branchId?: string | null;
  before?: unknown;
  after?: unknown;
  meta?: Record<string, unknown>;
  /** По умолчанию — актор из контекста запроса. */
  actor?: Actor | null;
}

export interface AuditRecordView {
  id: string;
  occurredAt: Date;
  actorKind: string;
  actorUserId: string | null;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string;
  branchId: string | null;
  before: unknown;
  after: unknown;
  meta: Record<string, unknown>;
  ip: string | null;
  requestId: string | null;
}

export interface AuditSearch {
  actorUserId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  branchId?: string;
  from?: Date;
  to?: Date;
}

function toJson(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

@Injectable()
export class AuditLog {
  constructor(
    private readonly database: Database,
    private readonly clock: Clock,
  ) {}

  async record(entry: AuditEntry): Promise<void> {
    const ctx = RequestContext.current();
    const actor = entry.actor ?? ctx?.actor ?? Actor.system();
    await this.database
      .db()
      .insertInto('platform.audit_log')
      .values({
        id: newId(),
        occurred_at: this.clock.now(),
        actor_kind: actor.kind,
        actor_user_id: actor.userId,
        actor_name: actor.name,
        action: entry.action,
        entity_type: entry.entityType,
        entity_id: entry.entityId,
        branch_id: entry.branchId ?? null,
        before: toJson(entry.before),
        after: toJson(entry.after),
        meta: JSON.stringify(entry.meta ?? {}),
        ip: ctx?.ip ?? null,
        request_id: ctx?.requestId ?? null,
      })
      .execute();
  }

  async search(filter: AuditSearch, page: PageRequest): Promise<Page<AuditRecordView>> {
    let q = this.database.db().selectFrom('platform.audit_log');
    if (filter.actorUserId) q = q.where('actor_user_id', '=', filter.actorUserId);
    if (filter.action) q = q.where('action', 'like', `${filter.action}%`);
    if (filter.entityType) q = q.where('entity_type', '=', filter.entityType);
    if (filter.entityId) q = q.where('entity_id', '=', filter.entityId);
    if (filter.branchId) q = q.where('branch_id', '=', filter.branchId);
    if (filter.from) q = q.where('occurred_at', '>=', filter.from);
    if (filter.to) q = q.where('occurred_at', '<', filter.to);
    const total = await q.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst();
    const rows = await q.selectAll().orderBy('occurred_at', 'desc').limit(page.perPage).offset(offsetOf(page)).execute();
    return pageOf(
      rows.map((r: any) => ({
        id: r.id,
        occurredAt: r.occurred_at,
        actorKind: r.actor_kind,
        actorUserId: r.actor_user_id,
        actorName: r.actor_name,
        action: r.action,
        entityType: r.entity_type,
        entityId: r.entity_id,
        branchId: r.branch_id,
        before: r.before,
        after: r.after,
        meta: r.meta,
        ip: r.ip,
        requestId: r.request_id,
      })),
      Number(total?.n ?? 0),
      page,
    );
  }
}
