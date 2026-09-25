import { Injectable } from '@nestjs/common';
import { JobHandler, Scheduled } from '../../../shared/infrastructure/events/decorators';
import { JobEnvelope } from '../../../shared/infrastructure/events/types';
import { BanquetJobs, EsfJobPayload } from '../application/document.actions';
import { CheckEsfStatus, SubmitEsf } from '../application/esf.actions';
import { CheckSlaBreaches } from '../application/sla.actions';

/**
 * Фоновые задачи Banquet: внешние вызовы (ИС ЭСФ, NCANode) — только здесь, с повторами
 * и экспоненциальной задержкой; после исчерпания попыток — очередь неудач платформы и алерт.
 */
@Injectable()
export class BanquetJobHandlers {
  constructor(
    private readonly submitEsf: SubmitEsf,
    private readonly checkEsf: CheckEsfStatus,
  ) {}

  @JobHandler(BanquetJobs.EsfSubmit, { attempts: 8, backoffMs: 30_000, maxBackoffMs: 60 * 60_000 })
  async esfSubmit(job: JobEnvelope<EsfJobPayload>): Promise<void> {
    await this.submitEsf.execute(job.payload);
  }

  /** Регистрационный номер ЭСФ появляется не сразу: проверка с нарастающим интервалом (до ~сутки). */
  @JobHandler(BanquetJobs.EsfCheck, { attempts: 12, backoffMs: 60_000, maxBackoffMs: 6 * 60 * 60_000 })
  async esfCheck(job: JobEnvelope<EsfJobPayload>): Promise<void> {
    await this.checkEsf.execute(job.payload);
  }
}

/** Периодические задачи (часовой пояс Asia/Almaty). */
@Injectable()
export class BanquetSchedules {
  constructor(private readonly sla: CheckSlaBreaches) {}

  /** Раз в минуту: заявки без ответа дольше 30 минут — уведомление менеджеру и собственнику. */
  @Scheduled('banquet.sla_check', { everyMs: 60_000 })
  async slaCheck(): Promise<void> {
    await this.sla.execute();
  }
}
