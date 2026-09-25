import { Injectable } from '@nestjs/common';
import { Selectable } from 'kysely';
import { Database } from '../../../shared/infrastructure/database/database';
import { newId } from '../../../shared/kernel/ids';
import { Currency, Money } from '../../../shared/kernel/money';
import { offsetOf, Page, pageOf, PageRequest } from '../../../shared/kernel/pagination';
import { PromoCodeDefinition, PromoCodeState, PromoKind, PromoUsageCounts, PromoUsageStatus } from '../domain/promo-code';
import { OrderingTables, PromoCodesTable } from './ordering.tables';

function mapPromo(row: Selectable<PromoCodesTable>): PromoCodeState {
  return {
    id: row.id,
    code: row.code,
    description: row.description,
    kind: row.kind as PromoKind,
    percentBp: row.percent_bp,
    fixedAmount: row.fixed_amount === null ? null : Money.of(row.fixed_amount, row.fixed_currency as Currency),
    minSubtotal: row.min_subtotal_amount === null ? null : Money.of(row.min_subtotal_amount, row.min_subtotal_currency as Currency),
    validFrom: row.valid_from,
    validTo: row.valid_to,
    totalLimit: row.total_limit,
    perPhoneLimit: row.per_phone_limit,
    branchId: row.branch_id,
    isActive: row.is_active,
  };
}

function toRow(def: PromoCodeDefinition) {
  return {
    code: def.code,
    description: def.description,
    kind: def.kind,
    percent_bp: def.percentBp,
    fixed_amount: def.fixedAmount?.amount ?? null,
    fixed_currency: def.fixedAmount?.currency ?? 'KZT',
    min_subtotal_amount: def.minSubtotal?.amount ?? null,
    min_subtotal_currency: def.minSubtotal?.currency ?? 'KZT',
    valid_from: def.validFrom,
    valid_to: def.validTo,
    total_limit: def.totalLimit,
    per_phone_limit: def.perPhoneLimit,
    branch_id: def.branchId,
    is_active: def.isActive,
  };
}

export interface PromoListFilter {
  /** Филиалы, промокоды которых видны ('all' — все); глобальные промокоды видны всегда. */
  branches: 'all' | string[];
  branchId?: string | null;
  /** network — только сетевые промокоды, branch — только промокоды филиалов. */
  scope?: 'network' | 'branch';
  q?: string;
  active?: boolean;
}

export interface PromoUsageStats {
  reserved: number;
  used: number;
  released: number;
}

/** Промокоды и их использования. */
@Injectable()
export class PromoCodeRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<OrderingTables>();
  }

  async findById(id: string): Promise<PromoCodeState | null> {
    const row = await this.db().selectFrom('ordering.promo_codes').selectAll().where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
    return row ? mapPromo(row) : null;
  }

  /** Поиск по коду; forUpdate — блокировка строки на время оформления (лимиты использований). */
  async findByCode(code: string, options: { forUpdate?: boolean } = {}): Promise<PromoCodeState | null> {
    let q = this.db().selectFrom('ordering.promo_codes').selectAll().where('code', '=', code).where('deleted_at', 'is', null);
    if (options.forUpdate) q = q.forUpdate();
    const row = await q.executeTakeFirst();
    return row ? mapPromo(row) : null;
  }

  async list(filter: PromoListFilter, page: PageRequest): Promise<Page<PromoCodeState>> {
    let q = this.db().selectFrom('ordering.promo_codes').where('deleted_at', 'is', null);
    if (filter.branches !== 'all') {
      const branches = filter.branches;
      q = q.where((eb) => (branches.length > 0 ? eb.or([eb('branch_id', 'is', null), eb('branch_id', 'in', branches)]) : eb('branch_id', 'is', null)));
    }
    if (filter.branchId !== undefined) {
      q = filter.branchId === null ? q.where('branch_id', 'is', null) : q.where('branch_id', '=', filter.branchId);
    }
    if (filter.scope === 'network') q = q.where('branch_id', 'is', null);
    if (filter.scope === 'branch') q = q.where('branch_id', 'is not', null);
    if (filter.active !== undefined) q = q.where('is_active', '=', filter.active);
    const text = filter.q?.trim().toUpperCase();
    if (text) q = q.where('code', 'like', `%${text.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
    const total = await q.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst();
    const rows = await q.selectAll().orderBy('created_at', 'desc').limit(page.perPage).offset(offsetOf(page)).execute();
    return pageOf(rows.map(mapPromo), Number(total?.n ?? 0), page);
  }

  async insert(id: string, def: PromoCodeDefinition): Promise<void> {
    await this.db()
      .insertInto('ordering.promo_codes')
      .values({ id, deleted_at: null, ...toRow(def) })
      .execute();
  }

  async update(id: string, def: PromoCodeDefinition): Promise<void> {
    await this.db().updateTable('ordering.promo_codes').set(toRow(def)).where('id', '=', id).execute();
  }

  async softDelete(id: string, at: Date): Promise<void> {
    await this.db().updateTable('ordering.promo_codes').set({ deleted_at: at, is_active: false }).where('id', '=', id).execute();
  }

  /** Использования (reserved + used) — всего и по телефону. */
  async usageCounts(promoCodeId: string, phone: string | null): Promise<PromoUsageCounts> {
    const rows = await this.db()
      .selectFrom('ordering.promo_code_usages')
      .select(['phone'])
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('promo_code_id', '=', promoCodeId)
      .where('status', '!=', PromoUsageStatus.Released)
      .groupBy('phone')
      .execute();
    const total = rows.reduce((sum, r) => sum + Number(r.n), 0);
    const byPhone = phone === null ? null : Number(rows.find((r) => r.phone === phone)?.n ?? 0);
    return { total, byPhone };
  }

  async usageStats(promoCodeIds: string[]): Promise<Map<string, PromoUsageStats>> {
    const result = new Map<string, PromoUsageStats>();
    if (promoCodeIds.length === 0) return result;
    const rows = await this.db()
      .selectFrom('ordering.promo_code_usages')
      .select(['promo_code_id', 'status'])
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('promo_code_id', 'in', promoCodeIds)
      .groupBy(['promo_code_id', 'status'])
      .execute();
    for (const id of promoCodeIds) result.set(id, { reserved: 0, used: 0, released: 0 });
    for (const r of rows) {
      const stats = result.get(r.promo_code_id)!;
      stats[r.status as keyof PromoUsageStats] = Number(r.n);
    }
    return result;
  }

  async reserve(input: { promoCodeId: string; orderId: string; phone: string; discount: Money }): Promise<void> {
    await this.db()
      .insertInto('ordering.promo_code_usages')
      .values({
        id: newId(),
        promo_code_id: input.promoCodeId,
        order_id: input.orderId,
        phone: input.phone,
        status: PromoUsageStatus.Reserved,
        discount_amount: input.discount.amount,
        discount_currency: input.discount.currency,
      })
      .execute();
  }

  /** Перевести использование заказа: reserved -> used (оплата) или reserved -> released (отмена до оплаты). */
  async setUsageStatus(orderId: string, from: PromoUsageStatus, to: PromoUsageStatus): Promise<boolean> {
    const res = await this.db()
      .updateTable('ordering.promo_code_usages')
      .set({ status: to })
      .where('order_id', '=', orderId)
      .where('status', '=', from)
      .executeTakeFirst();
    return Number(res.numUpdatedRows) > 0;
  }

  async usageStatusForOrder(orderId: string): Promise<PromoUsageStatus | null> {
    const row = await this.db().selectFrom('ordering.promo_code_usages').select('status').where('order_id', '=', orderId).executeTakeFirst();
    return (row?.status as PromoUsageStatus | undefined) ?? null;
  }
}
