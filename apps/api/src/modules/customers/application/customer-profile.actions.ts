import { Injectable } from '@nestjs/common';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { sha256 } from '../../../shared/infrastructure/crypto/secret-box';
import { Database } from '../../../shared/infrastructure/database/database';
import { EventBus } from '../../../shared/infrastructure/events/event-bus';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/kernel/errors';
import { Permission } from '../../../shared/kernel/permissions';
import { randomToken } from '../../../shared/kernel/random';
import { toLocalDate } from '../../../shared/kernel/time';
import { isLocale, Locale } from '../../../shared/kernel/translatable';
import {
  anonymizedPhoneMarker,
  CUSTOMER_LIMITS,
  describeProfileChange,
  EditableProfile,
  normalizeName,
  normalizeTag,
  normalizeTags,
  normalizeText,
  requireValidEmail,
  validateBirthday,
} from '../domain/customer';
import { ConsentRepository } from '../infrastructure/consent.repository';
import { CustomerRecord, CustomerRepository } from '../infrastructure/customer.repository';
import { PhoneVerificationRepository } from '../infrastructure/phone-verification.repository';
import { CustomerAnonymizedPayload, CustomersEvents } from '../public';
import { CustomerAdminView, toAdminView } from './customer-views';

export interface CustomerProfilePatch {
  name?: string | null;
  email?: string | null;
  birthday?: string | null;
  locale?: Locale;
  tags?: string[];
  allergies?: string | null;
  preferences?: string | null;
  notes?: string | null;
}

function editable(c: CustomerRecord): EditableProfile {
  return {
    name: c.name,
    email: c.email,
    birthday: c.birthday,
    locale: c.locale,
    tags: c.tags,
    allergies: c.allergies,
    preferences: c.preferences,
    notes: c.notes,
  };
}

/**
 * Правка карточки гостя менеджером (customers.manage): имя, почта, день рождения, язык, теги,
 * аллергии, предпочтения, заметки. В журнал — изменённые поля (ПД маскируются).
 */
@Injectable()
export class UpdateCustomerProfile {
  constructor(
    private readonly customers: CustomerRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, customerId: string, patch: CustomerProfilePatch): Promise<CustomerAdminView> {
    actor.assertCanSomewhere(Permission.CustomersManage);
    return this.database.transaction(async () => {
      const current = await this.customers.findByIdForUpdate(customerId);
      if (!current) throw new NotFoundError('customer', customerId);
      if (current.anonymizedAt) throw new ConflictError('customer.anonymized', 'Customer is anonymized');
      const before = editable(current);
      if (patch.locale !== undefined && !isLocale(patch.locale)) {
        throw new ValidationError('customer.locale_invalid', 'Locale must be kk, ru or en');
      }
      const after: EditableProfile = {
        name: patch.name !== undefined ? normalizeName(patch.name) : before.name,
        email: patch.email !== undefined ? requireValidEmail(patch.email) : before.email,
        birthday: patch.birthday !== undefined ? validateBirthday(patch.birthday, toLocalDate(this.clock.now())) : before.birthday,
        locale: patch.locale ?? before.locale,
        tags: patch.tags !== undefined ? normalizeTags(patch.tags ?? []) : before.tags,
        allergies: patch.allergies !== undefined ? normalizeText(patch.allergies, 'allergies') : before.allergies,
        preferences: patch.preferences !== undefined ? normalizeText(patch.preferences, 'preferences') : before.preferences,
        notes: patch.notes !== undefined ? normalizeText(patch.notes, 'notes') : before.notes,
      };
      const change = describeProfileChange(before, after);
      if (change.changed.length === 0) return toAdminView(current);
      await this.customers.updateProfile(customerId, after);
      await this.audit.record({
        action: 'customer.updated',
        entityType: 'customer',
        entityId: customerId,
        before: change.before,
        after: change.after,
        meta: { fields: change.changed },
      });
      return toAdminView((await this.customers.findById(customerId))!);
    });
  }
}

/** Добавить тег гостю (например 'banquet' после заявки, 'corporate' при оплате юрлицом). Идемпотентно. */
@Injectable()
export class AddCustomerTag {
  constructor(
    private readonly customers: CustomerRepository,
    private readonly database: Database,
  ) {}

  async execute(customerId: string, rawTag: string): Promise<void> {
    const tag = normalizeTag(rawTag);
    await this.database.transaction(async () => {
      const customer = await this.customers.findByIdForUpdate(customerId);
      if (!customer) throw new NotFoundError('customer', customerId);
      if (customer.tags.includes(tag)) return;
      if (customer.tags.length >= CUSTOMER_LIMITS.tagsPerCustomer) {
        throw new ValidationError('customer.too_many_tags', `At most ${CUSTOMER_LIMITS.tagsPerCustomer} tags`);
      }
      await this.customers.addTag(customerId, tag);
    });
  }
}

/**
 * Обезличивание гостя по его требованию (закон РК о ПД): телефон заменяется необратимым маркером,
 * имя, почта, день рождения, аллергии, предпочтения и заметки стираются, IP в истории согласий —
 * тоже; коды подтверждения на этот номер удаляются. Агрегаты и история (без ПД) сохраняются для
 * отчётности. В журнал и событие ПД не попадают.
 */
@Injectable()
export class AnonymizeCustomer {
  constructor(
    private readonly customers: CustomerRepository,
    private readonly consents: ConsentRepository,
    private readonly verifications: PhoneVerificationRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly events: EventBus,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, customerId: string, input: { reason?: string | null } = {}): Promise<CustomerAdminView> {
    actor.assertCanSomewhere(Permission.CustomersManage);
    const reason = input.reason?.trim().slice(0, 500) || null;
    return this.database.transaction(async () => {
      const customer = await this.customers.findByIdForUpdate(customerId);
      if (!customer) throw new NotFoundError('customer', customerId);
      if (customer.anonymizedAt) throw new ConflictError('customer.already_anonymized', 'Customer is already anonymized');
      const now = this.clock.now();
      const marker = anonymizedPhoneMarker(sha256(`${customerId}:${randomToken(32)}`));
      await this.customers.anonymize(customerId, marker, now);
      await this.consents.eraseIps(customerId);
      await this.verifications.deleteForPhone(customer.phone);
      await this.audit.record({
        action: 'customer.anonymized',
        entityType: 'customer',
        entityId: customerId,
        before: { anonymized: false },
        after: { anonymized: true, anonymizedAt: now.toISOString() },
        meta: reason ? { reason } : {},
      });
      await this.events.publish<CustomerAnonymizedPayload>(
        CustomersEvents.CustomerAnonymized,
        { customerId, phone: customer.phone, email: customer.email ?? null, occurredAt: now.toISOString() },
        { aggregateId: customerId },
      );
      return toAdminView((await this.customers.findById(customerId))!);
    });
  }
}
