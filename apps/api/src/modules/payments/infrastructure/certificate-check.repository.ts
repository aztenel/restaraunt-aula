import { Injectable } from '@nestjs/common';
import { Database } from '../../../shared/infrastructure/database/database';
import { newId } from '../../../shared/kernel/ids';

/**
 * Журнал неудачных проверок кодов и блокировки IP.
 *
 * Пишется через корневое соединение, вне транзакции бизнес-операции: неудачная проверка
 * заканчивается ошибкой (и откатом транзакции вызывающего кода — например, оформления заказа),
 * но попытка подбора должна остаться в журнале.
 */
@Injectable()
export class CertificateCheckRepository {
  constructor(private readonly database: Database) {}

  private root() {
    return this.database.rootConnection();
  }

  async findBlock(ip: string, now: Date): Promise<Date | null> {
    const row = await this.root()
      .selectFrom('payments.certificate_ip_blocks')
      .select('blocked_until')
      .where('ip', '=', ip)
      .where('blocked_until', '>', now)
      .executeTakeFirst();
    return row ? (row.blocked_until as Date) : null;
  }

  /** Записать неудачу гостя; вернуть число неудач гостей с этого IP начиная с since (включая эту). */
  async recordFailure(ip: string, now: Date, since: Date): Promise<number> {
    await this.root().insertInto('payments.certificate_check_failures').values({ id: newId(), ip, occurred_at: now, user_id: null }).execute();
    const byIp = await this.root()
      .selectFrom('payments.certificate_check_failures')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('ip', '=', ip)
      .where('user_id', 'is', null)
      .where('occurred_at', '>', since)
      .executeTakeFirst();
    return Number(byIp?.n ?? 0);
  }

  /** Записать неудачу сотрудника (учёт по пользователю, IP — для журнала). */
  async recordUserFailure(userId: string, ip: string | null, now: Date): Promise<void> {
    await this.root()
      .insertInto('payments.certificate_check_failures')
      .values({ id: newId(), ip: ip ?? 'n/a', occurred_at: now, user_id: userId })
      .execute();
  }

  /** Неудачи сотрудника начиная с since и время самой ранней из них (для Retry-After). */
  async userFailuresSince(userId: string, since: Date): Promise<{ count: number; oldest: Date | null }> {
    const row = await this.root()
      .selectFrom('payments.certificate_check_failures')
      .select((eb) => [eb.fn.countAll<number>().as('n'), eb.fn.min<Date>('occurred_at').as('oldest')])
      .where('user_id', '=', userId)
      .where('occurred_at', '>', since)
      .executeTakeFirst();
    return { count: Number(row?.n ?? 0), oldest: row?.oldest ? new Date(row.oldest) : null };
  }

  /** Глобальный счётчик неудачных проверок (со всех IP) начиная с since. */
  async countSince(since: Date): Promise<{ failures: number; ips: number }> {
    const row = await this.root()
      .selectFrom('payments.certificate_check_failures')
      .select((eb) => [eb.fn.countAll<number>().as('n'), eb.fn.count<number>('ip').distinct().as('ips')])
      .where('occurred_at', '>', since)
      .executeTakeFirst();
    return { failures: Number(row?.n ?? 0), ips: Number(row?.ips ?? 0) };
  }

  async block(ip: string, until: Date, failures: number): Promise<void> {
    await this.root()
      .insertInto('payments.certificate_ip_blocks')
      .values({ ip, blocked_until: until, failures })
      .onConflict((oc) => oc.column('ip').doUpdateSet({ blocked_until: until, failures }))
      .execute();
  }

  /** Очистка старых записей (журнал неудач хранится ограниченное время). */
  async cleanup(before: Date): Promise<number> {
    const res = await this.root().deleteFrom('payments.certificate_check_failures').where('occurred_at', '<', before).executeTakeFirst();
    await this.root().deleteFrom('payments.certificate_ip_blocks').where('blocked_until', '<', before).execute();
    return Number(res.numDeletedRows ?? 0);
  }
}
