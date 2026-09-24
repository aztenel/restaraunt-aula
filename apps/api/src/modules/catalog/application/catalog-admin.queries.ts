import { Injectable } from '@nestjs/common';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { ForbiddenError, NotFoundError } from '../../../shared/kernel/errors';
import { Money } from '../../../shared/kernel/money';
import { Page, PageRequest } from '../../../shared/kernel/pagination';
import { Permission } from '../../../shared/kernel/permissions';
import { Translatable } from '../../../shared/kernel/translatable';
import { BranchDirectory } from '../../identity/public';
import { ALLERGEN_CODES, allergenLabel, AllergenCode } from '../domain/allergens';
import { isRequiredGroup } from '../domain/modifiers';
import { normalizeSearchQuery } from '../domain/search';
import { displayAvailability, effectiveAvailability, MenuItemAvailability, StopSource } from '../domain/stop-list';
import { missingTranslations, MissingTranslation } from '../domain/translations';
import { BranchMenuItemRecord, BranchMenuRepository } from '../infrastructure/branch-menu.repository';
import { CategoryRecord, CategoryRepository } from '../infrastructure/category.repository';
import { DishPhotoRecord, DishRecord, DishRepository } from '../infrastructure/dish.repository';
import { ModifierGroupRecord, ModifierRepository } from '../infrastructure/modifier.repository';
import { DishAvailability } from '../public';
import { ImageUrls, ImageView } from './image-urls';

/** Права, дающие доступ к разделу «Меню» админки (просмотр справочников). */
export const MENU_READ_PERMISSIONS = [Permission.MenuContent, Permission.MenuPrices, Permission.MenuStopList] as const;

export function assertAnySomewhere(actor: Actor, permissions: readonly Permission[]): void {
  if (!permissions.some((p) => actor.canSomewhere(p))) {
    throw new ForbiddenError('access.forbidden', 'Not enough permissions', { required: permissions });
  }
}

export function assertAnyInBranch(actor: Actor, permissions: readonly Permission[], branchId: string): void {
  if (!permissions.some((p) => actor.can(p, branchId))) {
    throw new ForbiddenError('access.forbidden_branch', 'No access to this branch menu', { branchId, required: permissions });
  }
}

export interface AdminCategoryView extends Omit<CategoryRecord, 'image'> {
  image: ImageView | null;
  dishCount: number;
  missingTranslations: MissingTranslation[];
}

export interface AdminPhotoView extends ImageView {
  sortOrder: number;
}

export interface AdminBranchPriceView {
  branchId: string;
  price: Money;
  availability: MenuItemAvailability;
  stoppedUntil: Date | null;
  sku: string | null;
}

export interface AdminDishView extends DishRecord {
  photos: AdminPhotoView[];
  modifierGroupIds: string[];
  missingTranslations: MissingTranslation[];
  /** Цены по филиалам, доступным сотруднику (только в карточке блюда). */
  branchPrices?: AdminBranchPriceView[];
}

export interface AdminModifierGroupView extends ModifierGroupRecord {
  isRequired: boolean;
  dishCount: number;
}

export interface AdminBranchMenuItemView {
  branchId: string;
  dishId: string;
  dishSlug: string;
  dishName: Translatable;
  categoryId: string;
  dishIsActive: boolean;
  photo: ImageView | null;
  price: Money;
  availability: MenuItemAvailability;
  /** Как блюдо видно на витрине с учётом настройки филиала. */
  displayAvailability: DishAvailability;
  stoppedUntil: Date | null;
  stopReason: string | null;
  stopSource: StopSource | null;
  stoppedAt: Date | null;
  /** Код POS филиала (переопределение). */
  sku: string | null;
  /** Код, который уходит в POS: филиала или общий код блюда. */
  effectiveSku: string | null;
  updatedBy: string | null;
  updatedAt: Date;
}

export interface BranchMenuFilter {
  q?: string | null;
  categoryId?: string | null;
  availability?: MenuItemAvailability | null;
}

export interface AllergenRef {
  code: AllergenCode;
  name: Translatable;
}

function dishTranslations(d: DishRecord): MissingTranslation[] {
  return missingTranslations([
    { field: 'name', value: d.name, required: true },
    { field: 'description', value: d.description, required: false },
    { field: 'composition', value: d.composition, required: false },
    { field: 'seoTitle', value: d.seoTitle, required: false },
    { field: 'seoDescription', value: d.seoDescription, required: false },
  ]);
}

/** Чтение справочников меню и меню филиалов для админки. */
@Injectable()
export class CatalogAdminQueries {
  constructor(
    private readonly categories: CategoryRepository,
    private readonly dishes: DishRepository,
    private readonly modifiers: ModifierRepository,
    private readonly branchMenu: BranchMenuRepository,
    private readonly branches: BranchDirectory,
    private readonly images: ImageUrls,
    private readonly clock: Clock,
  ) {}

  private categoryView(c: CategoryRecord, dishCount: number): AdminCategoryView {
    return {
      ...c,
      image: this.images.view(c.image, 'categories'),
      dishCount,
      missingTranslations: missingTranslations([
        { field: 'name', value: c.name, required: true },
        { field: 'description', value: c.description, required: false },
        { field: 'seoTitle', value: c.seoTitle, required: false },
        { field: 'seoDescription', value: c.seoDescription, required: false },
      ]),
    };
  }

  private photoViews(photos: DishPhotoRecord[]): AdminPhotoView[] {
    return photos.map((p) => ({ ...this.images.view(p, 'dishes')!, sortOrder: p.sortOrder }));
  }

  async categoryList(actor: Actor): Promise<AdminCategoryView[]> {
    assertAnySomewhere(actor, MENU_READ_PERMISSIONS);
    const [list, counts] = await Promise.all([this.categories.list(), this.categories.dishCounts()]);
    return list.map((c) => this.categoryView(c, counts.get(c.id) ?? 0));
  }

  async category(actor: Actor, id: string): Promise<AdminCategoryView> {
    assertAnySomewhere(actor, MENU_READ_PERMISSIONS);
    const c = await this.categories.findById(id);
    if (!c) throw new NotFoundError('category', id);
    return this.categoryView(c, await this.dishes.countInCategory(id));
  }

  async dishPage(
    actor: Actor,
    filter: { q?: string | null; categoryId?: string | null; isActive?: boolean | null; notInBranchId?: string | null },
    page: PageRequest,
  ): Promise<Page<AdminDishView>> {
    assertAnySomewhere(actor, MENU_READ_PERMISSIONS);
    const result = await this.dishes.search({ ...filter, q: normalizeSearchQuery(filter.q) }, page);
    const ids = result.items.map((d) => d.id);
    const [photos, groups] = await Promise.all([this.dishes.photosFor(ids), this.dishes.modifierGroupIdsFor(ids)]);
    return {
      ...result,
      items: result.items.map((d) => ({
        ...d,
        photos: this.photoViews(photos.get(d.id) ?? []),
        modifierGroupIds: groups.get(d.id) ?? [],
        missingTranslations: dishTranslations(d),
      })),
    };
  }

  async dish(actor: Actor, id: string): Promise<AdminDishView> {
    assertAnySomewhere(actor, MENU_READ_PERMISSIONS);
    const d = await this.dishes.findById(id);
    if (!d) throw new NotFoundError('dish', id);
    const [photos, groupIds, items] = await Promise.all([this.dishes.photos(id), this.dishes.modifierGroupIds(id), this.branchMenu.listForDish(id)]);
    return {
      ...d,
      photos: this.photoViews(photos),
      modifierGroupIds: groupIds,
      missingTranslations: dishTranslations(d),
      branchPrices: items
        .filter((i) => MENU_READ_PERMISSIONS.some((p) => actor.can(p, i.branchId)))
        .map((i) => ({ branchId: i.branchId, price: i.price, availability: i.availability, stoppedUntil: i.stoppedUntil, sku: i.sku })),
    };
  }

  async modifierGroupList(actor: Actor): Promise<AdminModifierGroupView[]> {
    assertAnySomewhere(actor, MENU_READ_PERMISSIONS);
    const [groups, counts] = await Promise.all([this.modifiers.list(), this.modifiers.dishCounts()]);
    return groups.map((g) => ({ ...g, isRequired: isRequiredGroup(g), dishCount: counts.get(g.id) ?? 0 }));
  }

  async modifierGroup(actor: Actor, id: string): Promise<AdminModifierGroupView> {
    assertAnySomewhere(actor, MENU_READ_PERMISSIONS);
    const g = await this.modifiers.findById(id);
    if (!g) throw new NotFoundError('modifier_group', id);
    return { ...g, isRequired: isRequiredGroup(g), dishCount: (await this.modifiers.dishIdsUsing(id)).length };
  }

  /** Меню филиала: цены, доступность, стоп-лист (право в этом филиале). */
  async branchMenuPage(actor: Actor, branchId: string, filter: BranchMenuFilter, page: PageRequest): Promise<Page<AdminBranchMenuItemView>> {
    const items = await this.branchItems(actor, branchId, filter);
    const start = (page.page - 1) * page.perPage;
    return { items: items.slice(start, start + page.perPage), total: items.length, page: page.page, perPage: page.perPage };
  }

  async branchMenuItem(actor: Actor, branchId: string, dishId: string): Promise<AdminBranchMenuItemView> {
    const item = (await this.branchItems(actor, branchId, {})).find((i) => i.dishId === dishId);
    if (!item) throw new NotFoundError('branch_menu_item', dishId, { branchId });
    return item;
  }

  /** Текущий стоп-лист филиала (блюда, которые сейчас в стопе). */
  async stopList(actor: Actor, branchId: string): Promise<AdminBranchMenuItemView[]> {
    return this.branchItems(actor, branchId, { availability: 'stopped' });
  }

  private async branchItems(actor: Actor, branchId: string, filter: BranchMenuFilter): Promise<AdminBranchMenuItemView[]> {
    assertAnyInBranch(actor, MENU_READ_PERMISSIONS, branchId);
    const branch = await this.branches.find(branchId);
    if (!branch) throw new NotFoundError('branch', branchId);
    const now = this.clock.now();
    const items = await this.branchMenu.listForBranch(branchId);
    const dishes = new Map((await this.dishes.findManyByIds(items.map((i) => i.dishId))).map((d) => [d.id, d]));
    const categories = new Map((await this.categories.list()).map((c, index) => [c.id, index]));
    const photos = await this.dishes.photosFor([...dishes.keys()]);
    const q = normalizeSearchQuery(filter.q)?.toLowerCase() ?? null;
    const rows: Array<{ item: BranchMenuItemRecord; dish: DishRecord }> = [];
    for (const item of items) {
      const dish = dishes.get(item.dishId);
      if (!dish) continue;
      if (filter.categoryId && dish.categoryId !== filter.categoryId) continue;
      if (filter.availability && effectiveAvailability(item, now) !== filter.availability) continue;
      if (q) {
        const haystack = [dish.slug, dish.sku ?? '', item.sku ?? '', ...Object.values(dish.name)].join(' ').toLowerCase();
        if (!haystack.includes(q)) continue;
      }
      rows.push({ item, dish });
    }
    rows.sort(
      (a, b) =>
        (categories.get(a.dish.categoryId) ?? 0) - (categories.get(b.dish.categoryId) ?? 0) ||
        a.dish.sortOrder - b.dish.sortOrder ||
        a.dish.createdAt.getTime() - b.dish.createdAt.getTime(),
    );
    return rows.map(({ item, dish }) => {
      const effective = effectiveAvailability(item, now);
      return {
        branchId,
        dishId: dish.id,
        dishSlug: dish.slug,
        dishName: dish.name,
        categoryId: dish.categoryId,
        dishIsActive: dish.isActive,
        photo: this.images.view(photos.get(dish.id)?.[0], 'dishes'),
        price: item.price,
        availability: effective,
        displayAvailability: displayAvailability(effective, branch.settings.stopListMode),
        stoppedUntil: effective === 'stopped' ? item.stoppedUntil : null,
        stopReason: effective === 'stopped' ? item.stopReason : null,
        stopSource: effective === 'stopped' ? item.stopSource : null,
        stoppedAt: effective === 'stopped' ? item.stoppedAt : null,
        sku: item.sku,
        effectiveSku: item.sku ?? dish.sku,
        updatedBy: item.updatedBy,
        updatedAt: item.updatedAt,
      };
    });
  }

  allergens(): AllergenRef[] {
    return ALLERGEN_CODES.map((code) => ({ code, name: allergenLabel(code) }));
  }
}
