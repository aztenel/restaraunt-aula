import { Injectable } from '@nestjs/common';
import { Actor } from '../../../shared/kernel/actor';
import { NotFoundError } from '../../../shared/kernel/errors';
import { Page, PageRequest } from '../../../shared/kernel/pagination';
import { Permission } from '../../../shared/kernel/permissions';
import { PromoCodeState } from '../domain/promo-code';
import { PromoCodeRepository, PromoUsageStats } from '../infrastructure/promo-code.repository';

export interface PromoCodeView {
  promo: PromoCodeState;
  usage: PromoUsageStats;
  /** Сотрудник может изменить промокод (право в его филиале или глобальное для сетевого). */
  editable: boolean;
}

/**
 * Промокоды в админке: сетевые видны всем с правом promocodes.manage, промокоды филиалов — в пределах
 * филиалов сотрудника.
 */
@Injectable()
export class PromoCodeQueries {
  constructor(private readonly promos: PromoCodeRepository) {}

  async list(
    actor: Actor,
    filter: { branchId?: string | null; q?: string; active?: boolean },
    page: PageRequest,
  ): Promise<Page<PromoCodeView>> {
    const branches = filter.branchId ? actor.scopeBranches(Permission.PromoCodesManage, filter.branchId) : actor.branchesWith(Permission.PromoCodesManage);
    const result = await this.promos.list({ branches, branchId: filter.branchId ?? undefined, q: filter.q, active: filter.active }, page);
    const stats = await this.promos.usageStats(result.items.map((p) => p.id));
    return {
      ...result,
      items: result.items.map((promo) => ({
        promo,
        usage: stats.get(promo.id) ?? { reserved: 0, used: 0, released: 0 },
        editable: actor.can(Permission.PromoCodesManage, promo.branchId),
      })),
    };
  }

  async get(actor: Actor, id: string): Promise<PromoCodeView> {
    const promo = await this.promos.findById(id);
    if (!promo) throw new NotFoundError('promo_code', id);
    const visible = promo.branchId === null ? actor.canSomewhere(Permission.PromoCodesManage) : actor.can(Permission.PromoCodesManage, promo.branchId);
    if (!visible) throw new NotFoundError('promo_code', id);
    const stats = await this.promos.usageStats([id]);
    return { promo, usage: stats.get(id)!, editable: actor.can(Permission.PromoCodesManage, promo.branchId) };
  }
}
