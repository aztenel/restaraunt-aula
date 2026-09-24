import { Injectable } from '@nestjs/common';
import { Database } from '../../../shared/infrastructure/database/database';
import { EventBus } from '../../../shared/infrastructure/events/event-bus';
import { Clock } from '../../../shared/kernel/clock';
import { invariant } from '../../../shared/kernel/errors';
import { newId } from '../../../shared/kernel/ids';
import { normalizePhone } from '../../../shared/kernel/phone';
import { DEFAULT_LOCALE, Locale } from '../../../shared/kernel/translatable';
import { fillEmptyFields, normalizeEmail, normalizeName } from '../domain/customer';
import { CustomerRecord, CustomerRepository } from '../infrastructure/customer.repository';
import { CustomerCreatedPayload, CustomersEvents } from '../public';

export interface IdentifyCustomerInput {
  phone: string;
  name?: string | null;
  email?: string | null;
  locale?: Locale;
  /** Момент первого обращения (для проекции событий — время события). По умолчанию — сейчас. */
  seenAt?: Date;
}

/**
 * Найти или создать гостя по нормализованному телефону (+7XXXXXXXXXX). Имя и почта из формы
 * заполняют только пустые поля — то, что ввёл менеджер, не затирается. Конкурентные вызовы
 * с одним телефоном не создают дубликатов (уникальный индекс + ON CONFLICT DO NOTHING).
 */
@Injectable()
export class IdentifyCustomer {
  constructor(
    private readonly customers: CustomerRepository,
    private readonly database: Database,
    private readonly events: EventBus,
    private readonly clock: Clock,
  ) {}

  async execute(input: IdentifyCustomerInput): Promise<{ customerId: string; isNew: boolean }> {
    const phone = normalizePhone(input.phone);
    return this.database.transaction(async () => {
      const existing = await this.customers.findByPhone(phone);
      if (existing) {
        await this.fill(existing, input);
        return { customerId: existing.id, isNew: false };
      }
      const id = newId();
      const now = this.clock.now();
      const inserted = await this.customers.insertIfAbsent({
        id,
        phone,
        name: normalizeName(input.name),
        email: normalizeEmail(input.email),
        locale: input.locale ?? DEFAULT_LOCALE,
        firstSeenAt: input.seenAt ?? now,
      });
      if (inserted) {
        await this.events.publish<CustomerCreatedPayload>(
          CustomersEvents.CustomerCreated,
          { customerId: id, phone, occurredAt: now.toISOString() },
          { aggregateId: id },
        );
        return { customerId: id, isNew: true };
      }
      // Гонка: гостя с этим телефоном только что создал параллельный запрос.
      const raced = await this.customers.findByPhone(phone);
      invariant(raced, 'customer.identify_race', 'Customer must exist after a conflicting insert');
      await this.fill(raced, input);
      return { customerId: raced.id, isNew: false };
    });
  }

  private async fill(customer: CustomerRecord, input: IdentifyCustomerInput): Promise<void> {
    if (customer.anonymizedAt) return;
    const patch = fillEmptyFields(customer, input);
    if (Object.keys(patch).length > 0) await this.customers.fillEmpty(customer.id, patch);
  }
}
