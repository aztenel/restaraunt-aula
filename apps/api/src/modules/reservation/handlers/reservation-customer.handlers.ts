import { Injectable } from '@nestjs/common';
import { OnEvent } from '../../../shared/infrastructure/events/decorators';
import { EventEnvelope } from '../../../shared/infrastructure/events/types';
import { CustomerAnonymizedPayload, CustomersEvents } from '../../customers/public';
import { AnonymizeReservationGuest } from '../application/maintenance.actions';

/** Обезличивание гостя по требованию (закон РК о ПД): контакты в снимках броней стираются. */
@Injectable()
export class ReservationCustomerHandlers {
  constructor(private readonly anonymize: AnonymizeReservationGuest) {}

  @OnEvent(CustomersEvents.CustomerAnonymized)
  async onCustomerAnonymized(e: EventEnvelope<CustomerAnonymizedPayload>): Promise<void> {
    await this.anonymize.execute(e.payload.customerId);
  }
}
