import { randomUUID } from 'node:crypto';
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { parseLocale } from '../../kernel/translatable';
import { RequestContext } from '../context/request-context';

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.headers['x-request-id'];
    const requestId = typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    res.setHeader('x-request-id', requestId);
    const localeHeader = (req.headers['x-locale'] as string | undefined) ?? req.headers['accept-language']?.slice(0, 2);
    RequestContext.run(
      {
        requestId,
        actor: null,
        ip: req.ip ?? null,
        userAgent: req.headers['user-agent'] ?? null,
        locale: parseLocale(typeof req.query?.locale === 'string' ? req.query.locale : localeHeader),
      },
      () => next(),
    );
  }
}
