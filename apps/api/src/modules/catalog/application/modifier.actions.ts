import { Injectable } from '@nestjs/common';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { Database } from '../../../shared/infrastructure/database/database';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/kernel/errors';
import { newId } from '../../../shared/kernel/ids';
import { Money } from '../../../shared/kernel/money';
import { Permission } from '../../../shared/kernel/permissions';
import { Translatable } from '../../../shared/kernel/translatable';
import { assertMenuPrice, optionalText, requiredText, TEXT_LIMITS } from '../domain/dish';
import { validateModifierGroupConfig } from '../domain/modifiers';
import { assertSlug, generateUniqueSlug } from '../domain/slug';
import { guardUnique } from '../infrastructure/db-errors';
import {
  ModifierGroupRecord,
  ModifierGroupWrite,
  ModifierOptionWrite,
  ModifierRepository,
} from '../infrastructure/modifier.repository';
import { CatalogEventPublisher } from './catalog-events';

export interface ModifierOptionInput {
  /** Существующая опция группы; не задан — новая опция. */
  id?: string | null;
  name: Translatable;
  price: Money;
  isDefault?: boolean | null;
  sortOrder?: number | null;
  isActive?: boolean | null;
}

export interface ModifierGroupInput {
  /** Код группы (латиница) — не задан: из названия. */
  code?: string | null;
  name: Translatable;
  description?: Translatable | null;
  minSelect: number;
  maxSelect: number;
  sortOrder?: number | null;
  isActive?: boolean | null;
  /** Полный список опций группы: отсутствующие в списке опции удаляются. */
  options: ModifierOptionInput[];
}

async function toWrite(
  input: ModifierGroupInput,
  current: ModifierGroupRecord | null,
  repo: ModifierRepository,
): Promise<{ group: ModifierGroupWrite; options: ModifierOptionWrite[] }> {
  const name = requiredText(input.name, TEXT_LIMITS.name, 'name');
  let code: string;
  if (input.code) {
    code = assertSlug(input.code, 'code');
    if (await repo.codeTaken(code, current?.id)) {
      throw new ConflictError('catalog.modifier_code_taken', 'Modifier group with this code already exists', { code });
    }
  } else if (current) {
    code = current.code;
  } else {
    code = await generateUniqueSlug(name, 'modifiers', (s) => repo.codeTaken(s));
  }
  const known = new Set(current?.options.map((o) => o.id) ?? []);
  const seen = new Set<string>();
  const options: ModifierOptionWrite[] = input.options.map((o, index) => {
    if (o.id) {
      if (!known.has(o.id)) {
        throw new ValidationError('catalog.unknown_modifier_option', 'Option does not belong to this group', { optionId: o.id });
      }
      if (seen.has(o.id)) throw new ValidationError('catalog.duplicate_ids', 'Option listed twice', { optionId: o.id });
      seen.add(o.id);
    }
    return {
      id: o.id ?? newId(),
      name: requiredText(o.name, TEXT_LIMITS.name, `options[${index}].name`),
      price: assertMenuPrice(o.price),
      isDefault: o.isDefault ?? false,
      sortOrder: o.sortOrder ?? (index + 1) * 10,
      isActive: o.isActive ?? true,
    };
  });
  const group: ModifierGroupWrite = {
    code,
    name,
    description: optionalText(input.description === undefined ? current?.description : input.description, TEXT_LIMITS.description, 'description'),
    minSelect: input.minSelect,
    maxSelect: input.maxSelect,
    sortOrder: input.sortOrder ?? current?.sortOrder ?? 0,
    isActive: input.isActive ?? current?.isActive ?? true,
  };
  validateModifierGroupConfig({ minSelect: group.minSelect, maxSelect: group.maxSelect, options });
  return { group, options };
}

function auditView(group: ModifierGroupWrite, options: ModifierOptionWrite[]) {
  return { ...group, options: options.map((o) => ({ ...o, price: o.price.toJSON() })) };
}

@Injectable()
export class CreateModifierGroup {
  constructor(
    private readonly modifiers: ModifierRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly events: CatalogEventPublisher,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, input: ModifierGroupInput): Promise<string> {
    actor.assertCan(Permission.MenuContent);
    const id = newId();
    await guardUnique(
      () =>
        this.database.transaction(async () => {
          const { group, options } = await toWrite(input, null, this.modifiers);
          await this.modifiers.insertGroup(id, group);
          await this.modifiers.syncOptions(id, options, this.clock.now());
          await this.audit.record({ action: 'menu.modifier_group_created', entityType: 'modifier_group', entityId: id, after: auditView(group, options) });
          await this.events.menuChanged({ branchId: null });
        }),
      'catalog.modifier_code_taken',
      'Modifier group with this code already exists',
    );
    return id;
  }
}

@Injectable()
export class UpdateModifierGroup {
  constructor(
    private readonly modifiers: ModifierRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly events: CatalogEventPublisher,
    private readonly clock: Clock,
  ) {}

  /** Изменение группы и её опций (включая цены опций — пишутся в журнал «было/стало»). */
  async execute(actor: Actor, id: string, input: ModifierGroupInput): Promise<void> {
    actor.assertCan(Permission.MenuContent);
    await guardUnique(
      () =>
        this.database.transaction(async () => {
          const current = await this.modifiers.findById(id);
          if (!current) throw new NotFoundError('modifier_group', id);
          const { group, options } = await toWrite(input, current, this.modifiers);
          await this.modifiers.updateGroup(id, group);
          await this.modifiers.syncOptions(id, options, this.clock.now());
          await this.audit.record({
            action: 'menu.modifier_group_updated',
            entityType: 'modifier_group',
            entityId: id,
            before: auditView(current, current.options),
            after: auditView(group, options),
          });
          await this.events.menuChanged({ branchId: null });
        }),
      'catalog.modifier_code_taken',
      'Modifier group with this code already exists',
    );
  }
}

@Injectable()
export class DeleteModifierGroup {
  constructor(
    private readonly modifiers: ModifierRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly events: CatalogEventPublisher,
    private readonly clock: Clock,
  ) {}

  /** Логическое удаление группы; группа отвязывается от блюд (список блюд — в журнале). */
  async execute(actor: Actor, id: string): Promise<void> {
    actor.assertCan(Permission.MenuContent);
    await this.database.transaction(async () => {
      const current = await this.modifiers.findById(id);
      if (!current) throw new NotFoundError('modifier_group', id);
      const dishIds = await this.modifiers.dishIdsUsing(id);
      await this.modifiers.unlinkFromDishes(id);
      await this.modifiers.softDeleteGroup(id, this.clock.now());
      await this.audit.record({
        action: 'menu.modifier_group_deleted',
        entityType: 'modifier_group',
        entityId: id,
        before: { ...auditView(current, current.options), dishIds },
      });
      await this.events.menuChanged({ branchId: null });
    });
  }
}
