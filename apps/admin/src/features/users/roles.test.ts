import { describe, expect, it } from 'vitest';
import { normalizeRoleAssignments, roleScope, validateRoleAssignments } from './roles';

describe('назначение ролей', () => {
  it('филиальные роли требуют филиал, глобальные — без филиала', () => {
    expect(roleScope('branch_operator')).toBe('branch');
    expect(roleScope('owner')).toBe('global');
    expect(validateRoleAssignments([{ role: 'branch_manager', branchId: null }])).toEqual(['branch_required']);
    expect(validateRoleAssignments([{ role: 'branch_manager', branchId: 'gl' }, { role: 'owner', branchId: null }])).toEqual([]);
  });

  it('дубликаты и пустые роли', () => {
    expect(validateRoleAssignments([{ role: 'finance' }, { role: 'finance', branchId: 'gl' }])).toEqual(['duplicate']);
    expect(validateRoleAssignments([{ role: 'branch_operator', branchId: 'gl' }, { role: 'branch_operator', branchId: 'gv' }])).toEqual([]);
    expect(validateRoleAssignments([{ branchId: 'gl' }])).toEqual(['empty_role']);
  });

  it('нормализация: у глобальных ролей branchId = null', () => {
    expect(normalizeRoleAssignments([{ role: 'owner', branchId: 'gl' }, { role: 'branch_operator', branchId: 'gv' }, { branchId: 'x' }])).toEqual([
      { role: 'owner', branchId: null },
      { role: 'branch_operator', branchId: 'gv' },
    ]);
  });

  it('область роли берётся с сервера, если есть описание', () => {
    expect(roleScope('finance', [{ role: 'finance', scope: 'branch', title: { ru: '', kk: '' }, permissions: [] }])).toBe('branch');
  });
});
