import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { Database } from '../../../shared/infrastructure/database/database';
import { Actor } from '../../../shared/kernel/actor';
import { tryNormalizePhone } from '../../../shared/kernel/phone';
import { PaymentsTables } from '../infrastructure/payments.tables';

/** Имя вместо стёртого в обязательных полях (покупатель/получатель сертификата). */
export const ANONYMIZED_NAME = 'anonymized';

export interface AnonymizedContacts {
  customerId: string;
  phone: string | null;
  email: string | null;
}

export interface AnonymizeResult {
  payments: number;
  certificateOrders: number;
  certificates: number;
}

/**
 * Обезличивание гостя (событие Customers.CustomerAnonymized): в платежах и сертификатах нет customerId,
 * поэтому копии контактов находятся по прежним телефону и почте из события. Суммы, статусы и журнал
 * движений сертификатов сохраняются (учёт), стираются только контакты. Идемпотентно.
 */
@Injectable()
export class AnonymizePaymentContacts {
  constructor(
    private readonly database: Database,
    private readonly audit: AuditLog,
  ) {}

  async execute(input: AnonymizedContacts): Promise<AnonymizeResult> {
    const phone = tryNormalizePhone(input.phone);
    const email = input.email?.trim().toLowerCase() || null;
    if (!phone && !email) return { payments: 0, certificateOrders: 0, certificates: 0 };
    return this.database.transaction(async () => {
      const db = this.database.db<PaymentsTables>();
      const matches = (phoneCol: string, emailCol: string) =>
        sql<boolean>`(${phone ? sql`${sql.ref(phoneCol)} = ${phone}` : sql`false`} or ${email ? sql`lower(${sql.ref(emailCol)}) = ${email}` : sql`false`})`;

      const payments = await db
        .updateTable('payments.payments')
        .set({ customer_phone: null, customer_name: null, customer_email: null })
        .where(matches('customer_phone', 'customer_email'))
        .executeTakeFirst();

      const orderBuyers = await db
        .updateTable('payments.certificate_orders')
        .set({ buyer_name: ANONYMIZED_NAME, buyer_phone: null, buyer_email: null })
        .where(matches('buyer_phone', 'buyer_email'))
        .executeTakeFirst();
      const orderRecipients = await db
        .updateTable('payments.certificate_orders')
        .set({ recipient_name: ANONYMIZED_NAME, recipient_phone: null, recipient_email: null })
        .where(matches('recipient_phone', 'recipient_email'))
        .executeTakeFirst();
      const certBuyers = await db
        .updateTable('payments.gift_certificates')
        .set({ buyer_name: ANONYMIZED_NAME, buyer_phone: null, buyer_email: null })
        .where(matches('buyer_phone', 'buyer_email'))
        .executeTakeFirst();
      const certRecipients = await db
        .updateTable('payments.gift_certificates')
        .set({ recipient_name: ANONYMIZED_NAME, recipient_phone: null, recipient_email: null })
        .where(matches('recipient_phone', 'recipient_email'))
        .executeTakeFirst();
      const certificateOrders = Number(orderBuyers.numUpdatedRows) + Number(orderRecipients.numUpdatedRows);
      const certificates = Number(certBuyers.numUpdatedRows) + Number(certRecipients.numUpdatedRows);
      const result = { payments: Number(payments.numUpdatedRows), certificateOrders, certificates };
      if (result.payments + result.certificateOrders + result.certificates > 0) {
        await this.audit.record({
          action: 'payments.customer_anonymized',
          entityType: 'customer',
          entityId: input.customerId,
          after: result,
          actor: Actor.system('customers'),
        });
      }
      return result;
    });
  }
}
