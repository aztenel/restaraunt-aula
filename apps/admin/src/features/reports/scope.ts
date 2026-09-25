/**
 * Область отчёта — зеркало ReportScopes на сервере (reporting/application/report-scope.ts), только для UX:
 *  - выбран филиал → отчёт филиала, нужно reports.branch в этом филиале (или глобально);
 *  - «Все филиалы» → сводный отчёт, нужно глобальное reports.consolidated.
 * Выгрузка в учёт — reports.export (в филиале; по всей сети — глобально).
 * Итоги агрегаторов вводит сотрудник с reports.branch в филиале. Окончательно права проверяет сервер.
 */
import { Permission } from '@aula/api-client';
import { branchesWith, can, type PermissionSnapshot } from '@/shared/auth/permissions';

export type ReportScope =
  /** Отчёт филиала. */
  | { kind: 'branch'; branchId: string }
  /** Сводный по сети (branchId в запросе не передаётся). */
  | { kind: 'consolidated' }
  /** «Все филиалы», но сводных прав нет — выбрать один из доступных филиалов. */
  | { kind: 'choose_branch'; branchIds: string[] }
  /** Выбран филиал без права на его отчёты. */
  | { kind: 'forbidden'; canConsolidated: boolean };

/** Филиалы, где есть reports.branch (из списка доступных сотруднику филиалов). */
export function reportBranches(me: PermissionSnapshot | null | undefined, branchIds: readonly string[]): string[] {
  const scope = branchesWith(me, Permission.ReportsBranch);
  return scope === 'all' ? [...branchIds] : branchIds.filter((id) => scope.includes(id));
}

export function reportScope(
  me: PermissionSnapshot | null | undefined,
  selectedBranchId: string | null,
  branchIds: readonly string[],
): ReportScope {
  const canConsolidated = can(me, Permission.ReportsConsolidated);
  if (selectedBranchId) {
    return can(me, Permission.ReportsBranch, selectedBranchId) ? { kind: 'branch', branchId: selectedBranchId } : { kind: 'forbidden', canConsolidated };
  }
  if (canConsolidated) return { kind: 'consolidated' };
  return { kind: 'choose_branch', branchIds: reportBranches(me, branchIds) };
}

/** branchId запроса: null — сводный. Для choose_branch / forbidden запрос не выполняется. */
export function scopeBranchId(scope: ReportScope): string | null | undefined {
  if (scope.kind === 'branch') return scope.branchId;
  if (scope.kind === 'consolidated') return null;
  return undefined;
}

/** Выгрузка в учёт: по филиалу — reports.export в нём; по всей сети — глобальное reports.export. */
export function canAccountingExport(me: PermissionSnapshot | null | undefined, branchId: string | null): boolean {
  return can(me, Permission.ReportsExport, branchId);
}

/** Ввод итогов агрегаторов: reports.branch в филиале (сводный ввод невозможен — итог по филиалу). */
export function canEditAggregators(me: PermissionSnapshot | null | undefined, branchId: string | null): boolean {
  return branchId !== null && can(me, Permission.ReportsBranch, branchId);
}
