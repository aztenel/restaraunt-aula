import { Injectable } from '@nestjs/common';
import { JobHandler, Scheduled } from '../../../shared/infrastructure/events/decorators';
import { JobEnvelope } from '../../../shared/infrastructure/events/types';
import { ExpireCertificates } from '../application/certificates/certificate-admin.actions';
import { MonitorCertificateChecks } from '../application/certificates/gift-certificates.service';
import { InitiateJobPayload, PaymentJobs } from '../application/create-payment.action';
import {
  CheckPaymentStatus,
  CheckStatusJobPayload,
  INITIATE_MAX_ATTEMPTS,
  InitiatePayment,
  SchedulePaymentChecks,
} from '../application/payment-provider.actions';
import { ProcessRefund, REFUND_MAX_ATTEMPTS, RefundJobPayload } from '../application/refund.actions';

/**
 * Фоновые задачи платежей: все обращения к провайдерам — только здесь, с повторами
 * и экспоненциальной задержкой (после исчерпания — очередь неудач платформы).
 */
@Injectable()
export class PaymentJobHandlers {
  constructor(
    private readonly initiatePayment: InitiatePayment,
    private readonly processRefund: ProcessRefund,
    private readonly checkStatus: CheckPaymentStatus,
  ) {}

  @JobHandler(PaymentJobs.Initiate, { attempts: INITIATE_MAX_ATTEMPTS, backoffMs: 5_000, maxBackoffMs: 5 * 60_000 })
  async initiate(job: JobEnvelope<InitiateJobPayload>): Promise<void> {
    await this.initiatePayment.execute(job.payload);
  }

  @JobHandler(PaymentJobs.Refund, { attempts: REFUND_MAX_ATTEMPTS, backoffMs: 30_000, maxBackoffMs: 30 * 60_000 })
  async refund(job: JobEnvelope<RefundJobPayload>): Promise<void> {
    await this.processRefund.execute(job.payload);
  }

  @JobHandler(PaymentJobs.CheckStatus, { attempts: 3, backoffMs: 10_000, maxBackoffMs: 60_000 })
  async check(job: JobEnvelope<CheckStatusJobPayload>): Promise<void> {
    await this.checkStatus.execute(job.payload);
  }
}

/** Периодические задачи модуля (часовой пояс Asia/Almaty). */
@Injectable()
export class PaymentSchedules {
  constructor(
    private readonly paymentChecks: SchedulePaymentChecks,
    private readonly expireCertificates: ExpireCertificates,
    private readonly monitorChecks: MonitorCertificateChecks,
  ) {}

  /** Опрос ожидающих онлайн-платежей — на случай пропущенного вебхука. */
  @Scheduled('payments.poll_pending', { everyMs: 5 * 60_000 })
  async pollPending(): Promise<void> {
    await this.paymentChecks.execute('poll');
  }

  /** Истёкшие неоплаченные платежи: финальная проверка у провайдера и отмена (PaymentCancelled). */
  @Scheduled('payments.expire_pending', { everyMs: 60_000 })
  async expirePending(): Promise<void> {
    await this.paymentChecks.execute('expire');
  }

  /** Ежедневно: сертификаты с истёкшим сроком -> expired (CertificateExpired). */
  @Scheduled('payments.certificates_expire', { cron: '5 0 * * *' })
  async certificatesExpire(): Promise<void> {
    await this.expireCertificates.execute();
  }

  /** Глобальный счётчик неудачных проверок кодов: оповещение о подборе + очистка журнала. */
  @Scheduled('payments.certificate_checks_monitor', { everyMs: 5 * 60_000 })
  async certificateChecksMonitor(): Promise<void> {
    await this.monitorChecks.execute();
  }
}
