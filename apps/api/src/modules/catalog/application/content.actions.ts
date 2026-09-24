import { Injectable } from '@nestjs/common';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { Database } from '../../../shared/infrastructure/database/database';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/kernel/errors';
import { newId } from '../../../shared/kernel/ids';
import { Permission } from '../../../shared/kernel/permissions';
import { Translatable } from '../../../shared/kernel/translatable';
import { BranchDirectory } from '../../identity/public';
import { CONTENT_TEXT_LIMITS, isBannerPlacement, isProtectedPage, normalizeLink, validateWindow } from '../domain/content';
import { optionalText, requiredText } from '../domain/dish';
import { sanitizeTranslatableHtml } from '../domain/html';
import { assertSlug, generateUniqueSlug } from '../domain/slug';
import {
  BannerRecord,
  BannerRepository,
  BannerWrite,
  PageRecord,
  PageRepository,
  PageWrite,
  PromotionRecord,
  PromotionRepository,
  PromotionWrite,
} from '../infrastructure/content.repository';
import { guardUnique } from '../infrastructure/db-errors';
import { ImageProcessor, UploadedImage } from '../infrastructure/image-processor';
import { CatalogEventPublisher } from './catalog-events';

/**
 * Контент витрины (контент-менеджер, право content.manage): баннеры, акции, статические страницы.
 * Баннер или акция конкретного филиала требуют права в этом филиале, общие — глобального права.
 */
const L = CONTENT_TEXT_LIMITS;

async function assertBranches(branches: BranchDirectory, ids: readonly string[]): Promise<void> {
  for (const id of ids) {
    if (!(await branches.find(id))) throw new ValidationError('content.unknown_branch', 'Branch not found', { branchId: id });
  }
}

function assertCanForBranches(actor: Actor, branchIds: readonly (string | null)[]): void {
  for (const branchId of branchIds) actor.assertCan(Permission.ContentManage, branchId);
}

function withoutMeta<T extends { createdAt: Date; updatedAt: Date }>(record: T): Omit<T, 'createdAt' | 'updatedAt'> {
  const { createdAt: _c, updatedAt: _u, ...rest } = record;
  return rest;
}

// ---------------------------------------------------------------- Баннеры

export interface BannerInput {
  placement: string;
  /** null — для всех филиалов. */
  branchId?: string | null;
  title: Translatable;
  subtitle?: Translatable | null;
  ctaLabel?: Translatable | null;
  linkUrl?: string | null;
  activeFrom?: Date | null;
  activeTo?: Date | null;
  sortOrder?: number | null;
  isActive?: boolean | null;
}

function bannerWrite(input: BannerInput, current: BannerRecord | null): BannerWrite {
  if (!isBannerPlacement(input.placement)) {
    throw new ValidationError('content.invalid_placement', 'Unknown banner placement', { placement: input.placement });
  }
  const activeFrom = input.activeFrom === undefined ? (current?.activeFrom ?? null) : input.activeFrom;
  const activeTo = input.activeTo === undefined ? (current?.activeTo ?? null) : input.activeTo;
  validateWindow(activeFrom, activeTo);
  return {
    placement: input.placement,
    branchId: input.branchId === undefined ? (current?.branchId ?? null) : input.branchId,
    title: requiredText(input.title, L.title, 'title'),
    subtitle: optionalText(input.subtitle === undefined ? current?.subtitle : input.subtitle, L.subtitle, 'subtitle'),
    ctaLabel: optionalText(input.ctaLabel === undefined ? current?.ctaLabel : input.ctaLabel, L.ctaLabel, 'ctaLabel'),
    linkUrl: input.linkUrl === undefined ? (current?.linkUrl ?? null) : normalizeLink(input.linkUrl),
    activeFrom,
    activeTo,
    sortOrder: input.sortOrder ?? current?.sortOrder ?? 0,
    isActive: input.isActive ?? current?.isActive ?? true,
  };
}

@Injectable()
export class CreateBanner {
  constructor(
    private readonly banners: BannerRepository,
    private readonly branches: BranchDirectory,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly events: CatalogEventPublisher,
  ) {}

  async execute(actor: Actor, input: BannerInput): Promise<string> {
    const data = bannerWrite(input, null);
    assertCanForBranches(actor, [data.branchId]);
    if (data.branchId) await assertBranches(this.branches, [data.branchId]);
    const id = newId();
    await this.database.transaction(async () => {
      await this.banners.insert(id, data);
      await this.audit.record({ action: 'content.banner_created', entityType: 'banner', entityId: id, branchId: data.branchId, after: data });
      await this.events.contentChanged({ kind: 'banner', id, branchId: data.branchId });
    });
    return id;
  }
}

@Injectable()
export class UpdateBanner {
  constructor(
    private readonly banners: BannerRepository,
    private readonly branches: BranchDirectory,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly events: CatalogEventPublisher,
  ) {}

  async execute(actor: Actor, id: string, input: BannerInput): Promise<void> {
    await this.database.transaction(async () => {
      const current = await this.banners.findById(id);
      if (!current) throw new NotFoundError('banner', id);
      const data = bannerWrite(input, current);
      assertCanForBranches(actor, [current.branchId, data.branchId]);
      if (data.branchId) await assertBranches(this.branches, [data.branchId]);
      await this.banners.update(id, data);
      await this.audit.record({
        action: 'content.banner_updated',
        entityType: 'banner',
        entityId: id,
        branchId: data.branchId,
        before: withoutMeta(current),
        after: data,
      });
      await this.events.contentChanged({ kind: 'banner', id, branchId: data.branchId });
    });
  }
}

@Injectable()
export class DeleteBanner {
  constructor(
    private readonly banners: BannerRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly events: CatalogEventPublisher,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, id: string): Promise<void> {
    await this.database.transaction(async () => {
      const current = await this.banners.findById(id);
      if (!current) throw new NotFoundError('banner', id);
      assertCanForBranches(actor, [current.branchId]);
      await this.banners.softDelete(id, this.clock.now());
      await this.audit.record({ action: 'content.banner_deleted', entityType: 'banner', entityId: id, branchId: current.branchId, before: withoutMeta(current) });
      await this.events.contentChanged({ kind: 'banner', id, branchId: current.branchId });
    });
  }
}

@Injectable()
export class SetBannerImage {
  constructor(
    private readonly banners: BannerRepository,
    private readonly images: ImageProcessor,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly events: CatalogEventPublisher,
  ) {}

  async execute(actor: Actor, id: string, file: UploadedImage): Promise<void> {
    const current = await this.banners.findById(id);
    if (!current) throw new NotFoundError('banner', id);
    assertCanForBranches(actor, [current.branchId]);
    const image = await this.images.store('banners', id, file);
    try {
      await this.database.transaction(async () => {
        await this.banners.setImage(id, image);
        await this.audit.record({
          action: 'content.banner_image_changed',
          entityType: 'banner',
          entityId: id,
          branchId: current.branchId,
          before: current.image,
          after: image,
        });
        await this.events.contentChanged({ kind: 'banner', id, branchId: current.branchId });
      });
    } catch (err) {
      await this.images.remove(image);
      throw err;
    }
  }
}

// ---------------------------------------------------------------- Акции

export interface PromotionInput {
  slug?: string | null;
  title: Translatable;
  description?: Translatable | null;
  terms?: Translatable | null;
  seoTitle?: Translatable | null;
  seoDescription?: Translatable | null;
  validFrom?: Date | null;
  validTo?: Date | null;
  /** Пусто — во всех филиалах. */
  branchIds?: string[] | null;
  sortOrder?: number | null;
  isActive?: boolean | null;
}

async function promotionWrite(input: PromotionInput, current: PromotionRecord | null, repo: PromotionRepository): Promise<PromotionWrite> {
  const title = requiredText(input.title, L.title, 'title');
  let slug: string;
  if (input.slug) {
    slug = assertSlug(input.slug);
    if (await repo.slugTaken(slug, current?.id)) throw new ConflictError('content.slug_taken', 'Promotion with this slug exists', { slug });
  } else if (current) {
    slug = current.slug;
  } else {
    slug = await generateUniqueSlug(title, 'promo', (s) => repo.slugTaken(s));
  }
  const validFrom = input.validFrom === undefined ? (current?.validFrom ?? null) : input.validFrom;
  const validTo = input.validTo === undefined ? (current?.validTo ?? null) : input.validTo;
  validateWindow(validFrom, validTo);
  const branchIds = input.branchIds === undefined || input.branchIds === null ? (current?.branchIds ?? []) : [...new Set(input.branchIds)];
  return {
    slug,
    title,
    description: optionalText(input.description === undefined ? current?.description : input.description, L.promotionDescription, 'description'),
    terms: optionalText(input.terms === undefined ? current?.terms : input.terms, L.promotionTerms, 'terms'),
    seoTitle: optionalText(input.seoTitle === undefined ? current?.seoTitle : input.seoTitle, L.seoTitle, 'seoTitle'),
    seoDescription: optionalText(input.seoDescription === undefined ? current?.seoDescription : input.seoDescription, L.seoDescription, 'seoDescription'),
    validFrom,
    validTo,
    branchIds,
    sortOrder: input.sortOrder ?? current?.sortOrder ?? 0,
    isActive: input.isActive ?? current?.isActive ?? true,
  };
}

function scopeOf(branchIds: readonly string[]): (string | null)[] {
  return branchIds.length === 0 ? [null] : [...branchIds];
}

@Injectable()
export class CreatePromotion {
  constructor(
    private readonly promotions: PromotionRepository,
    private readonly branches: BranchDirectory,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly events: CatalogEventPublisher,
  ) {}

  async execute(actor: Actor, input: PromotionInput): Promise<string> {
    assertCanForBranches(actor, scopeOf(input.branchIds ?? []));
    const id = newId();
    await guardUnique(
      () =>
        this.database.transaction(async () => {
          const data = await promotionWrite(input, null, this.promotions);
          await assertBranches(this.branches, data.branchIds);
          await this.promotions.insert(id, data);
          await this.audit.record({ action: 'content.promotion_created', entityType: 'promotion', entityId: id, after: data });
          await this.events.contentChanged({ kind: 'promotion', id, slug: data.slug, branchId: data.branchIds.length === 1 ? data.branchIds[0]! : null });
        }),
      'content.slug_taken',
      'Promotion with this slug exists',
    );
    return id;
  }
}

@Injectable()
export class UpdatePromotion {
  constructor(
    private readonly promotions: PromotionRepository,
    private readonly branches: BranchDirectory,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly events: CatalogEventPublisher,
  ) {}

  async execute(actor: Actor, id: string, input: PromotionInput): Promise<void> {
    await guardUnique(
      () =>
        this.database.transaction(async () => {
          const current = await this.promotions.findById(id);
          if (!current) throw new NotFoundError('promotion', id);
          const data = await promotionWrite(input, current, this.promotions);
          assertCanForBranches(actor, [...scopeOf(current.branchIds), ...scopeOf(data.branchIds)]);
          await assertBranches(this.branches, data.branchIds);
          await this.promotions.update(id, data);
          await this.audit.record({
            action: 'content.promotion_updated',
            entityType: 'promotion',
            entityId: id,
            before: withoutMeta(current),
            after: data,
          });
          await this.events.contentChanged({ kind: 'promotion', id, slug: data.slug, branchId: null });
        }),
      'content.slug_taken',
      'Promotion with this slug exists',
    );
  }
}

@Injectable()
export class DeletePromotion {
  constructor(
    private readonly promotions: PromotionRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly events: CatalogEventPublisher,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, id: string): Promise<void> {
    await this.database.transaction(async () => {
      const current = await this.promotions.findById(id);
      if (!current) throw new NotFoundError('promotion', id);
      assertCanForBranches(actor, scopeOf(current.branchIds));
      await this.promotions.softDelete(id, this.clock.now());
      await this.audit.record({ action: 'content.promotion_deleted', entityType: 'promotion', entityId: id, before: withoutMeta(current) });
      await this.events.contentChanged({ kind: 'promotion', id, slug: current.slug, branchId: null });
    });
  }
}

@Injectable()
export class SetPromotionImage {
  constructor(
    private readonly promotions: PromotionRepository,
    private readonly images: ImageProcessor,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly events: CatalogEventPublisher,
  ) {}

  async execute(actor: Actor, id: string, file: UploadedImage): Promise<void> {
    const current = await this.promotions.findById(id);
    if (!current) throw new NotFoundError('promotion', id);
    assertCanForBranches(actor, scopeOf(current.branchIds));
    const image = await this.images.store('promotions', id, file);
    try {
      await this.database.transaction(async () => {
        await this.promotions.setImage(id, image);
        await this.audit.record({
          action: 'content.promotion_image_changed',
          entityType: 'promotion',
          entityId: id,
          before: current.image,
          after: image,
        });
        await this.events.contentChanged({ kind: 'promotion', id, slug: current.slug, branchId: null });
      });
    } catch (err) {
      await this.images.remove(image);
      throw err;
    }
  }
}

// ---------------------------------------------------------------- Страницы

export interface PageInput {
  slug?: string | null;
  title: Translatable;
  /** HTML по языкам; санитизируется при сохранении. */
  body: Translatable;
  seoTitle?: Translatable | null;
  seoDescription?: Translatable | null;
  isPublished?: boolean | null;
  sortOrder?: number | null;
}

async function pageWrite(input: PageInput, current: PageRecord | null, repo: PageRepository): Promise<PageWrite> {
  const title = requiredText(input.title, L.pageTitle, 'title');
  let slug: string;
  if (input.slug) {
    slug = assertSlug(input.slug);
    if (await repo.slugTaken(slug, current?.id)) throw new ConflictError('content.slug_taken', 'Page with this slug exists', { slug });
  } else if (current) {
    slug = current.slug;
  } else {
    slug = await generateUniqueSlug(title, 'page', (s) => repo.slugTaken(s));
  }
  const body = optionalText(sanitizeTranslatableHtml(input.body ?? {}), L.pageBody, 'body');
  if (!body.ru && !body.kk) throw new ValidationError('translatable.required', 'Page body must have ru or kk text', { field: 'body' });
  const isPublished = input.isPublished ?? current?.isPublished ?? true;
  if (current && isProtectedPage(current.slug)) {
    if (slug !== current.slug) throw new ConflictError('content.page_protected', 'Legal page slug cannot be changed', { slug: current.slug });
    if (!isPublished) throw new ConflictError('content.page_protected', 'Legal page cannot be unpublished', { slug: current.slug });
  }
  return {
    slug,
    title,
    body,
    seoTitle: optionalText(input.seoTitle === undefined ? current?.seoTitle : input.seoTitle, L.seoTitle, 'seoTitle'),
    seoDescription: optionalText(input.seoDescription === undefined ? current?.seoDescription : input.seoDescription, L.seoDescription, 'seoDescription'),
    isPublished,
    sortOrder: input.sortOrder ?? current?.sortOrder ?? 0,
  };
}

@Injectable()
export class CreatePage {
  constructor(
    private readonly pages: PageRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly events: CatalogEventPublisher,
  ) {}

  async execute(actor: Actor, input: PageInput): Promise<string> {
    actor.assertCan(Permission.ContentManage);
    const id = newId();
    await guardUnique(
      () =>
        this.database.transaction(async () => {
          const data = await pageWrite(input, null, this.pages);
          await this.pages.insert(id, data);
          await this.audit.record({ action: 'content.page_created', entityType: 'page', entityId: id, after: data });
          await this.events.contentChanged({ kind: 'page', id, slug: data.slug, branchId: null });
        }),
      'content.slug_taken',
      'Page with this slug exists',
    );
    return id;
  }
}

@Injectable()
export class UpdatePage {
  constructor(
    private readonly pages: PageRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly events: CatalogEventPublisher,
  ) {}

  async execute(actor: Actor, id: string, input: PageInput): Promise<void> {
    actor.assertCan(Permission.ContentManage);
    await guardUnique(
      () =>
        this.database.transaction(async () => {
          const current = await this.pages.findById(id);
          if (!current) throw new NotFoundError('page', id);
          const data = await pageWrite(input, current, this.pages);
          await this.pages.update(id, data);
          await this.audit.record({ action: 'content.page_updated', entityType: 'page', entityId: id, before: withoutMeta(current), after: data });
          await this.events.contentChanged({ kind: 'page', id, slug: data.slug, branchId: null });
        }),
      'content.slug_taken',
      'Page with this slug exists',
    );
  }
}

@Injectable()
export class DeletePage {
  constructor(
    private readonly pages: PageRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly events: CatalogEventPublisher,
    private readonly clock: Clock,
  ) {}

  /** Оферту и политику конфиденциальности удалить нельзя (на них ссылается согласие на обработку ПД). */
  async execute(actor: Actor, id: string): Promise<void> {
    actor.assertCan(Permission.ContentManage);
    await this.database.transaction(async () => {
      const current = await this.pages.findById(id);
      if (!current) throw new NotFoundError('page', id);
      if (isProtectedPage(current.slug)) {
        throw new ConflictError('content.page_protected', 'Legal page cannot be deleted', { slug: current.slug });
      }
      await this.pages.softDelete(id, this.clock.now());
      await this.audit.record({ action: 'content.page_deleted', entityType: 'page', entityId: id, before: withoutMeta(current) });
      await this.events.contentChanged({ kind: 'page', id, slug: current.slug, branchId: null });
    });
  }
}
