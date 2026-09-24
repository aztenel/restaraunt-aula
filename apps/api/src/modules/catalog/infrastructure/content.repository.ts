import { Injectable } from '@nestjs/common';
import { Selectable } from 'kysely';
import { Database } from '../../../shared/infrastructure/database/database';
import { Translatable } from '../../../shared/kernel/translatable';
import { BannerPlacement } from '../domain/content';
import { StoredImage } from '../domain/images';
import { BannersTable, CatalogTables, PagesTable, PromotionsTable } from './catalog.tables';
import { asImage } from './category.repository';

// ---------------------------------------------------------------- Баннеры

export interface BannerRecord {
  id: string;
  placement: BannerPlacement;
  branchId: string | null;
  title: Translatable;
  subtitle: Translatable;
  ctaLabel: Translatable;
  linkUrl: string | null;
  image: StoredImage | null;
  activeFrom: Date | null;
  activeTo: Date | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type BannerWrite = Omit<BannerRecord, 'id' | 'image' | 'createdAt' | 'updatedAt'>;

function mapBanner(row: Selectable<BannersTable>): BannerRecord {
  return {
    id: row.id,
    placement: row.placement as BannerPlacement,
    branchId: row.branch_id,
    title: row.title as Translatable,
    subtitle: (row.subtitle ?? {}) as Translatable,
    ctaLabel: (row.cta_label ?? {}) as Translatable,
    linkUrl: row.link_url,
    image: asImage(row.image),
    activeFrom: row.active_from,
    activeTo: row.active_to,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

@Injectable()
export class BannerRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<CatalogTables>();
  }

  async findById(id: string): Promise<BannerRecord | null> {
    const row = await this.db().selectFrom('catalog.banners').selectAll().where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
    return row ? mapBanner(row) : null;
  }

  async list(filter: { placement?: string | null; branchId?: string | null; activeOnly?: boolean } = {}): Promise<BannerRecord[]> {
    let q = this.db().selectFrom('catalog.banners').selectAll().where('deleted_at', 'is', null);
    if (filter.placement) q = q.where('placement', '=', filter.placement);
    if (filter.branchId) q = q.where((eb) => eb.or([eb('branch_id', 'is', null), eb('branch_id', '=', filter.branchId!)]));
    if (filter.activeOnly) q = q.where('is_active', '=', true);
    const rows = await q.orderBy('placement').orderBy('sort_order').orderBy('created_at').execute();
    return rows.map(mapBanner);
  }

  async count(): Promise<number> {
    const row = await this.db()
      .selectFrom('catalog.banners')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return Number(row?.n ?? 0);
  }

  async insert(id: string, data: BannerWrite): Promise<void> {
    await this.db()
      .insertInto('catalog.banners')
      .values({ id, ...this.toRow(data), image: null, deleted_at: null })
      .execute();
  }

  async update(id: string, data: BannerWrite): Promise<void> {
    await this.db().updateTable('catalog.banners').set(this.toRow(data)).where('id', '=', id).execute();
  }

  async setImage(id: string, image: StoredImage | null): Promise<void> {
    await this.db()
      .updateTable('catalog.banners')
      .set({ image: image ? JSON.stringify(image) : null })
      .where('id', '=', id)
      .execute();
  }

  async softDelete(id: string, at: Date): Promise<void> {
    await this.db().updateTable('catalog.banners').set({ deleted_at: at, is_active: false }).where('id', '=', id).execute();
  }

  private toRow(data: BannerWrite) {
    return {
      placement: data.placement,
      branch_id: data.branchId,
      title: JSON.stringify(data.title),
      subtitle: JSON.stringify(data.subtitle),
      cta_label: JSON.stringify(data.ctaLabel),
      link_url: data.linkUrl,
      active_from: data.activeFrom,
      active_to: data.activeTo,
      sort_order: data.sortOrder,
      is_active: data.isActive,
    };
  }
}

// ---------------------------------------------------------------- Акции

export interface PromotionRecord {
  id: string;
  slug: string;
  title: Translatable;
  description: Translatable;
  terms: Translatable;
  seoTitle: Translatable;
  seoDescription: Translatable;
  image: StoredImage | null;
  validFrom: Date | null;
  validTo: Date | null;
  branchIds: string[];
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type PromotionWrite = Omit<PromotionRecord, 'id' | 'image' | 'createdAt' | 'updatedAt'>;

function mapPromotion(row: Selectable<PromotionsTable>): PromotionRecord {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title as Translatable,
    description: (row.description ?? {}) as Translatable,
    terms: (row.terms ?? {}) as Translatable,
    seoTitle: (row.seo_title ?? {}) as Translatable,
    seoDescription: (row.seo_description ?? {}) as Translatable,
    image: asImage(row.image),
    validFrom: row.valid_from,
    validTo: row.valid_to,
    branchIds: row.branch_ids ?? [],
    sortOrder: row.sort_order,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

@Injectable()
export class PromotionRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<CatalogTables>();
  }

  async findById(id: string): Promise<PromotionRecord | null> {
    const row = await this.db().selectFrom('catalog.promotions').selectAll().where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
    return row ? mapPromotion(row) : null;
  }

  async findBySlug(slug: string): Promise<PromotionRecord | null> {
    const row = await this.db()
      .selectFrom('catalog.promotions')
      .selectAll()
      .where('slug', '=', slug)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return row ? mapPromotion(row) : null;
  }

  async slugTaken(slug: string, exceptId?: string): Promise<boolean> {
    let q = this.db().selectFrom('catalog.promotions').select('id').where('slug', '=', slug).where('deleted_at', 'is', null);
    if (exceptId) q = q.where('id', '!=', exceptId);
    return !!(await q.executeTakeFirst());
  }

  async list(filter: { activeOnly?: boolean } = {}): Promise<PromotionRecord[]> {
    let q = this.db().selectFrom('catalog.promotions').selectAll().where('deleted_at', 'is', null);
    if (filter.activeOnly) q = q.where('is_active', '=', true);
    const rows = await q.orderBy('sort_order').orderBy('created_at', 'desc').execute();
    return rows.map(mapPromotion);
  }

  async insert(id: string, data: PromotionWrite): Promise<void> {
    await this.db()
      .insertInto('catalog.promotions')
      .values({ id, ...this.toRow(data), image: null, deleted_at: null })
      .execute();
  }

  async update(id: string, data: PromotionWrite): Promise<void> {
    await this.db().updateTable('catalog.promotions').set(this.toRow(data)).where('id', '=', id).execute();
  }

  async setImage(id: string, image: StoredImage | null): Promise<void> {
    await this.db()
      .updateTable('catalog.promotions')
      .set({ image: image ? JSON.stringify(image) : null })
      .where('id', '=', id)
      .execute();
  }

  async softDelete(id: string, at: Date): Promise<void> {
    await this.db().updateTable('catalog.promotions').set({ deleted_at: at, is_active: false }).where('id', '=', id).execute();
  }

  private toRow(data: PromotionWrite) {
    return {
      slug: data.slug,
      title: JSON.stringify(data.title),
      description: JSON.stringify(data.description),
      terms: JSON.stringify(data.terms),
      seo_title: JSON.stringify(data.seoTitle),
      seo_description: JSON.stringify(data.seoDescription),
      valid_from: data.validFrom,
      valid_to: data.validTo,
      branch_ids: data.branchIds,
      sort_order: data.sortOrder,
      is_active: data.isActive,
    };
  }
}

// ---------------------------------------------------------------- Статические страницы

export interface PageRecord {
  id: string;
  slug: string;
  title: Translatable;
  body: Translatable;
  seoTitle: Translatable;
  seoDescription: Translatable;
  isPublished: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export type PageWrite = Omit<PageRecord, 'id' | 'createdAt' | 'updatedAt'>;

function mapPage(row: Selectable<PagesTable>): PageRecord {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title as Translatable,
    body: (row.body ?? {}) as Translatable,
    seoTitle: (row.seo_title ?? {}) as Translatable,
    seoDescription: (row.seo_description ?? {}) as Translatable,
    isPublished: row.is_published,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

@Injectable()
export class PageRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<CatalogTables>();
  }

  async findById(id: string): Promise<PageRecord | null> {
    const row = await this.db().selectFrom('catalog.pages').selectAll().where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
    return row ? mapPage(row) : null;
  }

  async findBySlug(slug: string): Promise<PageRecord | null> {
    const row = await this.db().selectFrom('catalog.pages').selectAll().where('slug', '=', slug).where('deleted_at', 'is', null).executeTakeFirst();
    return row ? mapPage(row) : null;
  }

  async slugTaken(slug: string, exceptId?: string): Promise<boolean> {
    let q = this.db().selectFrom('catalog.pages').select('id').where('slug', '=', slug).where('deleted_at', 'is', null);
    if (exceptId) q = q.where('id', '!=', exceptId);
    return !!(await q.executeTakeFirst());
  }

  async list(filter: { publishedOnly?: boolean } = {}): Promise<PageRecord[]> {
    let q = this.db().selectFrom('catalog.pages').selectAll().where('deleted_at', 'is', null);
    if (filter.publishedOnly) q = q.where('is_published', '=', true);
    const rows = await q.orderBy('sort_order').orderBy('slug').execute();
    return rows.map(mapPage);
  }

  async insert(id: string, data: PageWrite): Promise<void> {
    await this.db()
      .insertInto('catalog.pages')
      .values({ id, ...this.toRow(data), deleted_at: null })
      .execute();
  }

  async update(id: string, data: PageWrite): Promise<void> {
    await this.db().updateTable('catalog.pages').set(this.toRow(data)).where('id', '=', id).execute();
  }

  async softDelete(id: string, at: Date): Promise<void> {
    await this.db().updateTable('catalog.pages').set({ deleted_at: at, is_published: false }).where('id', '=', id).execute();
  }

  private toRow(data: PageWrite) {
    return {
      slug: data.slug,
      title: JSON.stringify(data.title),
      body: JSON.stringify(data.body),
      seo_title: JSON.stringify(data.seoTitle),
      seo_description: JSON.stringify(data.seoDescription),
      is_published: data.isPublished,
      sort_order: data.sortOrder,
    };
  }
}
