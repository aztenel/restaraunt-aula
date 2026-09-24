import { Injectable } from '@nestjs/common';
import { Clock } from '../../../shared/kernel/clock';
import { NotFoundError } from '../../../shared/kernel/errors';
import { normalizePhone, tryNormalizePhone } from '../../../shared/kernel/phone';
import { Locale } from '../../../shared/kernel/translatable';
import { assertConsentKind } from '../domain/consent';
import { assertTokenForPhone } from '../domain/otp';
import { ConsentTextRepository } from '../infrastructure/consent.repository';
import { CustomerRepository } from '../infrastructure/customer.repository';
import { ConsentKind, CustomerDirectory, CustomerProfile, CustomerTag, PhoneVerification } from '../public';
import { RecordConsent } from './consent.actions';
import { AddCustomerTag } from './customer-profile.actions';
import { toProfile } from './customer-views';
import { IdentifyCustomer } from './identify-customer.action';
import { PhoneVerificationCrypto, StartPhoneVerification, VerifyPhoneCode } from './phone-verification.actions';

/**
 * Реализация публичного контракта CustomerDirectory: тонкий фасад над действиями модуля.
 * Обезличенный гость для других модулей не существует (NotFoundError) — его ПД стёрты.
 */
@Injectable()
export class CustomerDirectoryService extends CustomerDirectory {
  constructor(
    private readonly customers: CustomerRepository,
    private readonly texts: ConsentTextRepository,
    private readonly identifyCustomer: IdentifyCustomer,
    private readonly recordConsentAction: RecordConsent,
    private readonly addTagAction: AddCustomerTag,
    private readonly clock: Clock,
  ) {
    super();
  }

  identify(input: { phone: string; name?: string | null; email?: string | null; locale?: Locale }) {
    return this.identifyCustomer.execute(input);
  }

  async get(customerId: string): Promise<CustomerProfile> {
    const customer = await this.customers.findById(customerId);
    if (!customer || customer.anonymizedAt) throw new NotFoundError('customer', customerId);
    return toProfile(customer);
  }

  async findByPhone(phone: string): Promise<CustomerProfile | null> {
    const normalized = tryNormalizePhone(phone);
    if (!normalized) return null;
    const customer = await this.customers.findByPhone(normalized);
    return customer && !customer.anonymizedAt ? toProfile(customer) : null;
  }

  async recordConsent(input: {
    customerId: string;
    kind: ConsentKind;
    granted: boolean;
    textVersion: string;
    source: 'web' | 'admin' | 'phone';
    ip?: string | null;
  }): Promise<void> {
    await this.recordConsentAction.execute(input);
  }

  async currentConsentVersion(kind: ConsentKind): Promise<string> {
    const k = assertConsentKind(kind);
    const text = await this.texts.current(k, this.clock.now());
    if (!text) throw new NotFoundError('consent_text', k);
    return text.version;
  }

  addTag(customerId: string, tag: CustomerTag): Promise<void> {
    return this.addTagAction.execute(customerId, tag);
  }
}

/** Реализация публичного контракта PhoneVerification. */
@Injectable()
export class PhoneVerificationService extends PhoneVerification {
  constructor(
    private readonly startAction: StartPhoneVerification,
    private readonly verifyAction: VerifyPhoneCode,
    private readonly crypto: PhoneVerificationCrypto,
    private readonly clock: Clock,
  ) {
    super();
  }

  start(phone: string, locale: Locale) {
    return this.startAction.execute(phone, locale);
  }

  async verify(verificationId: string, code: string): Promise<{ token: string; phone: string }> {
    const { token, phone } = await this.verifyAction.execute(verificationId, code);
    return { token, phone };
  }

  async assertVerified(phone: string, token: string | null | undefined): Promise<void> {
    assertTokenForPhone(token, normalizePhone(phone), this.crypto.sign, this.clock.now());
  }
}
