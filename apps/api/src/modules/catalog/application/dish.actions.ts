import { Injectable } from '@nestjs/common';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { Database } from '../../../shared/infrastructure/database/database';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/kernel/errors';
import { newId } from '../../../shared/kernel/ids';
import { Permission } from '../../../shared/kernel/permissions';
import { Translatable } from '../../../shared/kernel/translatable';
import { normalizeSku, optionalText, requiredText, TEXT_LIMITS, validateDishAttributes } from '../domain/dish';
import { assertSlug, generateUniqueSlug } from '../domain/slug';
import { BranchMenuRepository } from '../infrastructure/branch-menu.repository';
import { CategoryRepository } from '../infrastructure/category.repository';
import { guardUnique } from '../infrastructure/db-errors';
import { DishRecord, DishRepository, DishWrite } from '../infrastructure/dish.repository';
import { ModifierRepository } from '../infrastructure/modifier.repository';
import { CatalogEventPublisher } from './catalog-events';

/** Карточка блюда. Цены здесь нет: цена задаётся в меню филиала (BranchDishPrice). */
export interface DishInput {
  slug?: string | null;
  categoryId: string;
  name: Translatable;
  description?: Translatable | null;
  composition?: Translatable | null;
  seoTitle?: Translatable | null;
  seoDescription?: Translatable | null;
  weightGrams?: number | null;
  calories?: number | null;
  isVegetarian?: boolean | null;
  spicyLevel?: number | null;
  isHalal?: boolean | null;
  allergens?: string[] | null;
  /** Общий код блюда в POS сети. */
  sku?: string | null;
  sortOrder?: number | null;
  isActive?: boolean | null;
  /** Группы модификаторов в порядке показа; не задано — без изменений. */
  modifierGroupIds?: string[] | null;
}

interface DishDeps {
  dishes: DishRepository;
  categories: CategoryRepository;
  modifiers: ModifierRepository;
  branchMenu: BranchMenuRepository;
}

async function toWrite(input: DishInput, current: DishRecord | null, deps: DishDeps): Promise<DishWrite> {
  const name = requiredText(input.name, TEXT_LIMITS.name, 'name');
  const category = await deps.categories.findById(input.categoryId);
  if (!category) throw new ValidationError('catalog.unknown_category', 'Category not found', { categoryId: input.categoryId });

  let slug: string;
  if (input.slug) {
    slug = assertSlug(input.slug);
    if (await deps.dishes.slugTaken(slug, current?.id)) {
      throw new ConflictError('catalog.slug_taken', 'Dish with this slug already exists', { slug });
    }
  } else if (current) {
    slug = current.slug;
  } else {
    slug = await generateUniqueSlug(name, 'dish', (s) => deps.dishes.slugTaken(s));
  }

  const sku = input.sku === undefined ? (current?.sku ?? null) : normalizeSku(input.sku);
  if (sku) {
    const owner = await deps.dishes.skuOwner(sku, current?.id);
    const branchOwners = (await deps.branchMenu.dishIdsByBranchSku(sku)).filter((id) => id !== current?.id);
    if (owner || branchOwners.length > 0) {
      throw new ConflictError('catalog.sku_taken', 'This POS code is already used by another dish', { sku });
    }
  }

  const pick = <K extends keyof DishInput>(key: K, fallback: Translatable | undefined) =>
    (input[key] === undefined ? fallback : input[key]) as Translatable | null | undefined;

  return {
    slug,
    categoryId: category.id,
    name,
    description: optionalText(pick('description', current?.description), TEXT_LIMITS.description, 'description'),
    composition: optionalText(pick('composition', current?.composition), TEXT_LIMITS.composition, 'composition'),
    seoTitle: optionalText(pick('seoTitle', current?.seoTitle), TEXT_LIMITS.seoTitle, 'seoTitle'),
    seoDescription: optionalText(pick('seoDescription', current?.seoDescription), TEXT_LIMITS.seoDescription, 'seoDescription'),
    ...validateDishAttributes(input, current),
    sku,
    sortOrder: input.sortOrder ?? current?.sortOrder ?? 0,
    isActive: input.isActive ?? current?.isActive ?? true,
  };
}

async function validateGroupIds(ids: string[] | null | undefined, modifiers: ModifierRepository): Promise<string[] | null> {
  if (ids === null || ids === undefined) return null;
  if (new Set(ids).size !== ids.length) {
    throw new ValidationError('catalog.duplicate_ids', 'Modifier group linked twice');
  }
  const found = new Set((await modifiers.findByIds(ids)).map((g) => g.id));
  const unknown = ids.filter((id) => !found.has(id));
  if (unknown.length > 0) {
    throw new ValidationError('catalog.unknown_modifier_group', 'Modifier group not found', { ids: unknown });
  }
  return ids;
}

function auditView(dish: DishWrite & Partial<Pick<DishRecord, 'id' | 'createdAt' | 'updatedAt'>>, groupIds: string[]) {
  const { createdAt: _c, updatedAt: _u, ...rest } = dish;
  return { ...rest, modifierGroupIds: groupIds };
}

@Injectable()
export class CreateDish {
  constructor(
    private readonly dishes: DishRepository,
    private readonly categories: CategoryRepository,
    private readonly modifiers: ModifierRepository,
    private readonly branchMenu: BranchMenuRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly events: CatalogEventPublisher,
  ) {}

  private deps(): DishDeps {
    return { dishes: this.dishes, categories: this.categories, modifiers: this.modifiers, branchMenu: this.branchMenu };
  }

  async execute(actor: Actor, input: DishInput): Promise<string> {
    actor.assertCan(Permission.MenuContent);
    const id = newId();
    await guardUnique(
      () =>
        this.database.transaction(async () => {
          const data = await toWrite(input, null, this.deps());
          const groupIds = (await validateGroupIds(input.modifierGroupIds, this.modifiers)) ?? [];
          await this.dishes.insert(id, data);
          await this.dishes.replaceModifierGroups(id, groupIds);
          await this.audit.record({ action: 'menu.dish_created', entityType: 'dish', entityId: id, after: auditView(data, groupIds) });
          await this.events.menuChanged({ branchId: null, dishId: id, categoryId: data.categoryId });
        }),
      'catalog.slug_taken',
      'Dish with this slug or POS code already exists',
    );
    return id;
  }
}

@Injectable()
export class UpdateDish {
  constructor(
    private readonly dishes: DishRepository,
    private readonly categories: CategoryRepository,
    private readonly modifiers: ModifierRepository,
    private readonly branchMenu: BranchMenuRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly events: CatalogEventPublisher,
  ) {}

  private deps(): DishDeps {
    return { dishes: this.dishes, categories: this.categories, modifiers: this.modifiers, branchMenu: this.branchMenu };
  }

  async execute(actor: Actor, id: string, input: DishInput): Promise<void> {
    actor.assertCan(Permission.MenuContent);
    await guardUnique(
      () =>
        this.database.transaction(async () => {
          const current = await this.dishes.findById(id);
          if (!current) throw new NotFoundError('dish', id);
          const currentGroups = await this.dishes.modifierGroupIds(id);
          const data = await toWrite(input, current, this.deps());
          const groupIds = (await validateGroupIds(input.modifierGroupIds, this.modifiers)) ?? currentGroups;
          await this.dishes.update(id, data);
          await this.dishes.replaceModifierGroups(id, groupIds);
          await this.audit.record({
            action: 'menu.dish_updated',
            entityType: 'dish',
            entityId: id,
            before: auditView(current, currentGroups),
            after: auditView(data, groupIds),
          });
          await this.events.menuChanged({ branchId: null, dishId: id, categoryId: data.categoryId });
          if (current.categoryId !== data.categoryId) {
            await this.events.menuChanged({ branchId: null, categoryId: current.categoryId });
          }
        }),
      'catalog.slug_taken',
      'Dish with this slug or POS code already exists',
    );
  }
}

@Injectable()
export class DeleteDish {
  constructor(
    private readonly dishes: DishRepository,
    private readonly branchMenu: BranchMenuRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly events: CatalogEventPublisher,
    private readonly clock: Clock,
  ) {}

  /**
   * Логическое удаление блюда: убирается из меню всех филиалов (цены — в журнале).
   * Прошлые заказы и сметы не меняются — у них снимок позиции.
   */
  async execute(actor: Actor, id: string): Promise<void> {
    actor.assertCan(Permission.MenuContent);
    await this.database.transaction(async () => {
      const current = await this.dishes.findById(id);
      if (!current) throw new NotFoundError('dish', id);
      const now = this.clock.now();
      const removed = await this.branchMenu.softDeleteAllForDish(id, now, actor.userId);
      await this.dishes.softDelete(id, now);
      await this.audit.record({
        action: 'menu.dish_deleted',
        entityType: 'dish',
        entityId: id,
        before: {
          ...auditView(current, await this.dishes.modifierGroupIds(id)),
          branchPrices: removed.map((r) => ({ branchId: r.branchId, price: r.price.toJSON(), availability: r.availability })),
        },
      });
      for (const item of removed) {
        await this.audit.record({
          action: 'menu.item_removed',
          entityType: 'branch_dish_price',
          entityId: id,
          branchId: item.branchId,
          before: { price: item.price.toJSON(), availability: item.availability, sku: item.sku },
          meta: { reason: 'dish_deleted' },
        });
        await this.events.menuChanged({ branchId: item.branchId, dishId: id });
      }
      await this.events.menuChanged({ branchId: null, dishId: id, categoryId: current.categoryId });
    });
  }
}
