/**
 * Доступные действия в разделах «Меню», «Стоп-лист» и «Контент» — зеркало проверок модуля Catalog:
 *  - структура каталога (категории, блюда, модификаторы, фото) — menu.content ГЛОБАЛЬНО
 *    (actor.assertCan(MenuContent) без филиала);
 *  - меню филиала: цены, добавление/удаление, копирование, код POS — menu.prices В ФИЛИАЛЕ;
 *  - стоп-лист — menu.stoplist В ФИЛИАЛЕ;
 *  - просмотр справочников — любое из menu.content / menu.prices / menu.stoplist хоть где-то,
 *    меню филиала — любое из них в этом филиале (или глобально);
 *  - баннер филиала — content.manage в этом филиале, общий баннер — глобально;
 *    акция — content.manage во всех её филиалах (пустой список — глобально); страницы — глобально.
 * Это только UX (скрыть/заблокировать недоступное): окончательную проверку делает сервер.
 */
import { Permission } from '@aula/api-client';
import { can, canAnySomewhere, type PermissionSnapshot } from '@/shared/auth/permissions';

const P = Permission;

/** Права чтения справочников меню (как MENU_READ_PERMISSIONS на сервере). */
export const MENU_READ_PERMISSIONS = [P.MenuContent, P.MenuPrices, P.MenuStopList] as const;
/** Отчёт о переводах: menu.content или content.manage. */
export const TRANSLATIONS_PERMISSIONS = [P.MenuContent, P.ContentManage] as const;

export interface CatalogAbilities {
  /** Смотреть категории, блюда, модификаторы. */
  viewCatalog: boolean;
  /** Создавать и менять категории, блюда, модификаторы, фото. */
  editCatalog: boolean;
  /** Отчёт о полноте переводов. */
  viewTranslations: boolean;
}

export function catalogAbilities(snapshot: PermissionSnapshot | null | undefined): CatalogAbilities {
  return {
    viewCatalog: canAnySomewhere(snapshot, MENU_READ_PERMISSIONS),
    editCatalog: can(snapshot, P.MenuContent),
    viewTranslations: canAnySomewhere(snapshot, TRANSLATIONS_PERMISSIONS),
  };
}

export interface BranchMenuAbilities {
  /** Смотреть меню и стоп-лист филиала. */
  view: boolean;
  /** Цены, добавление/удаление блюд, массовое изменение, копирование, код POS филиала. */
  editPrices: boolean;
  /** Ставить в стоп и возвращать в продажу. */
  editStopList: boolean;
}

export function branchMenuAbilities(snapshot: PermissionSnapshot | null | undefined, branchId: string | null): BranchMenuAbilities {
  if (!branchId) return { view: false, editPrices: false, editStopList: false };
  return {
    view: MENU_READ_PERMISSIONS.some((p) => can(snapshot, p, branchId)),
    editPrices: can(snapshot, P.MenuPrices, branchId),
    editStopList: can(snapshot, P.MenuStopList, branchId),
  };
}

/** Филиалы, меню которых сотрудник может открыть (для выбора филиала, если в шапке «Все филиалы»). */
export function branchesWithMenuAccess(snapshot: PermissionSnapshot | null | undefined, branchIds: readonly string[], permissions: readonly Permission[] = MENU_READ_PERMISSIONS): string[] {
  return branchIds.filter((id) => permissions.some((p) => can(snapshot, p, id)));
}

/** Баннер филиала (branchId) или общий (null). */
export function canEditBanner(snapshot: PermissionSnapshot | null | undefined, branchId: string | null): boolean {
  return can(snapshot, P.ContentManage, branchId);
}

/** Акция во всех перечисленных филиалах; пустой список — акция сети (нужно глобальное право). */
export function canEditPromotion(snapshot: PermissionSnapshot | null | undefined, branchIds: readonly string[]): boolean {
  const scope: Array<string | null> = branchIds.length === 0 ? [null] : [...branchIds];
  return scope.every((branchId) => can(snapshot, P.ContentManage, branchId));
}

/** Статические страницы витрины — только глобальное право. */
export function canEditPages(snapshot: PermissionSnapshot | null | undefined): boolean {
  return can(snapshot, P.ContentManage);
}

/** Раздел «Контент»: баннеры/акции/страницы хоть где-то. */
export function canViewContent(snapshot: PermissionSnapshot | null | undefined): boolean {
  return canAnySomewhere(snapshot, [P.ContentManage]);
}
