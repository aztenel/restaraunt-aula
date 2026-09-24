/**
 * Динамическая форма интеграции по описанию адаптера (IntegrationCatalog на сервере).
 * Секреты сервер отдаёт замаскированными; в запрос попадают только изменённые секреты:
 * новое значение — заменить, null — удалить, отсутствие ключа — оставить прежнее.
 */
import type { IntegrationDescriptor, IntegrationSetting, SaveIntegrationSetting } from '@aula/api-client';

export interface IntegrationFormValues {
  enabled: boolean;
  config: Record<string, unknown>;
  /** Новые значения секретов (пусто — не менять). */
  secrets: Record<string, string | undefined>;
  /** Секреты, отмеченные к удалению. */
  clearSecrets: Record<string, boolean | undefined>;
  /** Конфигурация целиком JSON-строкой (адаптеры без описания полей). */
  rawConfig?: string;
}

export function initialFormValues(descriptor: IntegrationDescriptor, setting: IntegrationSetting | undefined): IntegrationFormValues {
  const config: Record<string, unknown> = {};
  for (const field of descriptor.fields) {
    if (field.secret) continue;
    const value = setting?.config[field.name];
    config[field.name] = field.type === 'json' && value !== undefined ? JSON.stringify(value, null, 2) : value;
  }
  return {
    enabled: setting?.enabled ?? false,
    config,
    secrets: {},
    clearSecrets: {},
    rawConfig: descriptor.fields.length === 0 ? JSON.stringify(setting?.config ?? {}, null, 2) : undefined,
  };
}

/** Значения формы → тело PUT /admin/system/integrations/{key}. JSON-поля разбираются (ошибка — исключение). */
export function toSavePayload(descriptor: IntegrationDescriptor, values: IntegrationFormValues): SaveIntegrationSetting {
  let config: Record<string, unknown> = {};
  if (descriptor.fields.length === 0) {
    config = values.rawConfig?.trim() ? (JSON.parse(values.rawConfig) as Record<string, unknown>) : {};
  } else {
    for (const field of descriptor.fields) {
      if (field.secret) continue;
      const value = values.config[field.name];
      if (value === undefined || value === '') continue;
      config[field.name] = field.type === 'json' && typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
    }
  }
  const secrets: Record<string, string | null> = {};
  for (const field of descriptor.fields.filter((f) => f.secret)) {
    if (values.clearSecrets[field.name]) secrets[field.name] = null;
    else if (values.secrets[field.name]) secrets[field.name] = values.secrets[field.name]!;
  }
  return { enabled: values.enabled, config, ...(Object.keys(secrets).length > 0 ? { secrets } : {}) };
}

export function isValidJson(text: string | undefined): boolean {
  if (!text?.trim()) return true;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}
