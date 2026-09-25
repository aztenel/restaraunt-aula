import { Injectable } from '@nestjs/common';
import { OnEvent } from '../../../shared/infrastructure/events/decorators';
import { EventEnvelope } from '../../../shared/infrastructure/events/types';
import { CustomerAnonymizedPayload, CustomersEvents } from '../../customers/public';
import { AnonymizePaymentContacts } from '../application/anonymize-contacts.action';

/** Гость обезличен в базе гостей — стираем копии его контактов в платежах и сертификатах (по телефону/почте). */
@Injectable()
export class PaymentsCustomerHandlers {
  constructor(private readonly anonymize: AnonymizePaymentContacts) {}

  @OnEvent(CustomersEvents.CustomerAnonymized)
  async onCustomerAnonymized(e: EventEnvelope<CustomerAnonymizedPayload>): Promise<void> {
    await this.anonymize.execute({ customerId: e.payload.customerId, phone: e.payload.phone ?? null, email: e.payload.email ?? null });
  }
}
