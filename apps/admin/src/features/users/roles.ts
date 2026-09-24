import { STAFF_ROLES, type RoleAssignment, type RoleDefinition, type StaffRole } from '@aula/api-client';

/** Область роли: филиальные роли требуют филиал, глобальные — нет (как на сервере). */
export const FALLBACK_ROLE_SCOPE: Record<StaffRole, 'branch' | 'global'> = {
  branch_operator: 'branch',
  banquet_manager: 'global',
  branch_manager: 'branch',
  content_manager: 'global',
  finance: 'global',
  owner: 'global',
  sysadmin: 'global',
};

export function roleScope(role: StaffRole, definitions?: RoleDefinition[]): 'branch' | 'global' {
  return definitions?.find((d) => d.role === role)?.scope ?? FALLBACK_ROLE_SCOPE[role];
}

export type RoleAssignmentIssue = 'branch_required' | 'duplicate' | 'empty_role';

/** Проверка назначений до отправки (сервер проверяет те же правила). */
export function validateRoleAssignments(roles: Array<Partial<RoleAssignment>>, definitions?: RoleDefinition[]): RoleAssignmentIssue[] {
  const issues = new Set<RoleAssignmentIssue>();
  const seen = new Set<string>();
  for (const r of roles) {
    if (!r.role || !(STAFF_ROLES as readonly string[]).includes(r.role)) {
      issues.add('empty_role');
      continue;
    }
    const scope = roleScope(r.role, definitions);
    if (scope === 'branch' && !r.branchId) issues.add('branch_required');
    const key = `${r.role}:${scope === 'branch' ? (r.branchId ?? '') : ''}`;
    if (seen.has(key)) issues.add('duplicate');
    seen.add(key);
  }
  return [...issues];
}

/** Нормализация перед отправкой: у глобальных ролей branchId = null. */
export function normalizeRoleAssignments(roles: Array<Partial<RoleAssignment>>, definitions?: RoleDefinition[]): RoleAssignment[] {
  return roles
    .filter((r): r is Partial<RoleAssignment> & { role: StaffRole } => Boolean(r.role))
    .map((r) => ({ role: r.role, branchId: roleScope(r.role, definitions) === 'branch' ? (r.branchId ?? null) : null }));
}
