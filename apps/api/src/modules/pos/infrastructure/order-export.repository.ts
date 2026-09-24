import { Injectable } from '@nestjs/common';
import { Selectable } from 'kysely';
import { Database } from '../../../shared/infrastructure/database/database';
import { offsetOf, Page, pageOf, PageRequest } from '../../../shared/kernel/pagination';
import { OrderExport, OrderExportDetails, OrderExportState, OrderExportStatus, SkipReason } from '../domain/order-export';
import { PosFailureReason } from '../public';
import { OrderExportsTable, PosTables } from './pos.tables';

function toState(row: Selectable<OrderExportsTable>): OrderExportState {
  return {
    id: row.id,
    orderId: row.order_id,
    orderNumber: row.order_number,
    branchId: row.branch_id,
    provider: row.provider,
    status: row.status as OrderExportStatus,
    posOrderId: row.pos_order_id,
    attempts: row.attempts,
    manualRetries: row.manual_retries,
    lastError: row.last_error,
    failureReason: row.failure_reason as PosFailureReason | null,
    skipReason: row.skip_reason as SkipReason | null,
    details: (row.details as OrderExportDetails | null) ?? {},
    lastAttemptAt: row.last_attempt_at,
    sentAt: row.sent_at,
    failedAt: row.failed_at,
    createdAt: row.created_at,
  };
}

function toRow(s: OrderExportState) {
  return {
    order_number: s.orderNumber,
    branch_id: s.branchId,
    provider: s.provider,
    status: s.status,
    pos_order_id: s.posOrderId,
    attempts: s.attempts,
    manual_retries: s.manualRetries,
    last_error: s.lastError,
    failure_reason: s.failureReason,
    skip_reason: s.skipReason,
    details: JSON.stringify(s.details ?? {}),
    last_attempt_at: s.lastAttemptAt,
    sent_at: s.sentAt,
    failed_at: s.failedAt,
  };
}

export interface OrderExportFilter {
  branchIds: 'all' | string[];
  status?: OrderExportStatus;
  orderId?: string;
}

export interface OrderExportRecord extends OrderExportState {
  updatedAt: Date;
}

export type ExportCounts = Record<OrderExportStatus, number>;

@Injectable()
export class OrderExportRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<PosTables>();
  }

  async findById(id: string): Promise<OrderExport | null> {
    const row = await this.db().selectFrom('pos.order_exports').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? OrderExport.restore(toState(row)) : null;
  }

  async findByOrderId(orderId: string, options: { forUpdate?: boolean } = {}): Promise<OrderExport | null> {
    let q = this.db().selectFrom('pos.order_exports').selectAll().where('order_id', '=', orderId);
    if (options.forUpdate) q = q.forUpdate();
    const row = await q.executeTakeFirst();
    return row ? OrderExport.restore(toState(row)) : null;
  }

  /** Вставка, если записи по заказу ещё нет. true — вставлено. */
  async insertIfAbsent(exp: OrderExport): Promise<boolean> {
    const s = exp.snapshot();
    const inserted = await this.db()
      .insertInto('pos.order_exports')
      .values({ id: s.id, order_id: s.orderId, created_at: s.createdAt, ...toRow(s) })
      .onConflict((oc) => oc.column('order_id').doNothing())
      .returning('id')
      .executeTakeFirst();
    return !!inserted;
  }

  async save(exp: OrderExport): Promise<void> {
    const s = exp.snapshot();
    await this.db().updateTable('pos.order_exports').set(toRow(s)).where('id', '=', s.id).execute();
  }

  async getRecord(id: string): Promise<OrderExportRecord | null> {
    const row = await this.db().selectFrom('pos.order_exports').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? { ...toState(row), updatedAt: row.updated_at } : null;
  }

  async list(filter: OrderExportFilter, page: PageRequest): Promise<Page<OrderExportRecord>> {
    if (filter.branchIds !== 'all' && filter.branchIds.length === 0) return pageOf([], 0, page);
    let q = this.db().selectFrom('pos.order_exports');
    if (filter.branchIds !== 'all') q = q.where('branch_id', 'in', filter.branchIds);
    if (filter.status) q = q.where('status', '=', filter.status);
    if (filter.orderId) q = q.where('order_id', '=', filter.orderId);
    const total = await q.select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirst();
    const rows = await q
      .selectAll()
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(page.perPage)
      .offset(offsetOf(page))
      .execute();
    return pageOf(
      rows.map((r) => ({ ...toState(r), updatedAt: r.updated_at })),
      Number(total?.n ?? 0),
      page,
    );
  }

  /** Число записей по статусам в разрезе филиалов. */
  async countsByBranch(branchIds: string[]): Promise<Map<string, ExportCounts>> {
    const result = new Map<string, ExportCounts>();
    if (branchIds.length === 0) return result;
    const rows = await this.db()
      .selectFrom('pos.order_exports')
      .select(['branch_id', 'status', (eb) => eb.fn.countAll<string>().as('n')])
      .where('branch_id', 'in', branchIds)
      .groupBy(['branch_id', 'status'])
      .execute();
    for (const row of rows) {
      const counts = result.get(row.branch_id) ?? { pending: 0, sent: 0, failed: 0, skipped: 0 };
      counts[row.status as OrderExportStatus] = Number(row.n);
      result.set(row.branch_id, counts);
    }
    return result;
  }
}
