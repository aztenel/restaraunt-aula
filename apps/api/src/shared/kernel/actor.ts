import { ForbiddenError } from './errors';
import { Permission } from './permissions';

/**
 * Кто выполняет действие. Сотрудник (из JWT), система (фоновые задачи) или гость.
 * Права сотрудника: глобальные + по филиалам. Проверка всегда с учётом филиала.
 */
export interface ActorSnapshot {
  kind: 'staff' | 'system' | 'guest';
  userId: string | null;
  name: string;
  globalPermissions: Permission[];
  branchPermissions: Record<string, Permission[]>;
}

export class Actor {
  private readonly global: ReadonlySet<Permission>;
  private readonly byBranch: ReadonlyMap<string, ReadonlySet<Permission>>;

  constructor(readonly snapshot: ActorSnapshot) {
    this.global = new Set(snapshot.globalPermissions);
    this.byBranch = new Map(Object.entries(snapshot.branchPermissions).map(([b, p]) => [b, new Set(p)]));
  }

  static system(name = 'system'): Actor {
    return new Actor({ kind: 'system', userId: null, name, globalPermissions: [], branchPermissions: {} });
  }

  static guest(): Actor {
    return new Actor({ kind: 'guest', userId: null, name: 'guest', globalPermissions: [], branchPermissions: {} });
  }

  get kind(): ActorSnapshot['kind'] {
    return this.snapshot.kind;
  }

  get userId(): string | null {
    return this.snapshot.userId;
  }

  get name(): string {
    return this.snapshot.name;
  }

  isSystem(): boolean {
    return this.snapshot.kind === 'system';
  }

  isStaff(): boolean {
    return this.snapshot.kind === 'staff';
  }

  /**
   * Есть ли право. branchId задан — право глобальное или в этом филиале.
   * branchId не задан (null) — нужно глобальное право (действие над всеми филиалами).
   * Системный актор может всё: фоновые задачи вызываются кодом, а не людьми.
   */
  can(permission: Permission, branchId?: string | null): boolean {
    if (this.isSystem()) return true;
    if (this.global.has(permission)) return true;
    if (!branchId) return false;
    return this.byBranch.get(branchId)?.has(permission) ?? false;
  }

  /** Право хотя бы в одном филиале (для доступа к разделу админки). */
  canSomewhere(permission: Permission): boolean {
    if (this.isSystem() || this.global.has(permission)) return true;
    for (const perms of this.byBranch.values()) {
      if (perms.has(permission)) return true;
    }
    return false;
  }

  /** Филиалы, в которых есть право: 'all' для глобального. Для фильтрации списков. */
  branchesWith(permission: Permission): 'all' | string[] {
    if (this.isSystem() || this.global.has(permission)) return 'all';
    return [...this.byBranch.entries()].filter(([, perms]) => perms.has(permission)).map(([branchId]) => branchId);
  }

  assertCan(permission: Permission, branchId?: string | null): void {
    if (!this.can(permission, branchId)) {
      throw new ForbiddenError('access.forbidden', `Permission ${permission} required`, {
        permission,
        branchId: branchId ?? null,
      });
    }
  }

  assertCanSomewhere(permission: Permission): void {
    if (!this.canSomewhere(permission)) {
      throw new ForbiddenError('access.forbidden', `Permission ${permission} required`, { permission });
    }
  }

  /**
   * Сужает запрошенный фильтр филиала до доступных. Возвращает список филиалов для запроса
   * или 'all'. Запрос чужого филиала — ForbiddenError.
   */
  scopeBranches(permission: Permission, requested?: string | null): 'all' | string[] {
    const allowed = this.branchesWith(permission);
    if (requested) {
      if (allowed !== 'all' && !allowed.includes(requested)) {
        throw new ForbiddenError('access.forbidden_branch', 'No access to this branch', { branchId: requested, permission });
      }
      return [requested];
    }
    if (allowed !== 'all' && allowed.length === 0) {
      throw new ForbiddenError('access.forbidden', `Permission ${permission} required`, { permission });
    }
    return allowed;
  }
}
