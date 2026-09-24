import { Injectable } from '@nestjs/common';
import { Actor } from '../../../shared/kernel/actor';
import { NotFoundError } from '../../../shared/kernel/errors';
import { Permission } from '../../../shared/kernel/permissions';
import { isProtectedPage } from '../domain/content';
import { missingTranslations, MissingTranslation } from '../domain/translations';
import {
  BannerRecord,
  BannerRepository,
  PageRecord,
  PageRepository,
  PromotionRecord,
  PromotionRepository,
} from '../infrastructure/content.repository';
import { ImageUrls, ImageView } from './image-urls';

export interface AdminBannerView extends Omit<BannerRecord, 'image'> {
  image: ImageView | null;
  missingTranslations: MissingTranslation[];
}

export interface AdminPromotionView extends Omit<PromotionRecord, 'image'> {
  image: ImageView | null;
  missingTranslations: MissingTranslation[];
}

export interface AdminPageView extends PageRecord {
  isProtected: boolean;
  missingTranslations: MissingTranslation[];
}

/**
 * Контент для админки (право content.manage). Баннеры и акции конкретных филиалов видят
 * сотрудники с правом в этих филиалах, общие — все с правом.
 */
@Injectable()
export class ContentAdminQueries {
  constructor(
    private readonly banners: BannerRepository,
    private readonly promotions: PromotionRepository,
    private readonly pages: PageRepository,
    private readonly images: ImageUrls,
  ) {}

  private bannerView(b: BannerRecord): AdminBannerView {
    return {
      ...b,
      image: this.images.view(b.image, 'banners'),
      missingTranslations: missingTranslations([
        { field: 'title', value: b.title, required: true },
        { field: 'subtitle', value: b.subtitle, required: false },
        { field: 'ctaLabel', value: b.ctaLabel, required: false },
      ]),
    };
  }

  private promotionView(p: PromotionRecord): AdminPromotionView {
    return {
      ...p,
      image: this.images.view(p.image, 'promotions'),
      missingTranslations: missingTranslations([
        { field: 'title', value: p.title, required: true },
        { field: 'description', value: p.description, required: false },
        { field: 'terms', value: p.terms, required: false },
        { field: 'seoTitle', value: p.seoTitle, required: false },
        { field: 'seoDescription', value: p.seoDescription, required: false },
      ]),
    };
  }

  private pageView(p: PageRecord): AdminPageView {
    return {
      ...p,
      isProtected: isProtectedPage(p.slug),
      missingTranslations: missingTranslations([
        { field: 'title', value: p.title, required: true },
        { field: 'body', value: p.body, required: true },
        { field: 'seoTitle', value: p.seoTitle, required: false },
        { field: 'seoDescription', value: p.seoDescription, required: false },
      ]),
    };
  }

  async bannerList(actor: Actor, filter: { placement?: string | null; branchId?: string | null }): Promise<AdminBannerView[]> {
    actor.assertCanSomewhere(Permission.ContentManage);
    const list = await this.banners.list(filter);
    return list.filter((b) => actor.can(Permission.ContentManage, b.branchId) || b.branchId === null).map((b) => this.bannerView(b));
  }

  async banner(actor: Actor, id: string): Promise<AdminBannerView> {
    actor.assertCanSomewhere(Permission.ContentManage);
    const b = await this.banners.findById(id);
    if (!b || (b.branchId !== null && !actor.can(Permission.ContentManage, b.branchId))) throw new NotFoundError('banner', id);
    return this.bannerView(b);
  }

  async promotionList(actor: Actor): Promise<AdminPromotionView[]> {
    actor.assertCanSomewhere(Permission.ContentManage);
    return (await this.promotions.list()).map((p) => this.promotionView(p));
  }

  async promotion(actor: Actor, id: string): Promise<AdminPromotionView> {
    actor.assertCanSomewhere(Permission.ContentManage);
    const p = await this.promotions.findById(id);
    if (!p) throw new NotFoundError('promotion', id);
    return this.promotionView(p);
  }

  async pageList(actor: Actor): Promise<AdminPageView[]> {
    actor.assertCanSomewhere(Permission.ContentManage);
    return (await this.pages.list()).map((p) => this.pageView(p));
  }

  async page(actor: Actor, id: string): Promise<AdminPageView> {
    actor.assertCanSomewhere(Permission.ContentManage);
    const p = await this.pages.findById(id);
    if (!p) throw new NotFoundError('page', id);
    return this.pageView(p);
  }
}
