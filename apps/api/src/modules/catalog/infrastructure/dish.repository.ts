import { Injectable } from '@nestjs/common';
import { Selectable, sql } from 'kysely';
import { Database } from '../../../shared/infrastructure/database/database';
import { offsetOf, Page, pageOf, PageRequest } from '../../../shared/kernel/pagination';
import { Translatable } from '../../../shared/kernel/translatable';
import { AllergenCode } from '../domain/allergens';
import { SpicyLevel } from '../domain/dish';
import { ImageVariant } from '../domain/images';
import { containsPattern } from '../domain/search';
import { CatalogTables, DishesTable, DishPhotosTable } from './catalog.tables';

export interface DishRecord {
  id: string;
  slug: string;
  categoryId: string;
  name: Translatable;
  description: Translatable;
  composition: Translatable;
  seoTitle: Translatable;
  seoDescription: Translatable;
  weightGrams: number | null;
  calories: number | null;
  isVegetarian: boolean;
  spicyLevel: SpicyLevel;
  isHalal: boolean;
  allergens: AllergenCode[];
  sku: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type DishWrite = Omit<DishRecord, 'id' | 'createdAt' | 'updatedAt'>;

export interface DishPhotoRecord {
  id: string;
  dishId: string;
  sortOrder: number;
  variants: ImageVariant[];
  alt: Translatable;
  createdAt: Date;
}

export interface DishSearch {
  q?: string | null;
  categoryId?: string | null;
  isActive?: boolean | null;
  /** Только блюда, которых нет в меню филиала (выбор «добавить в меню»). */
  notInBranchId?: string | null;
  /** Только блюда меню филиала. */
  inBranchId?: string | null;
}

export function mapDish(row: Selectable<DishesTable>): DishRecord {
  return {
    id: row.id,
    slug: row.slug,
    categoryId: row.category_id,
    name: row.name as Translatable,
    description: (row.description ?? {}) as Translatable,
    composition: (row.composition ?? {}) as Translatable,
    seoTitle: (row.seo_title ?? {}) as Translatable,
    seoDescription: (row.seo_description ?? {}) as Translatable,
    weightGrams: row.weight_grams,
    calories: row.calories,
    isVegetarian: row.is_vegetarian,
    spicyLevel: row.spicy_level as SpicyLevel,
    isHalal: row.is_halal,
    allergens: (row.allergens ?? []) as AllergenCode[],
    sku: row.sku,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapPhoto(row: Selectable<DishPhotosTable>): DishPhotoRecord {
  return {
    id: row.id,
    dishId: row.dish_id,
    sortOrder: row.sort_order,
    variants: (Array.isArray(row.variants) ? row.variants : []) as ImageVariant[],
    alt: (row.alt ?? {}) as Translatable,
    createdAt: row.created_at,
  };
}

/** Колонки блюда без служебных полей поиска. */
export const DISH_COLUMNS = [
  'id',
  'slug',
  'category_id',
  'name',
  'description',
  'composition',
  'seo_title',
  'seo_description',
  'weight_grams',
  'calories',
  'is_vegetarian',
  'spicy_level',
  'is_halal',
  'allergens',
  'sku',
  'sort_order',
  'is_active',
  'created_at',
  'updated_at',
  'deleted_at',
] as const;

@Injectable()
export class DishRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<CatalogTables>();
  }

  async findById(id: string): Promise<DishRecord | null> {
    const row = await this.db()
      .selectFrom('catalog.dishes')
      .select(DISH_COLUMNS)
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return row ? mapDish(row as Selectable<DishesTable>) : null;
  }

  async findBySlug(slug: string): Promise<DishRecord | null> {
    const row = await this.db()
      .selectFrom('catalog.dishes')
      .select(DISH_COLUMNS)
      .where('slug', '=', slug)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return row ? mapDish(row as Selectable<DishesTable>) : null;
  }

  async findManyByIds(ids: readonly string[]): Promise<DishRecord[]> {
    if (ids.length === 0) return [];
    const rows = await this.db()
      .selectFrom('catalog.dishes')
      .select(DISH_COLUMNS)
      .where('id', 'in', [...ids])
      .where('deleted_at', 'is', null)
      .execute();
    return rows.map((r) => mapDish(r as Selectable<DishesTable>));
  }

  async listAll(): Promise<DishRecord[]> {
    const rows = await this.db()
      .selectFrom('catalog.dishes')
      .select(DISH_COLUMNS)
      .where('deleted_at', 'is', null)
      .orderBy('sort_order')
      .orderBy('created_at')
      .execute();
    return rows.map((r) => mapDish(r as Selectable<DishesTable>));
  }

  async slugTaken(slug: string, exceptId?: string): Promise<boolean> {
    let q = this.db().selectFrom('catalog.dishes').select('id').where('slug', '=', slug).where('deleted_at', 'is', null);
    if (exceptId) q = q.where('id', '!=', exceptId);
    return !!(await q.executeTakeFirst());
  }

  /** Блюдо, которому принадлежит общий код POS (кроме exceptId). */
  async skuOwner(sku: string, exceptId?: string): Promise<string | null> {
    let q = this.db().selectFrom('catalog.dishes').select('id').where('sku', '=', sku).where('deleted_at', 'is', null);
    if (exceptId) q = q.where('id', '!=', exceptId);
    return (await q.executeTakeFirst())?.id ?? null;
  }

  async countInCategory(categoryId: string): Promise<number> {
    const row = await this.db()
      .selectFrom('catalog.dishes')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('category_id', '=', categoryId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return Number(row?.n ?? 0);
  }

  async search(filter: DishSearch, page: PageRequest): Promise<Page<DishRecord>> {
    let q = this.db().selectFrom('catalog.dishes as d').where('d.deleted_at', 'is', null);
    if (filter.categoryId) q = q.where('d.category_id', '=', filter.categoryId);
    if (filter.isActive !== null && filter.isActive !== undefined) q = q.where('d.is_active', '=', filter.isActive);
    if (filter.q) {
      const pattern = containsPattern(filter.q);
      q = q.where((eb) =>
        eb.or([
          eb('d.search_text', 'like', pattern),
          eb('d.slug', 'like', pattern),
          eb('d.sku', '=', filter.q!.trim()),
          sql<boolean>`d.search_vector @@ websearch_to_tsquery('russian', ${filter.q})`,
        ]),
      );
    }
    if (filter.notInBranchId) {
      const branchId = filter.notInBranchId;
      q = q.where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom('catalog.branch_menu_items as bmi')
              .select('bmi.id')
              .whereRef('bmi.dish_id', '=', 'd.id')
              .where('bmi.branch_id', '=', branchId)
              .where('bmi.deleted_at', 'is', null),
          ),
        ),
      );
    }
    if (filter.inBranchId) {
      const branchId = filter.inBranchId;
      q = q.where(({ exists, selectFrom }) =>
        exists(
          selectFrom('catalog.branch_menu_items as bmi')
            .select('bmi.id')
            .whereRef('bmi.dish_id', '=', 'd.id')
            .where('bmi.branch_id', '=', branchId)
            .where('bmi.deleted_at', 'is', null),
        ),
      );
    }
    const total = await q.select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirst();
    const rows = await q
      .select(DISH_COLUMNS.map((c) => `d.${c}` as const))
      .orderBy('d.sort_order')
      .orderBy('d.created_at')
      .limit(page.perPage)
      .offset(offsetOf(page))
      .execute();
    return pageOf(
      rows.map((r) => mapDish(r as Selectable<DishesTable>)),
      Number(total?.n ?? 0),
      page,
    );
  }

  async insert(id: string, data: DishWrite): Promise<void> {
    await this.db()
      .insertInto('catalog.dishes')
      .values({ id, ...this.toRow(data), deleted_at: null })
      .execute();
  }

  async update(id: string, data: DishWrite): Promise<void> {
    await this.db().updateTable('catalog.dishes').set(this.toRow(data)).where('id', '=', id).execute();
  }

  /** Отметить изменение карточки (фото) — для updatedAt в sitemap и кэшей. */
  async touch(id: string): Promise<void> {
    await this.db().updateTable('catalog.dishes').set({ sort_order: sql`sort_order` }).where('id', '=', id).execute();
  }

  async softDelete(id: string, at: Date): Promise<void> {
    await this.db().updateTable('catalog.dishes').set({ deleted_at: at, is_active: false, sku: null }).where('id', '=', id).execute();
  }

  // ---------------------------------------------------------------- группы модификаторов блюда

  async modifierGroupIds(dishId: string): Promise<string[]> {
    return (await this.modifierGroupIdsFor([dishId])).get(dishId) ?? [];
  }

  async modifierGroupIdsFor(dishIds: readonly string[]): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    if (dishIds.length === 0) return result;
    const rows = await this.db()
      .selectFrom('catalog.dish_modifier_groups')
      .select(['dish_id', 'group_id'])
      .where('dish_id', 'in', [...dishIds])
      .orderBy('dish_id')
      .orderBy('sort_order')
      .execute();
    for (const r of rows) result.set(r.dish_id, [...(result.get(r.dish_id) ?? []), r.group_id]);
    return result;
  }

  async replaceModifierGroups(dishId: string, groupIds: readonly string[]): Promise<void> {
    await this.db().deleteFrom('catalog.dish_modifier_groups').where('dish_id', '=', dishId).execute();
    if (groupIds.length === 0) return;
    await this.db()
      .insertInto('catalog.dish_modifier_groups')
      .values(groupIds.map((groupId, i) => ({ dish_id: dishId, group_id: groupId, sort_order: i })))
      .execute();
  }

  // ---------------------------------------------------------------- фото

  async photos(dishId: string): Promise<DishPhotoRecord[]> {
    return (await this.photosFor([dishId])).get(dishId) ?? [];
  }

  async photosFor(dishIds: readonly string[]): Promise<Map<string, DishPhotoRecord[]>> {
    const result = new Map<string, DishPhotoRecord[]>();
    if (dishIds.length === 0) return result;
    const rows = await this.db()
      .selectFrom('catalog.dish_photos')
      .selectAll()
      .where('dish_id', 'in', [...dishIds])
      .where('deleted_at', 'is', null)
      .orderBy('dish_id')
      .orderBy('sort_order')
      .orderBy('created_at')
      .execute();
    for (const r of rows) result.set(r.dish_id, [...(result.get(r.dish_id) ?? []), mapPhoto(r)]);
    return result;
  }

  async insertPhoto(photo: Omit<DishPhotoRecord, 'createdAt'>): Promise<void> {
    await this.db()
      .insertInto('catalog.dish_photos')
      .values({
        id: photo.id,
        dish_id: photo.dishId,
        sort_order: photo.sortOrder,
        variants: JSON.stringify(photo.variants),
        alt: JSON.stringify(photo.alt),
        deleted_at: null,
      })
      .execute();
  }

  async softDeletePhoto(photoId: string, at: Date): Promise<void> {
    await this.db().updateTable('catalog.dish_photos').set({ deleted_at: at }).where('id', '=', photoId).execute();
  }

  async setPhotoOrder(photoId: string, sortOrder: number): Promise<void> {
    await this.db().updateTable('catalog.dish_photos').set({ sort_order: sortOrder }).where('id', '=', photoId).execute();
  }

  private toRow(data: DishWrite) {
    return {
      slug: data.slug,
      category_id: data.categoryId,
      name: JSON.stringify(data.name),
      description: JSON.stringify(data.description),
      composition: JSON.stringify(data.composition),
      seo_title: JSON.stringify(data.seoTitle),
      seo_description: JSON.stringify(data.seoDescription),
      weight_grams: data.weightGrams,
      calories: data.calories,
      is_vegetarian: data.isVegetarian,
      spicy_level: data.spicyLevel,
      is_halal: data.isHalal,
      allergens: data.allergens,
      sku: data.sku,
      sort_order: data.sortOrder,
      is_active: data.isActive,
    };
  }
}
