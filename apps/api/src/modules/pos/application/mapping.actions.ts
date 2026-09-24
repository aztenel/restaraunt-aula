import { Injectable } from '@nestjs/common';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { Database } from '../../../shared/infrastructure/database/database';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/kernel/errors';
import { newId } from '../../../shared/kernel/ids';
import { Permission } from '../../../shared/kernel/permissions';
import { Translatable } from '../../../shared/kernel/translatable';
import { MenuQuery } from '../../catalog/public';
import { BranchDirectory } from '../../identity/public';
import { assertProviderName, MappingInput, normalizeMapping, NormalizedMapping } from '../domain/product-mapping';
import { PosProductRepository } from '../infrastructure/pos-product.repository';
import { ProductMappingRecord, ProductMappingRepository } from '../infrastructure/product-mapping.repository';
import { StopListSnapshotRepository } from '../infrastructure/stop-list-snapshot.repository';
import { PosClientRegistry } from './pos-client.registry';

export interface ProductMappingView extends ProductMappingRecord {
  /** Название блюда из меню филиала (null — блюда больше нет в меню). */
  dishName: Translatable | null;
}

export const BULK_MAPPINGS_MAX = 500;

/**
 * Провайдер сопоставления: указанный явно или POS филиала по маршрутизации.
 * Сопоставлять можно только с POS, у которой есть внешняя система (передача заказов/стоп-лист).
 */
async function mappingProvider(registry: PosClientRegistry, branchId: string, requested?: string | null): Promise<string> {
  const provider = requested ? assertProviderName(requested) : await registry.providerFor(branchId);
  const client = registry.get(provider);
  if (!client.capabilities.pushOrders && !client.capabilities.stopList) {
    throw new ValidationError('pos.mapping_not_supported', 'The POS of this branch has no external system to map dishes to', { provider, branchId });
  }
  return provider;
}

function auditView(m: { dishId: string; provider: string } & NormalizedMapping) {
  return {
    dishId: m.dishId,
    provider: m.provider,
    externalProductId: m.externalProductId,
    externalName: m.externalName,
    modifiers: m.modifiers,
  };
}

/** Название товара POS из импортированной номенклатуры, если сотрудник его не ввёл. */
async function withExternalName(products: PosProductRepository, branchId: string, provider: string, data: NormalizedMapping): Promise<NormalizedMapping> {
  if (data.externalName) return data;
  const found = await products.findByExternalIds(branchId, provider, [data.externalProductId]);
  return { ...data, externalName: found.get(data.externalProductId)?.name ?? null };
}

async function dishNames(menu: MenuQuery, branchId: string, dishIds: string[]): Promise<Map<string, Translatable>> {
  const dishes = await menu.getDishes(branchId, [...new Set(dishIds)]);
  return new Map(dishes.map((d) => [d.dishId, d.name]));
}

@Injectable()
export class CreateProductMapping {
  constructor(
    private readonly mappings: ProductMappingRepository,
    private readonly products: PosProductRepository,
    private readonly registry: PosClientRegistry,
    private readonly branches: BranchDirectory,
    private readonly menu: MenuQuery,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, input: MappingInput & { branchId: string; dishId: string; provider?: string | null }): Promise<ProductMappingView> {
    actor.assertCan(Permission.IntegrationsManage, input.branchId);
    await this.branches.get(input.branchId);
    const provider = await mappingProvider(this.registry, input.branchId, input.provider);
    const names = await dishNames(this.menu, input.branchId, [input.dishId]);
    if (!names.has(input.dishId)) {
      throw new ValidationError('pos.dish_not_in_branch_menu', 'Dish is not in the branch menu', { dishId: input.dishId, branchId: input.branchId });
    }
    const data = await withExternalName(this.products, input.branchId, provider, normalizeMapping(input));
    const id = newId();
    await this.database.transaction(async () => {
      await this.database.advisoryLock('pos.mapping', `${input.branchId}|${provider}|${input.dishId}`);
      if (await this.mappings.findActive(input.branchId, provider, input.dishId)) {
        throw new ConflictError('pos.mapping_exists', 'The dish is already mapped for this POS', { dishId: input.dishId, provider });
      }
      await this.mappings.insert({ id, branchId: input.branchId, dishId: input.dishId, provider, now: this.clock.now(), ...data });
      await this.audit.record({
        action: 'pos.mapping_created',
        entityType: 'pos_product_mapping',
        entityId: id,
        branchId: input.branchId,
        after: auditView({ dishId: input.dishId, provider, ...data }),
      });
    });
    return { ...(await this.mappings.findById(id))!, dishName: names.get(input.dishId) ?? null };
  }
}

@Injectable()
export class UpdateProductMapping {
  constructor(
    private readonly mappings: ProductMappingRepository,
    private readonly products: PosProductRepository,
    private readonly menu: MenuQuery,
    private readonly database: Database,
    private readonly audit: AuditLog,
  ) {}

  async execute(actor: Actor, id: string, input: MappingInput): Promise<ProductMappingView> {
    const current = await this.mappings.findById(id);
    if (!current) throw new NotFoundError('pos_product_mapping', id);
    actor.assertCan(Permission.IntegrationsManage, current.branchId);
    const data = await withExternalName(this.products, current.branchId, current.provider, normalizeMapping(input));
    await this.database.transaction(async () => {
      await this.mappings.update(id, data);
      await this.audit.record({
        action: 'pos.mapping_updated',
        entityType: 'pos_product_mapping',
        entityId: id,
        branchId: current.branchId,
        before: auditView(current),
        after: auditView({ dishId: current.dishId, provider: current.provider, ...data }),
      });
    });
    const names = await dishNames(this.menu, current.branchId, [current.dishId]);
    return { ...(await this.mappings.findById(id))!, dishName: names.get(current.dishId) ?? null };
  }
}

@Injectable()
export class DeleteProductMapping {
  constructor(
    private readonly mappings: ProductMappingRepository,
    private readonly snapshots: StopListSnapshotRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, id: string): Promise<void> {
    const current = await this.mappings.findById(id);
    if (!current) throw new NotFoundError('pos_product_mapping', id);
    actor.assertCan(Permission.IntegrationsManage, current.branchId);
    await this.database.transaction(async () => {
      await this.mappings.softDelete(id, this.clock.now());
      // Стоп-лист POS по блюду больше не отслеживается; текущая доступность на витрине не меняется.
      await this.snapshots.remove(current.branchId, [current.dishId]);
      await this.audit.record({
        action: 'pos.mapping_deleted',
        entityType: 'pos_product_mapping',
        entityId: id,
        branchId: current.branchId,
        before: auditView(current),
      });
    });
  }
}

export interface BulkMappingResult {
  created: number;
  updated: number;
  unchanged: number;
  items: ProductMappingView[];
}

/**
 * Массовое сохранение сопоставлений (принять подсказки автоподбора): новое — создать,
 * существующее с другим товаром — обновить (опции модификаторов сохраняются).
 */
@Injectable()
export class BulkUpsertProductMappings {
  constructor(
    private readonly mappings: ProductMappingRepository,
    private readonly products: PosProductRepository,
    private readonly registry: PosClientRegistry,
    private readonly branches: BranchDirectory,
    private readonly menu: MenuQuery,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(
    actor: Actor,
    input: { branchId: string; provider?: string | null; items: Array<{ dishId: string; externalProductId: string; externalName?: string | null }> },
  ): Promise<BulkMappingResult> {
    actor.assertCan(Permission.IntegrationsManage, input.branchId);
    if (input.items.length === 0 || input.items.length > BULK_MAPPINGS_MAX) {
      throw new ValidationError('pos.mapping_invalid', `From 1 to ${BULK_MAPPINGS_MAX} items`, { max: BULK_MAPPINGS_MAX });
    }
    const dishIds = input.items.map((i) => i.dishId);
    if (new Set(dishIds).size !== dishIds.length) throw new ValidationError('pos.mapping_duplicate_dish', 'A dish appears twice');
    await this.branches.get(input.branchId);
    const provider = await mappingProvider(this.registry, input.branchId, input.provider);
    const names = await dishNames(this.menu, input.branchId, dishIds);
    const notInMenu = dishIds.filter((id) => !names.has(id));
    if (notInMenu.length > 0) {
      throw new ValidationError('pos.dish_not_in_branch_menu', 'Some dishes are not in the branch menu', { dishIds: notInMenu });
    }
    const normalized = input.items.map((i) => ({ dishId: i.dishId, ...normalizeMapping({ externalProductId: i.externalProductId, externalName: i.externalName }) }));
    const known = await this.products.findByExternalIds(input.branchId, provider, normalized.map((n) => n.externalProductId));

    const result: BulkMappingResult = { created: 0, updated: 0, unchanged: 0, items: [] };
    const ids: string[] = [];
    await this.database.transaction(async () => {
      await this.database.advisoryLock('pos.mapping_bulk', `${input.branchId}|${provider}`);
      const before: unknown[] = [];
      const after: unknown[] = [];
      for (const item of normalized) {
        await this.database.advisoryLock('pos.mapping', `${input.branchId}|${provider}|${item.dishId}`);
        const externalName = item.externalName ?? known.get(item.externalProductId)?.name ?? null;
        const existing = await this.mappings.findActive(input.branchId, provider, item.dishId);
        if (!existing) {
          const id = newId();
          await this.mappings.insert({
            id,
            branchId: input.branchId,
            dishId: item.dishId,
            provider,
            externalProductId: item.externalProductId,
            externalName,
            modifiers: {},
            now: this.clock.now(),
          });
          ids.push(id);
          result.created += 1;
          after.push(auditView({ dishId: item.dishId, provider, externalProductId: item.externalProductId, externalName, modifiers: {} }));
          continue;
        }
        ids.push(existing.id);
        if (existing.externalProductId === item.externalProductId) {
          result.unchanged += 1;
          continue;
        }
        await this.mappings.update(existing.id, { externalProductId: item.externalProductId, externalName, modifiers: existing.modifiers });
        result.updated += 1;
        before.push(auditView(existing));
        after.push(auditView({ dishId: item.dishId, provider, externalProductId: item.externalProductId, externalName, modifiers: existing.modifiers }));
      }
      if (result.created + result.updated > 0) {
        await this.audit.record({
          action: 'pos.mappings_bulk_saved',
          entityType: 'pos_product_mapping',
          entityId: input.branchId,
          branchId: input.branchId,
          before,
          after,
          meta: { provider, created: result.created, updated: result.updated },
        });
      }
    });
    for (const id of ids) {
      const record = await this.mappings.findById(id);
      if (record) result.items.push({ ...record, dishName: names.get(record.dishId) ?? null });
    }
    return result;
  }
}
