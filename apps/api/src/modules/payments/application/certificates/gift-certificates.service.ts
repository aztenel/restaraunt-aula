import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../../../shared/infrastructure/context/request-context';
import { Clock } from '../../../../shared/kernel/clock';
import { Permission } from '../../../../shared/kernel/permissions';
import { Notifier } from '../../../notifications/public';
import { shouldAlertGlobal, windowStart } from '../../domain/brute-force';
import { CERTIFICATE_CHECK_POLICY } from '../../domain/brute-force';
import { CertificateCheckRepository } from '../../infrastructure/certificate-check.repository';
import { CertificateBalanceView, GiftCertificates } from '../../public';
import { toBalanceView } from './certificate-views';
import { FindCertificateByCode } from './find-certificate-by-code.action';

/**
 * Реализация контракта GiftCertificates: проверка кода (витрина, админка, точка, оформление заказа).
 * Защита от подбора: ограничение частоты на HTTP-уровне + учёт неудач по IP в самом сервисе.
 * Отдаёт только маскированное представление.
 */
@Injectable()
export class GiftCertificatesService extends GiftCertificates {
  constructor(private readonly find: FindCertificateByCode) {
    super();
  }

  async check(code: string): Promise<CertificateBalanceView> {
    const record = await this.find.execute(code);
    return toBalanceView(record, RequestContext.locale());
  }
}

/**
 * Периодическая проверка глобального счётчика неудачных проверок: подбор с множества IP не упирается
 * в лимит одного IP — при всплеске оповещаем персонал (раз в час). Заодно чистим старый журнал неудач.
 */
@Injectable()
export class MonitorCertificateChecks {
  constructor(
    private readonly checks: CertificateCheckRepository,
    private readonly notifier: Notifier,
    private readonly clock: Clock,
  ) {}

  async execute(): Promise<{ failures: number; alerted: boolean }> {
    const now = this.clock.now();
    const { failures, ips } = await this.checks.countSince(windowStart(now));
    let alerted = false;
    if (shouldAlertGlobal(failures)) {
      const hour = now.toISOString().slice(0, 13);
      await this.notifier.notifyStaff({
        audience: { branchId: null, permission: Permission.CertificatesManage },
        template: 'staff.system_alert',
        params: {
          title: 'Подозрение на подбор кодов сертификатов',
          details: `За последний час ${failures} неудачных проверок кодов с ${ips} IP-адресов. Порог — ${CERTIFICATE_CHECK_POLICY.globalAlertThreshold}.`,
        },
        dedupeKey: `certificates:bruteforce:${hour}`,
      });
      alerted = true;
    }
    await this.checks.cleanup(new Date(now.getTime() - CERTIFICATE_CHECK_POLICY.retentionMs));
    return { failures, alerted };
  }
}
