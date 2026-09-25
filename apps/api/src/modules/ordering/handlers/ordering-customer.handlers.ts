import { Injectable } from '@nestjs/common';
import { OnEvent } from '../../../shared/infrastructure/events/decorators';
import { EventEnvelope } from '../../../shared/infrastructure/events/types';
import { CustomerAnonymizedPayload, CustomersEvents } from '../../customers/public';
import { AnonymizeCustomerOrders } from '../application/anonymize-customer-orders.action';

/** Обезличивание гостя (закон РК о ПД): стираем контакты и адреса в его заказах. */
@Injectable()
export class OrderingCustomerHandlers {
  constructor(private readonly anonymize: AnonymizeCustomerOrders) {}

  @OnEvent(CustomersEvents.CustomerAnonymized)
  async onCustomerAnonymized(event: EventEnvelope<CustomerAnonymizedPayload>): Promise<void> {
    await this.anonymize.execute(event.payload.customerId);
  }
}
