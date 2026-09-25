import { Injectable } from '@nestjs/common';
import { ValidationError } from '../../../../../shared/kernel/errors';
import { CourierClaimInfo, CourierDispatch, OWN_COURIER_PROVIDER } from '../../../domain/courier-dispatch';

/**
 * Свои курьеры (по умолчанию): заявки во внешней службе не создаются, доставку ведёт оператор
 * (статусы «в пути» / «выполнен» — на экране заказов).
 */
@Injectable()
export class OwnCourierDispatch extends CourierDispatch {
  readonly provider = OWN_COURIER_PROVIDER;
  readonly external = false;

  private unsupported(): never {
    throw new ValidationError('courier.not_external', 'Own couriers do not use an external dispatch service');
  }

  async createClaim(): Promise<CourierClaimInfo> {
    return this.unsupported();
  }

  async getClaim(): Promise<CourierClaimInfo> {
    return this.unsupported();
  }

  async confirmClaim(): Promise<CourierClaimInfo> {
    return this.unsupported();
  }

  async cancelClaim(): Promise<void> {
    return this.unsupported();
  }
}
