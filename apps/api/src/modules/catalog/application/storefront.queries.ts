import { Injectable } from '@nestjs/common';
import { Clock } from '../../../shared/kernel/clock';
import { NotFoundError } from '../../../shared/kernel/errors';
import { Money } from '../../../shared/kernel/money';
import { Page, PageRequest } from '../../../shared/kernel/pagination';
import { Locale, translate } from '../../../shared/kernel/translatable';
import { BranchDirectory, BranchInfo } from '../../identity/public';
import { allergenLabel, AllergenCode } from '../domain/allergens';
import { isRequiredGroup } from '../domain/modifiers';
import { normalizeSearchQuery } from '../domain/search';
import { buildSeo, menuItemJsonLd, MenuItemLd, menuJsonLd, SeoMeta } from '../domain/seo';
import { isPromotionVisible } from '../domain/content';
import { displayAvailability, effectiveAvailability } from '../domain/stop-list';
import { CategoryRecord, CategoryRepository } from '../infrastructure/category.repository';
import { PageRepository, PromotionRepository } from '../infrastructure/content.repository';
import { DishPhotoRecord, DishRepository } from '../infrastructure/dish.repository';
import { MenuFilter, MenuReadRepository, MenuRow } from '../infrastructure/menu-read.repository';
import { ModifierGroupRecord, ModifierRepository } from '../infrastructure/modifier.repository';
import { DishAvailability } from '../public';
import { ImageUrls, ImageView } from './image-urls';

/**
 * Витрина (SSR/SEO): меню филиала по slug, страница категории, карточка блюда, поиск, sitemap.
 * Тексты уже переведены на запрошенный язык (запасной язык ru -> kk -> en), цены — филиала,
 * доступность — с учётом стоп-листа и настройки филиала stopListMode.
 */
export interface AllergenView {
  code: AllergenCode;
  name: string;
}

export interface PublicBranchRef {
  id: string;
  slug: string;
  name: string;
}

export interface PublicDishCard {
  id: string;
  slug: string;
  categoryId: string;
  categorySlug: string;
  name: string;
  description: string;
  price: Money;
  available: boolean;
  availability: DishAvailability;
  weightGrams: number | null;
  calories: number | null;
  isVegetarian: boolean;
  spicyLevel: number;
  isHalal: boolean;
  allergens: AllergenView[];
  photo: ImageView | null;
  hasModifiers: boolean;
  hasRequiredModifiers: boolean;
  updatedAt: Date;
}

export interface PublicModifierOption {
  id: string;
  name: string;
  price: Money;
  isDefault: boolean;
}

export interface PublicModifierGroup {
  id: string;
  name: string;
  description: string;
  minSelect: number;
  maxSelect: number;
  isRequired: boolean;
  options: PublicModifierOption[];
}

export interface PublicCategory {
  id: string;
  slug: string;
  name: string;
  description: string;
  image: ImageView | null;
  seo: SeoMeta;
  dishCount: number;
  updatedAt: Date;
}

export interface PublicDishDetail extends PublicDishCard {
  composition: string;
  photos: ImageView[];
  modifierGroups: PublicModifierGroup[];
  category: { id: string; slug: string; name: string };
  branch: PublicBranchRef;
  seo: SeoMeta;
  structuredData: Record<string, unknown>;
}

export interface PublicMenu {
  branch: PublicBranchRef;
  locale: Locale;
  seo: SeoMeta;
  categories: Array<PublicCategory & { dishes: PublicDishCard[] }>;
  structuredData: Record<string, unknown>;
}

export interface PublicCategoryPage {
  branch: PublicBranchRef;
  locale: Locale;
  category: PublicCategory;
  /** Навигация: все категории меню филиала, где есть блюда. */
  categories: PublicCategory[];
  dishes: PublicDishCard[];
  structuredData: Record<string, unknown>;
}

export interface MenuSearchFilter {
  q?: string | null;
  vegetarian?: boolean | null;
  spicy?: boolean | null;
  maxSpicyLevel?: number | null;
  halal?: boolean | null;
  maxPriceAmount?: number | null;
  categorySlug?: string | null;
}

export interface SitemapView {
  branches: Array<{ slug: string; updatedAt: Date | null }>;
  categories: Array<{ branchSlug: string; slug: string; updatedAt: Date }>;
  dishes: Array<{ branchSlug: string; categorySlug: string; slug: string; updatedAt: Date }>;
  pages: Array<{ slug: string; updatedAt: Date }>;
  promotions: Array<{ slug: string; updatedAt: Date }>;
}

interface Context {
  branch: BranchInfo;
  locale: Locale;
  now: Date;
  photos: Map<string, DishPhotoRecord[]>;
  groups: Map<string, ModifierGroupRecord[]>;
}

function laterOf(a: Date, b: Date): Date {
  return a.getTime() >= b.getTime() ? a : b;
}

@Injectable()
export class StorefrontQueries {
  constructor(
    private readonly branches: BranchDirectory,
    private readonly menu: MenuReadRepository,
    private readonly categories: CategoryRepository,
    private readonly dishes: DishRepository,
    private readonly modifiers: ModifierRepository,
    private readonly pages: PageRepository,
    private readonly promotions: PromotionRepository,
    private readonly images: ImageUrls,
    private readonly clock: Clock,
  ) {}

  private async branch(slug: string): Promise<BranchInfo> {
    const branch = await this.branches.findBySlug(slug);
    if (!branch || !branch.isActive) throw new NotFoundError('branch', slug);
    return branch;
  }

  private branchRef(branch: BranchInfo, locale: Locale): PublicBranchRef {
    return { id: branch.id, slug: branch.slug, name: translate(branch.name, locale) };
  }

  private baseFilter(branch: BranchInfo, now: Date): MenuFilter {
    return { branchId: branch.id, now, hideStopped: branch.settings.stopListMode === 'hide' };
  }

  private async context(branch: BranchInfo, locale: Locale, now: Date, rows: MenuRow[], withGroups = true): Promise<Context> {
    const ids = rows.map((r) => r.dish.id);
    const [photos, groups] = await Promise.all([
      this.dishes.photosFor(ids),
      withGroups ? this.modifiers.groupsForDishes(ids) : Promise.resolve(new Map<string, ModifierGroupRecord[]>()),
    ]);
    return { branch, locale, now, photos, groups };
  }

  private card(row: MenuRow, ctx: Context): PublicDishCard {
    const { dish, item } = row;
    const availability = displayAvailability(effectiveAvailability(item, ctx.now), ctx.branch.settings.stopListMode);
    const groups = (ctx.groups.get(dish.id) ?? []).filter((g) => g.isActive && g.options.some((o) => o.isActive));
    return {
      id: dish.id,
      slug: dish.slug,
      categoryId: dish.categoryId,
      categorySlug: row.categorySlug,
      name: translate(dish.name, ctx.locale),
      description: translate(dish.description, ctx.locale),
      price: item.price,
      available: availability === 'available',
      availability,
      weightGrams: dish.weightGrams,
      calories: dish.calories,
      isVegetarian: dish.isVegetarian,
      spicyLevel: dish.spicyLevel,
      isHalal: dish.isHalal,
      allergens: dish.allergens.map((code) => ({ code, name: translate(allergenLabel(code), ctx.locale) })),
      photo: this.images.view(ctx.photos.get(dish.id)?.[0], 'dishes'),
      hasModifiers: groups.length > 0,
      hasRequiredModifiers: groups.some(isRequiredGroup),
      updatedAt: laterOf(dish.updatedAt, item.updatedAt),
    };
  }

  private itemLd(card: PublicDishCard): MenuItemLd {
    return {
      name: card.name,
      description: card.description,
      url: null,
      image: card.photo?.url ?? null,
      price: card.price,
      available: card.available,
      isVegetarian: card.isVegetarian,
      isHalal: card.isHalal,
      calories: card.calories,
      weightGrams: card.weightGrams,
    };
  }

  private publicCategory(category: CategoryRecord, dishCount: number, branch: BranchInfo, locale: Locale): PublicCategory {
    return {
      id: category.id,
      slug: category.slug,
      name: translate(category.name, locale),
      description: translate(category.description, locale),
      image: this.images.view(category.image, 'categories'),
      seo: buildSeo(
        {
          seoTitle: category.seoTitle,
          seoDescription: category.seoDescription,
          name: category.name,
          fallbackDescriptions: [category.description],
          titleSuffix: translate(branch.name, locale),
        },
        locale,
      ),
      dishCount,
      updatedAt: category.updatedAt,
    };
  }

  /** Категории меню филиала, в которых есть видимые блюда (в порядке меню). */
  private sections(rows: MenuRow[], categories: CategoryRecord[]): Array<{ category: CategoryRecord; rows: MenuRow[] }> {
    const byCategory = new Map<string, MenuRow[]>();
    for (const r of rows) byCategory.set(r.dish.categoryId, [...(byCategory.get(r.dish.categoryId) ?? []), r]);
    return categories.filter((c) => byCategory.has(c.id)).map((category) => ({ category, rows: byCategory.get(category.id)! }));
  }

  async menuOf(branchSlug: string, locale: Locale): Promise<PublicMenu> {
    const branch = await this.branch(branchSlug);
    const now = this.clock.now();
    const [{ rows }, categories] = await Promise.all([this.menu.list(this.baseFilter(branch, now)), this.categories.list({ activeOnly: true })]);
    const ctx = await this.context(branch, locale, now, rows);
    const sections = this.sections(rows, categories).map(({ category, rows: sectionRows }) => ({
      ...this.publicCategory(category, sectionRows.length, branch, locale),
      dishes: sectionRows.map((r) => this.card(r, ctx)),
    }));
    const branchName = translate(branch.name, locale);
    return {
      branch: this.branchRef(branch, locale),
      locale,
      seo: buildSeo(
        {
          seoTitle: null,
          seoDescription: null,
          name: { ru: `Меню — ${branchName}`, kk: `Мәзір — ${branchName}`, en: `Menu — ${branchName}` },
          fallbackDescriptions: [
            {
              ru: `Меню ресторана ${branchName}: ${sections.map((s) => s.name).join(', ')}. Доставка и самовывоз.`,
              kk: `${branchName} мейрамханасының мәзірі: ${sections.map((s) => s.name).join(', ')}. Жеткізу және алып кету.`,
              en: `${branchName} menu: ${sections.map((s) => s.name).join(', ')}. Delivery and pickup.`,
            },
          ],
        },
        locale,
      ),
      categories: sections,
      structuredData: menuJsonLd({
        name: branchName,
        locale,
        url: null,
        sections: sections.map((s) => ({ name: s.name, description: s.description, items: s.dishes.map((d) => this.itemLd(d)) })),
      }),
    };
  }

  async categoryPage(branchSlug: string, categorySlug: string, locale: Locale): Promise<PublicCategoryPage> {
    const branch = await this.branch(branchSlug);
    const category = await this.categories.findBySlug(categorySlug);
    if (!category || !category.isActive) throw new NotFoundError('category', categorySlug);
    const now = this.clock.now();
    const [{ rows }, categories] = await Promise.all([this.menu.list(this.baseFilter(branch, now)), this.categories.list({ activeOnly: true })]);
    const ctx = await this.context(branch, locale, now, rows.filter((r) => r.dish.categoryId === category.id));
    const sections = this.sections(rows, categories);
    const own = sections.find((s) => s.category.id === category.id)?.rows ?? [];
    const dishes = own.map((r) => this.card(r, ctx));
    const publicCategory = this.publicCategory(category, dishes.length, branch, locale);
    return {
      branch: this.branchRef(branch, locale),
      locale,
      category: publicCategory,
      categories: sections.map((s) => this.publicCategory(s.category, s.rows.length, branch, locale)),
      dishes,
      structuredData: menuJsonLd({
        name: `${publicCategory.name} — ${translate(branch.name, locale)}`,
        locale,
        url: null,
        sections: [{ name: publicCategory.name, description: publicCategory.description, items: dishes.map((d) => this.itemLd(d)) }],
      }),
    };
  }

  async dish(branchSlug: string, dishSlug: string, locale: Locale): Promise<PublicDishDetail> {
    const branch = await this.branch(branchSlug);
    const now = this.clock.now();
    const { rows } = await this.menu.list({ ...this.baseFilter(branch, now), dishSlug });
    const row = rows[0];
    if (!row) throw new NotFoundError('dish', dishSlug);
    const ctx = await this.context(branch, locale, now, [row]);
    const card = this.card(row, ctx);
    const category = (await this.categories.findById(row.dish.categoryId))!;
    const groups = (ctx.groups.get(row.dish.id) ?? []).filter((g) => g.isActive && g.options.some((o) => o.isActive));
    const photos = (ctx.photos.get(row.dish.id) ?? []).map((p) => this.images.view(p, 'dishes')).filter((p): p is ImageView => !!p);
    return {
      ...card,
      composition: translate(row.dish.composition, locale),
      photos,
      modifierGroups: groups.map((g) => ({
        id: g.id,
        name: translate(g.name, locale),
        description: translate(g.description, locale),
        minSelect: g.minSelect,
        maxSelect: g.maxSelect,
        isRequired: isRequiredGroup(g),
        options: g.options
          .filter((o) => o.isActive)
          .map((o) => ({ id: o.id, name: translate(o.name, locale), price: o.price, isDefault: o.isDefault })),
      })),
      category: { id: category.id, slug: category.slug, name: translate(category.name, locale) },
      branch: this.branchRef(branch, locale),
      seo: buildSeo(
        {
          seoTitle: row.dish.seoTitle,
          seoDescription: row.dish.seoDescription,
          name: row.dish.name,
          fallbackDescriptions: [row.dish.description, row.dish.composition],
          titleSuffix: translate(branch.name, locale),
        },
        locale,
      ),
      structuredData: { '@context': 'https://schema.org', ...menuItemJsonLd(this.itemLd(card)) },
    };
  }

  async search(branchSlug: string, filter: MenuSearchFilter, page: PageRequest, locale: Locale): Promise<Page<PublicDishCard>> {
    const branch = await this.branch(branchSlug);
    let categoryId: string | null = null;
    if (filter.categorySlug) {
      const category = await this.categories.findBySlug(filter.categorySlug);
      if (!category || !category.isActive) return { items: [], total: 0, page: page.page, perPage: page.perPage };
      categoryId = category.id;
    }
    const now = this.clock.now();
    const { rows, total } = await this.menu.list(
      {
        ...this.baseFilter(branch, now),
        categoryId,
        q: normalizeSearchQuery(filter.q),
        vegetarian: filter.vegetarian,
        spicy: filter.spicy,
        maxSpicyLevel: filter.maxSpicyLevel,
        halal: filter.halal,
        maxPriceAmount: filter.maxPriceAmount,
      },
      page,
    );
    const ctx = await this.context(branch, locale, now, rows);
    return { items: rows.map((r) => this.card(r, ctx)), total, page: page.page, perPage: page.perPage };
  }

  /** Данные для sitemap: активные филиалы, категории и блюда (с учётом стоп-листа «скрыть»), страницы, акции. */
  async sitemap(): Promise<SitemapView> {
    const now = this.clock.now();
    const branches = await this.branches.list({ activeOnly: true });
    const categories = await this.categories.list({ activeOnly: true });
    const result: SitemapView = { branches: [], categories: [], dishes: [], pages: [], promotions: [] };
    for (const branch of branches) {
      const { rows } = await this.menu.list(this.baseFilter(branch, now));
      let branchUpdated: Date | null = null;
      for (const { category, rows: sectionRows } of this.sections(rows, categories)) {
        let categoryUpdated = category.updatedAt;
        for (const r of sectionRows) {
          const updatedAt = laterOf(r.dish.updatedAt, r.item.updatedAt);
          categoryUpdated = laterOf(categoryUpdated, updatedAt);
          result.dishes.push({ branchSlug: branch.slug, categorySlug: category.slug, slug: r.dish.slug, updatedAt });
        }
        branchUpdated = branchUpdated ? laterOf(branchUpdated, categoryUpdated) : categoryUpdated;
        result.categories.push({ branchSlug: branch.slug, slug: category.slug, updatedAt: categoryUpdated });
      }
      result.branches.push({ slug: branch.slug, updatedAt: branchUpdated });
    }
    result.pages = (await this.pages.list({ publishedOnly: true })).map((p) => ({ slug: p.slug, updatedAt: p.updatedAt }));
    result.promotions = (await this.promotions.list({ activeOnly: true }))
      .filter((p) => isPromotionVisible(p, now, null))
      .map((p) => ({ slug: p.slug, updatedAt: p.updatedAt }));
    return result;
  }
}
