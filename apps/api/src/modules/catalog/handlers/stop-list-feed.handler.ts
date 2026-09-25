import { Injectable } from '@nestjs/common';
import { OnEvent } from '../../../shared/infrastructure/events/decorators';
import { EventEnvelope } from '../../../shared/infrastructure/events/types';
import { translate } from '../../../shared/kernel/translatable';
import { AdminFeed } from '../../notifications/public';
import { DishRepository } from '../infrastructure/dish.repository';
import { CatalogEvents, StopListChangedPayload } from '../public';

/**
 * Стоп-лист в ленте админки (поток заказов, без звука): оператор видит, что блюдо встало в стоп или
 * вернулось в продажу — вручную, из POS или автоматически по сроку. Ссылка — блюдо в меню филиала.
 */
@Injectable()
export class StopListFeedHandler {
  constructor(
    private readonly dishes: DishRepository,
    private readonly feed: AdminFeed,
  ) {}

  @OnEvent(CatalogEvents.StopListChanged)
  async onStopListChanged(event: EventEnvelope<StopListChangedPayload>): Promise<void> {
    const p = event.payload;
    const dish = await this.dishes.findById(p.dishId);
    const name = dish ? translate(dish.name, 'ru') : p.dishId;
    const state = p.availability === 'available' ? 'снова в продаже' : 'в стопе';
    await this.feed.push({
      branchId: p.branchId,
      stream: 'orders',
      kind: 'updated',
      entityId: p.dishId,
      entityType: 'dish',
      title: `Стоп-лист: ${name} — ${state}`,
      sound: false,
    });
  }
}
