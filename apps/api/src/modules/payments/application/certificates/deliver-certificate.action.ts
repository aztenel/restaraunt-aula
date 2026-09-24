import { Injectable } from '@nestjs/common';
import { FileStorage } from '../../../../shared/infrastructure/storage/file-storage';
import { Clock } from '../../../../shared/kernel/clock';
import { ValidationError } from '../../../../shared/kernel/errors';
import { tryNormalizePhone } from '../../../../shared/kernel/phone';
import { GuestTemplateParams, NotificationChannel, Notifier } from '../../../notifications/public';
import { maskCertificateCode } from '../../domain/certificate-code';
import { DeliveryChannel, resolveDeliveryTarget } from '../../domain/certificate-order';
import { CertificateRecord, CertificateRepository } from '../../infrastructure/certificate.repository';
import { formatAmount, formatExpiry } from './certificate-views';

/** Ссылка на PDF в WhatsApp действует 30 дней (PDF можно переотправить из админки). */
const PDF_LINK_TTL_SECONDS = 30 * 24 * 3600;

/**
 * Параметры шаблона 'certificate.issued' + ссылка на PDF (для WhatsApp, где вложений нет).
 * Шаблон модуля Notifications может использовать {{pdfUrl}}; лишний параметр не мешает.
 */
type CertificateIssuedParams = GuestTemplateParams['certificate.issued'] & { pdfUrl: string };

export interface DeliverCertificateInput {
  record: CertificateRecord;
  /** Полный код — только при выпуске (показывается один раз). При переотправке — null: код есть в PDF. */
  code: string | null;
  /** Переопределение канала и адреса (переотправка на другой контакт). */
  channel?: Exclude<DeliveryChannel, 'none'>;
  target?: { email?: string | null; phone?: string | null };
  dedupeKey: string;
}

/**
 * Доставка сертификата гостю через Notifier: email — PDF во вложении, WhatsApp — сообщение со ссылкой
 * на PDF (резерв — SMS). Отправка асинхронная (очередь модуля Notifications).
 */
@Injectable()
export class DeliverCertificate {
  constructor(
    private readonly notifier: Notifier,
    private readonly storage: FileStorage,
    private readonly certificates: CertificateRepository,
    private readonly clock: Clock,
  ) {}

  async execute(input: DeliverCertificateInput): Promise<boolean> {
    const { record } = input;
    const channel = input.channel ?? record.deliveryChannel;
    if (channel === 'none') return false;
    if (!record.pdfFileKey) throw new ValidationError('certificate.pdf_missing', 'Certificate PDF is not generated');
    const target = input.target
      ? resolveDeliveryTarget(channel, input.target, {})
      : resolveDeliveryTarget(
          channel,
          { email: record.recipientEmail, phone: record.recipientPhone },
          { email: record.buyerEmail, phone: record.buyerPhone },
        );
    const s = record.certificate.snapshot();
    const filename = `AULA-certificate-${s.last4}.pdf`;
    const params: CertificateIssuedParams = {
      code: input.code ?? maskCertificateCode(s.last4),
      nominal: formatAmount(s.nominal),
      expiresAt: formatExpiry(s.expiresAt),
      recipientName: record.recipientName ?? '',
      message: record.message ?? '',
      pdfUrl: await this.storage.signedUrl(record.pdfFileKey, PDF_LINK_TTL_SECONDS, filename),
    };
    const channels: NotificationChannel[] = channel === 'email' ? ['email'] : ['whatsapp', 'sms'];
    await this.notifier.notifyGuest({
      recipient: { email: target.email, phone: tryNormalizePhone(target.phone), name: record.recipientName },
      template: 'certificate.issued',
      params,
      locale: record.locale,
      channels,
      // Email — PDF во вложении; WhatsApp/SMS — ссылка на PDF (параметр pdfUrl).
      attachments: channel === 'email' ? [{ fileKey: record.pdfFileKey, filename, contentType: 'application/pdf' }] : undefined,
      dedupeKey: input.dedupeKey,
      related: { type: 'gift_certificate', id: s.id },
    });
    await this.certificates.markDelivered(s.id, this.clock.now());
    return true;
  }
}
