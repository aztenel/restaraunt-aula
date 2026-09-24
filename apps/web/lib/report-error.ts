/** Отправить ошибку в Sentry из клиентского компонента (только если Sentry включён). */
export function reportError(error: unknown): void {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  void import('@sentry/nextjs').then((Sentry) => Sentry.captureException(error)).catch(() => undefined);
}
