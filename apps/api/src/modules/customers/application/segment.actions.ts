import { Injectable } from '@nestjs/common';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { Database } from '../../../shared/infrastructure/database/database';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/kernel/errors';
import { newId } from '../../../shared/kernel/ids';
import { Permission } from '../../../shared/kernel/permissions';
import { CustomerFilter, normalizeCustomerFilter } from '../domain/customer-filter';
import { SegmentRecord, SegmentRepository } from '../infrastructure/segment.repository';

export interface SegmentInput {
  name: string;
  description?: string | null;
  filter: CustomerFilter | Record<string, unknown>;
}

function validate(input: SegmentInput): { name: string; description: string | null; filter: CustomerFilter } {
  const name = (input.name ?? '').replace(/\s+/g, ' ').trim();
  if (name.length < 1 || name.length > 120) throw new ValidationError('customer_segment.name_invalid', 'Name: 1-120 characters');
  const description = input.description?.trim() || null;
  if (description && description.length > 500) {
    throw new ValidationError('customer_segment.description_too_long', 'Description: up to 500 characters');
  }
  return { name, description, filter: normalizeCustomerFilter(input.filter) };
}

/** Сегмент — сохранённый фильтр базы гостей (для выгрузок и рассылок). */
@Injectable()
export class CreateCustomerSegment {
  constructor(
    private readonly segments: SegmentRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
  ) {}

  async execute(actor: Actor, input: SegmentInput): Promise<SegmentRecord> {
    actor.assertCanSomewhere(Permission.CustomersManage);
    const data = validate(input);
    const id = newId();
    await this.database.transaction(async () => {
      await this.database.advisoryLock('customers.segment_name', data.name.toLowerCase());
      if (await this.segments.findByName(data.name)) {
        throw new ConflictError('customer_segment.name_taken', 'Segment with this name already exists');
      }
      await this.segments.insert({ id, ...data, userId: actor.userId });
      await this.audit.record({ action: 'customer_segment.created', entityType: 'customer_segment', entityId: id, after: data });
    });
    return (await this.segments.findById(id))!;
  }
}

@Injectable()
export class UpdateCustomerSegment {
  constructor(
    private readonly segments: SegmentRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
  ) {}

  async execute(actor: Actor, segmentId: string, input: SegmentInput): Promise<SegmentRecord> {
    actor.assertCanSomewhere(Permission.CustomersManage);
    const data = validate(input);
    await this.database.transaction(async () => {
      const current = await this.segments.findById(segmentId);
      if (!current) throw new NotFoundError('customer_segment', segmentId);
      await this.database.advisoryLock('customers.segment_name', data.name.toLowerCase());
      if (await this.segments.findByName(data.name, segmentId)) {
        throw new ConflictError('customer_segment.name_taken', 'Segment with this name already exists');
      }
      await this.segments.update(segmentId, { ...data, userId: actor.userId });
      await this.audit.record({
        action: 'customer_segment.updated',
        entityType: 'customer_segment',
        entityId: segmentId,
        before: { name: current.name, description: current.description, filter: current.filter },
        after: data,
      });
    });
    return (await this.segments.findById(segmentId))!;
  }
}

@Injectable()
export class DeleteCustomerSegment {
  constructor(
    private readonly segments: SegmentRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, segmentId: string): Promise<void> {
    actor.assertCanSomewhere(Permission.CustomersManage);
    await this.database.transaction(async () => {
      const current = await this.segments.findById(segmentId);
      if (!current) throw new NotFoundError('customer_segment', segmentId);
      await this.segments.softDelete(segmentId, this.clock.now(), actor.userId);
      await this.audit.record({
        action: 'customer_segment.deleted',
        entityType: 'customer_segment',
        entityId: segmentId,
        before: { name: current.name, filter: current.filter },
      });
    });
  }
}
