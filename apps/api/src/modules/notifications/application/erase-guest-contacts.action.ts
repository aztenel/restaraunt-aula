import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { Database } from '../../../shared/infrastructure/database/database';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { tryNormalizePhone } from '../../../shared/kernel/phone';
import { NotificationsTables } from '../infrastructure/notifications.tables';

export interface EraseGuestContactsInput {
  customerId: string;
  phone: string | null;
  email: string | null;
}

/**
 * Обезличивание гостя (Customers.CustomerAnonymized) в журнале уведомлений: у гостевых сообщений
 * стираются адресат (телефон, почта, имя) и параметры шаблона, у доставок — адрес, цепочка адресов
 * и отправленный текст, у попыток — маска адреса. Ещё не отправленные доставки гостю закрываются
 * как неуспешные (адресата больше нет). Сам факт отправки (шаблон, канал, время, статус) остаётся.
 */
@Injectable()
export class EraseGuestContacts {
  constructor(
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(input: EraseGuestContactsInput): Promise<{ messages: number; deliveries: number }> {
    const phone = tryNormalizePhone(input.phone);
    const email = input.email?.trim().toLowerCase() || null;
    if (!phone && !email) return { messages: 0, deliveries: 0 };
    const addresses = [phone, email].filter((a): a is string => !!a);
    return this.database.transaction(async () => {
      const db = this.database.db<NotificationsTables>();
      const now = this.clock.now();
      const byRecipient = sql<boolean>`recipient->>'kind' = 'guest' and (${phone ? sql`recipient->>'phone' = ${phone}` : sql`false`} or ${
        email ? sql`lower(recipient->>'email') = ${email}` : sql`false`
      })`;
      const messageIds = (await db.selectFrom('notifications.messages').select('id').where(byRecipient).execute()).map((m) => m.id);
      const deliveryIds = (
        await db
          .selectFrom('notifications.deliveries')
          .select('id')
          .where('target_kind', 'in', ['guest', 'direct'])
          .where((eb) => eb.or([...(messageIds.length > 0 ? [eb('message_id', 'in', messageIds)] : []), eb('address', 'in', addresses)]))
          .execute()
      ).map((d) => d.id);

      if (messageIds.length > 0) {
        await db
          .updateTable('notifications.messages')
          .set({
            recipient: JSON.stringify({ kind: 'guest', phone: null, email: null, name: null }),
            params: '{}',
            secret_params: null,
          })
          .where('id', 'in', messageIds)
          .execute();
        await db
          .updateTable('notifications.messages')
          .set({ status: 'failed', completed_at: now, last_error: 'recipient_anonymized' })
          .where('id', 'in', messageIds)
          .where('status', '=', 'queued')
          .execute();
      }
      if (deliveryIds.length > 0) {
        await db
          .updateTable('notifications.deliveries')
          .set({ address: '', chain: '[]', recipient_name: null, rendered_subject: null, rendered_text: null })
          .where('id', 'in', deliveryIds)
          .execute();
        await db
          .updateTable('notifications.deliveries')
          .set({ status: 'failed', last_error: 'recipient_anonymized' })
          .where('id', 'in', deliveryIds)
          .where('status', '=', 'pending')
          .execute();
        await db.updateTable('notifications.delivery_attempts').set({ address_masked: '***' }).where('delivery_id', 'in', deliveryIds).execute();
      }
      const result = { messages: messageIds.length, deliveries: deliveryIds.length };
      if (result.messages + result.deliveries > 0) {
        await this.audit.record({
          action: 'notifications.customer_anonymized',
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
