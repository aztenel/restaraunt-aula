/** Sentry для админки: подключается только при заданном VITE_SENTRY_DSN (отдельный чанк). */
export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;
  void import('@sentry/react').then((Sentry) => {
    Sentry.init({
      dsn,
      environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,
      release: import.meta.env.VITE_RELEASE,
      tracesSampleRate: 0.05,
      sendDefaultPii: false,
    });
  });
}

export function reportError(error: unknown): void {
  if (!import.meta.env.VITE_SENTRY_DSN) return;
  void import('@sentry/react').then((Sentry) => Sentry.captureException(error)).catch(() => undefined);
}
