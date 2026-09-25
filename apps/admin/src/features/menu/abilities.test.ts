import { describe, expect, it } from 'vitest';
import { Permission } from '@aula/api-client';
import type { PermissionSnapshot } from '@/shared/auth/permissions';
import {
  branchesWithMenuAccess,
  branchMenuAbilities,
  canEditBanner,
  canEditPages,
  canEditPromotion,
  canViewContent,
  catalogAbilities,
} from './abilities';

const P = Permission;

// Права ролей — как ROLE_DEFINITIONS на сервере (identity/domain/roles.ts).
const contentManager: PermissionSnapshot = {
  globalPermissions: [P.MenuContent, P.MenuPrices, P.ContentManage, P.PromoCodesManage],
  branchPermissions: {},
};
const branchManagerGl: PermissionSnapshot = {
  globalPermissions: [],
  branchPermissions: { gl: [P.OrdersView, P.MenuPrices, P.MenuStopList, P.PromoCodesManage] },
};
const operatorGl: PermissionSnapshot = {
  globalPermissions: [],
  branchPermissions: { gl: [P.OrdersView, P.OrdersManage, P.ReservationsView] },
};
const localContentEditor: PermissionSnapshot = {
  globalPermissions: [],
  branchPermissions: { gl: [P.ContentManage] },
};
const owner: PermissionSnapshot = { globalPermissions: [P.MenuContent, P.MenuPrices, P.MenuStopList, P.ContentManage], branchPermissions: {} };

describe('каталог: структура меню — только глобальное menu.content', () => {
  it('контент-менеджер редактирует категории, блюда и модификаторы', () => {
    expect(catalogAbilities(contentManager)).toEqual({ viewCatalog: true, editCatalog: true, viewTranslations: true });
  });

  it('управляющий филиалом видит каталог только для чтения', () => {
    expect(catalogAbilities(branchManagerGl)).toEqual({ viewCatalog: true, editCatalog: false, viewTranslations: false });
  });

  it('оператор точки не видит раздел меню', () => {
    expect(catalogAbilities(operatorGl).viewCatalog).toBe(false);
    expect(catalogAbilities(null).editCatalog).toBe(false);
  });
});

describe('меню филиала: цены и стоп-лист — права в выбранном филиале', () => {
  it('управляющий: цены и стоп-лист только в своём филиале', () => {
    expect(branchMenuAbilities(branchManagerGl, 'gl')).toEqual({ view: true, editPrices: true, editStopList: true });
    expect(branchMenuAbilities(branchManagerGl, 'gv')).toEqual({ view: false, editPrices: false, editStopList: false });
  });

  it('контент-менеджер: цены во всех филиалах, стоп-лист — нет', () => {
    expect(branchMenuAbilities(contentManager, 'gv')).toEqual({ view: true, editPrices: true, editStopList: false });
  });

  it('«Все филиалы» (null) — действия недоступны, нужен конкретный филиал', () => {
    expect(branchMenuAbilities(owner, null)).toEqual({ view: false, editPrices: false, editStopList: false });
    expect(branchMenuAbilities(owner, 'gl').editStopList).toBe(true);
  });

  it('выбор филиала: только филиалы с доступом к меню или стоп-листу', () => {
    expect(branchesWithMenuAccess(branchManagerGl, ['gl', 'gv'])).toEqual(['gl']);
    expect(branchesWithMenuAccess(contentManager, ['gl', 'gv'])).toEqual(['gl', 'gv']);
    expect(branchesWithMenuAccess(contentManager, ['gl', 'gv'], [P.MenuStopList])).toEqual([]);
    expect(branchesWithMenuAccess(operatorGl, ['gl'])).toEqual([]);
  });
});

describe('контент: баннеры, акции, страницы', () => {
  it('общий баннер и страницы — только при глобальном content.manage', () => {
    expect(canEditBanner(contentManager, null)).toBe(true);
    expect(canEditBanner(localContentEditor, null)).toBe(false);
    expect(canEditBanner(localContentEditor, 'gl')).toBe(true);
    expect(canEditBanner(localContentEditor, 'gv')).toBe(false);
    expect(canEditPages(contentManager)).toBe(true);
    expect(canEditPages(localContentEditor)).toBe(false);
  });

  it('акция — право во всех её филиалах; акция сети (пустой список) — глобально', () => {
    expect(canEditPromotion(localContentEditor, ['gl'])).toBe(true);
    expect(canEditPromotion(localContentEditor, ['gl', 'gv'])).toBe(false);
    expect(canEditPromotion(localContentEditor, [])).toBe(false);
    expect(canEditPromotion(contentManager, [])).toBe(true);
  });

  it('раздел «Контент» виден при content.manage хоть где-то', () => {
    expect(canViewContent(localContentEditor)).toBe(true);
    expect(canViewContent(branchManagerGl)).toBe(false);
  });
});
