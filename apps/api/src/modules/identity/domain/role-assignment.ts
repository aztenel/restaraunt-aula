import { ValidationError } from '../../../shared/kernel/errors';
import { StaffRole } from '../public/staff-directory';
import { isStaffRole, RoleAssignment, ROLE_DEFINITIONS } from './roles';

/** Проверка набора ролей пользователя: филиальная роль требует филиал, глобальная — без филиала. */
export function validateRoleAssignments(input: Array<{ role: string; branchId?: string | null }>): RoleAssignment[] {
  const result: RoleAssignment[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    if (!isStaffRole(item.role)) {
      throw new ValidationError('user.unknown_role', `Unknown role ${item.role}`, { role: item.role });
    }
    const def = ROLE_DEFINITIONS[item.role as StaffRole];
    const branchId = item.branchId ?? null;
    if (def.scope === 'branch' && !branchId) {
      throw new ValidationError('user.role_requires_branch', `Role ${item.role} must be bound to a branch`, { role: item.role });
    }
    if (def.scope === 'global' && branchId) {
      throw new ValidationError('user.role_is_global', `Role ${item.role} is global and cannot be bound to a branch`, {
        role: item.role,
      });
    }
    const key = `${item.role}:${branchId ?? '*'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ role: item.role as StaffRole, branchId });
  }
  return result;
}
