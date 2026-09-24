import { Injectable, Logger } from '@nestjs/common';
import { Scheduled } from '../../../shared/infrastructure/events/decorators';
import { PurgePhoneVerifications } from '../application/phone-verification.actions';

/** Периодические задачи модуля Customers. */
@Injectable()
export class CustomersMaintenanceSchedules {
  private readonly logger = new Logger(CustomersMaintenanceSchedules.name);

  constructor(private readonly purge: PurgePhoneVerifications) {}

  /** Ежедневно ночью: удалить проверки телефона старше суток (телефон — персональные данные). */
  @Scheduled('customers.purge_phone_verifications', { cron: '25 3 * * *' })
  async purgePhoneVerifications(): Promise<void> {
    const deleted = await this.purge.execute();
    if (deleted > 0) this.logger.log({ deleted }, 'Old phone verifications purged');
  }
}
