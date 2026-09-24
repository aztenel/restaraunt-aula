import { Injectable } from '@nestjs/common';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { Database } from '../../../shared/infrastructure/database/database';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/kernel/errors';
import { newId } from '../../../shared/kernel/ids';
import { Permission } from '../../../shared/kernel/permissions';
import { Translatable } from '../../../shared/kernel/translatable';
import {
  applyConsent,
  assertConsentKind,
  assertConsentSource,
  assertConsentText,
  ConsentFlags,
  ConsentSource,
  normalizeConsentVersion,
} from '../domain/consent';
import { ConsentRepository, ConsentTextRecord, ConsentTextRepository } from '../infrastructure/consent.repository';
import { CustomerRepository } from '../infrastructure/customer.repository';
import { ConsentKind } from '../public';
import { CustomerAdminView, toAdminView } from './customer-views';

export interface RecordConsentInput {
  customerId: string;
  kind: ConsentKind;
  granted: boolean;
  textVersion: string;
  source: ConsentSource;
  ip?: string | null;
  /** Сотрудник, внёсший согласие (источник admin/phone). */
  recordedBy?: string | null;
}

function normalizeIp(ip: string | null | undefined): string | null {
  const value = (ip ?? '').trim();
  return value ? value.slice(0, 64) : null;
}

function flagsOf(c: ConsentFlags): ConsentFlags {
  return {
    personalDataConsent: c.personalDataConsent,
    personalDataConsentVersion: c.personalDataConsentVersion,
    personalDataConsentAt: c.personalDataConsentAt,
    marketingConsent: c.marketingConsent,
    marketingConsentVersion: c.marketingConsentVersion,
    marketingConsentAt: c.marketingConsentAt,
  };
}

/**
 * Согласие или отзыв согласия гостя: новая запись в истории (дата, версия текста, источник, IP)
 * и текущие флаги в карточке. Версия текста должна быть опубликована — иначе нельзя доказать,
 * с каким текстом согласился гость.
 */
@Injectable()
export class RecordConsent {
  constructor(
    private readonly customers: CustomerRepository,
    private readonly consents: ConsentRepository,
    private readonly texts: ConsentTextRepository,
    private readonly database: Database,
    private readonly clock: Clock,
  ) {}

  async execute(input: RecordConsentInput): Promise<ConsentFlags> {
    const kind = assertConsentKind(input.kind);
    const source = assertConsentSource(input.source);
    const version = normalizeConsentVersion(input.textVersion);
    if (typeof input.granted !== 'boolean') throw new ValidationError('consent.granted_required', 'granted must be boolean');
    return this.database.transaction(async () => {
      const customer = await this.customers.findByIdForUpdate(input.customerId);
      if (!customer) throw new NotFoundError('customer', input.customerId);
      if (customer.anonymizedAt) throw new ConflictError('customer.anonymized', 'Customer is anonymized');
      const now = this.clock.now();
      const text = await this.texts.find(kind, version);
      if (!text || text.publishedAt.getTime() > now.getTime()) {
        throw new ValidationError('consent.unknown_version', 'Consent text version is not published', { kind, version });
      }
      await this.consents.insert({
        id: newId(),
        customerId: customer.id,
        kind,
        granted: input.granted,
        textVersion: version,
        source,
        ip: normalizeIp(input.ip),
        recordedBy: input.recordedBy ?? null,
        recordedAt: now,
      });
      const flags = applyConsent(flagsOf(customer), { kind, granted: input.granted, version, at: now });
      await this.customers.updateConsentFlags(customer.id, flags);
      return flags;
    });
  }
}

/**
 * Согласие/отзыв, полученные сотрудником (по телефону или лично), — из админки.
 * Версия текста по умолчанию — действующая. Пишется журнал действий.
 */
@Injectable()
export class RecordStaffConsent {
  constructor(
    private readonly recordConsent: RecordConsent,
    private readonly customers: CustomerRepository,
    private readonly texts: ConsentTextRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(
    actor: Actor,
    customerId: string,
    input: { kind: ConsentKind; granted: boolean; textVersion?: string | null; source: 'admin' | 'phone' },
  ): Promise<CustomerAdminView> {
    actor.assertCanSomewhere(Permission.CustomersManage);
    const kind = assertConsentKind(input.kind);
    if (input.source !== 'admin' && input.source !== 'phone') {
      throw new ValidationError('consent.source_invalid', 'Staff consent source must be admin or phone');
    }
    return this.database.transaction(async () => {
      const before = await this.customers.findById(customerId);
      if (!before) throw new NotFoundError('customer', customerId);
      let version = input.textVersion ?? null;
      if (!version) {
        const current = await this.texts.current(kind, this.clock.now());
        if (!current) throw new NotFoundError('consent_text', kind);
        version = current.version;
      }
      const flags = await this.recordConsent.execute({
        customerId,
        kind,
        granted: input.granted,
        textVersion: version,
        source: input.source,
        recordedBy: actor.userId,
      });
      await this.audit.record({
        action: 'customer.consent_recorded',
        entityType: 'customer',
        entityId: customerId,
        before: flagsOf(before),
        after: flags,
        meta: { kind, granted: input.granted, textVersion: version, source: input.source },
      });
      return toAdminView((await this.customers.findById(customerId))!);
    });
  }
}

/**
 * Публикация новой версии текста согласия (право customers.manage). Опубликованная версия
 * не меняется — для правки публикуется следующая. Действует последняя опубликованная.
 */
@Injectable()
export class PublishConsentText {
  constructor(
    private readonly texts: ConsentTextRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, input: { kind: ConsentKind; version: string; text: Translatable }): Promise<ConsentTextRecord> {
    actor.assertCanSomewhere(Permission.CustomersManage);
    const kind = assertConsentKind(input.kind);
    const version = normalizeConsentVersion(input.version);
    const text = assertConsentText(input.text);
    return this.database.transaction(async () => {
      await this.database.advisoryLock('customers.consent_text', kind);
      if (await this.texts.find(kind, version)) {
        throw new ConflictError('consent_text.version_exists', 'This consent text version already exists', { kind, version });
      }
      const record: ConsentTextRecord = { id: newId(), kind, version, text, publishedAt: this.clock.now(), publishedBy: actor.userId };
      await this.texts.insert(record);
      await this.audit.record({
        action: 'consent_text.published',
        entityType: 'consent_text',
        entityId: record.id,
        after: { kind, version, text },
      });
      return record;
    });
  }
}
