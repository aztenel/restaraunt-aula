import { Injectable } from '@nestjs/common';
import { EventBus } from '../../../shared/infrastructure/events/event-bus';
import { CatalogEvents, ContentChangedPayload, MenuChangedPayload, StopListChangedPayload } from '../public';

/**
 * Публикация событий Catalog (через outbox, внутри транзакции изменения):
 * MenuChanged — для сброса кэшей витрины, StopListChanged — доступность блюда в филиале,
 * ContentChanged — баннеры, акции, страницы.
 */
@Injectable()
export class CatalogEventPublisher {
  constructor(private readonly events: EventBus) {}

  async menuChanged(payload: MenuChangedPayload): Promise<void> {
    await this.events.publish(CatalogEvents.MenuChanged, payload, {
      aggregateId: payload.dishId ?? payload.categoryId ?? null,
      branchId: payload.branchId,
    });
  }

  async stopListChanged(payload: StopListChangedPayload): Promise<void> {
    await this.events.publish(CatalogEvents.StopListChanged, payload, { aggregateId: payload.dishId, branchId: payload.branchId });
  }

  async contentChanged(payload: ContentChangedPayload): Promise<void> {
    await this.events.publish(CatalogEvents.ContentChanged, payload, { aggregateId: payload.id, branchId: payload.branchId });
  }
}
