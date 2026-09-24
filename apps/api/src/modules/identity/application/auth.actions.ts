import { Injectable } from '@nestjs/common';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { Database } from '../../../shared/infrastructure/database/database';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { ForbiddenError, ValidationError } from '../../../shared/kernel/errors';
import { newId } from '../../../shared/kernel/ids';
import { assertPasswordStrength, LOCKOUT_MINUTES, MAX_FAILED_LOGINS } from '../domain/password-policy';
import { RefreshTokenRepository } from '../infrastructure/refresh-token.repository';
import { UserRepository } from '../infrastructure/user.repository';
import { ActorResolver } from './actor-resolver';
import { PasswordHasher } from './password-hasher';
import { TokenService } from './token.service';

export interface SessionTokens {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
  userId: string;
  mustChangePassword: boolean;
}

interface ClientInfo {
  ip: string | null;
  userAgent: string | null;
}

const INVALID_CREDENTIALS = () => new ForbiddenError('auth.invalid_credentials', 'Invalid email or password');

@Injectable()
export class Login {
  constructor(
    private readonly users: UserRepository,
    private readonly tokens: TokenService,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly hasher: PasswordHasher,
    private readonly database: Database,
    private readonly clock: Clock,
    private readonly audit: AuditLog,
  ) {}

  async execute(input: { email: string; password: string } & ClientInfo): Promise<SessionTokens> {
    const now = this.clock.now();
    const user = await this.users.findByEmail(input.email);
    if (!user || !user.isActive) {
      // Выравниваем время ответа, чтобы не раскрывать существование адреса.
      await this.hasher.dummyVerify(input.password);
      throw INVALID_CREDENTIALS();
    }
    if (user.lockedUntil && user.lockedUntil > now) {
      throw new ForbiddenError('auth.locked', 'Account temporarily locked after failed attempts', {
        lockedUntil: user.lockedUntil.toISOString(),
      });
    }
    const ok = await this.hasher.verify(user.passwordHash, input.password);
    if (!ok) {
      const failed = user.failedLoginCount + 1;
      const lockedUntil = failed >= MAX_FAILED_LOGINS ? new Date(now.getTime() + LOCKOUT_MINUTES * 60_000) : null;
      await this.database.transaction(async () => {
        await this.users.recordLoginFailure(user.id, lockedUntil ? 0 : failed, lockedUntil);
        await this.audit.record({
          action: lockedUntil ? 'auth.locked' : 'auth.login_failed',
          entityType: 'user',
          entityId: user.id,
          actor: Actor.guest(),
          meta: { failed },
        });
      });
      throw INVALID_CREDENTIALS();
    }
    return this.database.transaction(async () => {
      await this.users.recordLoginSuccess(user.id, now);
      const session = await issueSession(this.tokens, this.refreshTokens, user.id, now, input);
      await this.audit.record({
        action: 'auth.login',
        entityType: 'user',
        entityId: user.id,
        actor: new Actor({ kind: 'staff', userId: user.id, name: user.name, globalPermissions: [], branchPermissions: {} }),
      });
      return { ...session, mustChangePassword: user.mustChangePassword };
    });
  }
}

async function issueSession(
  tokens: TokenService,
  refreshTokens: RefreshTokenRepository,
  userId: string,
  now: Date,
  client: ClientInfo,
): Promise<Omit<SessionTokens, 'mustChangePassword'>> {
  const access = tokens.signAccess(userId);
  const refresh = tokens.newRefreshToken();
  const refreshExpiresAt = new Date(now.getTime() + tokens.refreshTtlMs());
  const id = newId();
  await refreshTokens.insert({
    id,
    userId,
    tokenHash: refresh.hash,
    expiresAt: refreshExpiresAt,
    userAgent: client.userAgent,
    ip: client.ip,
  });
  return {
    accessToken: access.token,
    expiresIn: access.expiresIn,
    refreshToken: refresh.token,
    refreshExpiresAt,
    userId,
  };
}

/** Ротация refresh-токена. Повторное использование отозванного токена — отзыв всех сессий (кража). */
@Injectable()
export class RefreshSession {
  constructor(
    private readonly users: UserRepository,
    private readonly tokens: TokenService,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly database: Database,
    private readonly clock: Clock,
  ) {}

  async execute(input: { refreshToken: string } & ClientInfo): Promise<SessionTokens> {
    const now = this.clock.now();
    const result = await this.database.transaction(async () => {
      const row = await this.refreshTokens.findByHashForUpdate(this.tokens.hashRefresh(input.refreshToken));
      if (!row) return { error: 'invalid' as const };
      if (row.revoked_at) {
        await this.refreshTokens.revokeAllForUser(row.user_id, now);
        return { error: 'reused' as const };
      }
      if (row.expires_at <= now) return { error: 'invalid' as const };
      const user = await this.users.findById(row.user_id);
      if (!user || !user.isActive) return { error: 'invalid' as const };
      const session = await issueSession(this.tokens, this.refreshTokens, user.id, now, input);
      const newRow = await this.refreshTokens.findByHashForUpdate(this.tokens.hashRefresh(session.refreshToken));
      await this.refreshTokens.revoke(row.id, now, newRow?.id ?? null);
      return { session: { ...session, mustChangePassword: user.mustChangePassword } };
    });
    if ('error' in result) {
      throw new ForbiddenError('auth.invalid_refresh', 'Session expired, please sign in again');
    }
    return result.session;
  }
}

@Injectable()
export class Logout {
  constructor(
    private readonly tokens: TokenService,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly database: Database,
    private readonly clock: Clock,
  ) {}

  async execute(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    await this.database.transaction(async () => {
      const row = await this.refreshTokens.findByHashForUpdate(this.tokens.hashRefresh(refreshToken));
      if (row && !row.revoked_at) await this.refreshTokens.revoke(row.id, this.clock.now(), null);
    });
  }
}

@Injectable()
export class ChangeOwnPassword {
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly database: Database,
    private readonly clock: Clock,
    private readonly audit: AuditLog,
    private readonly actors: ActorResolver,
  ) {}

  async execute(actor: Actor, input: { currentPassword: string; newPassword: string }): Promise<void> {
    if (!actor.userId) throw new ForbiddenError();
    const user = await this.users.findById(actor.userId);
    if (!user || !(await this.hasher.verify(user.passwordHash, input.currentPassword))) {
      throw new ValidationError('auth.wrong_password', 'Current password is incorrect');
    }
    if (input.currentPassword === input.newPassword) {
      throw new ValidationError('password.same', 'New password must differ from the current one');
    }
    assertPasswordStrength(input.newPassword);
    const hashValue = await this.hasher.hash(input.newPassword);
    await this.database.transaction(async () => {
      await this.users.setPassword(user.id, hashValue, false);
      await this.refreshTokens.revokeAllForUser(user.id, this.clock.now());
      await this.audit.record({ action: 'user.password_changed', entityType: 'user', entityId: user.id });
    });
    this.actors.invalidate(user.id);
  }
}
