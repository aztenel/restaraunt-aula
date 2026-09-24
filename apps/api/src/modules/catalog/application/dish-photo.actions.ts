import { Injectable } from '@nestjs/common';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { Database } from '../../../shared/infrastructure/database/database';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { NotFoundError, ValidationError } from '../../../shared/kernel/errors';
import { Permission } from '../../../shared/kernel/permissions';
import { MAX_PHOTOS_PER_DISH, StoredImage } from '../domain/images';
import { DishRepository } from '../infrastructure/dish.repository';
import { ImageProcessor, UploadedImage } from '../infrastructure/image-processor';
import { CatalogEventPublisher } from './catalog-events';

/**
 * Фото блюда: несколько, упорядочены. Загрузка -> webp 1200/600/300 px в публичном хранилище.
 * Файлы пишутся до транзакции; при ошибке транзакции загруженные файлы удаляются.
 */
@Injectable()
export class AddDishPhotos {
  constructor(
    private readonly dishes: DishRepository,
    private readonly images: ImageProcessor,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly events: CatalogEventPublisher,
  ) {}

  async execute(actor: Actor, dishId: string, files: UploadedImage[]): Promise<void> {
    actor.assertCan(Permission.MenuContent);
    if (files.length === 0) throw new ValidationError('catalog.image_required', 'At least one image file is required');
    const dish = await this.dishes.findById(dishId);
    if (!dish) throw new NotFoundError('dish', dishId);
    const existing = await this.dishes.photos(dishId);
    if (existing.length + files.length > MAX_PHOTOS_PER_DISH) {
      throw new ValidationError('catalog.too_many_photos', `A dish can have at most ${MAX_PHOTOS_PER_DISH} photos`, {
        max: MAX_PHOTOS_PER_DISH,
        existing: existing.length,
      });
    }
    const stored: StoredImage[] = [];
    try {
      for (const file of files) stored.push(await this.images.store('dishes', dishId, file));
      await this.database.transaction(async () => {
        // Повторная проверка лимита в транзакции (параллельные загрузки).
        const current = await this.dishes.photos(dishId);
        if (current.length + stored.length > MAX_PHOTOS_PER_DISH) {
          throw new ValidationError('catalog.too_many_photos', `A dish can have at most ${MAX_PHOTOS_PER_DISH} photos`);
        }
        let order = current.reduce((max, p) => Math.max(max, p.sortOrder), 0);
        for (const image of stored) {
          order += 10;
          await this.dishes.insertPhoto({ id: image.id, dishId, sortOrder: order, variants: image.variants, alt: {} });
        }
        await this.dishes.touch(dishId);
        await this.audit.record({
          action: 'menu.dish_photos_added',
          entityType: 'dish',
          entityId: dishId,
          before: { photoIds: current.map((p) => p.id) },
          after: { photoIds: [...current.map((p) => p.id), ...stored.map((s) => s.id)] },
        });
        await this.events.menuChanged({ branchId: null, dishId, categoryId: dish.categoryId });
      });
    } catch (err) {
      for (const image of stored) await this.images.remove(image);
      throw err;
    }
  }
}

@Injectable()
export class DeleteDishPhoto {
  constructor(
    private readonly dishes: DishRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly events: CatalogEventPublisher,
    private readonly clock: Clock,
  ) {}

  /** Логическое удаление: файлы остаются в хранилище (можно восстановить по журналу). */
  async execute(actor: Actor, dishId: string, photoId: string): Promise<void> {
    actor.assertCan(Permission.MenuContent);
    await this.database.transaction(async () => {
      const dish = await this.dishes.findById(dishId);
      if (!dish) throw new NotFoundError('dish', dishId);
      const photo = (await this.dishes.photos(dishId)).find((p) => p.id === photoId);
      if (!photo) throw new NotFoundError('dish_photo', photoId);
      await this.dishes.softDeletePhoto(photoId, this.clock.now());
      await this.dishes.touch(dishId);
      await this.audit.record({ action: 'menu.dish_photo_removed', entityType: 'dish', entityId: dishId, before: photo });
      await this.events.menuChanged({ branchId: null, dishId, categoryId: dish.categoryId });
    });
  }
}

@Injectable()
export class ReorderDishPhotos {
  constructor(
    private readonly dishes: DishRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly events: CatalogEventPublisher,
  ) {}

  /** Новый порядок фото: передаются все id фото блюда. Первое фото — обложка карточки. */
  async execute(actor: Actor, dishId: string, photoIds: string[]): Promise<void> {
    actor.assertCan(Permission.MenuContent);
    await this.database.transaction(async () => {
      const dish = await this.dishes.findById(dishId);
      if (!dish) throw new NotFoundError('dish', dishId);
      const current = await this.dishes.photos(dishId);
      const currentIds = current.map((p) => p.id);
      const sameSet = photoIds.length === currentIds.length && new Set(photoIds).size === photoIds.length && photoIds.every((id) => currentIds.includes(id));
      if (!sameSet) {
        throw new ValidationError('catalog.photos_mismatch', 'Order must list every photo of the dish exactly once', { photoIds: currentIds });
      }
      for (const [index, id] of photoIds.entries()) await this.dishes.setPhotoOrder(id, (index + 1) * 10);
      await this.dishes.touch(dishId);
      await this.audit.record({
        action: 'menu.dish_photos_reordered',
        entityType: 'dish',
        entityId: dishId,
        before: { photoIds: currentIds },
        after: { photoIds },
      });
      await this.events.menuChanged({ branchId: null, dishId, categoryId: dish.categoryId });
    });
  }
}
