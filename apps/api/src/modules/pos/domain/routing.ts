/**
 * Маршрутизация филиалов по POS: какая кассовая система стоит на точке.
 * По умолчанию — manual (заказы ведутся на экране админки, внешней системы нет).
 * Настройка pos.routing: { default: 'manual', branches: { '<branchId>': '<provider>' } }.
 */
export const DEFAULT_POS_PROVIDER = 'manual';

export interface PosRouting {
  default: string;
  branches: Record<string, string>;
}

export const DEFAULT_POS_ROUTING: PosRouting = { default: DEFAULT_POS_PROVIDER, branches: {} };

export function providerForBranch(routing: PosRouting | null | undefined, branchId: string): string {
  const r = routing ?? DEFAULT_POS_ROUTING;
  return r.branches[branchId] || r.default || DEFAULT_POS_PROVIDER;
}
