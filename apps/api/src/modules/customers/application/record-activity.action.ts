import { Injectable } from '@nestjs/common';
import { Database } from '../../../shared/infrastructure/database/database';
import { invariant } from '../../../shared/kernel/errors';
import { newId } from '../../../shared/kernel/ids';
import { tryNormalizePhone } from '../../../shared/kernel/phone';
import { fillEmptyFields, mergeTags } from '../domain/customer';
import { ActivityDraft, ActivityType, applyDelta, autoTags, CustomerRef } from '../domain/history';
import { ActivityRepository } from '../infrastructure/activity.repository';
import { BanquetLinkRepository } from '../infrastructure/banquet-link.repository';
import { CustomerRepository } from '../infrastructure/customer.repository';
import { IdentifyCustomer } from './identify-customer.action';

export interface RecordActivityInput {
  /** Гость из события; null — гость определяется по банкетной заявке (banquetRequest.mode=lookup). */
  ref: CustomerRef | null;
  draft: ActivityDraft;
  /** id события-источника: повтор того же события не дублирует строку и агрегаты. */
  sourceEventId: string | null;
  /** link — запомнить гостя заявки; lookup — найти гостя по заявке (в событии о счёте нет контакта). */
  banquetRequest?: { requestId: string; number: string; mode: 'link' | 'lookup' };
  /** Гость выполненного заказа (возвраты): нет строки «заказ выполнен» — событие пропускается. */
  completedOrderId?: string;
}

/**
 * Связь с банкетной заявкой ещё не установлена (событие о заявке не обработано) —
 * обработчик события будет повторён платформой с задержкой.
 */
export class BanquetLinkPendingError extends Error {
  constructor(requestId: string) {
    super(`Banquet request ${requestId} is not linked to a customer yet`);
    this.name = 'BanquetLinkPendingError';
  }
}

/**
 * Запись в историю гостя из события другого модуля: определить гостя (по id или телефону, создать при
 * необходимости), добавить строку истории, пересчитать агрегаты и автотеги (regular, banquet, corporate).
 * Идемпотентно по id события.
 */
@Injectable()
export class RecordCustomerActivity {
  constructor(
    private readonly customers: CustomerRepository,
    private readonly activities: ActivityRepository,
    private readonly links: BanquetLinkRepository,
    private readonly identify: IdentifyCustomer,
    private readonly database: Database,
  ) {}

  async execute(input: RecordActivityInput): Promise<string | null> {
    return this.database.transaction(async () => {
      const customerId = await this.resolveCustomer(input);
      if (!customerId) return null;
      if (input.banquetRequest?.mode === 'link') {
        await this.links.upsert(input.banquetRequest.requestId, customerId, input.banquetRequest.number);
      }
      const inserted = await this.activities.insert({ id: newId(), customerId, draft: input.draft, sourceEventId: input.sourceEventId });
      if (!inserted) return customerId;

      const customer = await this.customers.findByIdForUpdate(customerId);
      invariant(customer, 'customer.activity_without_customer', 'Customer must exist for an activity');
      const aggregates = applyDelta(customer, input.draft.delta);
      const occurredAt = input.draft.occurredAt;
      await this.customers.updateAggregates(customerId, {
        aggregates,
        tags: mergeTags(customer.tags, [...autoTags(aggregates), ...input.draft.tags]),
        firstSeenAt: occurredAt < customer.firstSeenAt ? occurredAt : customer.firstSeenAt,
        lastActivityAt: !customer.lastActivityAt || occurredAt > customer.lastActivityAt ? occurredAt : customer.lastActivityAt,
      });
      return customerId;
    });
  }

  private async resolveCustomer(input: RecordActivityInput): Promise<string | null> {
    if (input.completedOrderId) {
      return this.activities.customerForEntity('order', input.completedOrderId, ActivityType.OrderCompleted);
    }
    if (input.banquetRequest?.mode === 'lookup') {
      const linked = await this.links.customerFor(input.banquetRequest.requestId);
      if (!linked) throw new BanquetLinkPendingError(input.banquetRequest.requestId);
      return linked;
    }
    const ref = input.ref;
    if (!ref) return null;
    if (ref.customerId) {
      const known = await this.customers.findById(ref.customerId);
      if (known) {
        if (!known.anonymizedAt) {
          const patch = fillEmptyFields(known, ref);
          if (Object.keys(patch).length > 0) await this.customers.fillEmpty(known.id, patch);
        }
        return known.id;
      }
    }
    const phone = tryNormalizePhone(ref.phone);
    if (!phone) return null;
    const { customerId } = await this.identify.execute({
      phone,
      name: ref.name,
      email: ref.email,
      locale: ref.locale ?? undefined,
      seenAt: input.draft.occurredAt,
    });
    return customerId;
  }
}
