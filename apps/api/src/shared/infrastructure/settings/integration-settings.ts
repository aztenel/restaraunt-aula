import { Injectable } from '@nestjs/common';
import { z, ZodType } from 'zod';
import { Clock } from '../../kernel/clock';
import { ValidationError } from '../../kernel/errors';
import { SecretBox } from '../crypto/secret-box';
import { Database } from '../database/database';

/**
 * Настройки интеграций (провайдеры оплаты, мессенджеры, POS, доставка, ЭСФ, 1С).
 * Управляет администратор системы из админки. Секреты хранятся зашифрованными
 * и никогда не отдаются наружу целиком.
 *
 * Ключи: '<модуль>.<провайдер>', например 'payments.kaspi', 'notifications.whatsapp'.
 * Начальные значения можно задать переменной окружения INTEGRATION__<KEY> (JSON),
 * где KEY — ключ с точками, заменёнными на '__': INTEGRATION__PAYMENTS__KASPI.
 */
export interface IntegrationSettingValue {
  key: string;
  enabled: boolean;
  config: Record<string, unknown>;
  secrets: Record<string, string>;
}

export interface IntegrationSettingView {
  key: string;
  enabled: boolean;
  config: Record<string, unknown>;
  /** Только имена заданных секретов и последние 4 символа. */
  secrets: Record<string, string>;
  updatedAt: Date | null;
}

const CACHE_TTL_MS = 30_000;

@Injectable()
export class IntegrationSettings {
  private cache = new Map<string, { value: IntegrationSettingValue | null; at: number }>();

  constructor(
    private readonly database: Database,
    private readonly box: SecretBox,
    private readonly clock: Clock,
  ) {}

  private fromEnv(key: string): IntegrationSettingValue | null {
    const envKey = `INTEGRATION__${key.replace(/\./g, '__').toUpperCase()}`;
    const raw = process.env[envKey];
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<IntegrationSettingValue>;
      return { key, enabled: parsed.enabled ?? true, config: parsed.config ?? {}, secrets: parsed.secrets ?? {} };
    } catch {
      throw new Error(`Invalid JSON in ${envKey}`);
    }
  }

  async getRaw(key: string): Promise<IntegrationSettingValue | null> {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
    const row: any = await this.database
      .db()
      .selectFrom('platform.integration_settings')
      .selectAll()
      .where('key', '=', key)
      .executeTakeFirst();
    const value: IntegrationSettingValue | null = row
      ? {
          key,
          enabled: row.enabled,
          config: row.config ?? {},
          secrets: row.secrets_encrypted ? (JSON.parse(this.box.decrypt(row.secrets_encrypted)) as Record<string, string>) : {},
        }
      : this.fromEnv(key);
    this.cache.set(key, { value, at: Date.now() });
    return value;
  }

  /**
   * Настройки, провалидированные схемой адаптера (config и secrets сливаются в один объект).
   * null — интеграция не настроена или выключена.
   */
  async get<T>(key: string, schema: ZodType<T>): Promise<T | null> {
    const raw = await this.getRaw(key);
    if (!raw || !raw.enabled) return null;
    const parsed = schema.safeParse({ ...raw.config, ...raw.secrets });
    if (!parsed.success) {
      throw new ValidationError('integration.misconfigured', `Integration ${key} is misconfigured`, {
        key,
        issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
    }
    return parsed.data;
  }

  async isEnabled(key: string): Promise<boolean> {
    return (await this.getRaw(key))?.enabled ?? false;
  }

  /**
   * Сохранить настройки. Пустая строка в secrets удаляет секрет, отсутствующий ключ — сохраняет прежний.
   */
  async set(
    key: string,
    input: { enabled: boolean; config: Record<string, unknown>; secrets?: Record<string, string | null> },
    userId: string | null,
  ): Promise<void> {
    if (!/^[a-z0-9_]+\.[a-z0-9_]+$/.test(key)) {
      throw new ValidationError('integration.invalid_key', 'Key must look like module.provider');
    }
    const current = await this.getRaw(key);
    const secrets: Record<string, string> = { ...(current?.secrets ?? {}) };
    for (const [name, value] of Object.entries(input.secrets ?? {})) {
      if (value === null || value === '') delete secrets[name];
      else secrets[name] = value;
    }
    const encrypted = Object.keys(secrets).length > 0 ? this.box.encrypt(JSON.stringify(secrets)) : null;
    await this.database
      .db()
      .insertInto('platform.integration_settings')
      .values({
        key,
        enabled: input.enabled,
        config: JSON.stringify(input.config),
        secrets_encrypted: encrypted,
        updated_at: this.clock.now(),
        updated_by: userId,
      })
      .onConflict((oc) =>
        oc.column('key').doUpdateSet({
          enabled: input.enabled,
          config: JSON.stringify(input.config),
          secrets_encrypted: encrypted,
          updated_at: this.clock.now(),
          updated_by: userId,
        }),
      )
      .execute();
    this.cache.delete(key);
  }

  async list(): Promise<IntegrationSettingView[]> {
    const rows: any[] = await this.database.db().selectFrom('platform.integration_settings').selectAll().orderBy('key').execute();
    return rows.map((row) => {
      const secrets = row.secrets_encrypted ? (JSON.parse(this.box.decrypt(row.secrets_encrypted)) as Record<string, string>) : {};
      return {
        key: row.key,
        enabled: row.enabled,
        config: row.config ?? {},
        secrets: Object.fromEntries(Object.entries(secrets).map(([k, v]) => [k, v.length > 4 ? `***${v.slice(-4)}` : '***'])),
        updatedAt: row.updated_at,
      };
    });
  }

  invalidate(key?: string): void {
    if (key) this.cache.delete(key);
    else this.cache.clear();
  }
}

/** Общие схемы для адаптеров. */
export const zUrl = z.string().url();
