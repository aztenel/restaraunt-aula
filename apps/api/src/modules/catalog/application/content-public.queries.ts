import { Injectable } from '@nestjs/common';
import { Clock } from '../../../shared/kernel/clock';
import { NotFoundError } from '../../../shared/kernel/errors';
import { Locale, translate } from '../../../shared/kernel/translatable';
import { BranchDirectory } from '../../identity/public';
import { BannerPlacement, isBannerVisible, isPromotionVisible } from '../domain/content';
import { htmlToPlainText } from '../domain/html';
import { buildSeo, SeoMeta } from '../domain/seo';
import { BannerRepository, PageRepository, PromotionRecord, PromotionRepository } from '../infrastructure/content.repository';
import { ImageUrls, ImageView } from './image-urls';

export interface PublicBanner {
  id: string;
  placement: BannerPlacement;
  title: string;
  subtitle: string;
  ctaLabel: string;
  linkUrl: string | null;
  image: ImageView | null;
}

export interface PublicPromotion {
  id: string;
  slug: string;
  title: string;
  description: string;
  terms: string;
  image: ImageView | null;
  validFrom: Date | null;
  validTo: Date | null;
  /** Пусто — во всех филиалах. */
  branchIds: string[];
  seo: SeoMeta;
  updatedAt: Date;
}

export interface PublicPageSummary {
  slug: string;
  title: string;
  updatedAt: Date;
}

export interface PublicPage extends PublicPageSummary {
  bodyHtml: string;
  seo: SeoMeta;
}

/** Контент витрины для гостя: баннеры, действующие акции, опубликованные страницы. */
@Injectable()
export class ContentPublicQueries {
  constructor(
    private readonly banners: BannerRepository,
    private readonly promotions: PromotionRepository,
    private readonly pages: PageRepository,
    private readonly branches: BranchDirectory,
    private readonly images: ImageUrls,
    private readonly clock: Clock,
  ) {}

  private async branchId(slug: string | null | undefined): Promise<string | null> {
    if (!slug) return null;
    const branch = await this.branches.findBySlug(slug);
    if (!branch || !branch.isActive) throw new NotFoundError('branch', slug);
    return branch.id;
  }

  async bannerList(input: { placement?: string | null; branchSlug?: string | null }, locale: Locale): Promise<PublicBanner[]> {
    const branchId = await this.branchId(input.branchSlug);
    const now = this.clock.now();
    const banners = await this.banners.list({ placement: input.placement, activeOnly: true });
    return banners
      .filter((b) => isBannerVisible(b, now, branchId))
      .map((b) => ({
        id: b.id,
        placement: b.placement,
        title: translate(b.title, locale),
        subtitle: translate(b.subtitle, locale),
        ctaLabel: translate(b.ctaLabel, locale),
        linkUrl: b.linkUrl,
        image: this.images.view(b.image, 'banners'),
      }));
  }

  private promotion(p: PromotionRecord, locale: Locale): PublicPromotion {
    return {
      id: p.id,
      slug: p.slug,
      title: translate(p.title, locale),
      description: translate(p.description, locale),
      terms: translate(p.terms, locale),
      image: this.images.view(p.image, 'promotions'),
      validFrom: p.validFrom,
      validTo: p.validTo,
      branchIds: p.branchIds,
      seo: buildSeo({ seoTitle: p.seoTitle, seoDescription: p.seoDescription, name: p.title, fallbackDescriptions: [p.description] }, locale),
      updatedAt: p.updatedAt,
    };
  }

  async promotionList(branchSlug: string | null | undefined, locale: Locale): Promise<PublicPromotion[]> {
    const branchId = await this.branchId(branchSlug);
    const now = this.clock.now();
    return (await this.promotions.list({ activeOnly: true })).filter((p) => isPromotionVisible(p, now, branchId)).map((p) => this.promotion(p, locale));
  }

  async promotionBySlug(slug: string, locale: Locale): Promise<PublicPromotion> {
    const p = await this.promotions.findBySlug(slug);
    if (!p || !isPromotionVisible(p, this.clock.now(), null)) throw new NotFoundError('promotion', slug);
    return this.promotion(p, locale);
  }

  async pageList(locale: Locale): Promise<PublicPageSummary[]> {
    return (await this.pages.list({ publishedOnly: true })).map((p) => ({ slug: p.slug, title: translate(p.title, locale), updatedAt: p.updatedAt }));
  }

  async pageBySlug(slug: string, locale: Locale): Promise<PublicPage> {
    const page = await this.pages.findBySlug(slug);
    if (!page || !page.isPublished) throw new NotFoundError('page', slug);
    const bodyHtml = translate(page.body, locale);
    return {
      slug: page.slug,
      title: translate(page.title, locale),
      bodyHtml,
      seo: buildSeo(
        { seoTitle: page.seoTitle, seoDescription: page.seoDescription, name: page.title, fallbackDescriptions: [htmlToPlainText(bodyHtml)] },
        locale,
      ),
      updatedAt: page.updatedAt,
    };
  }
}
