import { Injectable } from '@nestjs/common';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { Database } from '../../../shared/infrastructure/database/database';
import { EventBus } from '../../../shared/infrastructure/events/event-bus';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { ValidationError } from '../../../shared/kernel/errors';
import { newId } from '../../../shared/kernel/ids';
import { Money } from '../../../shared/kernel/money';
import { Permission } from '../../../shared/kernel/permissions';
import { normalizePhone } from '../../../shared/kernel/phone';
import { randomToken } from '../../../shared/kernel/random';
import { Locale } from '../../../shared/kernel/translatable';
import { CustomerDirectory, CustomerTag } from '../../customers/public';
import { BranchDirectory, StaffMember } from '../../identity/public';
import { AdminFeed, Notifier } from '../../notifications/public';
import { BanquetRequest, BanquetSource, validateDetails } from '../domain/banquet-request';
import { formatDateRu } from '../domain/dates';
import { formatTenge } from '../domain/money-format';
import { eventTypeLabel } from '../domain/texts';
import { ActivityRepository } from '../infrastructure/activity.repository';
import { CompanyRepository } from '../infrastructure/company.repository';
import { RequestRepository } from '../infrastructure/request.repository';
import { BanquetEvents } from '../public';
import { guestActor } from './access';
import { requestCreatedPayload } from './banquet-events';
import { BanquetLinks } from './banquet-links';
import { BanquetSupport } from './banquet-support';
import { ManagerAssigner } from './manager-assigner';

export interface BanquetContactInput {
  name: string;
  phone: string;
  email?: string | null;
}

export interface CreateBanquetRequestInput {
  eventDate: string;
  eventTime?: string | null;
  eventType: string;
  guests: number;
  branchId?: string | null;
  isOffsite?: boolean;
  offsiteAddress?: string | null;
  budget?: Money | null;
  contact: BanquetContactInput;
  wishes?: string | null;
  locale: Locale;
  /** Витрина: согласие на обработку ПД обязательно; админка: отметка, что согласие получено устно. */
  consent?: { personalData: boolean; marketing?: boolean } | null;
  /** Только админка: ответственный вручную (иначе автоназначение). */
  managerId?: string | null;
  /** Только админка: компания-заказчик. */
  companyId?: string | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeContact(input: BanquetContactInput): { name: string; phone: string; email: string | null } {
  const name = input.name?.trim() ?? '';
  if (name.length < 1 || name.length > 120) throw new ValidationError('banquet.contact_name_invalid', 'Contact name is required (up to 120 chars)');
  const email = input.email?.trim().toLowerCase() || null;
  if (email && !EMAIL_RE.test(email)) throw new ValidationError('banquet.contact_email_invalid', 'Invalid email');
  return { name, phone: normalizePhone(input.phone), email };
}

/**
 * Заявка на банкет с витрины (source=web) или из админки (source=admin): гость в базе гостей
 * (согласие, тег banquet), автоназначение менеджеру, номер заявки, событие RequestCreated,
 * уведомления гостю («заявка принята, ваш менеджер …»), менеджеру и в ленту админки со звуком.
 */
@Injectable()
export class CreateBanquetRequest {
  constructor(
    private readonly requests: RequestRepository,
    private readonly activities: ActivityRepository,
    private readonly companies: CompanyRepository,
    private readonly support: BanquetSupport,
    private readonly assigner: ManagerAssigner,
    private readonly branches: BranchDirectory,
    private readonly customers: CustomerDirectory,
    private readonly notifier: Notifier,
    private readonly feed: AdminFeed,
    private readonly links: BanquetLinks,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly events: EventBus,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, input: CreateBanquetRequestInput, context: { source: BanquetSource; ip: string | null }): Promise<BanquetRequest> {
    const web = context.source === 'web';
    if (web && input.consent?.personalData !== true) {
      throw new ValidationError('consent.required', 'Consent to personal data processing is required');
    }
    if (!web) actor.assertCan(Permission.BanquetsManage, input.branchId ?? null);
    const contact = normalizeContact(input.contact);
    if (input.branchId) {
      const branch = await this.branches.find(input.branchId);
      if (!branch || (web && !branch.isActive)) throw new ValidationError('banquet.unknown_branch', 'Branch not found', { branchId: input.branchId });
    }
    const today = await this.support.today(input.branchId ?? null);
    const details = validateDetails(
      {
        eventDate: input.eventDate,
        eventTime: input.eventTime,
        eventType: input.eventType,
        guests: input.guests,
        budget: input.budget ?? null,
        branchId: input.branchId ?? null,
        isOffsite: input.isOffsite ?? false,
        offsiteAddress: input.offsiteAddress,
        wishes: input.wishes,
      },
      today,
      { checkDate: true },
    );
    if (!web && input.companyId && !(await this.companies.findById(input.companyId))) {
      throw new ValidationError('banquet_company.not_found', 'Company not found', { companyId: input.companyId });
    }
    const author = web ? guestActor(contact.name) : actor;

    return this.database.transaction(async () => {
      const now = this.clock.now();
      // Автоназначения сериализуются: две одновременные заявки не достанутся одному менеджеру «вслепую».
      await this.database.advisoryLock('banquet.assign', 'requests');
      const manager: StaffMember =
        !web && input.managerId ? await this.assigner.validate(input.managerId) : await this.assigner.pick();

      const { customerId } = await this.customers.identify({ phone: contact.phone, name: contact.name, email: contact.email, locale: input.locale });
      if (input.consent?.personalData) {
        await this.customers.recordConsent({
          customerId,
          kind: 'personal_data',
          granted: true,
          textVersion: await this.customers.currentConsentVersion('personal_data'),
          source: web ? 'web' : 'admin',
          ip: context.ip,
        });
      }
      if (input.consent?.marketing) {
        await this.customers.recordConsent({
          customerId,
          kind: 'marketing',
          granted: true,
          textVersion: await this.customers.currentConsentVersion('marketing'),
          source: web ? 'web' : 'admin',
          ip: context.ip,
        });
      }
      await this.customers.addTag(customerId, CustomerTag.Banquet);

      const { number } = await this.support.nextNumber('request', details.branchId);
      const request = BanquetRequest.create({
        id: newId(),
        number,
        source: context.source,
        ...details,
        contact: { customerId, ...contact },
        locale: input.locale,
        managerId: manager.id,
        assignedAt: now,
        companyId: web ? null : (input.companyId ?? null),
        publicToken: randomToken(24),
        createdAt: now,
      });
      await this.requests.insert(request);
      await this.activities.add({
        requestId: request.id,
        kind: 'created',
        text: details.wishes,
        data: { source: context.source, managerId: manager.id, managerName: manager.name },
        actor: author,
        at: now,
      });
      await this.audit.record({
        action: 'banquet.request_created',
        entityType: 'banquet_request',
        entityId: request.id,
        branchId: request.branchId,
        after: request.auditView(),
        meta: { source: context.source },
        actor: author,
      });
      await this.events.publish(BanquetEvents.RequestCreated, requestCreatedPayload(request, now), {
        aggregateId: request.id,
        branchId: request.branchId,
      });

      const s = request.snapshot();
      await this.notifier.notifyGuest({
        recipient: { phone: contact.phone, email: contact.email, name: contact.name },
        template: 'banquet.request_received',
        params: { number, managerName: manager.name, managerPhone: manager.phone ?? '' },
        locale: input.locale,
        dedupeKey: `banquet:${request.id}:received`,
        related: { type: 'banquet_request', id: request.id },
      });
      await this.notifier.notifyStaff({
        audience: { branchId: request.branchId, userIds: [manager.id] },
        template: 'staff.banquet_new',
        params: {
          number,
          eventDate: `${formatDateRu(s.eventDate)}${s.eventTime ? ` ${s.eventTime}` : ''} (${eventTypeLabel(s.eventType, 'ru')})`,
          guests: String(s.guests),
          budget: s.budget ? formatTenge(s.budget) : '—',
          managerName: manager.name,
          adminUrl: this.links.admin(request.id),
        },
        dedupeKey: `banquet:${request.id}:new`,
        related: { type: 'banquet_request', id: request.id },
      });
      await this.feed.push({
        branchId: request.branchId,
        stream: 'banquets',
        kind: 'created',
        entityId: request.id,
        title: `Новая банкетная заявка ${number}: ${formatDateRu(s.eventDate)}, ${s.guests} гост.`,
        sound: true,
      });
      return request;
    });
  }
}
