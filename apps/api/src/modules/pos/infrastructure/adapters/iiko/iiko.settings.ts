import { z } from 'zod';
import { IntegrationDescriptor } from '../../../../../shared/infrastructure/settings/integration-catalog';

/** Провайдер iiko (iikoCloud API). Имя встречается только в адаптере, модуле и конфигурации. */
export const IIKO_PROVIDER = 'iiko';
export const IIKO_SETTINGS_KEY = 'pos.iiko';
export const IIKO_DEFAULT_BASE_URL = 'https://api-ru.iiko.services';
/** Токен iikoCloud живёт час; обновляем с запасом. */
export const IIKO_TOKEN_TTL_MS = 50 * 60_000;

export const IikoBranchSchema = z.object({
  organizationId: z.string().trim().min(1),
  terminalGroupId: z.string().trim().min(1).nullish(),
});
export type IikoBranchSettings = z.infer<typeof IikoBranchSchema>;

export const IikoSettingsSchema = z.object({
  apiLogin: z.string().trim().min(1),
  baseUrl: z
    .string()
    .url()
    .default(IIKO_DEFAULT_BASE_URL)
    .transform((u) => u.replace(/\/+$/, '')),
  /** { '<branchId>': { organizationId, terminalGroupId } } */
  branches: z.record(IikoBranchSchema).default({}),
  timeoutMs: z.coerce.number().int().min(1_000).max(60_000).default(15_000),
});
export type IikoSettings = z.infer<typeof IikoSettingsSchema>;

export const IIKO_INTEGRATION: IntegrationDescriptor = {
  key: IIKO_SETTINGS_KEY,
  title: 'iiko (iikoCloud API)',
  category: 'pos',
  stage: 3,
  description:
    'Передача заказов на кухню, стоп-лист и номенклатура из iikoCloud. Филиал направляется в iiko настройкой «POS: маршрутизация» (pos.routing).',
  fields: [
    { name: 'apiLogin', label: 'API-логин iikoCloud', type: 'string', secret: true, required: true, help: 'iikoWeb → Настройки → API-логины' },
    { name: 'baseUrl', label: 'Адрес API', type: 'url', help: `По умолчанию ${IIKO_DEFAULT_BASE_URL}` },
    {
      name: 'branches',
      label: 'Организации и группы терминалов по филиалам',
      type: 'json',
      required: true,
      help: '{ "<id филиала>": { "organizationId": "<GUID организации>", "terminalGroupId": "<GUID группы терминалов>" } }',
    },
    { name: 'timeoutMs', label: 'Таймаут запроса, мс', type: 'number', help: 'По умолчанию 15000' },
  ],
};
