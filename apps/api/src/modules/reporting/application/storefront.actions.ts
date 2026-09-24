import { Injectable, Logger } from '@nestjs/common';
import { Clock } from '../../../shared/kernel/clock';
import { addDays } from '../../../shared/kernel/time';
import { BranchDirectory } from '../../identity/public';
import { localDateOf } from '../domain/period';
import { normalizeStorefrontEvent, STOREFRONT_RETENTION_DAYS, StorefrontEventInput } from '../domain/storefront';
import { StorefrontEventsRepository } from '../infrastructure/storefront-events.repository';

/**
 * Событие витрины (просмотр страницы, меню, блюда, корзина, начало оформления) — для конверсии.
 * Без персональных данных: анонимная сессия, путь без параметров. Неизвестный филиал не
 * блокирует запись (событие сохраняется без филиала).
 */
@Injectable()
export class RecordStorefrontEvent {
  constructor(
    private readonly events: StorefrontEventsRepository,
    private readonly branches: BranchDirectory,
    private readonly clock: Clock,
  ) {}

  async execute(input: StorefrontEventInput): Promise<void> {
    const event = normalizeStorefrontEvent(input);
    if (event.branchId && !(await this.branches.find(event.branchId))) event.branchId = null;
    const now = this.clock.now();
    await this.events.insert(event, now, localDateOf(now));
  }
}

/** Удаление сырых событий витрины старше срока хранения (STOREFRONT_RETENTION_DAYS). */
@Injectable()
export class PurgeStorefrontEvents {
  private readonly logger = new Logger(PurgeStorefrontEvents.name);

  constructor(
    private readonly events: StorefrontEventsRepository,
    private readonly clock: Clock,
  ) {}

  async execute(): Promise<number> {
    const before = addDays(localDateOf(this.clock.now()), -STOREFRONT_RETENTION_DAYS);
    const deleted = await this.events.purgeBefore(before);
    if (deleted > 0) this.logger.log({ deleted, before }, 'Storefront events purged');
    return deleted;
  }
}
