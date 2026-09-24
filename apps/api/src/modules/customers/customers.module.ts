import { Global, Module } from '@nestjs/common';
import { PublishConsentText, RecordConsent, RecordStaffConsent } from './application/consent.actions';
import { CustomerDirectoryService, PhoneVerificationService } from './application/contract-services';
import { AddCustomerTag, AnonymizeCustomer, UpdateCustomerProfile } from './application/customer-profile.actions';
import { ConsentTextQueries, CustomerQueries, SegmentQueries } from './application/customers.queries';
import { ExportCustomers } from './application/export-customers.action';
import { IdentifyCustomer } from './application/identify-customer.action';
import {
  PhoneVerificationCrypto,
  PurgePhoneVerifications,
  StartPhoneVerification,
  VerifyPhoneCode,
} from './application/phone-verification.actions';
import { RecordCustomerActivity } from './application/record-activity.action';
import { CreateCustomerSegment, DeleteCustomerSegment, UpdateCustomerSegment } from './application/segment.actions';
import { CustomersHistoryProjection } from './handlers/customer-history.handlers';
import { CustomersMaintenanceSchedules } from './handlers/customers-maintenance.schedules';
import { AdminConsentTextsController } from './http/admin/consent-texts.controller';
import { AdminCustomersController } from './http/admin/customers.controller';
import { AdminCustomerSegmentsController } from './http/admin/segments.controller';
import { PublicConsentsController } from './http/public/consents.controller';
import { PublicPhoneVerificationsController } from './http/public/phone-verifications.controller';
import { ActivityRepository } from './infrastructure/activity.repository';
import { BanquetLinkRepository } from './infrastructure/banquet-link.repository';
import { ConsentRepository, ConsentTextRepository } from './infrastructure/consent.repository';
import { CustomerRepository } from './infrastructure/customer.repository';
import { PhoneVerificationRepository } from './infrastructure/phone-verification.repository';
import { SegmentRepository } from './infrastructure/segment.repository';
import { CustomerDirectory, PhoneVerification } from './public';

/**
 * Customers: база гостей. Гость — по нормализованному телефону; согласия на обработку ПД и рассылки
 * с датой, версией текста, источником и IP; подтверждение телефона SMS-кодом; история гостя из событий
 * заказов, броней, банкетов и сертификатов; автотеги; сегменты и выгрузки (с журналом); обезличивание.
 * Внешних интеграций нет: SMS с кодом отправляет модуль Notifications (контракт Notifier).
 */
@Global()
@Module({
  controllers: [
    AdminCustomersController,
    AdminCustomerSegmentsController,
    AdminConsentTextsController,
    PublicConsentsController,
    PublicPhoneVerificationsController,
  ],
  providers: [
    CustomerRepository,
    ConsentRepository,
    ConsentTextRepository,
    ActivityRepository,
    BanquetLinkRepository,
    SegmentRepository,
    PhoneVerificationRepository,
    IdentifyCustomer,
    RecordConsent,
    RecordStaffConsent,
    PublishConsentText,
    UpdateCustomerProfile,
    AddCustomerTag,
    AnonymizeCustomer,
    CreateCustomerSegment,
    UpdateCustomerSegment,
    DeleteCustomerSegment,
    ExportCustomers,
    PhoneVerificationCrypto,
    StartPhoneVerification,
    VerifyPhoneCode,
    PurgePhoneVerifications,
    RecordCustomerActivity,
    CustomerQueries,
    SegmentQueries,
    ConsentTextQueries,
    CustomersHistoryProjection,
    CustomersMaintenanceSchedules,
    { provide: CustomerDirectory, useClass: CustomerDirectoryService },
    { provide: PhoneVerification, useClass: PhoneVerificationService },
  ],
  exports: [CustomerDirectory, PhoneVerification],
})
export class CustomersModule {}
