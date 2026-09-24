import { describe, expect, it } from 'vitest';
import { Actor } from './actor';
import { ForbiddenError } from './errors';
import { Permission } from './permissions';

describe('Actor', () => {
  const operator = new Actor({
    kind: 'staff',
    userId: 'u1',
    name: 'Оператор',
    globalPermissions: [],
    branchPermissions: { b1: [Permission.OrdersManage, Permission.OrdersView] },
  });

  it('checks branch-scoped permissions', () => {
    expect(operator.can(Permission.OrdersManage, 'b1')).toBe(true);
    expect(operator.can(Permission.OrdersManage, 'b2')).toBe(false);
    expect(operator.can(Permission.OrdersManage)).toBe(false);
    expect(operator.canSomewhere(Permission.OrdersManage)).toBe(true);
    expect(operator.branchesWith(Permission.OrdersView)).toEqual(['b1']);
  });

  it('scopes list filters', () => {
    expect(operator.scopeBranches(Permission.OrdersView)).toEqual(['b1']);
    expect(() => operator.scopeBranches(Permission.OrdersView, 'b2')).toThrow(ForbiddenError);
  });

  it('system actor can everything', () => {
    expect(Actor.system().can(Permission.UsersManage)).toBe(true);
  });
});
