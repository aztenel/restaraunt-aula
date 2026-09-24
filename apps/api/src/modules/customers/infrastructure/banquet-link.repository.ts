import { Injectable } from '@nestjs/common';
import { Database } from '../../../shared/infrastructure/database/database';
import { CustomersTables } from './customers.tables';

/** Связь банкетной заявки с гостем: событие о счёте несёт только requestId. */
@Injectable()
export class BanquetLinkRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<CustomersTables>();
  }

  async upsert(requestId: string, customerId: string, number: string): Promise<void> {
    await this.db()
      .insertInto('customers.banquet_links')
      .values({ request_id: requestId, customer_id: customerId, number })
      .onConflict((oc) => oc.column('request_id').doUpdateSet({ customer_id: customerId, number }))
      .execute();
  }

  async customerFor(requestId: string): Promise<string | null> {
    const row = await this.db()
      .selectFrom('customers.banquet_links')
      .select('customer_id')
      .where('request_id', '=', requestId)
      .executeTakeFirst();
    return row?.customer_id ?? null;
  }
}
