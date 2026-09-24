/**
 * Публичная поверхность платформы для модулей. Модули импортируют инфраструктуру только отсюда
 * или из конкретных файлов shared/infrastructure/*.
 */
export * from './audit/audit-log';
export * from './config/config';
export * from './context/request-context';
export * from './crypto/secret-box';
export * from './database/database';
export * from './database/numbering';
export * from './events/decorators';
export * from './events/event-bus';
export * from './events/failed-jobs.service';
export * from './events/handler-executor';
export * from './events/types';
export * from './http/api-types';
export * from './http/decorators';
export * from './integrations/external-http';
export * from './integrations/integration-log';
export * from './integrations/masking';
export * from './pdf/pdf-renderer';
export * from './rate-limit/rate-limit.guard';
export * from './rate-limit/rate-limiter';
export * from './redis/redis';
export * from './settings/integration-catalog';
export * from './settings/integration-settings';
export * from './storage/file-storage';
export * from './xlsx/xlsx-builder';
