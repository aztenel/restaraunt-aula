/**
 * Переключатель филиала (ТЗ: «один интерфейс на все филиалы с переключателем филиала»).
 * Список — GET /admin/branches (сервер отдаёт только доступные сотруднику филиалы).
 * «Все филиалы» доступно только при глобальных правах. Выбор хранится в localStorage.
 */
import { useQuery } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { translate, type Branch } from '@aula/api-client';
import { branchesApi } from '../api/endpoints';
import { queryKeys } from '../api/query-keys';
import { useAuth } from '../auth/AuthProvider';
import { hasGlobalScope } from '../auth/permissions';
import { currentLanguage } from '../i18n/language';
import { useStoredState } from '../lib/storage';

export const ALL_BRANCHES = 'all' as const;
export type BranchSelection = string | typeof ALL_BRANCHES;

export interface BranchContextValue {
  branches: Branch[];
  loading: boolean;
  /** Выбор в шапке: id филиала или 'all'. */
  selection: BranchSelection | null;
  /** Выбранный филиал; null — «Все филиалы». */
  selectedBranchId: string | null;
  canSelectAll: boolean;
  setSelection(selection: BranchSelection): void;
  branchName(id: string | null | undefined): string;
  getBranch(id: string | null | undefined): Branch | undefined;
}

const STORAGE_KEY = 'aula_admin_branch';
const BranchContext = createContext<BranchContextValue | null>(null);

/** Корректный выбор с учётом прав и доступных филиалов. */
export function resolveBranchSelection(
  stored: BranchSelection | null,
  branchIds: readonly string[],
  canSelectAll: boolean,
): BranchSelection | null {
  if (stored === ALL_BRANCHES && canSelectAll) return ALL_BRANCHES;
  if (stored && stored !== ALL_BRANCHES && branchIds.includes(stored)) return stored;
  if (canSelectAll) return ALL_BRANCHES;
  return branchIds[0] ?? null;
}

export function BranchProvider({ children }: { children: ReactNode }) {
  const { status, me } = useAuth();
  const [stored, setStored] = useStoredState<BranchSelection | null>(STORAGE_KEY, null);
  const branchesQuery = useQuery({
    queryKey: queryKeys.branches,
    queryFn: branchesApi.list,
    enabled: status === 'authenticated',
    staleTime: 5 * 60_000,
  });

  const branches = useMemo(() => branchesQuery.data ?? [], [branchesQuery.data]);
  const canSelectAll = hasGlobalScope(me);
  const selection = resolveBranchSelection(
    stored,
    branches.map((b) => b.id),
    canSelectAll,
  );

  const getBranch = useCallback((id: string | null | undefined) => branches.find((b) => b.id === id), [branches]);
  const branchName = useCallback(
    (id: string | null | undefined) => {
      const branch = branches.find((b) => b.id === id);
      return branch ? translate(branch.name, currentLanguage()) : (id ?? '');
    },
    [branches],
  );

  const value = useMemo<BranchContextValue>(
    () => ({
      branches,
      loading: branchesQuery.isLoading,
      selection,
      selectedBranchId: selection === ALL_BRANCHES ? null : selection,
      canSelectAll,
      setSelection: setStored,
      branchName,
      getBranch,
    }),
    [branches, branchesQuery.isLoading, selection, canSelectAll, setStored, branchName, getBranch],
  );

  return <BranchContext.Provider value={value}>{children}</BranchContext.Provider>;
}

export function useBranch(): BranchContextValue {
  const value = useContext(BranchContext);
  if (!value) throw new Error('useBranch must be used inside <BranchProvider>');
  return value;
}
