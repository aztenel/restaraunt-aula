import { Injectable } from '@nestjs/common';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { Database } from '../../../shared/infrastructure/database/database';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/kernel/errors';
import { newId } from '../../../shared/kernel/ids';
import { Permission } from '../../../shared/kernel/permissions';
import { validateTemplateBody } from '../domain/contract-template';
import { ContractTemplateRecord, ContractTemplateWrite, TemplateRepository } from '../infrastructure/template.repository';

export interface ContractTemplateInput {
  code: string;
  name: string;
  body: string;
  isDefault?: boolean;
}

function normalize(input: ContractTemplateInput): ContractTemplateWrite {
  const code = input.code.trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,60}$/.test(code)) throw new ValidationError('banquet_template.invalid_code', 'Code: 2-60 latin letters, digits, - or _');
  const name = input.name.trim();
  if (!name || name.length > 200) throw new ValidationError('banquet_template.invalid_name', 'Name is required (up to 200 chars)');
  return { code, name, body: validateTemplateBody(input.body), isDefault: input.isDefault ?? false };
}

/**
 * Шаблоны договоров (общие для сети): создают и правят собственник и банкетные менеджеры (banquets.manage).
 * Шаблон по умолчанию — один; неизвестные подстановки в тексте отклоняются.
 */
@Injectable()
export class SaveContractTemplate {
  constructor(
    private readonly templates: TemplateRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
  ) {}

  async execute(actor: Actor, id: string | null, input: ContractTemplateInput): Promise<ContractTemplateRecord> {
    actor.assertCan(Permission.BanquetsManage);
    const data = normalize(input);
    return this.database.transaction(async () => {
      await this.database.advisoryLock('banquet.contract_templates', 'all');
      const current = id ? await this.templates.findById(id) : null;
      if (id && !current) throw new NotFoundError('banquet_contract_template', id);
      if (await this.templates.findByCode(data.code, id ?? undefined)) {
        throw new ConflictError('banquet_template.duplicate_code', 'Template with this code already exists');
      }
      const templateId = id ?? newId();
      const hasDefault = await this.templates.findDefault();
      // Первый шаблон становится шаблоном по умолчанию; снять признак можно, только назначив другой шаблон.
      const isDefault = data.isDefault || !hasDefault || (current?.isDefault ?? false);
      const write = { ...data, isDefault };
      if (isDefault) await this.templates.clearDefault(templateId);
      if (current) await this.templates.update(templateId, write, actor.userId);
      else await this.templates.insert(templateId, write, actor.userId);
      await this.audit.record({
        action: current ? 'banquet.contract_template_updated' : 'banquet.contract_template_created',
        entityType: 'banquet_contract_template',
        entityId: templateId,
        before: current ? { code: current.code, name: current.name, isDefault: current.isDefault, body: current.body } : undefined,
        after: write,
        actor,
      });
      return (await this.templates.findById(templateId))!;
    });
  }
}

@Injectable()
export class DeleteContractTemplate {
  constructor(
    private readonly templates: TemplateRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, id: string): Promise<void> {
    actor.assertCan(Permission.BanquetsManage);
    await this.database.transaction(async () => {
      const current = await this.templates.findById(id);
      if (!current) throw new NotFoundError('banquet_contract_template', id);
      await this.templates.softDelete(id, this.clock.now());
      await this.audit.record({
        action: 'banquet.contract_template_deleted',
        entityType: 'banquet_contract_template',
        entityId: id,
        before: { code: current.code, name: current.name, isDefault: current.isDefault },
        actor,
      });
    });
  }
}
