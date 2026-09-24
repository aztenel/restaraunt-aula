import { RequestMethod } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { RequestContext } from '../context/request-context';
import { Config } from '../config/config';

/**
 * Структурированные логи (JSON, pino). Секреты и платёжные данные вырезаются.
 * В dev — человекочитаемый вывод.
 */
export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.refreshToken',
  '*.accessToken',
  '*.secret',
  '*.secrets',
  '*.cardNumber',
  '*.cvv',
  '*.code',
];

export function loggerModule(config: Config) {
  return LoggerModule.forRoot({
    forRoutes: [{ path: '{*path}', method: RequestMethod.ALL }],
    pinoHttp: {
      level: config.observability.logLevel,
      redact: { paths: LOG_REDACT_PATHS, censor: '[redacted]' },
      genReqId: (req) => (req.headers['x-request-id'] as string) ?? undefined!,
      customProps: () => {
        const ctx = RequestContext.current();
        return { requestId: ctx?.requestId, userId: ctx?.actor?.userId ?? undefined };
      },
      autoLogging: { ignore: (req) => (req.url ?? '').startsWith('/health') || req.url === '/metrics' },
      transport:
        config.env.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { singleLine: true, translateTime: 'SYS:HH:MM:ss' } }
          : undefined,
    },
  });
}
