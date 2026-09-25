import { Injectable } from '@nestjs/common';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { Actor } from '../../../shared/kernel/actor';
import { RequestRepository } from '../infrastructure/request.repository';

/**
 * Обезличивание гостя по требованию (закон РК о персональных данных): снимки контакта в заявках
 * (имя, телефон, почта, пожелания) стираются; заявки, суммы и документы для учёта сохраняются.
 */
@Injectable()
export class AnonymizeBanquetContacts {
  constructor(
    private readonly requests: RequestRepository,
    private readonly audit: AuditLog,
  ) {}

  async execute(customerId: string): Promise<number> {
    const ids = await this.requests.anonymizeCustomer(customerId);
    for (const id of ids) {
      await this.audit.record({
        action: 'banquet.contact_anonymized',
        entityType: 'banquet_request',
        entityId: id,
        meta: { customerId },
        actor: Actor.system('banquet.customers'),
      });
    }
    return ids.length;
  }
}
