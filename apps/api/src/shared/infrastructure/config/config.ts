import { existsSync } from 'node:fs';
import { z } from 'zod';

/** Локальная разработка: подхватить apps/api/.env, если он есть (в контейнерах переменные задаёт окружение). */
export function loadEnvFileIfPresent(path = '.env'): void {
  if (process.env.NODE_ENV !== 'test' && existsSync(path)) {
    process.loadEnvFile(path);
  }
}

/**
 * Конфигурация из переменных окружения. Валидируется при старте: приложение не запускается
 * с неполной конфигурацией. Секреты интеграций (Kaspi, WhatsApp и т.д.) хранятся не здесь,
 * а в IntegrationSettings (шифруются в БД, управляются администратором системы).
 */
const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const DEV_JWT_SECRET = 'dev-only-jwt-secret-change-me-0123456789abcdef';
const DEV_ENCRYPTION_KEY = 'ZGV2LW9ubHktZW5jcnlwdGlvbi1rZXktMzJieXRlcyE='; // 32 bytes, только для dev/test

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY: bool.default(true),
  CORS_ORIGINS: z.string().default('http://localhost:3001,http://localhost:5173'),

  PUBLIC_WEB_URL: z.string().url().default('http://localhost:3001'),
  ADMIN_URL: z.string().url().default('http://localhost:5173'),
  API_PUBLIC_URL: z.string().url().default('http://localhost:3000'),

  DATABASE_URL: z.string().default('postgres://aula:aula@localhost:5432/aula'),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(20),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),

  REDIS_URL: z.string().default('redis://localhost:6379'),
  QUEUE_DRIVER: z.enum(['bullmq', 'inline']).default('bullmq'),
  QUEUE_PREFIX: z.string().default('aula'),
  // Для QUEUE_DRIVER=inline: выполнять задачи сразу после коммита (dev). В тестах — false, там drain() вручную.
  QUEUE_INLINE_AUTODRAIN: bool.default(true),

  JWT_SECRET: z.string().min(32).default(DEV_JWT_SECRET),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),
  APP_ENCRYPTION_KEY: z.string().default(DEV_ENCRYPTION_KEY),

  STORAGE_DRIVER: z.enum(['s3', 'local']).default('local'),
  LOCAL_STORAGE_DIR: z.string().default('./storage'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('aula'),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_PUBLIC_URL: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool.default(true),

  SENTRY_DSN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
  RELEASE: z.string().default('dev'),
  METRICS_TOKEN: z.string().optional(),
  SWAGGER_ENABLED: bool.default(true),
});

export type Env = z.infer<typeof EnvSchema>;

export class Config {
  readonly env: Env;

  constructor(source: Record<string, string | undefined> = process.env) {
    const parsed = EnvSchema.safeParse(source);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new Error(`Invalid configuration: ${issues}`);
    }
    this.env = parsed.data;
    if (this.isProduction) {
      if (this.env.JWT_SECRET === DEV_JWT_SECRET) throw new Error('JWT_SECRET must be set in production');
      if (this.env.APP_ENCRYPTION_KEY === DEV_ENCRYPTION_KEY) {
        throw new Error('APP_ENCRYPTION_KEY must be set in production');
      }
    }
    if (Buffer.from(this.env.APP_ENCRYPTION_KEY, 'base64').length !== 32) {
      throw new Error('APP_ENCRYPTION_KEY must be 32 bytes encoded in base64');
    }
  }

  get isProduction(): boolean {
    return this.env.NODE_ENV === 'production';
  }

  get isTest(): boolean {
    return this.env.NODE_ENV === 'test';
  }

  get app() {
    return {
      port: this.env.PORT,
      publicWebUrl: this.env.PUBLIC_WEB_URL.replace(/\/$/, ''),
      adminUrl: this.env.ADMIN_URL.replace(/\/$/, ''),
      apiPublicUrl: this.env.API_PUBLIC_URL.replace(/\/$/, ''),
      corsOrigins: this.env.CORS_ORIGINS.split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      trustProxy: this.env.TRUST_PROXY,
      release: this.env.RELEASE,
      swaggerEnabled: this.env.SWAGGER_ENABLED,
    };
  }

  get database() {
    return {
      url: this.env.DATABASE_URL,
      poolMax: this.env.DATABASE_POOL_MAX,
      statementTimeoutMs: this.env.DATABASE_STATEMENT_TIMEOUT_MS,
    };
  }

  get redis() {
    return { url: this.env.REDIS_URL };
  }

  get queue() {
    return { driver: this.env.QUEUE_DRIVER, prefix: this.env.QUEUE_PREFIX, inlineAutoDrain: this.env.QUEUE_INLINE_AUTODRAIN };
  }

  get auth() {
    return {
      jwtSecret: this.env.JWT_SECRET,
      accessTtlSeconds: this.env.JWT_ACCESS_TTL_SECONDS,
      refreshTtlDays: this.env.JWT_REFRESH_TTL_DAYS,
    };
  }

  get encryptionKey(): Buffer {
    return Buffer.from(this.env.APP_ENCRYPTION_KEY, 'base64');
  }

  get storage() {
    return {
      driver: this.env.STORAGE_DRIVER,
      localDir: this.env.LOCAL_STORAGE_DIR,
      s3: {
        endpoint: this.env.S3_ENDPOINT,
        region: this.env.S3_REGION,
        bucket: this.env.S3_BUCKET,
        accessKey: this.env.S3_ACCESS_KEY,
        secretKey: this.env.S3_SECRET_KEY,
        publicUrl: this.env.S3_PUBLIC_URL,
        forcePathStyle: this.env.S3_FORCE_PATH_STYLE,
      },
    };
  }

  get observability() {
    return {
      logLevel: this.env.LOG_LEVEL,
      sentryDsn: this.env.SENTRY_DSN,
      sentryEnvironment: this.env.SENTRY_ENVIRONMENT ?? this.env.NODE_ENV,
      metricsToken: this.env.METRICS_TOKEN,
    };
  }
}
