import { Injectable } from '@nestjs/common';
import { Selectable } from 'kysely';
import { Database } from '../../../shared/infrastructure/database/database';
import { Currency, Money } from '../../../shared/kernel/money';
import { CourierDispatchStatus } from '../domain/courier-dispatch';
import { CourierDispatchesTable, OrderingTables } from './ordering.tables';

/** Заявка на курьера внешней службы. */
export interface CourierDispatchRecord {
  id: string;
  orderId: string;
  branchId: string;
  provider: string;
  status: CourierDispatchStatus;
  providerStatus: string | null;
  externalId: string | null;
  trackingUrl: string | null;
  courierName: string | null;
  courierPhone: string | null;
  price: Money | null;
  attempts: number;
  polls: number;
  lastError: string | null;
  requestedAt: Date;
  finishedAt: Date | null;
  updatedAt: Date;
}

function mapDispatch(row: Selectable<CourierDispatchesTable>): CourierDispatchRecord {
  return {
    id: row.id,
    orderId: row.order_id,
    branchId: row.branch_id,
    provider: row.provider,
    status: row.status as CourierDispatchStatus,
    providerStatus: row.provider_status,
    externalId: row.external_id,
    trackingUrl: row.tracking_url,
    courierName: row.courier_name,
    courierPhone: row.courier_phone,
    price: row.price_amount === null ? null : Money.of(row.price_amount, row.price_currency as Currency),
    attempts: row.attempts,
    polls: row.polls,
    lastError: row.last_error,
    requestedAt: row.requested_at,
    finishedAt: row.finished_at,
    updatedAt: row.updated_at,
  };
}

export type CourierDispatchPatch = Partial<
  Pick<
    CourierDispatchRecord,
    'status' | 'providerStatus' | 'externalId' | 'trackingUrl' | 'courierName' | 'courierPhone' | 'price' | 'attempts' | 'polls' | 'lastError' | 'finishedAt'
  >
>;

@Injectable()
export class CourierDispatchRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<OrderingTables>();
  }

  async insert(input: { id: string; orderId: string; branchId: string; provider: string; requestedAt: Date }): Promise<void> {
    await this.db()
      .insertInto('ordering.courier_dispatches')
      .values({
        id: input.id,
        order_id: input.orderId,
        branch_id: input.branchId,
        provider: input.provider,
        status: CourierDispatchStatus.Requested,
        provider_status: null,
        external_id: null,
        tracking_url: null,
        courier_name: null,
        courier_phone: null,
        price_amount: null,
        price_currency: 'KZT',
        attempts: 0,
        polls: 0,
        last_error: null,
        requested_at: input.requestedAt,
        finished_at: null,
      })
      .execute();
  }

  async findById(id: string, options: { forUpdate?: boolean } = {}): Promise<CourierDispatchRecord | null> {
    let q = this.db().selectFrom('ordering.courier_dispatches').selectAll().where('id', '=', id);
    if (options.forUpdate) q = q.forUpdate();
    const row = await q.executeTakeFirst();
    return row ? mapDispatch(row) : null;
  }

  /** Последняя заявка заказа. */
  async latestForOrder(orderId: string): Promise<CourierDispatchRecord | null> {
    const row = await this.db()
      .selectFrom('ordering.courier_dispatches')
      .selectAll()
      .where('order_id', '=', orderId)
      .orderBy('requested_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    return row ? mapDispatch(row) : null;
  }

  async patch(id: string, patch: CourierDispatchPatch): Promise<void> {
    const set: Record<string, unknown> = {};
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.providerStatus !== undefined) set.provider_status = patch.providerStatus;
    if (patch.externalId !== undefined) set.external_id = patch.externalId;
    if (patch.trackingUrl !== undefined) set.tracking_url = patch.trackingUrl;
    if (patch.courierName !== undefined) set.courier_name = patch.courierName;
    if (patch.courierPhone !== undefined) set.courier_phone = patch.courierPhone;
    if (patch.price !== undefined) {
      set.price_amount = patch.price?.amount ?? null;
      set.price_currency = patch.price?.currency ?? 'KZT';
    }
    if (patch.attempts !== undefined) set.attempts = patch.attempts;
    if (patch.polls !== undefined) set.polls = patch.polls;
    if (patch.lastError !== undefined) set.last_error = patch.lastError;
    if (patch.finishedAt !== undefined) set.finished_at = patch.finishedAt;
    if (Object.keys(set).length === 0) return;
    await this.db().updateTable('ordering.courier_dispatches').set(set).where('id', '=', id).execute();
  }
}
