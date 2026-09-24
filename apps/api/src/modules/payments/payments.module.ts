import { Global, Module, OnModuleInit } from '@nestjs/common';
import { IntegrationCatalog } from '../../shared/infrastructure/settings/integration-catalog';
import {
  BlockCertificate,
  ExpireCertificates,
  ExtendCertificate,
  GetCertificatePdfLink,
  RedeemCertificate,
  ResendCertificate,
  UnblockCertificate,
} from './application/certificates/certificate-admin.actions';
import { CreditCertificate, DebitCertificate } from './application/certificates/certificate-ledger.actions';
import { BlockCertificatesOfRefundedOrder, MarkCertificateOrderPaymentFailed } from './application/certificates/certificate-order.actions';
import { CreateCertificateProduct, DeleteCertificateProduct, UpdateCertificateProduct } from './application/certificates/certificate-product.actions';
import { CertificateQueries } from './application/certificates/certificate.queries';
import { DeliverCertificate } from './application/certificates/deliver-certificate.action';
import { ExportCertificateReport } from './application/certificates/export-certificate-report';
import { CertificateCodeHasher, FindCertificateByCode } from './application/certificates/find-certificate-by-code.action';
import { GiftCertificatesService, MonitorCertificateChecks } from './application/certificates/gift-certificates.service';
import { IssueCertificatesForOrder } from './application/certificates/issue-certificates.action';
import { IssueCorporateCertificates, PurchaseCertificate } from './application/certificates/purchase-certificate.action';
import { CreatePayment } from './application/create-payment.action';
import { PAYMENT_GATEWAYS, PaymentGatewayRegistry } from './application/payment-gateway.registry';
import { PaymentLinks } from './application/payment-links';
import { CheckPaymentStatus, InitiatePayment, SchedulePaymentChecks } from './application/payment-provider.actions';
import { ApplyGatewayStatus, CancelPayment, FailPayment, MarkCollected } from './application/payment-status.actions';
import { PaymentQueries } from './application/payment.queries';
import { PaymentsFacade } from './application/payments.facade';
import { ReceivePaymentWebhook } from './application/receive-webhook.action';
import { CompleteRefund, ConfirmManualRefund, FailRefund, ProcessRefund, RejectManualRefund, RequestRefund } from './application/refund.actions';
import { RegisterBankTransfer } from './application/register-bank-transfer.action';
import { RenderCheckoutPage } from './application/render-checkout-page.action';
import { PaymentGateway } from './domain/payment-gateway';
import { CertificatePaymentHandlers } from './handlers/certificate.handlers';
import { PaymentJobHandlers, PaymentSchedules } from './handlers/payment.handlers';
import { AdminCertificatesController } from './http/admin/certificates.controller';
import { AdminPaymentsController } from './http/admin/payments.controller';
import { PublicCertificatesController } from './http/public/certificates.controller';
import { PaymentPagesController } from './http/public/payment-pages.controller';
import { PaymentsWebhookController } from './http/webhooks/payments-webhook.controller';
import { HalykGateway } from './infrastructure/adapters/halyk/halyk.gateway';
import { KaspiGateway } from './infrastructure/adapters/kaspi/kaspi.gateway';
import { PAYMENT_DESCRIPTORS, PAYMENT_GATEWAY_CLASSES } from './infrastructure/adapters/payment-adapters';
import { SandboxCheckoutPage, SimulateSandboxPayment } from './infrastructure/adapters/sandbox/sandbox-simulator';
import { SandboxGateway } from './infrastructure/adapters/sandbox/sandbox.gateway';
import { SandboxStore } from './infrastructure/adapters/sandbox/sandbox.store';
import { CertificateCheckRepository } from './infrastructure/certificate-check.repository';
import { CertificateOrderRepository } from './infrastructure/certificate-order.repository';
import { CertificateProductRepository } from './infrastructure/certificate-product.repository';
import { CertificateRepository } from './infrastructure/certificate.repository';
import { PaymentRepository } from './infrastructure/payment.repository';
import { RefundRepository } from './infrastructure/refund.repository';
import { WebhookEventRepository } from './infrastructure/webhook-event.repository';
import { GiftCertificates, PaymentsService } from './public';

/**
 * Payments: платежи (онлайн через провайдера, при получении, сертификатом, банковским переводом),
 * возвраты, входящие вебхуки провайдеров и подарочные сертификаты.
 * Провайдеры (sandbox, Halyk ePay, Kaspi Pay) — адаптеры за интерфейсом PaymentGateway;
 * выбор провайдера — настройка payments.routing (по умолчанию и по филиалам).
 */
@Global()
@Module({
  controllers: [
    AdminPaymentsController,
    AdminCertificatesController,
    PublicCertificatesController,
    PaymentPagesController,
    PaymentsWebhookController,
  ],
  providers: [
    // Хранилище
    PaymentRepository,
    RefundRepository,
    WebhookEventRepository,
    CertificateProductRepository,
    CertificateOrderRepository,
    CertificateRepository,
    CertificateCheckRepository,
    // Провайдеры (адаптеры)
    SandboxStore,
    SandboxGateway,
    HalykGateway,
    KaspiGateway,
    SandboxCheckoutPage,
    SimulateSandboxPayment,
    {
      provide: PAYMENT_GATEWAYS,
      useFactory: (...gateways: PaymentGateway[]) => gateways,
      inject: [...PAYMENT_GATEWAY_CLASSES],
    },
    PaymentGatewayRegistry,
    PaymentLinks,
    // Платежи
    CreatePayment,
    CancelPayment,
    FailPayment,
    MarkCollected,
    ApplyGatewayStatus,
    RegisterBankTransfer,
    InitiatePayment,
    CheckPaymentStatus,
    SchedulePaymentChecks,
    ReceivePaymentWebhook,
    RenderCheckoutPage,
    PaymentQueries,
    // Возвраты
    CompleteRefund,
    FailRefund,
    RequestRefund,
    ProcessRefund,
    ConfirmManualRefund,
    RejectManualRefund,
    // Сертификаты
    CertificateCodeHasher,
    FindCertificateByCode,
    DebitCertificate,
    CreditCertificate,
    DeliverCertificate,
    IssueCertificatesForOrder,
    MarkCertificateOrderPaymentFailed,
    BlockCertificatesOfRefundedOrder,
    CreateCertificateProduct,
    UpdateCertificateProduct,
    DeleteCertificateProduct,
    PurchaseCertificate,
    IssueCorporateCertificates,
    RedeemCertificate,
    BlockCertificate,
    UnblockCertificate,
    ExtendCertificate,
    ResendCertificate,
    GetCertificatePdfLink,
    ExpireCertificates,
    MonitorCertificateChecks,
    CertificateQueries,
    ExportCertificateReport,
    // Обработчики событий, задачи, расписания
    PaymentJobHandlers,
    PaymentSchedules,
    CertificatePaymentHandlers,
    // Публичный контракт
    PaymentsFacade,
    GiftCertificatesService,
    { provide: PaymentsService, useExisting: PaymentsFacade },
    { provide: GiftCertificates, useExisting: GiftCertificatesService },
  ],
  exports: [PaymentsService, GiftCertificates],
})
export class PaymentsModule implements OnModuleInit {
  constructor(private readonly catalog: IntegrationCatalog) {}

  onModuleInit(): void {
    for (const descriptor of PAYMENT_DESCRIPTORS) this.catalog.register(descriptor);
  }
}
