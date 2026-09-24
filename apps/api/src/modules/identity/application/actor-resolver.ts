import { Injectable } from '@nestjs/common';
import { Actor } from '../../../shared/kernel/actor';
import { resolvePermissions } from '../domain/roles';
import { UserRepository } from '../infrastructure/user.repository';

const CACHE_TTL_MS = 30_000;

/**
 * Загрузка актора по id пользователя: роли -> права по филиалам.
 * Кэш 30 секунд: смена ролей и блокировка применяются почти сразу, без перевыпуска токена.
 */
@Injectable()
export class ActorResolver {
  private readonly cache = new Map<string, { actor: Actor | null; mustChangePassword: boolean; at: number }>();

  constructor(private readonly users: UserRepository) {}

  async resolve(userId: string): Promise<Actor | null> {
    return (await this.resolveWithFlags(userId)).actor;
  }

  async resolveWithFlags(userId: string): Promise<{ actor: Actor | null; mustChangePassword: boolean }> {
    const cached = this.cache.get(userId);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached;
    const user = await this.users.findById(userId);
    let actor: Actor | null = null;
    if (user && user.isActive) {
      const perms = resolvePermissions(user.roles);
      actor = new Actor({
        kind: 'staff',
        userId: user.id,
        name: user.name,
        globalPermissions: perms.global,
        branchPermissions: perms.byBranch,
      });
    }
    const entry = { actor, mustChangePassword: user?.mustChangePassword ?? false, at: Date.now() };
    this.cache.set(userId, entry);
    return entry;
  }

  invalidate(userId?: string): void {
    if (userId) this.cache.delete(userId);
    else this.cache.clear();
  }
}
