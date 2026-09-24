import { Injectable } from '@nestjs/common';
import { Selectable, sql } from 'kysely';
import { Database } from '../../../shared/infrastructure/database/database';
import { offsetOf, PageRequest } from '../../../shared/kernel/pagination';
import { containsPattern, prefixTsQuery } from '../domain/search';
import { mapMenuItem, BranchMenuItemRecord } from './branch-menu.repository';
import { BranchMenuItemsTable, CatalogTables, DishesTable } from './catalog.tables';
import { DishRecord, mapDish } from './dish.repository';

/** Строка меню филиала: блюдо + позиция меню + категория (для витрины, поиска, MenuQuery). */
export interface MenuRow {
  dish: DishRecord;
  item: BranchMenuItemRecord;
  categorySlug: string;
  categorySortOrder: number;
  rank: number;
}

export interface MenuFilter {
  branchId: string;
  now: Date;
  /** Режим филиала 'hide': блюда в стоп-листе не показываются. */
  hideStopped: boolean;
  categoryId?: string | null;
  dishIds?: readonly string[] | null;
  dishSlug?: string | null;
  vegetarian?: boolean | null;
  /** true — только острые (1..3), false — только неострые. */
  spicy?: boolean | null;
  maxSpicyLevel?: number | null;
  halal?: boolean | null;
  /** Максимальная цена в филиале, тиыны. */
  maxPriceAmount?: number | null;
  /** Строка поиска (нормализованная). */
  q?: string | null;
}

/**
 * Чтение меню филиала для витрины и других модулей: только активные неудалённые блюда
 * активных категорий, для которых есть позиция в меню филиала. Поиск — полнотекстовый
 * (russian + simple, префиксы) и pg_trgm по названиям на всех языках.
 */
@Injectable()
export class MenuReadRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<CatalogTables>();
  }

  private base(filter: MenuFilter) {
    let q = this.db()
      .selectFrom('catalog.branch_menu_items as bmi')
      .innerJoin('catalog.dishes as d', 'd.id', 'bmi.dish_id')
      .innerJoin('catalog.categories as c', 'c.id', 'd.category_id')
      .where('bmi.branch_id', '=', filter.branchId)
      .where('bmi.deleted_at', 'is', null)
      .where('d.deleted_at', 'is', null)
      .where('d.is_active', '=', true)
      .where('c.deleted_at', 'is', null)
      .where('c.is_active', '=', true);
    if (filter.hideStopped) {
      const now = filter.now;
      q = q.where((eb) =>
        eb.or([
          eb('bmi.availability', '=', 'available'),
          eb.and([eb('bmi.stopped_until', 'is not', null), eb('bmi.stopped_until', '<=', now)]),
        ]),
      );
    }
    if (filter.categoryId) q = q.where('d.category_id', '=', filter.categoryId);
    if (filter.dishIds) q = q.where('d.id', 'in', filter.dishIds.length > 0 ? [...filter.dishIds] : ['00000000-0000-0000-0000-000000000000']);
    if (filter.dishSlug) q = q.where('d.slug', '=', filter.dishSlug);
    if (filter.vegetarian === true) q = q.where('d.is_vegetarian', '=', true);
    if (filter.halal === true) q = q.where('d.is_halal', '=', true);
    if (filter.spicy === true) q = q.where('d.spicy_level', '>=', 1);
    if (filter.spicy === false) q = q.where('d.spicy_level', '=', 0);
    if (filter.maxSpicyLevel !== null && filter.maxSpicyLevel !== undefined) q = q.where('d.spicy_level', '<=', filter.maxSpicyLevel);
    if (filter.maxPriceAmount !== null && filter.maxPriceAmount !== undefined) q = q.where('bmi.price_amount', '<=', filter.maxPriceAmount);
    if (filter.q) {
      const text = filter.q;
      const prefix = prefixTsQuery(text);
      const pattern = containsPattern(text);
      const lowered = text.toLowerCase();
      q = q.where((eb) =>
        eb.or([
          sql<boolean>`d.search_vector @@ websearch_to_tsquery('russian', ${text})`,
          sql<boolean>`d.search_vector @@ websearch_to_tsquery('simple', ${text})`,
          ...(prefix ? [sql<boolean>`d.search_vector @@ to_tsquery('simple', ${prefix})`] : []),
          eb('d.search_text', 'like', pattern),
          sql<boolean>`${lowered} <% d.search_text`,
        ]),
      );
    }
    return q;
  }

  async list(filter: MenuFilter, page?: PageRequest): Promise<{ rows: MenuRow[]; total: number }> {
    const q = this.base(filter);
    let total = 0;
    if (page) {
      const count = await q.select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirst();
      total = Number(count?.n ?? 0);
    }
    const rank = filter.q
      ? sql<number>`(ts_rank(d.search_vector, websearch_to_tsquery('russian', ${filter.q})) * 2
          + ts_rank(d.search_vector, websearch_to_tsquery('simple', ${filter.q}))
          + word_similarity(${filter.q.toLowerCase()}, d.search_text))`
      : sql<number>`0`;
    let select = q
      .selectAll('bmi')
      .select([
        'd.slug as d_slug',
        'd.category_id as d_category_id',
        'd.name as d_name',
        'd.description as d_description',
        'd.composition as d_composition',
        'd.seo_title as d_seo_title',
        'd.seo_description as d_seo_description',
        'd.weight_grams as d_weight_grams',
        'd.calories as d_calories',
        'd.is_vegetarian as d_is_vegetarian',
        'd.spicy_level as d_spicy_level',
        'd.is_halal as d_is_halal',
        'd.allergens as d_allergens',
        'd.sku as d_sku',
        'd.sort_order as d_sort_order',
        'd.is_active as d_is_active',
        'd.created_at as d_created_at',
        'd.updated_at as d_updated_at',
        'c.slug as c_slug',
        'c.sort_order as c_sort_order',
        rank.as('rank'),
      ]);
    select = filter.q
      ? select.orderBy('rank', 'desc').orderBy('c.sort_order').orderBy('d.sort_order').orderBy('d.created_at')
      : select.orderBy('c.sort_order').orderBy('c.created_at').orderBy('d.sort_order').orderBy('d.created_at');
    if (page) select = select.limit(page.perPage).offset(offsetOf(page));
    const rows = await select.execute();
    const mapped = rows.map((r) => {
      const dishRow = {
        id: r.dish_id,
        slug: r.d_slug,
        category_id: r.d_category_id,
        name: r.d_name,
        description: r.d_description,
        composition: r.d_composition,
        seo_title: r.d_seo_title,
        seo_description: r.d_seo_description,
        weight_grams: r.d_weight_grams,
        calories: r.d_calories,
        is_vegetarian: r.d_is_vegetarian,
        spicy_level: r.d_spicy_level,
        is_halal: r.d_is_halal,
        allergens: r.d_allergens,
        sku: r.d_sku,
        sort_order: r.d_sort_order,
        is_active: r.d_is_active,
        created_at: r.d_created_at,
        updated_at: r.d_updated_at,
        deleted_at: null,
      } as unknown as Selectable<DishesTable>;
      return {
        dish: mapDish(dishRow),
        item: mapMenuItem(r as unknown as Selectable<BranchMenuItemsTable>),
        categorySlug: r.c_slug,
        categorySortOrder: r.c_sort_order,
        rank: Number(r.rank ?? 0),
      };
    });
    return { rows: mapped, total: page ? total : mapped.length };
  }
}
