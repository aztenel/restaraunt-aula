import { ExternalHttp, HttpTransport } from '../../../shared/infrastructure/integrations/external-http';
import { IntegrationLog, IntegrationLogEntry } from '../../../shared/infrastructure/integrations/integration-log';
import { IntegrationSettings } from '../../../shared/infrastructure/settings/integration-settings';
import { FileStorage } from '../../../shared/infrastructure/storage/file-storage';
import { ValidationError } from '../../../shared/kernel/errors';
import { ChannelSendRequest } from '../application/channel-adapter';

/**
 * Заглушки платформы для unit-тестов адаптеров каналов (без Nest и БД):
 * настройки интеграций из объекта, журнал интеграций в память, файловое хранилище в память.
 */
export function settingsStub(values: Record<string, Record<string, unknown> | null | undefined>): IntegrationSettings {
  return {
    get: async (key: string, schema: { safeParse: (v: unknown) => { success: boolean; data?: unknown } }) => {
      const raw = values[key];
      if (!raw) return null;
      const parsed = schema.safeParse(raw);
      if (!parsed.success) throw new ValidationError('integration.misconfigured', `Integration ${key} is misconfigured`);
      return parsed.data;
    },
  } as unknown as IntegrationSettings;
}

export function externalHttpStub(transport: HttpTransport): { http: ExternalHttp; logs: IntegrationLogEntry[] } {
  const logs: IntegrationLogEntry[] = [];
  const log = { record: async (entry: IntegrationLogEntry) => void logs.push(entry) } as unknown as IntegrationLog;
  return { http: new ExternalHttp(transport, log), logs };
}

export function storageStub(files: Record<string, Buffer> = {}): FileStorage {
  return {
    put: async () => undefined,
    get: async (key: string) => {
      const file = files[key];
      if (!file) throw new Error(`ENOENT ${key}`);
      return file;
    },
    delete: async () => undefined,
    publicUrl: (key: string) => `https://files.test/public/${key}`,
    signedUrl: async (key: string, ttl?: number) => `https://files.test/private/${key}?ttl=${ttl ?? 3600}`,
  } as unknown as FileStorage;
}

export function sendRequest(overrides: Partial<ChannelSendRequest> = {}): ChannelSendRequest {
  return {
    deliveryId: 'd-1',
    channel: 'whatsapp',
    to: '+77011234567',
    locale: 'ru',
    template: 'order.accepted',
    params: { number: 'GL-1', trackingUrl: 'https://aula.kz/t/1', eta: '19:40' },
    paramOrder: ['number', 'trackingUrl', 'eta'],
    content: { subject: null, text: 'Заказ №GL-1 принят', html: null },
    attachments: [],
    ...overrides,
  };
}
