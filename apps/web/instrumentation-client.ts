/**
 * Sentry в браузере. NEXT_PUBLIC_SENTRY_DSN встраивается при сборке: без DSN SDK не загружается
 * вовсе (динамический импорт вырезается), что важно для скорости на мобильном 4G.
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  void import('@sentry/nextjs').then((Sentry) => {
    Sentry.init({
      dsn,
      environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV,
      release: process.env.NEXT_PUBLIC_RELEASE,
      tracesSampleRate: 0.05,
      sendDefaultPii: false,
    });
  });
}
