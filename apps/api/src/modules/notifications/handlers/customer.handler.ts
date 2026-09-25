import { Injectable } from '@nestjs/common';
import { OnEvent } from '../../../shared/infrastructure/events/decorators';
import { EventEnvelope } from '../../../shared/infrastructure/events/types';
import { CustomerAnonymizedPayload, CustomersEvents } from '../../customers/public';
import { EraseGuestContacts } from '../application/erase-guest-contacts.action';

/** Гость обезличен в базе гостей — стираем его контакты в журнале уведомлений (по телефону/почте из события). */
@Injectable()
export class NotificationsCustomerHandler {
  constructor(private readonly erase: EraseGuestContacts) {}

  @OnEvent(CustomersEvents.CustomerAnonymized)
  async onCustomerAnonymized(e: EventEnvelope<CustomerAnonymizedPayload>): Promise<void> {
    await this.erase.execute({ customerId: e.payload.customerId, phone: e.payload.phone ?? null, email: e.payload.email ?? null });
  }
}
