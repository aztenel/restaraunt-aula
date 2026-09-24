import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ExternalHttp, ExternalServiceError } from '../../../../../shared/infrastructure/integrations/external-http';
import { IntegrationDescriptor } from '../../../../../shared/infrastructure/settings/integration-catalog';
import { IntegrationSettings } from '../../../../../shared/infrastructure/settings/integration-settings';
import { AccountingPushGateway, PushFile } from '../../../application/accounting/accounting-exporter';

/** Отправка выгрузки в HTTP-сервис 1С (публикация HTTP-сервиса базы 1С, basic auth). */
export const ONEC_HTTP_KEY = 'reporting.onec_http';

export const OnecHttpSettings = z.object({
  url: z.string().url(),
  username: z.string().min(1),
  password: z.string().min(1),
  timeoutMs: z.coerce.number().int().min(1_000).max(300_000).optional(),
});
export type OnecHttpSettings = z.infer<typeof OnecHttpSettings>;

export const ONEC_HTTP_DESCRIPTOR: IntegrationDescriptor = {
  key: ONEC_HTTP_KEY,
  title: '1С: HTTP-сервис обмена',
  category: 'accounting',
  stage: 3,
  description:
    'Отправка выгрузок продаж и документов (XML, близкий к EnterpriseData) в HTTP-сервис базы 1С. ' +
    'Без настройки выгрузка доступна файлом для загрузки бухгалтером.',
  fields: [
    { name: 'url', label: 'URL HTTP-сервиса 1С', type: 'url', required: true, help: 'https://1c.example.kz/base/hs/aula/exchange' },
    { name: 'username', label: 'Пользователь 1С', type: 'string', required: true },
    { name: 'password', label: 'Пароль', type: 'string', secret: true, required: true },
    { name: 'timeoutMs', label: 'Таймаут, мс', type: 'number', help: 'По умолчанию 60000' },
  ],
};

@Injectable()
export class OnecHttpPushGateway extends AccountingPushGateway {
  constructor(
    private readonly settings: IntegrationSettings,
    private readonly http: ExternalHttp,
  ) {
    super();
  }

  async isEnabled(): Promise<boolean> {
    return this.settings.isEnabled(ONEC_HTTP_KEY);
  }

  async push(file: PushFile, meta: { exportId: string; periodFrom: string; periodTo: string }): Promise<void> {
    const config = await this.settings.get(ONEC_HTTP_KEY, OnecHttpSettings);
    if (!config) throw new ExternalServiceError(ONEC_HTTP_KEY, 'integration is disabled', false);
    const credentials = Buffer.from(`${config.username}:${config.password}`, 'utf8').toString('base64');
    await this.http.request({
      integration: ONEC_HTTP_KEY,
      operation: 'push_export',
      method: 'POST',
      url: config.url,
      headers: {
        authorization: `Basic ${credentials}`,
        'content-type': file.contentType,
        'x-aula-export-id': meta.exportId,
        'x-aula-period': `${meta.periodFrom}/${meta.periodTo}`,
        'x-aula-filename': encodeURIComponent(file.name),
      },
      body: file.body.toString('utf8'),
      timeoutMs: config.timeoutMs ?? 60_000,
      correlationId: meta.exportId,
    });
  }
}
