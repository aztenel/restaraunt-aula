import { Injectable } from '@nestjs/common';
import { Actor } from '../../../shared/kernel/actor';
import { Page, pageOf, PageRequest } from '../../../shared/kernel/pagination';
import { Permission } from '../../../shared/kernel/permissions';
import { Translatable } from '../../../shared/kernel/translatable';
import { MenuQuery, StopListControl } from '../../catalog/public';
import { BranchDirectory } from '../../identity/public';
import { rankCandidates, searchKeywords } from '../domain/name-matching';
import { OrderExportStatus } from '../domain/order-export';
import { PosCapabilities, PosProductKind } from '../domain/pos-client';
import { assertProviderName } from '../domain/product-mapping';
import { DEFAULT_POS_PROVIDER, PosRouting, providerForBranch } from '../domain/routing';
import { ExportCounts, OrderExportRecord, OrderExportRepository } from '../infrastructure/order-export.repository';
import { PosProductRecord, PosProductRepository } from '../infrastructure/pos-product.repository';
import { ProductMappingRepository } from '../infrastructure/product-mapping.repository';
import { SyncStateRepository } from '../infrastructure/sync-state.repository';
import { ProductMappingView } from './mapping.actions';
import { scopePosBranches } from './pos-access';
import { PosClientRegistry } from './pos-client.registry';

/** Запросы раздела POS админки (только чтение). */

export interface PosBranchStatus {
  branchId: string;
  branchCode: string;
  branchName: Translatable;
  isActive: boolean;
  provider: string;
  /** Для провайдера есть адаптер. */
  providerKnown: boolean;
  /** Интеграция настроена для филиала (ключи, организация). */
  configured: boolean;
  capabilities: PosCapabilities;
  /** Ошибка настройки маршрутизации (pos.routing), если есть. */
  routingError: string | null;
  stopList: {
    syncedAt: Date | null;
    attemptedAt: Date | null;
    failures: number;
    error: string | null;
    lastChanges: number;
  };
  products: {
    requestedAt: Date | null;
    importedAt: Date | null;
    count: number;
    error: string | null;
  };
  mappingsCount: number;
  exports: ExportCounts;
}

const NO_CAPABILITIES: PosCapabilities = { pushOrders: false, stopList: false, nomenclature: false };

@Injectable()
export class PosStatusQuery {
  constructor(
    private readonly branches: BranchDirectory,
    private readonly registry: PosClientRegistry,
    private readonly state: SyncStateRepository,
    private readonly exports: OrderExportRepository,
    private readonly mappings: ProductMappingRepository,
    private readonly products: PosProductRepository,
  ) {}

  async execute(actor: Actor, branchId?: string | null): Promise<PosBranchStatus[]> {
    const scope = scopePosBranches(actor, branchId);
    if (branchId) await this.branches.get(branchId);
    const branches = (await this.branches.list()).filter((b) => scope === 'all' || scope.includes(b.id));
    const ids = branches.map((b) => b.id);

    let routing: PosRouting | null = null;
    let routingError: string | null = null;
    try {
      routing = await this.registry.routing();
    } catch (err) {
      routingError = err instanceof Error ? err.message : String(err);
    }
    const [states, exportCounts, mappingCounts, productCounts] = await Promise.all([
      this.state.getMany(ids),
      this.exports.countsByBranch(ids),
      this.mappings.countsByBranch(ids),
      this.products.countsByBranch(ids),
    ]);

    const result: PosBranchStatus[] = [];
    for (const branch of branches) {
      const provider = routing ? providerForBranch(routing, branch.id) : DEFAULT_POS_PROVIDER;
      const client = this.registry.find(provider);
      const s = states.get(branch.id)!;
      result.push({
        branchId: branch.id,
        branchCode: branch.code,
        branchName: branch.name,
        isActive: branch.isActive,
        provider,
        providerKnown: !!client,
        configured: routingError === null && !!client && (await client.isConfigured({ branchId: branch.id })),
        capabilities: client ? { ...client.capabilities } : NO_CAPABILITIES,
        routingError,
        stopList: {
          syncedAt: s.stopListSyncedAt,
          attemptedAt: s.stopListAttemptedAt,
          failures: s.stopListFailures,
          error: s.stopListError,
          lastChanges: s.stopListChanges,
        },
        products: {
          requestedAt: s.productsRequestedAt,
          importedAt: s.productsImportedAt,
          count: productCounts.get(`${branch.id}|${provider}`) ?? 0,
          error: s.productsError,
        },
        mappingsCount: mappingCounts.get(`${branch.id}|${provider}`) ?? 0,
        exports: exportCounts.get(branch.id) ?? { pending: 0, sent: 0, failed: 0, skipped: 0 },
      });
    }
    return result;
  }
}

@Injectable()
export class OrderExportsQuery {
  constructor(private readonly exports: OrderExportRepository) {}

  async execute(
    actor: Actor,
    filter: { branchId?: string | null; status?: OrderExportStatus; orderId?: string },
    page: PageRequest,
  ): Promise<Page<OrderExportRecord>> {
    const branchIds = scopePosBranches(actor, filter.branchId);
    return this.exports.list({ branchIds, status: filter.status, orderId: filter.orderId }, page);
  }
}

/** Провайдер для экранов сопоставления: явно указанный или POS филиала по маршрутизации. */
async function viewProvider(registry: PosClientRegistry, branchId: string, requested?: string | null): Promise<string> {
  return requested ? assertProviderName(requested) : registry.providerFor(branchId);
}

@Injectable()
export class ProductMappingsQuery {
  constructor(
    private readonly mappings: ProductMappingRepository,
    private readonly menu: MenuQuery,
  ) {}

  async execute(
    actor: Actor,
    filter: { branchId?: string | null; provider?: string; dishId?: string; externalProductId?: string },
    page: PageRequest,
  ): Promise<Page<ProductMappingView>> {
    const branchIds = actor.scopeBranches(Permission.IntegrationsManage, filter.branchId);
    const result = await this.mappings.list({ ...filter, branchIds }, page);
    const byBranch = new Map<string, string[]>();
    for (const m of result.items) byBranch.set(m.branchId, [...(byBranch.get(m.branchId) ?? []), m.dishId]);
    const names = new Map<string, Translatable>();
    for (const [branchId, dishIds] of byBranch) {
      for (const d of await this.menu.getDishes(branchId, [...new Set(dishIds)])) names.set(`${branchId}|${d.dishId}`, d.name);
    }
    return pageOf(
      result.items.map((m) => ({ ...m, dishName: names.get(`${m.branchId}|${m.dishId}`) ?? null })),
      result.total,
      page,
    );
  }
}

export interface PosProductView extends PosProductRecord {
  /** Блюда витрины, сопоставленные с товаром. */
  mappedDishIds: string[];
}

@Injectable()
export class PosProductsQuery {
  constructor(
    private readonly products: PosProductRepository,
    private readonly mappings: ProductMappingRepository,
    private readonly registry: PosClientRegistry,
  ) {}

  async execute(
    actor: Actor,
    filter: { branchId: string; provider?: string; q?: string; kind?: PosProductKind; unmappedOnly?: boolean; includeRemoved?: boolean },
    page: PageRequest,
  ): Promise<{ provider: string } & Page<PosProductView>> {
    actor.assertCan(Permission.IntegrationsManage, filter.branchId);
    const provider = await viewProvider(this.registry, filter.branchId, filter.provider);
    const result = await this.products.list({ ...filter, provider }, page);
    const mapped = await this.mappings.dishesByExternal(
      filter.branchId,
      provider,
      result.items.map((p) => p.externalProductId),
    );
    return {
      provider,
      ...pageOf(
        result.items.map((p) => ({ ...p, mappedDishIds: mapped.get(p.externalProductId) ?? [] })),
        result.total,
        page,
      ),
    };
  }
}

export interface MappingSuggestionCandidate {
  dishId: string;
  dishName: Translatable | null;
  score: number;
  /** sku — совпал код товара POS с кодом блюда в каталоге; name — похожее название. */
  method: 'sku' | 'name';
}

export interface MappingSuggestion {
  product: PosProductRecord;
  candidates: MappingSuggestionCandidate[];
}

/** Кандидатов в меню на один запрос поиска. */
const SEARCH_LIMIT = 10;
const CANDIDATES_PER_PRODUCT = 3;

/**
 * Автоподбор сопоставлений для несопоставленных товаров POS: сначала совпадение кода (sku) с кодом блюда
 * в каталоге филиала, затем похожие названия (нормализация, сравнение слов). Уже сопоставленные блюда
 * не предлагаются. Модификаторы POS не предлагаются (сопоставляются в карточке блюда).
 */
@Injectable()
export class MappingSuggestionsQuery {
  constructor(
    private readonly products: PosProductRepository,
    private readonly mappings: ProductMappingRepository,
    private readonly registry: PosClientRegistry,
    private readonly menu: MenuQuery,
    private readonly stopList: StopListControl,
  ) {}

  async execute(actor: Actor, input: { branchId: string; provider?: string }, page: PageRequest): Promise<{ provider: string } & Page<MappingSuggestion>> {
    actor.assertCan(Permission.IntegrationsManage, input.branchId);
    const provider = await viewProvider(this.registry, input.branchId, input.provider);
    const unmapped = await this.products.list(
      { branchId: input.branchId, provider, unmappedOnly: true, excludeKinds: ['modifier'] },
      page,
    );
    const mappedDishes = await this.mappings.mappedDishIds(input.branchId, provider);
    const names = new Map<string, Translatable>();
    const items: MappingSuggestion[] = [];

    for (const product of unmapped.items) {
      const candidates: MappingSuggestionCandidate[] = [];
      if (product.sku) {
        const dishId = await this.stopList.findDishIdBySkuInBranch(input.branchId, product.sku);
        if (dishId && !mappedDishes.has(dishId)) candidates.push({ dishId, dishName: null, score: 1, method: 'sku' });
      }
      const queries = [...new Set([product.name, ...searchKeywords(product.name)].filter((q) => q.trim().length >= 2))];
      const found = new Map<string, string[]>();
      for (const q of queries) {
        for (const dish of await this.menu.searchBranchDishes(input.branchId, q, SEARCH_LIMIT)) {
          if (mappedDishes.has(dish.dishId)) continue;
          names.set(dish.dishId, dish.name);
          found.set(dish.dishId, Object.values(dish.name).filter((n): n is string => typeof n === 'string'));
        }
      }
      const ranked = rankCandidates(
        product.name,
        [...found.entries()].map(([dishId, dishNames]) => ({ dishId, names: dishNames })),
        { limit: CANDIDATES_PER_PRODUCT },
      );
      for (const r of ranked) {
        if (!candidates.some((c) => c.dishId === r.dishId)) candidates.push({ dishId: r.dishId, dishName: null, score: r.score, method: 'name' });
      }
      items.push({ product, candidates: candidates.slice(0, CANDIDATES_PER_PRODUCT) });
    }

    const missingNames = [...new Set(items.flatMap((i) => i.candidates.map((c) => c.dishId)).filter((id) => !names.has(id)))];
    if (missingNames.length > 0) {
      for (const d of await this.menu.getDishes(input.branchId, missingNames)) names.set(d.dishId, d.name);
    }
    for (const item of items) {
      // Блюдо с тем же кодом, но не из меню этого филиала, не предлагаем.
      item.candidates = item.candidates.filter((c) => names.has(c.dishId)).map((c) => ({ ...c, dishName: names.get(c.dishId) ?? null }));
    }
    return { provider, ...pageOf(items, unmapped.total, page) };
  }
}
