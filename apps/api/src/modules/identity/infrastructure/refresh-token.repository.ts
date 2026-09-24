import { Injectable } from '@nestjs/common';
import { Database } from '../../../shared/infrastructure/database/database';
import { IdentityTables } from './identity.tables';

@Injectable()
export class RefreshTokenRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<IdentityTables>();
  }

  async insert(t: { id: string; userId: string; tokenHash: string; expiresAt: Date; userAgent: string | null; ip: string | null }) {
    await this.db()
      .insertInto('identity.refresh_tokens')
      .values({
        id: t.id,
        user_id: t.userId,
        token_hash: t.tokenHash,
        expires_at: t.expiresAt,
        revoked_at: null,
        replaced_by: null,
        user_agent: t.userAgent,
        ip: t.ip,
      })
      .execute();
  }

  async findByHashForUpdate(hash: string) {
    return this.db().selectFrom('identity.refresh_tokens').selectAll().where('token_hash', '=', hash).forUpdate().executeTakeFirst();
  }

  async revoke(id: string, at: Date, replacedBy: string | null): Promise<void> {
    await this.db().updateTable('identity.refresh_tokens').set({ revoked_at: at, replaced_by: replacedBy }).where('id', '=', id).execute();
  }

  async revokeAllForUser(userId: string, at: Date): Promise<void> {
    await this.db()
      .updateTable('identity.refresh_tokens')
      .set({ revoked_at: at })
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .execute();
  }
}
