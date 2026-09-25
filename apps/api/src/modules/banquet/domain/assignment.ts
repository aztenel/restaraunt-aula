/**
 * Автоназначение ответственного (decisions.md: менеджер с наименьшим числом активных заявок).
 * При равенстве — тот, кому дольше всего не назначали заявки; затем детерминированно по id.
 */
export interface ManagerLoad {
  managerId: string;
  openRequests: number;
  lastAssignedAt: Date | null;
}

export function pickManager(candidateIds: readonly string[], loads: ReadonlyMap<string, ManagerLoad>): string | null {
  if (candidateIds.length === 0) return null;
  const ranked = [...new Set(candidateIds)].map((id) => loads.get(id) ?? { managerId: id, openRequests: 0, lastAssignedAt: null });
  ranked.sort((a, b) => {
    if (a.openRequests !== b.openRequests) return a.openRequests - b.openRequests;
    const at = a.lastAssignedAt?.getTime() ?? -Infinity;
    const bt = b.lastAssignedAt?.getTime() ?? -Infinity;
    if (at !== bt) return at < bt ? -1 : 1;
    return a.managerId.localeCompare(b.managerId);
  });
  return ranked[0]!.managerId;
}
