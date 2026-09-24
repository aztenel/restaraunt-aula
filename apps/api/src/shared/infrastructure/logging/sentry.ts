import * as Sentry from '@sentry/node';
import { Config } from '../config/config';

/** Сбор ошибок (Sentry). Без SENTRY_DSN — выключен. */
export function initSentry(config: Config, component: 'api' | 'worker'): void {
  const dsn = config.observability.sentryDsn;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: config.observability.sentryEnvironment,
    release: config.app.release,
    tracesSampleRate: 0.05,
    initialScope: { tags: { component } },
    sendDefaultPii: false,
  });
}
