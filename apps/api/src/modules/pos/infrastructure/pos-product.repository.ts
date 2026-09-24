import { Injectable } from '@nestjs/common';
import { Selectable, sql } from 'kysely';
import { Database } from '../../../shared/infrastructure/database/database';
import { newId } from '../../../shared/kernel/ids';
import { offsetOf, Page, pageOf, PageRequest } from '../../../shared/kernel/pagination';
import { normalizeProductName } from '../domain/name-matching';
import { PosProduct, PosProductKind } from '../domain/pos-client';
import { PosTables, ProductsTable } from './pos.tables';

export interface PosProductRecord extends PosProduct {
  id: string;
  branchId: string;
  provider: string;
  importedAt: Date;
  removedAt: Date | null;
}

export interface PosProductFilter {
  branchId: string;
  provider: string;
  q?: string;
  kind?: PosProductKind;
  excludeKinds?: PosProductKind[];
  /** Только товары без сопоставления с блюдом. */
  unmappedOnly?: boolean;
  includeRemoved?: boolean;
}

const BATCH = 500;

function toRecord(row: Selectable<ProductsTable>): PosProductRecord {
  return {
    id: row.id,
    branchId: row.branch_id,
    provider: row.provider,
    externalProductId: row.external_product_id,
    name: row.name,
    sku: row.sku,
    kind: row.kind as PosProductKind,
    groupName: row.group_name,
    importedAt: row.imported_at,
    removedAt: row.removed_at,
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

@Injectable()
export class PosProductRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<PosTables>();
  }

  /**
   * Заменить номенклатуру филиала результатом импорта: новые — добавить, существующие — обновить,
   * пропавшие из POS — пометить удалёнными (сопоставления с ними остаются, админка их подсвечивает).
   */
  async replaceAll(branchId: string, provider: string, products: PosProduct[], now: Date): Promise<number> {
    const unique = [...new Map(products.map((p) => [p.externalProductId, p])).values()];
    for (let i = 0; i < unique.length; i += BATCH) {
      const chunk = unique.slice(i, i + BATCH);
      await this.db()
        .insertInto('pos.products')
        .values(
          chunk.map((p) => ({
            id: newId(),
            branch_id: branchId,
            provider,
            external_product_id: p.externalProductId,
            name: p.name,
            name_normalized: normalizeProductName(p.name),
            sku: p.sku,
            kind: p.kind,
            group_name: p.groupName,
            imported_at: now,
            removed_at: null,
          })),
        )
        .onConflict((oc) =>
          oc.columns(['branch_id', 'provider', 'external_product_id']).doUpdateSet((eb) => ({
            name: eb.ref('excluded.name'),
            name_normalized: eb.ref('excluded.name_normalized'),
            sku: eb.ref('excluded.sku'),
            kind: eb.ref('excluded.kind'),
            group_name: eb.ref('excluded.group_name'),
            imported_at: eb.ref('excluded.imported_at'),
            removed_at: null,
          })),
        )
        .execute();
    }
    const present = unique.map((p) => p.externalProductId);
    await this.db()
      .updateTable('pos.products')
      .set({ removed_at: now })
      .where('branch_id', '=', branchId)
      .where('provider', '=', provider)
      .where('removed_at', 'is', null)
      .where(sql<boolean>`not (external_product_id = any(${present}::text[]))`)
      .execute();
    return unique.length;
  }

  async findByExternalIds(branchId: string, provider: string, externalIds: string[]): Promise<Map<string, PosProductRecord>> {
    const result = new Map<string, PosProductRecord>();
    if (externalIds.length === 0) return result;
    const rows = await this.db()
      .selectFrom('pos.products')
      .selectAll()
      .where('branch_id', '=', branchId)
      .where('provider', '=', provider)
      .where('external_product_id', 'in', [...new Set(externalIds)])
      .execute();
    for (const r of rows) result.set(r.external_product_id, toRecord(r));
    return result;
  }

  async list(filter: PosProductFilter, page: PageRequest): Promise<Page<PosProductRecord>> {
    let q = this.db()
      .selectFrom('pos.products as p')
      .where('p.branch_id', '=', filter.branchId)
      .where('p.provider', '=', filter.provider);
    if (!filter.includeRemoved) q = q.where('p.removed_at', 'is', null);
    if (filter.kind) q = q.where('p.kind', '=', filter.kind);
    if (filter.excludeKinds && filter.excludeKinds.length > 0) q = q.where('p.kind', 'not in', filter.excludeKinds);
    if (filter.q) {
      const needle = normalizeProductName(filter.q);
      const raw = `%${escapeLike(filter.q.trim().toLowerCase())}%`;
      q = q.where((eb) =>
        eb.or([
          eb('p.name_normalized', 'like', `%${escapeLike(needle)}%`),
          eb(sql<string>`lower(coalesce(p.sku, ''))`, 'like', raw),
          eb(sql<string>`lower(p.external_product_id)`, 'like', raw),
        ]),
      );
    }
    if (filter.unmappedOnly) {
      q = q.where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom('pos.product_mappings as m')
              .select('m.id')
              .whereRef('m.branch_id', '=', 'p.branch_id')
              .whereRef('m.provider', '=', 'p.provider')
              .whereRef('m.external_product_id', '=', 'p.external_product_id')
              .where('m.deleted_at', 'is', null),
          ),
        ),
      );
    }
    const total = await q.select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirst();
    const rows = await q.selectAll('p').orderBy('p.name_normalized').orderBy('p.id').limit(page.perPage).offset(offsetOf(page)).execute();
    return pageOf(rows.map(toRecord), Number(total?.n ?? 0), page);
  }

  async countsByBranch(branchIds: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (branchIds.length === 0) return result;
    const rows = await this.db()
      .selectFrom('pos.products')
      .select(['branch_id', 'provider', (eb) => eb.fn.countAll<string>().as('n')])
      .where('branch_id', 'in', branchIds)
      .where('removed_at', 'is', null)
      .groupBy(['branch_id', 'provider'])
      .execute();
    for (const r of rows) result.set(`${r.branch_id}|${r.provider}`, Number(r.n));
    return result;
  }
}
