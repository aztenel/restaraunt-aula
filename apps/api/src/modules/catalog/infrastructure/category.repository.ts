import { Injectable } from '@nestjs/common';
import { Selectable } from 'kysely';
import { Database } from '../../../shared/infrastructure/database/database';
import { Translatable } from '../../../shared/kernel/translatable';
import { isStoredImage, StoredImage } from '../domain/images';
import { CatalogTables, CategoriesTable } from './catalog.tables';

export interface CategoryRecord {
  id: string;
  slug: string;
  name: Translatable;
  description: Translatable;
  seoTitle: Translatable;
  seoDescription: Translatable;
  image: StoredImage | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CategoryWrite {
  slug: string;
  name: Translatable;
  description: Translatable;
  seoTitle: Translatable;
  seoDescription: Translatable;
  sortOrder: number;
  isActive: boolean;
}

export function asImage(value: unknown): StoredImage | null {
  return isStoredImage(value) ? value : null;
}

export function mapCategory(row: Selectable<CategoriesTable>): CategoryRecord {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name as Translatable,
    description: (row.description ?? {}) as Translatable,
    seoTitle: (row.seo_title ?? {}) as Translatable,
    seoDescription: (row.seo_description ?? {}) as Translatable,
    image: asImage(row.image),
    sortOrder: row.sort_order,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

@Injectable()
export class CategoryRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<CatalogTables>();
  }

  async findById(id: string): Promise<CategoryRecord | null> {
    const row = await this.db()
      .selectFrom('catalog.categories')
      .selectAll()
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return row ? mapCategory(row) : null;
  }

  async findBySlug(slug: string): Promise<CategoryRecord | null> {
    const row = await this.db()
      .selectFrom('catalog.categories')
      .selectAll()
      .where('slug', '=', slug)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return row ? mapCategory(row) : null;
  }

  async slugTaken(slug: string, exceptId?: string): Promise<boolean> {
    let q = this.db().selectFrom('catalog.categories').select('id').where('slug', '=', slug).where('deleted_at', 'is', null);
    if (exceptId) q = q.where('id', '!=', exceptId);
    return !!(await q.executeTakeFirst());
  }

  async list(options: { activeOnly?: boolean } = {}): Promise<CategoryRecord[]> {
    let q = this.db().selectFrom('catalog.categories').selectAll().where('deleted_at', 'is', null);
    if (options.activeOnly) q = q.where('is_active', '=', true);
    const rows = await q.orderBy('sort_order').orderBy('created_at').execute();
    return rows.map(mapCategory);
  }

  async insert(id: string, data: CategoryWrite): Promise<void> {
    await this.db()
      .insertInto('catalog.categories')
      .values({ id, ...this.toRow(data), image: null, deleted_at: null })
      .execute();
  }

  async update(id: string, data: CategoryWrite): Promise<void> {
    await this.db().updateTable('catalog.categories').set(this.toRow(data)).where('id', '=', id).execute();
  }

  async setImage(id: string, image: StoredImage | null): Promise<void> {
    await this.db()
      .updateTable('catalog.categories')
      .set({ image: image ? JSON.stringify(image) : null })
      .where('id', '=', id)
      .execute();
  }

  async setSortOrder(id: string, sortOrder: number): Promise<void> {
    await this.db().updateTable('catalog.categories').set({ sort_order: sortOrder }).where('id', '=', id).execute();
  }

  async softDelete(id: string, at: Date): Promise<void> {
    await this.db().updateTable('catalog.categories').set({ deleted_at: at, is_active: false }).where('id', '=', id).execute();
  }

  /** Число неудалённых блюд по категориям. */
  async dishCounts(): Promise<Map<string, number>> {
    const rows = await this.db()
      .selectFrom('catalog.dishes')
      .select(['category_id', (eb) => eb.fn.countAll<string>().as('n')])
      .where('deleted_at', 'is', null)
      .groupBy('category_id')
      .execute();
    return new Map(rows.map((r) => [r.category_id, Number(r.n)]));
  }

  private toRow(data: CategoryWrite) {
    return {
      slug: data.slug,
      name: JSON.stringify(data.name),
      description: JSON.stringify(data.description),
      seo_title: JSON.stringify(data.seoTitle),
      seo_description: JSON.stringify(data.seoDescription),
      sort_order: data.sortOrder,
      is_active: data.isActive,
    };
  }
}
