import { Injectable } from '@nestjs/common';
import { InvariantViolationError, ValidationError } from '../../../shared/kernel/errors';
import { Permission } from '../../../shared/kernel/permissions';
import { StaffDirectory, StaffMember, StaffRole } from '../../identity/public';
import { pickManager } from '../domain/assignment';
import { RequestRepository } from '../infrastructure/request.repository';

/**
 * Ответственный за заявку: активный банкетный менеджер с наименьшим числом открытых заявок;
 * если менеджеров нет — собственник. Инвариант ТЗ: у заявки всегда есть ответственный.
 */
@Injectable()
export class ManagerAssigner {
  constructor(
    private readonly staff: StaffDirectory,
    private readonly requests: RequestRepository,
  ) {}

  async pick(): Promise<StaffMember> {
    for (const role of [StaffRole.BanquetManager, StaffRole.Owner]) {
      const members = (await this.staff.withRole(role)).filter((m) => m.isActive);
      if (members.length === 0) continue;
      const loads = await this.requests.managerLoads(members.map((m) => m.id));
      const id = pickManager(
        members.map((m) => m.id),
        loads,
      );
      const member = members.find((m) => m.id === id);
      if (member) return member;
    }
    throw new InvariantViolationError('banquet.no_manager', 'No active banquet manager or owner to assign the request to');
  }

  /** Назначаемый вручную сотрудник должен быть активен и вести банкеты (право banquets.manage глобально). */
  async validate(userId: string): Promise<StaffMember> {
    const member = await this.staff.get(userId);
    if (!member || !member.isActive) throw new ValidationError('banquet.manager_invalid', 'Manager not found or inactive', { managerId: userId });
    const eligible = await this.staff.withPermission(Permission.BanquetsManage, null);
    if (!eligible.some((m) => m.id === userId)) {
      throw new ValidationError('banquet.manager_invalid', 'User cannot manage banquet requests', { managerId: userId });
    }
    return member;
  }

  /** Кандидаты для переназначения (выпадающий список в админке). */
  async candidates(): Promise<StaffMember[]> {
    return (await this.staff.withPermission(Permission.BanquetsManage, null)).filter((m) => m.isActive);
  }
}
