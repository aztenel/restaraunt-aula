import { Injectable } from '@nestjs/common';
import { isPermission } from '../../../shared/kernel/permissions';
import { tryNormalizePhone } from '../../../shared/kernel/phone';
import { translate } from '../../../shared/kernel/translatable';
import { BranchDirectory, StaffDirectory, StaffMember } from '../../identity/public';
import { BranchContacts, planStaffDeliveries, PlannedDelivery } from '../domain/delivery-plan';
import { STAFF_LOCALE } from '../domain/templates';

export interface StaffAudienceSpec {
  branchId: string | null;
  permission: string | null;
  userIds: string[];
  /** null — по умолчанию: каналы точки, если не заданы ни право, ни сотрудники. */
  includeBranchChannels: boolean | null;
}

/**
 * Адресаты уведомления персоналу: сотрудники с правом в филиале (глобальные роли включаются)
 * и/или конкретные сотрудники; при includeBranchChannels — WhatsApp номера точки и Telegram-чат филиала.
 */
@Injectable()
export class StaffAudienceResolver {
  constructor(
    private readonly staff: StaffDirectory,
    private readonly branches: BranchDirectory,
  ) {}

  async resolve(audience: StaffAudienceSpec): Promise<PlannedDelivery[]> {
    const members = new Map<string, StaffMember>();
    if (audience.permission && isPermission(audience.permission)) {
      for (const m of await this.staff.withPermission(audience.permission, audience.branchId)) members.set(m.id, m);
    }
    for (const userId of audience.userIds) {
      const m = await this.staff.get(userId);
      if (m && m.isActive) members.set(m.id, m);
    }
    const includeBranch = audience.includeBranchChannels ?? (!audience.permission && audience.userIds.length === 0);
    let branch: BranchContacts | null = null;
    if (includeBranch && audience.branchId) {
      const info = await this.branches.find(audience.branchId);
      if (info) {
        branch = {
          name: translate(info.name, STAFF_LOCALE),
          phone: tryNormalizePhone(info.settings.staffNotifyPhone),
          telegramChatId: info.settings.staffTelegramChatId?.trim() || null,
        };
      }
    }
    return planStaffDeliveries({
      members: [...members.values()].map((m) => ({
        id: m.id,
        name: m.name,
        phone: tryNormalizePhone(m.phone),
        telegramChatId: m.telegramChatId?.trim() || null,
      })),
      branch,
    });
  }
}
