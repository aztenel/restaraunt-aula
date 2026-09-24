import { Injectable } from '@nestjs/common';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { Database } from '../../../shared/infrastructure/database/database';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/kernel/errors';
import { newId } from '../../../shared/kernel/ids';
import { Permission } from '../../../shared/kernel/permissions';
import { Translatable } from '../../../shared/kernel/translatable';
import { optionalText, requiredText, TEXT_LIMITS } from '../domain/dish';
import { assertSlug, generateUniqueSlug } from '../domain/slug';
import { CategoryRecord, CategoryRepository, CategoryWrite } from '../infrastructure/category.repository';
import { guardUnique } from '../infrastructure/db-errors';
import { DishRepository } from '../infrastructure/dish.repository';
import { ImageProcessor, UploadedImage } from '../infrastructure/image-processor';
import { CatalogEventPublisher } from './catalog-events';

export interface CategoryInput {
  /** Не задан — транслитерация из названия (ru, затем kk). */
  slug?: string | null;
  name: Translatable;
  description?: Translatable | null;
  seoTitle?: Translatable | null;
  seoDescription?: Translatable | null;
  sortOrder?: number | null;
  isActive?: boolean | null;
}

async function toWrite(input: CategoryInput, current: CategoryRecord | null, repo: CategoryRepository): Promise<CategoryWrite> {
  const name = requiredText(input.name, TEXT_LIMITS.name, 'name');
  let slug: string;
  if (input.slug) {
    slug = assertSlug(input.slug);
    if (await repo.slugTaken(slug, current?.id)) {
      throw new ConflictError('catalog.slug_taken', 'Category with this slug already exists', { slug });
    }
  } else if (current) {
    slug = current.slug;
  } else {
    slug = await generateUniqueSlug(name, 'category', (s) => repo.slugTaken(s));
  }
  return {
    slug,
    name,
    description: optionalText(input.description === undefined ? current?.description : input.description, TEXT_LIMITS.description, 'description'),
    seoTitle: optionalText(input.seoTitle === undefined ? current?.seoTitle : input.seoTitle, TEXT_LIMITS.seoTitle, 'seoTitle'),
    seoDescription: optionalText(
      input.seoDescription === undefined ? current?.seoDescription : input.seoDescription,
      TEXT_LIMITS.seoDescription,
      'seoDescription',
    ),
    sortOrder: input.sortOrder ?? current?.sortOrder ?? 0,
    isActive: input.isActive ?? current?.isActive ?? true,
  };
}

@Injectable()
export class CreateCategory {
  constructor(
    private readonly categories: CategoryRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly events: CatalogEventPublisher,
  ) {}

  async execute(actor: Actor, input: CategoryInput): Promise<string> {
    actor.assertCan(Permission.MenuContent);
    const id = newId();
    await guardUnique(
      () =>
        this.database.transaction(async () => {
          const data = await toWrite(input, null, this.categories);
          await this.categories.insert(id, data);
          await this.audit.record({ action: 'menu.category_created', entityType: 'category', entityId: id, after: data });
          await this.events.menuChanged({ branchId: null, categoryId: id });
        }),
      'catalog.slug_taken',
      'Category with this slug already exists',
    );
    return id;
  }
}

@Injectable()
export class UpdateCategory {
  constructor(
    private readonly categories: CategoryRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly events: CatalogEventPublisher,
  ) {}

  async execute(actor: Actor, id: string, input: CategoryInput): Promise<void> {
    actor.assertCan(Permission.MenuContent);
    await guardUnique(
      () =>
        this.database.transaction(async () => {
          const current = await this.categories.findById(id);
          if (!current) throw new NotFoundError('category', id);
          const data = await toWrite(input, current, this.categories);
          await this.categories.update(id, data);
          const { image: _image, createdAt: _c, updatedAt: _u, id: _id, ...before } = current;
          await this.audit.record({ action: 'menu.category_updated', entityType: 'category', entityId: id, before, after: data });
          await this.events.menuChanged({ branchId: null, categoryId: id });
        }),
      'catalog.slug_taken',
      'Category with this slug already exists',
    );
  }
}

@Injectable()
export class DeleteCategory {
  constructor(
    private readonly categories: CategoryRepository,
    private readonly dishes: DishRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly events: CatalogEventPublisher,
    private readonly clock: Clock,
  ) {}

  /** Логическое удаление. Категорию с блюдами удалить нельзя — сначала перенести или удалить блюда. */
  async execute(actor: Actor, id: string): Promise<void> {
    actor.assertCan(Permission.MenuContent);
    await this.database.transaction(async () => {
      const current = await this.categories.findById(id);
      if (!current) throw new NotFoundError('category', id);
      const dishCount = await this.dishes.countInCategory(id);
      if (dishCount > 0) {
        throw new ConflictError('catalog.category_not_empty', 'Category has dishes: move or delete them first', { dishCount });
      }
      await this.categories.softDelete(id, this.clock.now());
      await this.audit.record({ action: 'menu.category_deleted', entityType: 'category', entityId: id, before: current });
      await this.events.menuChanged({ branchId: null, categoryId: id });
    });
  }
}

@Injectable()
export class ReorderCategories {
  constructor(
    private readonly categories: CategoryRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly events: CatalogEventPublisher,
  ) {}

  /** Порядок категорий в меню: переданный список id — все категории в нужном порядке. */
  async execute(actor: Actor, ids: string[]): Promise<void> {
    actor.assertCan(Permission.MenuContent);
    if (new Set(ids).size !== ids.length) throw new ValidationError('catalog.duplicate_ids', 'Duplicate ids in order');
    await this.database.transaction(async () => {
      const all = await this.categories.list();
      const known = new Set(all.map((c) => c.id));
      const unknown = ids.filter((id) => !known.has(id));
      if (unknown.length > 0) throw new ValidationError('catalog.unknown_category', 'Unknown categories in order', { ids: unknown });
      const before = all.map((c) => ({ id: c.id, sortOrder: c.sortOrder }));
      const rest = all.filter((c) => !ids.includes(c.id)).map((c) => c.id);
      const order = [...ids, ...rest];
      for (const [index, id] of order.entries()) {
        await this.categories.setSortOrder(id, (index + 1) * 10);
      }
      await this.audit.record({
        action: 'menu.categories_reordered',
        entityType: 'category',
        entityId: 'order',
        before,
        after: order.map((id, i) => ({ id, sortOrder: (i + 1) * 10 })),
      });
      await this.events.menuChanged({ branchId: null });
    });
  }
}

@Injectable()
export class SetCategoryImage {
  constructor(
    private readonly categories: CategoryRepository,
    private readonly images: ImageProcessor,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly events: CatalogEventPublisher,
  ) {}

  async execute(actor: Actor, id: string, file: UploadedImage): Promise<void> {
    actor.assertCan(Permission.MenuContent);
    const current = await this.categories.findById(id);
    if (!current) throw new NotFoundError('category', id);
    const image = await this.images.store('categories', id, file);
    try {
      await this.database.transaction(async () => {
        await this.categories.setImage(id, image);
        await this.audit.record({
          action: 'menu.category_image_changed',
          entityType: 'category',
          entityId: id,
          before: current.image,
          after: image,
        });
        await this.events.menuChanged({ branchId: null, categoryId: id });
      });
    } catch (err) {
      await this.images.remove(image);
      throw err;
    }
  }
}

@Injectable()
export class RemoveCategoryImage {
  constructor(
    private readonly categories: CategoryRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly events: CatalogEventPublisher,
  ) {}

  async execute(actor: Actor, id: string): Promise<void> {
    actor.assertCan(Permission.MenuContent);
    await this.database.transaction(async () => {
      const current = await this.categories.findById(id);
      if (!current) throw new NotFoundError('category', id);
      if (!current.image) return;
      await this.categories.setImage(id, null);
      await this.audit.record({ action: 'menu.category_image_removed', entityType: 'category', entityId: id, before: current.image });
      await this.events.menuChanged({ branchId: null, categoryId: id });
    });
  }
}
