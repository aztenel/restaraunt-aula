import { describe, expect, it } from 'vitest';
import { Permission } from '@aula/api-client';
import { branchesWith, can, canAnySomewhere, canInSelection, canSomewhere, hasGlobalScope, type PermissionSnapshot } from './permissions';

const operatorGl: PermissionSnapshot = {
  globalPermissions: [],
  branchPermissions: { gl: [Permission.OrdersView, Permission.OrdersManage], gv: [Permission.OrdersView] },
};

const finance: PermissionSnapshot = {
  globalPermissions: [Permission.OrdersView, Permission.PaymentsView],
  branchPermissions: {},
};

describe('can (семантика Actor.can на бэкенде)', () => {
  it('филиальное право — только в своём филиале', () => {
    expect(can(operatorGl, Permission.OrdersManage, 'gl')).toBe(true);
    expect(can(operatorGl, Permission.OrdersManage, 'gv')).toBe(false);
    expect(can(operatorGl, Permission.OrdersView, 'gv')).toBe(true);
  });

  it('без филиала требуется глобальное право', () => {
    expect(can(operatorGl, Permission.OrdersView)).toBe(false);
    expect(can(operatorGl, Permission.OrdersView, null)).toBe(false);
    expect(can(finance, Permission.OrdersView)).toBe(true);
  });

  it('глобальное право действует в любом филиале', () => {
    expect(can(finance, Permission.PaymentsView, 'any-branch')).toBe(true);
    expect(can(finance, Permission.OrdersManage, 'gl')).toBe(false);
  });

  it('нет сессии — нет прав', () => {
    expect(can(null, Permission.OrdersView, 'gl')).toBe(false);
    expect(canSomewhere(undefined, Permission.OrdersView)).toBe(false);
  });
});

describe('canSomewhere / canAnySomewhere (видимость разделов, как @RequirePermissions)', () => {
  it('право хотя бы в одном филиале', () => {
    expect(canSomewhere(operatorGl, Permission.OrdersManage)).toBe(true);
    expect(canSomewhere(operatorGl, Permission.UsersManage)).toBe(false);
    expect(canAnySomewhere(operatorGl, [Permission.UsersManage, Permission.OrdersView])).toBe(true);
    expect(canAnySomewhere(operatorGl, [])).toBe(false);
  });
});

describe('branchesWith / hasGlobalScope / canInSelection', () => {
  it('список филиалов с правом или all', () => {
    expect(branchesWith(operatorGl, Permission.OrdersManage)).toEqual(['gl']);
    expect(branchesWith(operatorGl, Permission.OrdersView)).toEqual(['gl', 'gv']);
    expect(branchesWith(finance, Permission.OrdersView)).toBe('all');
    expect(branchesWith(null, Permission.OrdersView)).toEqual([]);
  });

  it('«Все филиалы» доступны только при глобальных правах', () => {
    expect(hasGlobalScope(finance)).toBe(true);
    expect(hasGlobalScope(operatorGl)).toBe(false);
  });

  it('право в выбранном в шапке филиале', () => {
    expect(canInSelection(operatorGl, Permission.OrdersManage, 'gl')).toBe(true);
    expect(canInSelection(operatorGl, Permission.OrdersManage, null)).toBe(false);
    expect(canInSelection(finance, Permission.OrdersView, null)).toBe(true);
  });
});
