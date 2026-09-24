import { describe, expect, it } from 'vitest';
import { Permission } from '../../../shared/kernel/permissions';
import { validateRoleAssignments } from './role-assignment';
import { resolvePermissions } from './roles';

describe('roles', () => {
  it('branch roles need a branch, global roles must not have one', () => {
    expect(() => validateRoleAssignments([{ role: 'branch_operator' }])).toThrow();
    expect(() => validateRoleAssignments([{ role: 'owner', branchId: 'b1' }])).toThrow();
    expect(() => validateRoleAssignments([{ role: 'chef' }])).toThrow();
    expect(validateRoleAssignments([{ role: 'branch_operator', branchId: 'b1' }, { role: 'finance' }])).toHaveLength(2);
  });

  it('same user can have different roles in different branches', () => {
    const perms = resolvePermissions([
      { role: 'branch_manager', branchId: 'b1' },
      { role: 'branch_operator', branchId: 'b2' },
    ]);
    expect(perms.byBranch.b1).toContain(Permission.MenuStopList);
    expect(perms.byBranch.b2).not.toContain(Permission.MenuStopList);
    expect(perms.byBranch.b2).toContain(Permission.OrdersManage);
    expect(perms.global).toEqual([]);
  });

  it('finance has no content access, sysadmin has no business data', () => {
    const finance = resolvePermissions([{ role: 'finance', branchId: null }]);
    expect(finance.global).toContain(Permission.PaymentsRefund);
    expect(finance.global).not.toContain(Permission.MenuContent);
    const admin = resolvePermissions([{ role: 'sysadmin', branchId: null }]);
    expect(admin.global).toContain(Permission.AuditView);
    expect(admin.global).not.toContain(Permission.OrdersView);
  });
});
