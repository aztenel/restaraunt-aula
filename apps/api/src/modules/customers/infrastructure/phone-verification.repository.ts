import { Injectable } from '@nestjs/common';
import { Database } from '../../../shared/infrastructure/database/database';
import { Locale, parseLocale } from '../../../shared/kernel/translatable';
import { CustomersTables } from './customers.tables';

export interface PhoneVerificationRecord {
  id: string;
  phone: string;
  codeHash: string;
  locale: Locale;
  expiresAt: Date;
  attempts: number;
  verifiedAt: Date | null;
  supersededAt: Date | null;
  createdAt: Date;
}

/** Проверки телефона SMS-кодом. Код хранится только в виде HMAC. */
@Injectable()
export class PhoneVerificationRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<CustomersTables>();
  }

  async insert(input: {
    id: string;
    phone: string;
    codeHash: string;
    locale: Locale;
    expiresAt: Date;
    ip: string | null;
    createdAt: Date;
  }): Promise<void> {
    await this.db()
      .insertInto('customers.phone_verifications')
      .values({
        id: input.id,
        phone: input.phone,
        code_hash: input.codeHash,
        locale: input.locale,
        expires_at: input.expiresAt,
        attempts: 0,
        verified_at: null,
        superseded_at: null,
        ip: input.ip,
        created_at: input.createdAt,
      })
      .execute();
  }

  /** Моменты отправки кодов на номер после since (для лимитов). */
  async sentSince(phone: string, since: Date): Promise<Date[]> {
    const rows = await this.db()
      .selectFrom('customers.phone_verifications')
      .select('created_at')
      .where('phone', '=', phone)
      .where('created_at', '>', since)
      .orderBy('created_at', 'desc')
      .execute();
    return rows.map((r) => r.created_at);
  }

  /** Новый код отменяет прежние неподтверждённые коды этого номера. */
  async supersedeActive(phone: string, at: Date): Promise<void> {
    await this.db()
      .updateTable('customers.phone_verifications')
      .set({ superseded_at: at })
      .where('phone', '=', phone)
      .where('verified_at', 'is', null)
      .where('superseded_at', 'is', null)
      .where('expires_at', '>', at)
      .execute();
  }

  async findForUpdate(id: string): Promise<PhoneVerificationRecord | null> {
    const row = await this.db().selectFrom('customers.phone_verifications').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
    if (!row) return null;
    return {
      id: row.id,
      phone: row.phone,
      codeHash: row.code_hash,
      locale: parseLocale(row.locale),
      expiresAt: row.expires_at,
      attempts: row.attempts,
      verifiedAt: row.verified_at,
      supersededAt: row.superseded_at,
      createdAt: row.created_at,
    };
  }

  async setAttempts(id: string, attempts: number): Promise<void> {
    await this.db().updateTable('customers.phone_verifications').set({ attempts }).where('id', '=', id).execute();
  }

  async markVerified(id: string, at: Date): Promise<void> {
    await this.db().updateTable('customers.phone_verifications').set({ verified_at: at }).where('id', '=', id).execute();
  }

  /** Удалить записи старше момента (телефон — ПД, дольше суток не храним). */
  async deleteCreatedBefore(before: Date): Promise<number> {
    const result = await this.db().deleteFrom('customers.phone_verifications').where('created_at', '<', before).executeTakeFirst();
    return Number(result.numDeletedRows ?? 0);
  }

  async deleteForPhone(phone: string): Promise<void> {
    await this.db().deleteFrom('customers.phone_verifications').where('phone', '=', phone).execute();
  }
}
